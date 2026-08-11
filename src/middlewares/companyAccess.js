const pool = require('../db');

/**
 * Autorización a nivel company.
 *
 * Mismo esquema que middlewares/projectAccess.js, un nivel arriba: en vez de
 * que cada controller repita el chequeo de pertenencia, se monta el
 * middleware en la ruta y el controller ya puede asumir que `req.company` es
 * accesible para el usuario del token.
 *
 * Todos dejan disponible:
 *   req.company     -> { id, name, ... }
 *   req.companyRole -> 'OWNER' | 'MEMBER'
 *
 * Importante: ser miembro de una company NO da acceso automático a los
 * proyectos que contiene. Esa autorización sigue siendo project_members, sin
 * cambios; company_members solo gobierna la administración de la company y
 * quién puede crear proyectos dentro de ella.
 */

// Se valida antes de consultar: un uuid mal formado hace que Postgres tire
// error 22P02, que sin este chequeo terminaría como un 500 en vez de un 404.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const loadCompanyAccess = async (req, res, companyId) => {
  const user_id = req.user.id;

  if (!companyId || !UUID_REGEX.test(companyId)) {
    res.status(404).json({ message: 'Company not found' });
    return null;
  }

  const result = await pool.query(
    `
    SELECT
      c.id,
      c.name,
      c.description,
      c.created_by,
      c.created_at,
      c.updated_at,
      cm.role
    FROM companies c
    JOIN company_members cm ON cm.company_id = c.id
    WHERE c.id = $1 AND cm.user_id = $2;
    `,
    [companyId, user_id]
  );

  // Mismo 404 si la company no existe o si existe pero el usuario no es
  // miembro: no se filtra la existencia de companies ajenas.
  if (result.rows.length === 0) {
    res.status(404).json({ message: 'Company not found' });
    return null;
  }

  const { role, ...company } = result.rows[0];
  req.company = company;
  req.companyRole = role;

  return role;
};

// Cualquier miembro: leer la company y crear proyectos dentro de ella.
// Toma el id de la ruta (/api/companies/:companyId/...).
const requireCompanyMember = async (req, res, next) => {
  try {
    const role = await loadCompanyAccess(req, res, req.params.companyId);
    if (!role) return;

    next();
  } catch (error) {
    console.error("COMPANY MEMBER CHECK ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Solo OWNER: editar o borrar la company y administrar miembros.
const requireCompanyOwner = async (req, res, next) => {
  try {
    const role = await loadCompanyAccess(req, res, req.params.companyId);
    if (!role) return;

    if (role !== 'OWNER') {
      return res.status(403).json({ message: 'Only the company owner can perform this action' });
    }

    next();
  } catch (error) {
    console.error("COMPANY OWNER CHECK ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Para el endpoint transversal que no cuelga de /api/companies y recibe la
// company en el body (POST /api/projects con company_id).
const requireCompanyMemberFromBody = async (req, res, next) => {
  const companyId = req.body.company_id;

  if (!companyId) {
    return res.status(400).json({ message: 'company_id is required' });
  }

  try {
    const role = await loadCompanyAccess(req, res, companyId);
    if (!role) return;

    next();
  } catch (error) {
    console.error("COMPANY MEMBER CHECK ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  requireCompanyMember,
  requireCompanyOwner,
  requireCompanyMemberFromBody
};
