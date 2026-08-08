const pool = require('../db');

/**
 * Autorización a nivel proyecto.
 *
 * Estos dos middlewares son el punto de entrada para todo lo que viva dentro de
 * un proyecto (tareas, sprints, retro, y lo que venga después): en vez de que
 * cada controller repita el chequeo de pertenencia, se monta el middleware en la
 * ruta y el controller ya puede asumir que `req.project` es accesible para el
 * usuario del token.
 *
 * Ambos esperan un `:projectId` en la ruta y dejan disponible:
 *   req.project     -> { id, key, name, ... }
 *   req.projectRole -> 'OWNER' | 'MEMBER'
 */

// Se valida antes de consultar: un uuid mal formado hace que Postgres tire
// error 22P02, que sin este chequeo terminaría como un 500 en vez de un 404.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const loadProjectAccess = async (req, res) => {
  const { projectId } = req.params;
  const user_id = req.user.id;

  if (!projectId || !UUID_REGEX.test(projectId)) {
    res.status(404).json({ message: 'Project not found' });
    return null;
  }

  const result = await pool.query(
    `
    SELECT
      p.id,
      p.key,
      p.name,
      p.description,
      p.created_by,
      p.created_at,
      p.updated_at,
      pm.role
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    WHERE p.id = $1 AND pm.user_id = $2;
    `,
    [projectId, user_id]
  );

  // Mismo 404 si el proyecto no existe o si existe pero el usuario no es
  // miembro: no se filtra la existencia de proyectos ajenos.
  if (result.rows.length === 0) {
    res.status(404).json({ message: 'Project not found' });
    return null;
  }

  const { role, ...project } = result.rows[0];
  req.project = project;
  req.projectRole = role;

  return role;
};

// Cualquier miembro: leer y trabajar sobre el contenido del proyecto.
const requireProjectMember = async (req, res, next) => {
  try {
    const role = await loadProjectAccess(req, res);
    if (!role) return;

    next();
  } catch (error) {
    console.error("PROJECT MEMBER CHECK ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Solo OWNER: editar o borrar el proyecto y administrar miembros.
const requireProjectOwner = async (req, res, next) => {
  try {
    const role = await loadProjectAccess(req, res);
    if (!role) return;

    if (role !== 'OWNER') {
      return res.status(403).json({ message: 'Only the project owner can perform this action' });
    }

    next();
  } catch (error) {
    console.error("PROJECT OWNER CHECK ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { requireProjectMember, requireProjectOwner };
