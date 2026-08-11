const pool = require('../db');

// ----------------------------
// Roles
// ----------------------------
const COMPANY_ROLES = ['OWNER', 'MEMBER'];

// ----------------------------
// Crear company
// ----------------------------
const createCompany = async (req, res) => {
  const user_id = req.user.id;
  const { name, description } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'Name is required' });
  }

  if (name.trim().length > 100) {
    return res.status(400).json({ message: 'Name must be 100 characters or less' });
  }

  // Company y membresía del creador entran juntas: una company sin OWNER
  // quedaría inaccesible incluso para quien la creó.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const company = await client.query(
      `
      INSERT INTO companies (name, description, created_by)
      VALUES ($1, $2, $3)
      RETURNING *;
      `,
      [name.trim(), description || null, user_id]
    );

    await client.query(
      `
      INSERT INTO company_members (company_id, user_id, role)
      VALUES ($1, $2, 'OWNER');
      `,
      [company.rows[0].id, user_id]
    );

    await client.query('COMMIT');

    res.status(201).json({ ...company.rows[0], role: 'OWNER' });

  } catch (error) {
    await client.query('ROLLBACK');

    console.error("CREATE COMPANY ERROR:", error);
    res.status(500).json({ message: 'Server error' });

  } finally {
    client.release();
  }
};

