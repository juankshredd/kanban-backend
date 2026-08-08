const pool = require('../db');

// ----------------------------
// Tipos y estados permitidos
// ----------------------------
const TASK_TYPES = ['EPIC', 'STORY', 'TASK', 'BUG'];
const DEFAULT_TASK_TYPE = 'STORY';

const STATUS_MAP = {
  todo: 'TODO',
  in_progress: 'IN_PROGRESS',
  done: 'DONE'
};

/**
 * Proyección común a todas las lecturas.
 *
 * El ticket id visible (KAN-42) no se guarda: se arma con la key del proyecto y
 * el número de ticket, así renombrar no deja ids desincronizados.
 */
const TASK_SELECT = `
  SELECT
    t.id,
    p.key || '-' || t.ticket_number AS ticket_id,
    t.ticket_number,
    t.title,
    t.description,
    t.status,
    t.type,
    t.project_id,
    t.sprint_id,
    p.key AS project_key,
    p.name AS project_name,
    t.user_id,
    u.username AS user_name,
    t.created_at,
    t.updated_at
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  LEFT JOIN users u ON u.id = t.user_id
`;

// Devuelve el valor del ENUM o null si no es válido.
const normalizeType = (type) => {
  const normalized = String(type).toUpperCase();
  return TASK_TYPES.includes(normalized) ? normalized : null;
};

const normalizeStatus = (status) => STATUS_MAP[String(status).toLowerCase()] || null;

// ----------------------------
// Crear tarea dentro de un proyecto
// ----------------------------
const createTask = async (req, res) => {
  const user_id = req.user.id;
  const project_id = req.project.id;      // lo dejó el middleware de acceso
  const { title, description, type } = req.body;

  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ message: 'Title is required' });
  }

  let typeNormalized = DEFAULT_TASK_TYPE;
  if (type !== undefined && type !== null && String(type).trim() !== '') {
    typeNormalized = normalizeType(type);

    if (!typeNormalized) {
      return res.status(400).json({ message: 'Invalid type value' });
    }
  }

  // El número de ticket sale de un contador por proyecto que se incrementa de
  // forma atómica: con MAX(ticket_number)+1 dos usuarios creando a la vez se
  // llevarían el mismo número. Va en transacción para que el contador no se
  // consuma si después falla el INSERT.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const counter = await client.query(
      `
      UPDATE projects
      SET next_ticket_number = next_ticket_number + 1
      WHERE id = $1
      RETURNING key, next_ticket_number - 1 AS ticket_number;
      `,
      [project_id]
    );

    const { key, ticket_number } = counter.rows[0];

    const newTask = await client.query(
      `
      INSERT INTO tasks (id, project_id, ticket_number, user_id, title, description, type)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
      RETURNING *;
      `,
      [project_id, ticket_number, user_id, title.trim(), description || null, typeNormalized]
    );

    await client.query('COMMIT');

    res.status(201).json({
      ...newTask.rows[0],
      ticket_id: `${key}-${ticket_number}`,
      project_key: key
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("CREATE TASK ERROR:", error);
    res.status(500).json({ message: 'Server error' });

  } finally {
    client.release();
  }
};

// Filtros opcionales compartidos por los dos listados.
const buildTaskFilters = (query, values) => {
  const filters = [];

  if (query.status !== undefined) {
    const statusNormalized = normalizeStatus(query.status);
    if (!statusNormalized) return { error: 'Invalid status value' };

    values.push(statusNormalized);
    filters.push(`t.status = $${values.length}`);
  }

  if (query.type !== undefined) {
    const typeNormalized = normalizeType(query.type);
    if (!typeNormalized) return { error: 'Invalid type value' };

    values.push(typeNormalized);
    filters.push(`t.type = $${values.length}`);
  }

  // sprint_id=backlog es la palabra clave para "sin sprint asignado", porque
  // NULL no se puede mandar como valor de query string.
  if (query.sprint_id !== undefined) {
    if (query.sprint_id === 'backlog') {
      filters.push('t.sprint_id IS NULL');
    } else {
      values.push(query.sprint_id);
      filters.push(`t.sprint_id = $${values.length}`);
    }
  }

  return { filters };
};

