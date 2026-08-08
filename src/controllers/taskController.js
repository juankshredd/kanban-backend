const pool = require('../db');

// ----------------------------
// Tipos de tarjeta permitidos
// ----------------------------
const TASK_TYPES = ['EPIC', 'STORY', 'TASK', 'BUG'];
const DEFAULT_TASK_TYPE = 'STORY';

// ----------------------------
// Crear nueva tarea
// ----------------------------
const createTask = async (req, res) => {
  const user_id = req.user.id; // viene del token JWT
  const { title, description, type } = req.body;

  try {
    if (!title) {
      return res.status(400).json({ message: 'Title is required' });
    }

    let typeNormalized = DEFAULT_TASK_TYPE;
    if (type !== undefined && type !== null && type !== '') {
      typeNormalized = String(type).toUpperCase();
      if (!TASK_TYPES.includes(typeNormalized)) {
        return res.status(400).json({ message: 'Invalid type value' });
      }
    }

    const newTask = await pool.query(
      `
      INSERT INTO tasks (id, user_id, title, description, type)
      VALUES (gen_random_uuid(), $1, $2, $3, $4)
      RETURNING *;
      `,
      [user_id, title, description || null, typeNormalized]
    );

    res.status(201).json(newTask.rows[0]);

  } catch (error) {
    console.error("CREATE TASK ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Obtener todas las tareas del usuario logueado
// ----------------------------
const getTasks = async (req, res) => {
  const user_id = req.user.id;

  try {
    const tasks = await pool.query(
      `
      SELECT 
        t.id,
        t.title,
        t.description,
        t.status,
        t.type,
        t.created_at,
        t.updated_at,
        u.username AS user_name
      FROM tasks t
      JOIN users u ON t.user_id = u.id
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC;
      `,
      [user_id]
    );

    res.status(200).json(tasks.rows);

  } catch (error) {
    console.error("GET TASKS ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Actualizar estado de una tarea
// ----------------------------
const updateTaskStatus = async (req, res) => {
  const user_id = req.user.id;
  const { id } = req.params;
  const { status, type } = req.body;

  try {
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ message: 'Status is required' });
    }

    // ✅ Normalizar el status a los valores exactos del ENUM
    const statusMap = {
      todo: 'TODO',
      in_progress: 'IN_PROGRESS',
      done: 'DONE'
    };

    const statusNormalized = statusMap[status.toLowerCase()];


    if (!statusNormalized) {
      return res.status(400).json({ message: 'Invalid status value' });
    }

    let typeNormalized;
    if (type !== undefined && type !== null && type !== '') {
      typeNormalized = String(type).toUpperCase();
      if (!TASK_TYPES.includes(typeNormalized)) {
        return res.status(400).json({ message: 'Invalid type value' });
      }
    }

    // Verificar que la tarea existe y pertenece al usuario
    const task = await pool.query(
      `SELECT * FROM tasks WHERE id = $1 AND user_id = $2`,
      [id, user_id]
    );

    if (task.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found or not owned by user' });
    }

    // Actualizar estado (y tipo, si vino en el body) en una sola query
    const updatedTask = await pool.query(
      `
      UPDATE tasks
      SET status = $1,
          type = COALESCE($2, type),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *;
      `,
      [statusNormalized, typeNormalized || null, id]
    );

    res.status(200).json(updatedTask.rows[0]);

  } catch (error) {
    console.error("UPDATE TASK STATUS ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Actualizar tipo de una tarea (Epic/Story/Task/Bug)
// ----------------------------
const updateTaskType = async (req, res) => {
  const user_id = req.user.id;
  const { id } = req.params;
  const { type } = req.body;

  try {
    if (!type || !TASK_TYPES.includes(String(type).toUpperCase())) {
      return res.status(400).json({ message: 'Invalid type value' });
    }
    const typeNormalized = String(type).toUpperCase();

    const task = await pool.query(
      `SELECT * FROM tasks WHERE id = $1 AND user_id = $2`,
      [id, user_id]
    );

    if (task.rows.length === 0) {
      return res.status(404).json({ message: 'Task not found or not owned by user' });
    }

    const updatedTask = await pool.query(
      `
      UPDATE tasks
      SET type = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *;
      `,
      [typeNormalized, id]
    );

    res.status(200).json(updatedTask.rows[0]);

  } catch (error) {
    console.error("UPDATE TASK TYPE ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

const deleteTask = async (req, res) => {
const user_id = req.user.id;
const { id } = req.params;

try {
  // 1️⃣ Buscar la tarea del usuario
  const taskResult = await pool.query(
    `
    SELECT * FROM tasks
    WHERE id = $1 AND user_id = $2;
    `,
    [id, user_id]
  );

  if (taskResult.rows.length === 0) {
    return res.status(404).json({ message: 'Task not found' });
  }

  const task = taskResult.rows[0];

  //  Regla de negocio: solo borrar si está en TODO
  if (task.status !== 'TODO') {
    return res.status(400).json({
      message: 'Only tasks with status TODO can be deleted'
    });
  }

  //  Eliminar
  await pool.query(
    `
    DELETE FROM tasks
    WHERE id = $1;
    `,
    [id]
  );

  res.json({ message: 'Task deleted successfully' });

} catch (error) {
  console.error("DELETE TASK ERROR:", error);
  res.status(500).json({ message: 'Server error' });
}
};

// ----------------------------
// Exportar funciones
// ----------------------------
module.exports = { createTask, getTasks, updateTaskStatus, updateTaskType, deleteTask};