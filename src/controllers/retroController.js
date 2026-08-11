const pool = require('../db');

const RETRO_CATEGORIES = ['WENT_WELL', 'TO_IMPROVE', 'ACTION_ITEM'];

const NOTE_SELECT = `
  SELECT
    n.id,
    n.sprint_id,
    n.category,
    n.content,
    n.author_id,
    u.username AS author_name,
    n.created_at,
    n.updated_at
  FROM retrospective_notes n
  JOIN users u ON u.id = n.author_id
`;

const normalizeCategory = (category) => {
  const normalized = String(category).toUpperCase();
  return RETRO_CATEGORIES.includes(normalized) ? normalized : null;
};

/**
 * La retro cuelga de un sprint, no directo del proyecto: la ruta trae
 * :projectId y :sprintId por separado, así que hay que confirmar que ese
 * sprint sea realmente del proyecto ya autorizado por requireProjectMember
 * (si no, un member de un proyecto podría leer/escribir la retro de un sprint
 * de otro proyecto solo adivinando su id).
 */
const findSprintInProject = async (projectId, sprintId) => {
  const result = await pool.query(
    `SELECT id FROM sprints WHERE id = $1 AND project_id = $2;`,
    [sprintId, projectId]
  );
  return result.rows[0] || null;
};

// ----------------------------
// Agregar nota
// ----------------------------
const createNote = async (req, res) => {
  const { sprintId } = req.params;
  const { category, content } = req.body || {};

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ message: 'Content is required' });
  }

  const categoryNormalized = normalizeCategory(category || '');
  if (!categoryNormalized) {
    return res.status(400).json({
      message: `Invalid category: must be one of ${RETRO_CATEGORIES.join(', ')}`
    });
  }

  try {
    const sprint = await findSprintInProject(req.project.id, sprintId);
    if (!sprint) {
      return res.status(404).json({ message: 'Sprint not found' });
    }

    const inserted = await pool.query(
      `
      INSERT INTO retrospective_notes (sprint_id, author_id, category, content)
      VALUES ($1, $2, $3, $4)
      RETURNING id;
      `,
      [sprintId, req.user.id, categoryNormalized, content.trim()]
    );

    // req.user solo trae { id } (así viene del JWT) — se relee con el JOIN a
    // users para devolver author_name, igual que el resto de las lecturas.
    const note = await pool.query(`${NOTE_SELECT} WHERE n.id = $1;`, [inserted.rows[0].id]);

    res.status(201).json(note.rows[0]);

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Sprint not found' });
    }

    console.error("CREATE RETRO NOTE ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Listar notas de un sprint, agrupadas por categoría
// ----------------------------
const getNotes = async (req, res) => {
  const { sprintId } = req.params;

  try {
    const sprint = await findSprintInProject(req.project.id, sprintId);
    if (!sprint) {
      return res.status(404).json({ message: 'Sprint not found' });
    }

    const notes = await pool.query(
      `${NOTE_SELECT} WHERE n.sprint_id = $1 ORDER BY n.created_at;`,
      [sprintId]
    );

    const grouped = {
      WENT_WELL: [],
      TO_IMPROVE: [],
      ACTION_ITEM: []
    };

    for (const note of notes.rows) {
      grouped[note.category].push(note);
    }

    res.status(200).json(grouped);

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Sprint not found' });
    }

    console.error("GET RETRO NOTES ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Trae la nota y confirma que sea del sprint de la ruta (y ese sprint, del
// proyecto ya autorizado), antes de editarla o borrarla.
const findOwnNote = async (projectId, sprintId, noteId) => {
  const result = await pool.query(
    `
    SELECT n.*
    FROM retrospective_notes n
    JOIN sprints s ON s.id = n.sprint_id
    WHERE n.id = $1 AND n.sprint_id = $2 AND s.project_id = $3;
    `,
    [noteId, sprintId, projectId]
  );
  return result.rows[0] || null;
};

// ----------------------------
// Editar una nota (solo su autor)
// ----------------------------
const updateNote = async (req, res) => {
  const { sprintId, noteId } = req.params;
  const { category, content } = req.body || {};

  if (category === undefined && content === undefined) {
    return res.status(400).json({ message: 'Nothing to update: send category and/or content' });
  }

  try {
    const note = await findOwnNote(req.project.id, sprintId, noteId);

    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    if (note.author_id !== req.user.id) {
      return res.status(403).json({ message: 'Only the author can edit this note' });
    }

    const updates = [];
    const values = [];

    if (content !== undefined) {
      if (typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({ message: 'Content cannot be empty' });
      }

      values.push(content.trim());
      updates.push(`content = $${values.length}`);
    }

    if (category !== undefined) {
      const categoryNormalized = normalizeCategory(category);

      if (!categoryNormalized) {
        return res.status(400).json({
          message: `Invalid category: must be one of ${RETRO_CATEGORIES.join(', ')}`
        });
      }

      values.push(categoryNormalized);
      updates.push(`category = $${values.length}`);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(noteId);

    await pool.query(
      `
      UPDATE retrospective_notes
      SET ${updates.join(', ')}
      WHERE id = $${values.length};
      `,
      values
    );

    const updated = await pool.query(`${NOTE_SELECT} WHERE n.id = $1;`, [noteId]);

    res.status(200).json(updated.rows[0]);

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Note not found' });
    }

    console.error("UPDATE RETRO NOTE ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Borrar una nota (su autor, o el OWNER del proyecto)
// ----------------------------
const deleteNote = async (req, res) => {
  const { sprintId, noteId } = req.params;

  try {
    const note = await findOwnNote(req.project.id, sprintId, noteId);

    if (!note) {
      return res.status(404).json({ message: 'Note not found' });
    }

    if (note.author_id !== req.user.id && req.projectRole !== 'OWNER') {
      return res.status(403).json({ message: 'Only the author or the project owner can delete this note' });
    }

    await pool.query(`DELETE FROM retrospective_notes WHERE id = $1;`, [noteId]);

    res.json({ message: 'Note deleted successfully' });

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Note not found' });
    }

    console.error("DELETE RETRO NOTE ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { createNote, getNotes, updateNote, deleteNote };