// ----------------------------
// Tareas de un proyecto (el board)
// ----------------------------
const getProjectTasks = async (req, res) => {
  const values = [req.project.id];
  const { filters, error } = buildTaskFilters(req.query, values);

  if (error) {
    return res.status(400).json({ message: error });
  }

  try {
    const tasks = await pool.query(
      `
      ${TASK_SELECT}
      WHERE t.project_id = $1
        ${filters.map((f) => `AND ${f}`).join(' ')}
      ORDER BY t.created_at DESC;
      `,
      values
    );

    res.status(200).json(tasks.rows);

  } catch (error) {
    // uuid mal formado en el filtro sprint_id
    if (error.code === '22P02') {
      return res.status(400).json({ message: 'Invalid sprint_id' });
    }

    console.error("GET PROJECT TASKS ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Tareas del usuario en todos sus proyectos ("mi trabajo")
// ----------------------------
const getMyTasks = async (req, res) => {
  const values = [req.user.id];
  const { filters, error } = buildTaskFilters(req.query, values);

  if (error) {
    return res.status(400).json({ message: error });
  }

  // Filtro opcional por proyecto, para que el front pueda reusar este endpoint
  // sin cambiar de ruta.
  if (req.query.project_id !== undefined) {
    values.push(req.query.project_id);
    filters.push(`t.project_id = $${values.length}`);
  }

  try {
    const tasks = await pool.query(
      `
      ${TASK_SELECT}
      JOIN project_members pm
        ON pm.project_id = t.project_id AND pm.user_id = $1
      ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
      ORDER BY t.created_at DESC;
      `,
      values
    );

    res.status(200).json(tasks.rows);

  } catch (error) {
    // uuid mal formado en el filtro project_id o sprint_id
    if (error.code === '22P02') {
      return res.status(400).json({ message: 'Invalid project_id or sprint_id' });
    }

    console.error("GET MY TASKS ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Actualizar una tarea (status, type y/o sprint_id)
// ----------------------------
const updateTask = async (req, res) => {
  const project_id = req.project.id;
  const { id } = req.params;
  const { status, type } = req.body;
  // 'sprint_id' in body distingue "no lo mandaron" de "lo mandaron en null"
  // (mover a Backlog), que un simple !== undefined no puede.
  const hasSprintId = Object.prototype.hasOwnProperty.call(req.body, 'sprint_id');
  const { sprint_id } = req.body;

  if (status === undefined && type === undefined && !hasSprintId) {
    return res.status(400).json({ message: 'Nothing to update: send status, type and/or sprint_id' });
  }

  const updates = [];
  const values = [];

  if (status !== undefined) {
    const statusNormalized = normalizeStatus(status);

    if (!statusNormalized) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    values.push(statusNormalized);
    updates.push(`status = $${values.length}`);
  }

  if (type !== undefined) {
    const typeNormalized = normalizeType(type);

    if (!typeNormalized) {
      return res.status(400).json({ message: 'Invalid type value' });
    }

    values.push(typeNormalized);
    updates.push(`type = $${values.length}`);
  }

  if (hasSprintId) {
    if (sprint_id === null) {
      // Mover al Backlog.
      updates.push('sprint_id = NULL');
    } else {
      // El sprint tiene que ser del mismo proyecto: si no, una tarea podría
      // terminar apuntando al sprint de un proyecto ajeno.
      try {
        const sprint = await pool.query(
          `SELECT id FROM sprints WHERE id = $1 AND project_id = $2;`,
          [sprint_id, project_id]
        );

        if (sprint.rows.length === 0) {
          return res.status(400).json({ message: 'sprint_id does not belong to this project' });
        }
      } catch (error) {
        if (error.code === '22P02') {
          return res.status(400).json({ message: 'Invalid sprint_id' });
        }
        throw error;
      }

      values.push(sprint_id);
      updates.push(`sprint_id = $${values.length}`);
    }
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  values.push(id, project_id);

  try {
    // El filtro por project_id cierra el caso de pedir una tarea de otro
    // proyecto usando la ruta anidada de uno propio.
    const updated = await pool.query(
      `
      UPDATE tasks
      SET ${updates.join(', ')}
      WHERE id = $${values.length - 1} AND project_id = $${values.length}
      RETURNING id;
      `,
      values
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const task = await pool.query(`${TASK_SELECT} WHERE t.id = $1;`, [id]);

    res.status(200).json(task.rows[0]);

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Task not found' });
    }

    console.error("UPDATE TASK ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Actualizar solo el tipo
// ----------------------------
const updateTaskType = async (req, res) => {
  if (req.body.type === undefined) {
    return res.status(400).json({ message: 'Type is required' });
  }

  // Misma lógica que updateTask, restringida al tipo.
  req.body = { type: req.body.type };

  return updateTask(req, res);
};

// ----------------------------
// Borrar una tarea
// ----------------------------
const deleteTask = async (req, res) => {
  const project_id = req.project.id;
  const { id } = req.params;

  try {
    const taskResult = await pool.query(
      `SELECT status FROM tasks WHERE id = $1 AND project_id = $2;`,
      [id, project_id]
    );

    if (taskResult.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Regla de negocio: solo se borra lo que todavía no se empezó.
    if (taskResult.rows[0].status !== 'TODO') {
      return res.status(400).json({
        message: 'Only tasks with status TODO can be deleted'
      });
    }

    await pool.query(`DELETE FROM tasks WHERE id = $1;`, [id]);

    res.json({ message: 'Task deleted successfully' });

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Task not found' });
    }

    console.error("DELETE TASK ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Exportar funciones
// ----------------------------
module.exports = {
  createTask,
  getProjectTasks,
  getMyTasks,
  updateTask,
  updateTaskType,
  deleteTask
};
