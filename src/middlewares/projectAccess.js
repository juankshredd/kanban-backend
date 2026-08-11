const pool = require('../db');

/**
 * Autorización a nivel proyecto.
 *
 * Estos middlewares son el punto de entrada para todo lo que viva dentro de un
 * proyecto (tareas, sprints, retro, y lo que venga después): en vez de que cada
 * controller repita el chequeo de pertenencia, se monta el middleware en la ruta
 * y el controller ya puede asumir que `req.project` es accesible para el usuario
 * del token.
 *
 * Todos dejan disponible:
 *   req.project     -> { id, key, name, ... }
 *   req.projectRole -> 'OWNER' | 'MEMBER'
 *
 * Lo único que cambia entre ellos es de dónde sale el id del proyecto: de la
 * ruta, del body, o del recurso que se está tocando.
 */

// Se valida antes de consultar: un uuid mal formado hace que Postgres tire
// error 22P02, que sin este chequeo terminaría como un 500 en vez de un 404.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const loadProjectAccess = async (req, res, projectId) => {
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
      p.company_id,
      c.name AS company_name,
      p.created_at,
      p.updated_at,
      pm.role
    FROM projects p
    JOIN project_members pm ON pm.project_id = p.id
    JOIN companies c ON c.id = p.company_id
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
// Toma el id de la ruta (/api/projects/:projectId/...).
const requireProjectMember = async (req, res, next) => {
  try {
    const role = await loadProjectAccess(req, res, req.params.projectId);
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
    const role = await loadProjectAccess(req, res, req.params.projectId);
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

// Para los endpoints transversales que no cuelgan de /api/projects y reciben el
// proyecto en el body (ej. POST /api/tasks con project_id).
const requireProjectMemberFromBody = async (req, res, next) => {
  const projectId = req.body.project_id;

  if (!projectId) {
    return res.status(400).json({ message: 'project_id is required' });
  }

  try {
    const role = await loadProjectAccess(req, res, projectId);
    if (!role) return;

    next();
  } catch (error) {
    console.error("PROJECT MEMBER CHECK ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Para operar un recurso por su id sin pasar por la ruta anidada
 * (ej. PATCH /api/tasks/:id): busca a qué proyecto pertenece y valida ahí.
 *
 * Es una fábrica para que sprints, notas de retro y demás tablas que cuelguen
 * de un proyecto reusen exactamente el mismo chequeo. La tabla sale de esta
 * lista blanca, nunca del request.
 */
const PROJECT_SCOPED_TABLES = ['tasks'];

const requireProjectMemberForResource = (table) => {
  if (!PROJECT_SCOPED_TABLES.includes(table)) {
    throw new Error(`Tabla no habilitada para acceso por proyecto: ${table}`);
  }

  return async (req, res, next) => {
    const { id } = req.params;

    if (!id || !UUID_REGEX.test(id)) {
      return res.status(404).json({ message: 'Resource not found' });
    }

    try {
      const resource = await pool.query(
        `SELECT project_id FROM ${table} WHERE id = $1;`,
        [id]
      );

      // Mismo 404 que si el proyecto no fuera accesible: no se distingue
      // "no existe" de "existe pero no es tuyo".
      if (resource.rows.length === 0) {
        return res.status(404).json({ message: 'Resource not found' });
      }

      const role = await loadProjectAccess(req, res, resource.rows[0].project_id);
      if (!role) return;

      next();
    } catch (error) {
      console.error("PROJECT RESOURCE CHECK ERROR:", error);
      res.status(500).json({ message: 'Server error' });
    }
  };
};

module.exports = {
  requireProjectMember,
  requireProjectOwner,
  requireProjectMemberFromBody,
  requireProjectMemberForResource
};
