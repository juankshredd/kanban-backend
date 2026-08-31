const pool = require('../db');
const { TASK_SELECT } = require('./taskController');

// Chequeo de existencia reusado por getRelations y deleteRelation (createRelation
// necesita confirmar dos ids en una sola query, así que no aplica ahí).
const findTaskInProject = async (id, projectId) => {
  const result = await pool.query(
    `SELECT id FROM tasks WHERE id = $1 AND project_id = $2;`,
    [id, projectId]
  );

  return result.rows[0] || null;
};

// ----------------------------
// Crear un link "related to" entre dos tareas del mismo proyecto
// ----------------------------
const createRelation = async (req, res) => {
  const project_id = req.project.id;
  const { id } = req.params;
  const { related_task_id } = req.body || {};

  if (!related_task_id || typeof related_task_id !== 'string') {
    return res.status(400).json({ message: 'related_task_id is required' });
  }

  // Comparación case-insensitive: un UUID es el mismo valor sin importar el
  // casing, y Postgres lo trata así, pero '===' entre strings de JS no.
  if (related_task_id.toLowerCase() === id.toLowerCase()) {
    return res.status(400).json({ message: 'A task cannot be related to itself' });
  }

  try {
    // Una sola query confirma que las dos tareas existen en este proyecto,
    // en vez de una consulta por cada una.
    const tasks = await pool.query(
      `SELECT id FROM tasks WHERE id = ANY($1) AND project_id = $2;`,
      [[id, related_task_id], project_id]
    );

    if (tasks.rows.length < 2) {
      return res.status(404).json({ message: 'Task or related_task_id not found in this project' });
    }

    const relation = await pool.query(
      `
      INSERT INTO task_relations (id, task_id, related_task_id, created_by)
      VALUES (gen_random_uuid(), $1, $2, $3)
      RETURNING *;
      `,
      [id, related_task_id, req.user.id]
    );

    res.status(201).json(relation.rows[0]);

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Task or related_task_id not found in this project' });
    }

    // Índice único del par (LEAST/GREATEST): ya existía esta relación,
    // insertada en cualquiera de los dos órdenes.
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Tasks are already related' });
    }

    // Una de las dos tareas (o, en el caso límite de un usuario borrado entre
    // la emisión del JWT y este INSERT, el propio autor) era válida al
    // chequearla pero dejó de existir antes de que este INSERT corriera. El
    // nombre de la FK violada dice cuál.
    if (error.code === '23503') {
      const FK_MESSAGES = {
        task_relations_task_id_fkey: 'Task no longer exists',
        task_relations_created_by_fkey: 'Acting user no longer exists'
      };
      const message = FK_MESSAGES[error.constraint] || 'related_task_id no longer exists';
      return res.status(409).json({ message });
    }

    console.error("CREATE TASK RELATION ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Listar las tareas relacionadas con una tarea dada
// ----------------------------
const getRelations = async (req, res) => {
  const project_id = req.project.id;
  const { id } = req.params;

  try {
    const task = await findTaskInProject(id, project_id);

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // La relación se guardó en cualquiera de los dos órdenes; el CASE resuelve
    // "la otra tarea" sin importar cuál.
    const relations = await pool.query(
      `
      SELECT
        id AS relation_id,
        created_at,
        CASE WHEN task_id = $1 THEN related_task_id ELSE task_id END AS related_task_id
      FROM task_relations
      WHERE task_id = $1 OR related_task_id = $1
      ORDER BY created_at;
      `,
      [id]
    );

    if (relations.rows.length === 0) {
      return res.status(200).json([]);
    }

    // Mismo patrón que getBacklogView: ids primero, después un solo SELECT
    // con ANY($1) reusando TASK_SELECT, merge en JS -- en vez de un JOIN
    // encima del CASE de arriba, que forzaría reescribir el FROM fijo de
    // TASK_SELECT.
    // t.project_id = $2 es defensa en profundidad, no solo un filtro: hoy
    // task_relations solo puede tener pares del mismo proyecto porque
    // createRelation lo valida, pero esta query no debería depender de ese
    // invariante siendo el único guardián -- mismo criterio que el resto del
    // controller layer (ver "Task rules" en CLAUDE.md).
    const relatedTaskIds = relations.rows.map((row) => row.related_task_id);
    const tasks = await pool.query(
      `${TASK_SELECT} WHERE t.id = ANY($1) AND t.project_id = $2;`,
      [relatedTaskIds, project_id]
    );
    const tasksById = Object.fromEntries(tasks.rows.map((task) => [task.id, task]));

    // Las dos queries no van en la misma transacción: si la tarea relacionada
    // se borra justo en el medio (lo que además CASCADEa y borra la fila de
    // task_relations), tasksById no la va a tener. Se descarta ese item en vez
    // de devolver un { relation_id, task: undefined } que rompería a un
    // cliente que asume row.task.id -- coincide con el estado real después de
    // la carrera: esa relación ya no existe.
    const result = relations.rows
      .map((row) => ({
        relation_id: row.relation_id,
        related_since: row.created_at,
        task: tasksById[row.related_task_id]
      }))
      .filter((row) => row.task !== undefined);

    res.status(200).json(result);

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Task not found' });
    }

    console.error("GET TASK RELATIONS ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Borrar un link "related to"
// ----------------------------
const deleteRelation = async (req, res) => {
  const project_id = req.project.id;
  const { id, relatedTaskId } = req.params;

  // Try/catch separado del de abajo: para cuando llegamos a la query de
  // DELETE, :id ya se probó válido y existente, así que un 22P02 ahí solo
  // puede venir de relatedTaskId -- de lo contrario un relatedTaskId mal
  // formado terminaría reportado como "Task not found" (la tarea ancla, que
  // sí existe).
  let task;
  try {
    task = await findTaskInProject(id, project_id);
  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Task not found' });
    }

    console.error("DELETE TASK RELATION ERROR:", error);
    return res.status(500).json({ message: 'Server error' });
  }

  if (!task) {
    return res.status(404).json({ message: 'Task not found' });
  }

  try {
    // El OR cubre los dos órdenes en los que el par pudo haberse insertado.
    const deleted = await pool.query(
      `
      DELETE FROM task_relations
      WHERE (task_id = $1 AND related_task_id = $2) OR (task_id = $2 AND related_task_id = $1)
      RETURNING id;
      `,
      [id, relatedTaskId]
    );

    if (deleted.rows.length === 0) {
      return res.status(404).json({ message: 'Relation not found' });
    }

    res.json({ message: 'Relation removed successfully' });

  } catch (error) {
    // relatedTaskId mal formado: nunca puede matchear una relación real.
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Relation not found' });
    }

    console.error("DELETE TASK RELATION ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createRelation,
  getRelations,
  deleteRelation
};
