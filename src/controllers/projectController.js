const pool = require('../db');

// ----------------------------
// Roles y formato de key
// ----------------------------
const PROJECT_ROLES = ['OWNER', 'MEMBER'];

// Mismo formato que valida la constraint projects_key_format en la base:
// arranca con letra y tiene entre 2 y 10 caracteres.
const PROJECT_KEY_REGEX = /^[A-Z][A-Z0-9]{1,9}$/;

/**
 * Deriva una key libre a partir del nombre del proyecto ("Mi Tablero" -> "MIT").
 * Si ya está tomada prueba con MIT2, MIT3, etc.
 */
const generateProjectKey = async (client, name) => {
  const alphanumeric = (name.match(/[a-zA-Z0-9]/g) || []).join('').toUpperCase();

  let base = alphanumeric.slice(0, 3);
  // El formato exige arrancar con letra y al menos 2 caracteres.
  if (base.length < 2 || !/^[A-Z]/.test(base)) {
    base = 'PRJ';
  }

  const taken = await client.query(
    `SELECT key FROM projects WHERE key = $1 OR key ~ ('^' || $1 || '[0-9]+$');`,
    [base]
  );

  const usedKeys = new Set(taken.rows.map((r) => r.key));
  if (!usedKeys.has(base)) {
    return base;
  }

  let suffix = 2;
  while (usedKeys.has(`${base}${suffix}`)) {
    suffix++;
  }

  return `${base}${suffix}`;
};

// ----------------------------
// Crear proyecto
// ----------------------------
const createProject = async (req, res) => {
  const user_id = req.user.id;
  const company_id = req.company.id;      // lo dejó el middleware de acceso a company
  const { name, description, key } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'Name is required' });
  }

  if (name.trim().length > 100) {
    return res.status(400).json({ message: 'Name must be 100 characters or less' });
  }

  let keyNormalized;
  if (key !== undefined && key !== null && String(key).trim() !== '') {
    keyNormalized = String(key).trim().toUpperCase();

    if (!PROJECT_KEY_REGEX.test(keyNormalized)) {
      return res.status(400).json({
        message: 'Invalid key: use 2 to 10 characters, starting with a letter and followed by letters or numbers'
      });
    }
  }

  // Proyecto y membresía del creador entran juntos: un proyecto sin OWNER
  // quedaría inaccesible incluso para quien lo creó.
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const finalKey = keyNormalized || await generateProjectKey(client, name.trim());

    const project = await client.query(
      `
      INSERT INTO projects (key, name, description, created_by, company_id)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
      `,
      [finalKey, name.trim(), description || null, user_id, company_id]
    );

    await client.query(
      `
      INSERT INTO project_members (project_id, user_id, role)
      VALUES ($1, $2, 'OWNER');
      `,
      [project.rows[0].id, user_id]
    );

    await client.query('COMMIT');

    res.status(201).json({ ...project.rows[0], role: 'OWNER' });

  } catch (error) {
    await client.query('ROLLBACK');

    if (error.code === '23505') {
      return res.status(409).json({ message: 'Project key already in use' });
    }

    console.error("CREATE PROJECT ERROR:", error);
    res.status(500).json({ message: 'Server error' });

  } finally {
    client.release();
  }
};

