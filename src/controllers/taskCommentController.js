const pool = require('../db');
const { findTaskInProject } = require('./taskRelationController');

const COMMENT_SELECT = `
  SELECT
    c.id,
    c.task_id,
    c.content,
    c.author_id,
    u.username AS author_name,
    c.created_at
  FROM task_comments c
  JOIN users u ON u.id = c.author_id
`;

// Sin edición (el mockup de la sección "Activity" no muestra affordance de
// editar, solo de agregar) -- ver "Task comments" en CLAUDE.md.

// ----------------------------
// Agregar comentario
// ----------------------------
const createComment = async (req, res) => {
  const project_id = req.project.id;
  const { id } = req.params;
  const { content } = req.body || {};

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ message: 'Content is required' });
  }

  try {
    const task = await findTaskInProject(id, project_id);

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const inserted = await pool.query(
      `
      INSERT INTO task_comments (id, task_id, author_id, content)
      VALUES (gen_random_uuid(), $1, $2, $3)
      RETURNING id;
      `,
      [id, req.user.id, content.trim()]
    );

    // req.user solo trae { id } (así viene del JWT) -- se relee con el JOIN a
    // users para devolver author_name, igual que retroController.js.
    const comment = await pool.query(`${COMMENT_SELECT} WHERE c.id = $1;`, [inserted.rows[0].id]);

    res.status(201).json(comment.rows[0]);

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Task not found' });
    }

    console.error("CREATE TASK COMMENT ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Listar comentarios de una tarea
// ----------------------------
const getComments = async (req, res) => {
  const project_id = req.project.id;
  const { id } = req.params;

  try {
    const task = await findTaskInProject(id, project_id);

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const comments = await pool.query(
      `${COMMENT_SELECT} WHERE c.task_id = $1 ORDER BY c.created_at;`,
      [id]
    );

    res.status(200).json(comments.rows);

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Task not found' });
    }

    console.error("GET TASK COMMENTS ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Borrar comentario (su autor, o el OWNER del proyecto -- misma moderación
// liviana que retroController.js)
// ----------------------------
const deleteComment = async (req, res) => {
  const project_id = req.project.id;
  const { id, commentId } = req.params;

  let task;
  try {
    task = await findTaskInProject(id, project_id);
  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Task not found' });
    }

    console.error("DELETE TASK COMMENT ERROR:", error);
    return res.status(500).json({ message: 'Server error' });
  }

  if (!task) {
    return res.status(404).json({ message: 'Task not found' });
  }

  try {
    const comment = await pool.query(
      `SELECT author_id FROM task_comments WHERE id = $1 AND task_id = $2;`,
      [commentId, id]
    );

    if (comment.rows.length === 0) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    if (comment.rows[0].author_id !== req.user.id && req.projectRole !== 'OWNER') {
      return res.status(403).json({ message: 'Only the author or the project owner can delete this comment' });
    }

    await pool.query(`DELETE FROM task_comments WHERE id = $1;`, [commentId]);

    res.json({ message: 'Comment deleted successfully' });

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Comment not found' });
    }

    console.error("DELETE TASK COMMENT ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createComment,
  getComments,
  deleteComment
};
