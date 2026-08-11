const pool = require('../db');
const { TASK_SELECT } = require('./taskController');

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

module.exports = { getBoard, getBacklogView };
