const pool = require('../db');
const { TASK_SELECT } = require('./taskController');
const { fetchRelationsForTask } = require('./taskRelationController');

// ----------------------------
// Board: el sprint activo del proyecto + sus tareas, en un solo request
// ----------------------------
// Deliberadamente separado de sprintController.getActiveSprint (liviano, sin
// tareas, usado en widgets como "Current Sprint") para no inflar esa
// respuesta con la lista completa de tareas cuando no hace falta.
const getBoard = async (req, res) => {
  const project_id = req.project.id;

  try {
    const activeSprint = await pool.query(
      `SELECT * FROM sprints WHERE project_id = $1 AND status = 'ACTIVE';`,
      [project_id]
    );

    if (activeSprint.rows.length === 0) {
      return res.status(404).json({ message: 'No active sprint' });
    }

    const sprint = activeSprint.rows[0];

    const tasks = await pool.query(
      `${TASK_SELECT} WHERE t.project_id = $1 AND t.sprint_id = $2 ORDER BY t.rank;`,
      [project_id, sprint.id]
    );

    res.status(200).json({ sprint, tasks: tasks.rows });

  } catch (error) {
    console.error("GET BOARD ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Backlog: sprints futuros (PLANNED) con sus tareas + el Backlog propiamente
// dicho (sprint_id NULL), en un solo request. 3 queries fijas sin importar
// cuántos sprints futuros haya, en vez de 1 + N si el front tuviera que pedir
// las tareas de cada sprint por separado.
// ----------------------------
const getBacklogView = async (req, res) => {
  const project_id = req.project.id;

  try {
    const sprints = await pool.query(
      `
      SELECT * FROM sprints
      WHERE project_id = $1 AND status = 'PLANNED'
      ORDER BY start_date NULLS LAST, created_at;
      `,
      [project_id]
    );

    const backlogTasks = await pool.query(
      `${TASK_SELECT} WHERE t.project_id = $1 AND t.sprint_id IS NULL ORDER BY t.rank;`,
      [project_id]
    );

    const sprintIds = sprints.rows.map((s) => s.id);
    const sprintTasks = sprintIds.length
      ? await pool.query(
          `${TASK_SELECT} WHERE t.sprint_id = ANY($1) ORDER BY t.rank;`,
          [sprintIds]
        )
      : { rows: [] };

    const tasksBySprintId = {};
    for (const task of sprintTasks.rows) {
      if (!tasksBySprintId[task.sprint_id]) {
        tasksBySprintId[task.sprint_id] = [];
      }
      tasksBySprintId[task.sprint_id].push(task);
    }

    res.status(200).json({
      sprints: sprints.rows.map((s) => ({ ...s, tasks: tasksBySprintId[s.id] || [] })),
      backlog: backlogTasks.rows
    });

  } catch (error) {
    console.error("GET BACKLOG ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Jerarquía: EPIC -> FEATURE -> STORY -> TASK/BUG de todo el proyecto, en un
// solo request. Una sola consulta (todas las tareas del proyecto) + un
// agrupado en memoria por parent_id, en vez de que el front tenga que pedir
// los hijos de cada nodo por separado (1 + N). La cadena es de profundidad
// fija (4 niveles), así que el anidado es un loop, no una consulta
// recursiva.
// ----------------------------
const getTaskHierarchy = async (req, res) => {
  const project_id = req.project.id;

  try {
    const tasks = await pool.query(
      `${TASK_SELECT} WHERE t.project_id = $1 ORDER BY t.rank;`,
      [project_id]
    );

    // Dos pasadas O(n), sin recursión: la primera crea un wrapper por tarea
    // con su propio array 'children' vacío; la segunda empuja cada wrapper
    // en el array de su padre. Como se empujan referencias al mismo objeto
    // creado en la primera pasada, el anidado queda armado sin importar el
    // orden de las filas ni la profundidad.
    const byId = {};
    for (const task of tasks.rows) {
      byId[task.id] = { ...task, children: [] };
    }
    for (const task of tasks.rows) {
      if (task.parent_id && byId[task.parent_id]) {
        byId[task.parent_id].children.push(byId[task.id]);
      }
    }

    // Raíz = sin padre, sea cual sea el tipo: no solo EPICs. parent_id es
    // opcional para todos los tipos (una STORY puede no tener FEATURE todavía),
    // así que filtrar por type === 'EPIC' dejaba esas tareas sin padre fuera
    // de la respuesta aunque existieran y fueran válidas.
    const roots = tasks.rows
      .filter((task) => !task.parent_id)
      .map((task) => byId[task.id]);

    res.status(200).json({ roots });

  } catch (error) {
    console.error("GET TASK HIERARCHY ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Detalle de una tarea: tarea + padre + children + relaciones (ya agrupadas y
// con el label resuelto) + sprint, en un solo request. Mismo criterio que
// getBoard/getBacklogView/getTaskHierarchy: la pantalla del modal de detalle
// necesita todo esto junto, no armado a mano con 4-5 llamadas por el frontend.
// ----------------------------
const getTaskDetail = async (req, res) => {
  const project_id = req.project.id;
  const { id } = req.params;

  try {
    const taskResult = await pool.query(`${TASK_SELECT} WHERE t.id = $1 AND t.project_id = $2;`, [id, project_id]);

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const task = taskResult.rows[0];

    // Las cuatro son independientes entre sí (solo dependen de `task`, ya
    // resuelta arriba), así que corren en paralelo en vez de 4 round trips
    // secuenciales -- la latencia de esta pantalla es la del más lento de los
    // cuatro, no la suma.
    const [parentResult, childrenResult, relations, sprintResult] = await Promise.all([
      task.parent_id
        ? pool.query(`${TASK_SELECT} WHERE t.id = $1 AND t.project_id = $2;`, [task.parent_id, project_id])
        : Promise.resolve({ rows: [] }),
      pool.query(`${TASK_SELECT} WHERE t.parent_id = $1 AND t.project_id = $2 ORDER BY t.rank;`, [id, project_id]),
      fetchRelationsForTask(id, project_id),
      task.sprint_id
        ? pool.query(`SELECT id, name, start_date, end_date FROM sprints WHERE id = $1 AND project_id = $2;`, [task.sprint_id, project_id])
        : Promise.resolve({ rows: [] })
    ]);

    // Agrupado por el label ya resuelto (relates to / blocks / is blocked
    // by / ...), la misma forma que el picker del modal necesita para
    // renderizar cada grupo -- sin esto el frontend tendría que agrupar en
    // cliente lo que ya sabemos agrupar acá.
    const relationsGrouped = {};
    for (const relation of relations) {
      if (!relationsGrouped[relation.type]) {
        relationsGrouped[relation.type] = [];
      }
      relationsGrouped[relation.type].push(relation);
    }

    res.status(200).json({
      task,
      parent: parentResult.rows[0] || null,
      children: childrenResult.rows,
      relations: relationsGrouped,
      sprint: sprintResult.rows[0] || null
    });

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Task not found' });
    }

    console.error("GET TASK DETAIL ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { getBoard, getBacklogView, getTaskHierarchy, getTaskDetail };