// ----------------------------
// Listar las companies del usuario logueado
// ----------------------------
const getCompanies = async (req, res) => {
  const user_id = req.user.id;

  try {
    const companies = await pool.query(
      `
      SELECT
        c.id,
        c.name,
        c.description,
        c.created_by,
        c.created_at,
        c.updated_at,
        cm.role,
        (SELECT count(*) FROM projects p WHERE p.company_id = c.id)::int AS project_count,
        (SELECT count(*) FROM company_members m WHERE m.company_id = c.id)::int AS member_count
      FROM companies c
      JOIN company_members cm ON cm.company_id = c.id
      WHERE cm.user_id = $1
      ORDER BY c.created_at DESC;
      `,
      [user_id]
    );

    res.status(200).json(companies.rows);

  } catch (error) {
    console.error("GET COMPANIES ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Detalle de una company
// ----------------------------
const getCompanyById = async (req, res) => {
  // requireCompanyMember ya validó el acceso y dejó la company en req.company
  const { id } = req.company;

  try {
    const members = await pool.query(
      `
      SELECT
        u.id,
        u.username,
        u.email,
        cm.role,
        cm.created_at AS joined_at
      FROM company_members cm
      JOIN users u ON u.id = cm.user_id
      WHERE cm.company_id = $1
      ORDER BY cm.role, u.username;
      `,
      [id]
    );

    const projectCount = await pool.query(
      `SELECT count(*)::int AS project_count FROM projects WHERE company_id = $1;`,
      [id]
    );

    res.status(200).json({
      ...req.company,
      role: req.companyRole,
      project_count: projectCount.rows[0].project_count,
      members: members.rows
    });

  } catch (error) {
    console.error("GET COMPANY ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Actualizar company (solo OWNER)
// ----------------------------
const updateCompany = async (req, res) => {
  const { id } = req.company;
  const { name, description } = req.body;

  if (name === undefined && description === undefined) {
    return res.status(400).json({ message: 'Nothing to update: send name and/or description' });
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ message: 'Name cannot be empty' });
    }

    if (name.trim().length > 100) {
      return res.status(400).json({ message: 'Name must be 100 characters or less' });
    }
  }

  try {
    // Se arma dinámico para poder distinguir "no lo mandaron" de "lo mandaron
    // en null" (limpiar la descripción), cosa que un COALESCE no permite.
    const updates = [];
    const values = [];

    if (name !== undefined) {
      values.push(name.trim());
      updates.push(`name = $${values.length}`);
    }

    if (description !== undefined) {
      values.push(description);
      updates.push(`description = $${values.length}`);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const updated = await pool.query(
      `
      UPDATE companies
      SET ${updates.join(', ')}
      WHERE id = $${values.length}
      RETURNING *;
      `,
      values
    );

    res.status(200).json({ ...updated.rows[0], role: req.companyRole });

  } catch (error) {
    console.error("UPDATE COMPANY ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Borrar company (solo OWNER)
// ----------------------------
const deleteCompany = async (req, res) => {
  const { id } = req.company;

  try {
    const projectCount = await pool.query(
      `SELECT count(*)::int AS n FROM projects WHERE company_id = $1;`,
      [id]
    );

    const { n } = projectCount.rows[0];

    // Borrar la company se lleva por cascade sus proyectos (y con ellos sus
    // tareas, sprints y miembros), así que si todavía tiene proyectos se pide
    // confirmación explícita.
    if (n > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        message: `Company has ${n} project(s). Send ?force=true to delete the company and all of its content`,
        project_count: n
      });
    }

    await pool.query(`DELETE FROM companies WHERE id = $1;`, [id]);

    res.json({ message: 'Company deleted successfully' });

  } catch (error) {
    console.error("DELETE COMPANY ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Agregar miembro (solo OWNER)
// ----------------------------
const addCompanyMember = async (req, res) => {
  const { id } = req.company;
  const { email, userId, role } = req.body;

  if (!email && !userId) {
    return res.status(400).json({ message: 'email or userId is required' });
  }

  let roleNormalized = 'MEMBER';
  if (role !== undefined && role !== null && String(role).trim() !== '') {
    roleNormalized = String(role).toUpperCase();

    if (!COMPANY_ROLES.includes(roleNormalized)) {
      return res.status(400).json({ message: 'Invalid role value' });
    }
  }

  try {
    const user = email
      ? await pool.query(`SELECT id, username, email FROM users WHERE email = $1;`, [email])
      : await pool.query(`SELECT id, username, email FROM users WHERE id = $1;`, [userId]);

    if (user.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const member = await pool.query(
      `
      INSERT INTO company_members (company_id, user_id, role)
      VALUES ($1, $2, $3)
      RETURNING role, created_at AS joined_at;
      `,
      [id, user.rows[0].id, roleNormalized]
    );

    res.status(201).json({ ...user.rows[0], ...member.rows[0] });

  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'User is already a member of this company' });
    }

    // uuid mal formado en userId
    if (error.code === '22P02') {
      return res.status(400).json({ message: 'Invalid userId' });
    }

    console.error("ADD COMPANY MEMBER ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Una company sin OWNER no la puede administrar nadie, así que tanto bajar de
 * rango como sacar al último OWNER quedan bloqueados.
 */
const isLastOwner = async (companyId, userId) => {
  const owners = await pool.query(
    `SELECT user_id FROM company_members WHERE company_id = $1 AND role = 'OWNER';`,
    [companyId]
  );

  return owners.rows.length === 1 && owners.rows[0].user_id === userId;
};

// ----------------------------
// Cambiar el rol de un miembro (solo OWNER)
// ----------------------------
const updateCompanyMemberRole = async (req, res) => {
  const { id } = req.company;
  const { userId } = req.params;
  const { role } = req.body;

  if (!role || !COMPANY_ROLES.includes(String(role).toUpperCase())) {
    return res.status(400).json({ message: 'Invalid role value' });
  }

  const roleNormalized = String(role).toUpperCase();

  try {
    const member = await pool.query(
      `SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2;`,
      [id, userId]
    );

    if (member.rows.length === 0) {
      return res.status(404).json({ message: 'User is not a member of this company' });
    }

    if (roleNormalized !== 'OWNER' && await isLastOwner(id, userId)) {
      return res.status(409).json({ message: 'Cannot demote the last owner of the company' });
    }

    const updated = await pool.query(
      `
      UPDATE company_members
      SET role = $1
      WHERE company_id = $2 AND user_id = $3
      RETURNING user_id, role, created_at AS joined_at;
      `,
      [roleNormalized, id, userId]
    );

    res.status(200).json(updated.rows[0]);

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(400).json({ message: 'Invalid userId' });
    }

    console.error("UPDATE COMPANY MEMBER ROLE ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Sacar un miembro (solo OWNER)
// ----------------------------
const removeCompanyMember = async (req, res) => {
  const { id } = req.company;
  const { userId } = req.params;

  try {
    const member = await pool.query(
      `SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2;`,
      [id, userId]
    );

    if (member.rows.length === 0) {
      return res.status(404).json({ message: 'User is not a member of this company' });
    }

    if (await isLastOwner(id, userId)) {
      return res.status(409).json({ message: 'Cannot remove the last owner of the company' });
    }

    await pool.query(
      `DELETE FROM company_members WHERE company_id = $1 AND user_id = $2;`,
      [id, userId]
    );

    res.json({ message: 'Member removed successfully' });

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(400).json({ message: 'Invalid userId' });
    }

    console.error("REMOVE COMPANY MEMBER ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Exportar funciones
// ----------------------------
module.exports = {
  createCompany,
  getCompanies,
  getCompanyById,
  updateCompany,
  deleteCompany,
  addCompanyMember,
  updateCompanyMemberRole,
  removeCompanyMember
};
