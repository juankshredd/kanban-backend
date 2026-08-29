const pool = require('../db');

// ----------------------------
// Tipos y estados permitidos
// ----------------------------
const TASK_TYPES = ['EPIC', 'STORY', 'TASK', 'BUG'];
const DEFAULT_TASK_TYPE = 'STORY';

// Campos propios de `details` según el tipo de tarjeta. Único lugar a tocar
// para agregar un campo o un tipo nuevo: no hace falta migración.
const TASK_DETAIL_FIELDS = {
  EPIC: [],
  STORY: ['acceptance_criteria'],
  TASK: [],
  BUG: ['steps_to_reproduce', 'expected_behavior', 'actual_behavior']
};

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
    t.rank,
    t.details,
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

// Valida `details` contra la lista de campos permitidos para el tipo dado.
// Reemplazo total (no merge parcial): mandar `{}` borra todos los campos.
const normalizeDetails = (type, details) => {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) {
    return { error: 'details must be an object' };
  }

  const allowedFields = TASK_DETAIL_FIELDS[type] || [];
  const normalized = {};

  for (const [key, value] of Object.entries(details)) {
    if (!allowedFields.includes(key)) {
      return { error: `"${key}" is not a valid detail field for type ${type}` };
    }

    if (value !== null && typeof value !== 'string') {
      return { error: `"${key}" must be a string` };
    }

    normalized[key] = value === null ? null : value.trim();
  }

  return { value: normalized };
};