// ----------------------------
// Listar los proyectos del usuario logueado
// ----------------------------
const getProjects = async (req, res) => {
  const user_id = req.user.id;
  // Filtro opcional para ver "mis proyectos" acotados a una company, igual
  // que getMyTasks acepta ?project_id=.
  const { company_id } = req.query;

  try {
    const projects = await pool.query(
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
        pm.role,
        (SELECT count(*) FROM tasks t WHERE t.project_id = p.id)::int AS task_count,
        (SELECT count(*) FROM project_members m WHERE m.project_id = p.id)::int AS member_count
      FROM projects p
      JOIN project_members pm ON pm.project_id = p.id
      JOIN companies c ON c.id = p.company_id
      WHERE pm.user_id = $1
        AND ($2::uuid IS NULL OR p.company_id = $2)
      ORDER BY p.created_at DESC;
      `,
      [user_id, company_id || null]
    );

    res.status(200).json(projects.rows);

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(400).json({ message: 'Invalid company_id' });
    }

    console.error("GET PROJECTS ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Listar los proyectos del usuario logueado dentro de una company
// ----------------------------
// requireCompanyMember ya validó el acceso a la company; esto además filtra
// por project_members, porque ser miembro de la company no da acceso
// automático a todos sus proyectos (ver middlewares/companyAccess.js).
const getCompanyProjects = async (req, res) => {
  const user_id = req.user.id;
  const { id: company_id } = req.company;

  try {
    const projects = await pool.query(
      `
      SELECT
        p.id,
        p.key,
        p.name,
        p.description,
        p.created_by,
        p.company_id,
        p.created_at,
        p.updated_at,
        pm.role,
        (SELECT count(*) FROM tasks t WHERE t.project_id = p.id)::int AS task_count,
        (SELECT count(*) FROM project_members m WHERE m.project_id = p.id)::int AS member_count
      FROM projects p
      JOIN project_members pm ON pm.project_id = p.id
      WHERE pm.user_id = $1 AND p.company_id = $2
      ORDER BY p.created_at DESC;
      `,
      [user_id, company_id]
    );

    res.status(200).json(projects.rows);

  } catch (error) {
    console.error("GET COMPANY PROJECTS ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Detalle de un proyecto
// ----------------------------
const getProjectById = async (req, res) => {
  // requireProjectMember ya validó el acceso y dejó el proyecto en req.project
  const { id } = req.project;

  try {
    const members = await pool.query(
      `
      SELECT
        u.id,
        u.username,
        u.email,
        pm.role,
        pm.created_at AS joined_at
      FROM project_members pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1
      ORDER BY pm.role, u.username;
      `,
      [id]
    );

    const taskCount = await pool.query(
      `SELECT count(*)::int AS task_count FROM tasks WHERE project_id = $1;`,
      [id]
    );

    res.status(200).json({
      ...req.project,
      role: req.projectRole,
      task_count: taskCount.rows[0].task_count,
      members: members.rows
    });

  } catch (error) {
    console.error("GET PROJECT ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Actualizar proyecto (solo OWNER)
// ----------------------------
const updateProject = async (req, res) => {
  const { id } = req.project;
  const { name, description } = req.body || {};

  // `key` no se puede editar a propósito: es el prefijo de todos los ticket id
  // ya repartidos (KAN-42), cambiarla renombraría tickets ya comunicados.
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
      UPDATE projects
      SET ${updates.join(', ')}
      WHERE id = $${values.length}
      RETURNING *;
      `,
      values
    );

    res.status(200).json({ ...updated.rows[0], role: req.projectRole });

  } catch (error) {
    console.error("UPDATE PROJECT ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Borrar proyecto (solo OWNER)
// ----------------------------
const deleteProject = async (req, res) => {
  const { id } = req.project;

  try {
    const taskCount = await pool.query(
      `SELECT count(*)::int AS n FROM tasks WHERE project_id = $1;`,
      [id]
    );

    const { n } = taskCount.rows[0];

    // Borrar el proyecto se lleva por cascade sus tareas, sprints y miembros,
    // así que si todavía tiene contenido se pide confirmación explícita.
    if (n > 0 && req.query.force !== 'true') {
      return res.status(409).json({
        message: `Project has ${n} task(s). Send ?force=true to delete the project and all of its content`,
        task_count: n
      });
    }

    await pool.query(`DELETE FROM projects WHERE id = $1;`, [id]);

    res.json({ message: 'Project deleted successfully' });

  } catch (error) {
    console.error("DELETE PROJECT ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Agregar miembro (solo OWNER)
// ----------------------------
const addProjectMember = async (req, res) => {
  const { id } = req.project;
  const { email, userId, role } = req.body || {};

  if (!email && !userId) {
    return res.status(400).json({ message: 'email or userId is required' });
  }

  let roleNormalized = 'MEMBER';
  if (role !== undefined && role !== null && String(role).trim() !== '') {
    roleNormalized = String(role).toUpperCase();

    if (!PROJECT_ROLES.includes(roleNormalized)) {
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
      INSERT INTO project_members (project_id, user_id, role)
      VALUES ($1, $2, $3)
      RETURNING role, created_at AS joined_at;
      `,
      [id, user.rows[0].id, roleNormalized]
    );

    res.status(201).json({ ...user.rows[0], ...member.rows[0] });

  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'User is already a member of this project' });
    }

    // uuid mal formado en userId
    if (error.code === '22P02') {
      return res.status(400).json({ message: 'Invalid userId' });
    }

    console.error("ADD PROJECT MEMBER ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Un proyecto sin OWNER no lo puede administrar nadie, así que tanto bajar de
 * rango como sacar al último OWNER quedan bloqueados.
 */
const isLastOwner = async (projectId, userId) => {
  const owners = await pool.query(
    `SELECT user_id FROM project_members WHERE project_id = $1 AND role = 'OWNER';`,
    [projectId]
  );

  return owners.rows.length === 1 && owners.rows[0].user_id === userId;
};

// ----------------------------
// Cambiar el rol de un miembro (solo OWNER)
// ----------------------------
const updateProjectMemberRole = async (req, res) => {
  const { id } = req.project;
  const { userId } = req.params;
  const { role } = req.body || {};

  if (!role || !PROJECT_ROLES.includes(String(role).toUpperCase())) {
    return res.status(400).json({ message: 'Invalid role value' });
  }

  const roleNormalized = String(role).toUpperCase();

  try {
    const member = await pool.query(
      `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2;`,
      [id, userId]
    );

    if (member.rows.length === 0) {
      return res.status(404).json({ message: 'User is not a member of this project' });
    }

    if (roleNormalized !== 'OWNER' && await isLastOwner(id, userId)) {
      return res.status(409).json({ message: 'Cannot demote the last owner of the project' });
    }

    const updated = await pool.query(
      `
      UPDATE project_members
      SET role = $1
      WHERE project_id = $2 AND user_id = $3
      RETURNING user_id, role, created_at AS joined_at;
      `,
      [roleNormalized, id, userId]
    );

    res.status(200).json(updated.rows[0]);

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(400).json({ message: 'Invalid userId' });
    }

    console.error("UPDATE PROJECT MEMBER ROLE ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Sacar un miembro (solo OWNER)
// ----------------------------
const removeProjectMember = async (req, res) => {
  const { id } = req.project;
  const { userId } = req.params;

  try {
    const member = await pool.query(
      `SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2;`,
      [id, userId]
    );

    if (member.rows.length === 0) {
      return res.status(404).json({ message: 'User is not a member of this project' });
    }

    if (await isLastOwner(id, userId)) {
      return res.status(409).json({ message: 'Cannot remove the last owner of the project' });
    }

    await pool.query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2;`,
      [id, userId]
    );

    res.json({ message: 'Member removed successfully' });

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(400).json({ message: 'Invalid userId' });
    }

    console.error("REMOVE PROJECT MEMBER ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Exportar funciones
// ----------------------------
module.exports = {
  createProject,
  getProjects,
  getCompanyProjects,
  getProjectById,
  updateProject,
  deleteProject,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember
};
