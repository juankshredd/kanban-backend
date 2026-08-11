const pool = require('../db');

const SPRINT_SELECT = `
  SELECT
    s.id,
    s.project_id,
    s.name,
    s.goal,
    s.status,
    s.start_date,
    s.end_date,
    s.created_at,
    s.updated_at,
    (SELECT count(*) FROM tasks t WHERE t.sprint_id = s.id)::int AS task_count
  FROM sprints s
`;

// ----------------------------
// Crear sprint (arranca en PLANNED)
// ----------------------------
const createSprint = async (req, res) => {
  const project_id = req.project.id;
  const { name, goal, start_date, end_date } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'Name is required' });
  }

  try {
    const sprint = await pool.query(
      `
      INSERT INTO sprints (project_id, name, goal, start_date, end_date)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
      `,
      [project_id, name.trim(), goal || null, start_date || null, end_date || null]
    );

    res.status(201).json({ ...sprint.rows[0], task_count: 0 });

  } catch (error) {
    // fecha con formato invalido
    if (error.code === '22007' || error.code === '22008') {
      return res.status(400).json({ message: 'Invalid start_date or end_date' });
    }

    console.error("CREATE SPRINT ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Listar sprints de un proyecto
// ----------------------------
const getSprints = async (req, res) => {
  try {
    const sprints = await pool.query(
      `${SPRINT_SELECT} WHERE s.project_id = $1 ORDER BY s.created_at DESC;`,
      [req.project.id]
    );

    res.status(200).json(sprints.rows);

  } catch (error) {
    console.error("GET SPRINTS ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// El sprint activo del proyecto ("Current Sprint")
// ----------------------------
const getActiveSprint = async (req, res) => {
  try {
    const sprint = await pool.query(
      `${SPRINT_SELECT} WHERE s.project_id = $1 AND s.status = 'ACTIVE';`,
      [req.project.id]
    );

    if (sprint.rows.length === 0) {
      return res.status(404).json({ message: 'No active sprint' });
    }

    res.status(200).json(sprint.rows[0]);

  } catch (error) {
    console.error("GET ACTIVE SPRINT ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Trae el sprint y confirma que sea del proyecto de la ruta, usado por
// start/complete/delete antes de tocarlo.
const findOwnSprint = async (projectId, sprintId) => {
  const result = await pool.query(
    `SELECT * FROM sprints WHERE id = $1 AND project_id = $2;`,
    [sprintId, projectId]
  );
  return result.rows[0] || null;
};

// ----------------------------
// Arrancar un sprint (PLANNED -> ACTIVE)
// ----------------------------
const startSprint = async (req, res) => {
  const project_id = req.project.id;
  const { sprintId } = req.params;

  try {
    const sprint = await findOwnSprint(project_id, sprintId);

    if (!sprint) {
      return res.status(404).json({ message: 'Sprint not found' });
    }

    if (sprint.status !== 'PLANNED') {
      return res.status(400).json({ message: `Cannot start a sprint that is ${sprint.status}` });
    }

    const updated = await pool.query(
      `
      UPDATE sprints
      SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *;
      `,
      [sprintId]
    );

    res.status(200).json({ ...updated.rows[0], task_count: sprint.task_count });

  } catch (error) {
    // choca con one_active_sprint_per_project: ya hay otro ACTIVE
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Project already has an active sprint' });
    }

    console.error("START SPRINT ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Cerrar un sprint (ACTIVE -> COMPLETED)
// ----------------------------
const completeSprint = async (req, res) => {
  const project_id = req.project.id;
  const { sprintId } = req.params;

  const client = await pool.connect();

  try {
    const sprint = await findOwnSprint(project_id, sprintId);

    if (!sprint) {
      res.status(404).json({ message: 'Sprint not found' });
      return;
    }

    if (sprint.status !== 'ACTIVE') {
      res.status(400).json({ message: `Cannot complete a sprint that is ${sprint.status}` });
      return;
    }

    await client.query('BEGIN');

    // Lo que no se terminó vuelve al backlog en vez de quedar colgado de un
    // sprint ya cerrado; lo que sí se completó se queda como historial del
    // sprint.
    const movedBack = await client.query(
      `
      UPDATE tasks
      SET sprint_id = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE sprint_id = $1 AND status != 'DONE'
      RETURNING id;
      `,
      [sprintId]
    );

    const updated = await client.query(
      `
      UPDATE sprints
      SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *;
      `,
      [sprintId]
    );

    await client.query('COMMIT');

    res.status(200).json({
      ...updated.rows[0],
      moved_to_backlog: movedBack.rows.length
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("COMPLETE SPRINT ERROR:", error);
    res.status(500).json({ message: 'Server error' });

  } finally {
    client.release();
  }
};

// ----------------------------
// Borrar un sprint (solo si nunca arrancó)
// ----------------------------
const deleteSprint = async (req, res) => {
  const project_id = req.project.id;
  const { sprintId } = req.params;

  try {
    const sprint = await findOwnSprint(project_id, sprintId);

    if (!sprint) {
      return res.status(404).json({ message: 'Sprint not found' });
    }

    // Borrar uno ACTIVE o COMPLETED tiraría sus tareas al backlog por el
    // ON DELETE SET NULL sin que nadie lo pida explícitamente; mejor exigir
    // completeSprint primero para que ese movimiento quede intencional.
    if (sprint.status !== 'PLANNED') {
      return res.status(400).json({
        message: 'Only a sprint that has not started can be deleted; complete it first'
      });
    }

    await pool.query(`DELETE FROM sprints WHERE id = $1;`, [sprintId]);

    res.json({ message: 'Sprint deleted successfully' });

  } catch (error) {
    console.error("DELETE SPRINT ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createSprint,
  getSprints,
  getActiveSprint,
  startSprint,
  completeSprint,
  deleteSprint
};