// ----------------------------
// Crear tarea dentro de un proyecto
// ----------------------------
const createTask = async (req, res) => {
  const user_id = req.user.id;
  const project_id = req.project.id;      // lo dejó el middleware de acceso
  const { title, description, type, details } = req.body || {};

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

  let detailsNormalized = {};
  if (details !== undefined) {
    const { error: detailsError, value } = normalizeDetails(typeNormalized, details);

    if (detailsError) {
      return res.status(400).json({ message: detailsError });
    }

    detailsNormalized = value;
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

    // Rank global por proyecto (ver migración 013): una tarea nueva entra al
    // final de la secuencia, o sea al fondo del Backlog.
    const rankResult = await client.query(
      `SELECT COALESCE(MAX(rank), 0) + 1000 AS next_rank FROM tasks WHERE project_id = $1;`,
      [project_id]
    );
    const nextRank = rankResult.rows[0].next_rank;

    const newTask = await client.query(
      `
      INSERT INTO tasks (id, project_id, ticket_number, user_id, title, description, type, rank, details)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
      `,
      [project_id, ticket_number, user_id, title.trim(), description || null, typeNormalized, nextRank, detailsNormalized]
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
      ORDER BY t.rank;
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
// Actualizar una tarea (status, type, sprint_id y/o posición en el board/backlog)
// ----------------------------
const updateTask = async (req, res) => {
  const project_id = req.project.id;
  const { id } = req.params;
  const body = req.body || {};
  const { status, type } = body;
  // 'sprint_id' y 'after_task_id' usan hasOwnProperty en vez de !== undefined
  // para distinguir "no lo mandaron" de "lo mandaron en null" (mover al
  // Backlog / mover al principio de la lista, respectivamente).
  const hasSprintId = Object.prototype.hasOwnProperty.call(body, 'sprint_id');
  const { sprint_id } = body;
  const hasAfterTaskId = Object.prototype.hasOwnProperty.call(body, 'after_task_id');
  const { after_task_id } = body;
  // Igual que sprint_id/after_task_id: hay que distinguir "no lo mandaron" de
  // "lo mandaron en {}" (borrar todos los campos del tipo actual).
  const hasDetails = Object.prototype.hasOwnProperty.call(body, 'details');
  const { details } = body;

  if (status === undefined && type === undefined && !hasSprintId && !hasAfterTaskId && !hasDetails) {
    return res.status(400).json({
      message: 'Nothing to update: send status, type, sprint_id, details and/or after_task_id'
    });
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

  // Se guarda afuera del if: el bloque de 'details' de más abajo lo necesita
  // para saber contra qué tipo validar cuando el tipo cambia en el mismo request.
  let typeNormalized;
  if (type !== undefined) {
    typeNormalized = normalizeType(type);

    if (!typeNormalized) {
      return res.status(400).json({ message: 'Invalid type value' });
    }

    values.push(typeNormalized);
    updates.push(`type = $${values.length}`);
  }

  // El tipo cambia pero 'details' no viene en este request: hay que chequear
  // que los details ya guardados sigan siendo válidos para el tipo nuevo (si
  // no, quedarían campos huérfanos de un tipo que la tarea ya no tiene). Pasa
  // también cuando esto se llama desde updateTaskType, que reenvía solo
  // { type }.
  if (typeNormalized && !hasDetails) {
    try {
      const current = await pool.query(
        `SELECT details FROM tasks WHERE id = $1 AND project_id = $2;`,
        [id, project_id]
      );

      if (current.rows.length === 0) {
        return res.status(404).json({ message: 'Task not found' });
      }

      const { error: detailsError } = normalizeDetails(typeNormalized, current.rows[0].details || {});

      if (detailsError) {
        return res.status(400).json({
          message: `Cannot change type: existing details are incompatible with the new type (${detailsError}). Send details explicitly to update them.`
        });
      }
    } catch (error) {
      if (error.code === '22P02') {
        return res.status(404).json({ message: 'Task not found' });
      }
      throw error;
    }
  }

  if (hasDetails) {
    // Si el tipo no cambia en este mismo request, hay que leer el actual para
    // saber contra qué lista de campos validar 'details'.
    let effectiveType = typeNormalized;

    if (!effectiveType) {
      try {
        const current = await pool.query(
          `SELECT type FROM tasks WHERE id = $1 AND project_id = $2;`,
          [id, project_id]
        );

        if (current.rows.length === 0) {
          return res.status(404).json({ message: 'Task not found' });
        }

        effectiveType = current.rows[0].type;
      } catch (error) {
        if (error.code === '22P02') {
          return res.status(404).json({ message: 'Task not found' });
        }
        throw error;
      }
    }

    const { error: detailsError, value: detailsValue } = normalizeDetails(effectiveType, details);

    if (detailsError) {
      return res.status(400).json({ message: detailsError });
    }

    values.push(detailsValue);
    updates.push(`details = $${values.length}`);
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

  if (hasAfterTaskId) {
    try {
      // El destino (Board de un sprint, o Backlog) es el sprint_id que la
      // tarea va a tener después de este mismo request. Si no vino en el
      // body, hay que leer el actual para saber en qué lista reordenar.
      let destinationSprintId = sprint_id;

      if (!hasSprintId) {
        const current = await pool.query(
          `SELECT sprint_id FROM tasks WHERE id = $1 AND project_id = $2;`,
          [id, project_id]
        );

        if (current.rows.length === 0) {
          return res.status(404).json({ message: 'Task not found' });
        }

        destinationSprintId = current.rows[0].sprint_id;
      }

      // IS NOT DISTINCT FROM (no '='): sprint_id NULL es una lista válida
      // (el Backlog), y NULL = NULL da NULL/false con un '=' normal.
      const list = await pool.query(
        `
        SELECT id, rank FROM tasks
        WHERE project_id = $1 AND sprint_id IS NOT DISTINCT FROM $2
        ORDER BY rank;
        `,
        [project_id, destinationSprintId]
      );

      const siblings = list.rows.filter((row) => row.id !== id);

      let newRank;
      if (after_task_id === null) {
        // Al principio de la lista.
        const first = siblings[0];
        newRank = first ? Number(first.rank) - 1000 : 1000;
      } else {
        const afterIndex = siblings.findIndex((row) => row.id === after_task_id);

        if (afterIndex === -1) {
          return res.status(400).json({ message: 'after_task_id does not belong to the destination list' });
        }

        const afterRank = Number(siblings[afterIndex].rank);
        const next = siblings[afterIndex + 1];
        newRank = next ? (afterRank + Number(next.rank)) / 2 : afterRank + 1000;
      }

      values.push(newRank);
      updates.push(`rank = $${values.length}`);

    } catch (error) {
      if (error.code === '22P02') {
        return res.status(400).json({ message: 'Invalid after_task_id' });
      }
      throw error;
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
  const type = (req.body || {}).type;

  if (type === undefined) {
    return res.status(400).json({ message: 'Type is required' });
  }

  // Misma lógica que updateTask, restringida al tipo.
  req.body = { type };

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
  deleteTask,
  // Reusado por boardController.js: misma proyección de tarea para el
  // Board y el Backlog, en vez de duplicar el SELECT.
  TASK_SELECT
};
