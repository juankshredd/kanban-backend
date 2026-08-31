const pool = require('../db');
const { TASK_SELECT } = require('./taskController');

const RELATION_TYPES = ['RELATED_TO', 'BLOCKS', 'DUPLICATES', 'CLONES'];

// Label visto desde el lado que creó el link (task_id).
const FORWARD_LABEL = {
  RELATED_TO: 'relates to',
  BLOCKS: 'blocks',
  DUPLICATES: 'duplicates',
  CLONES: 'clones'
};

// Label visto desde el otro lado (related_task_id). RELATED_TO es simétrico así
// que no tiene inverso -- FORWARD_LABEL.RELATED_TO vale para los dos lados.
const INVERSE_LABEL = {
  BLOCKS: 'is blocked by',
  DUPLICATES: 'is duplicated by',
  CLONES: 'is cloned by'
};

const resolveLabel = (relationType, anchorIsTaskId) =>
  relationType === 'RELATED_TO' || anchorIsTaskId
    ? FORWARD_LABEL[relationType]
    : INVERSE_LABEL[relationType];

// Chequeo de existencia reusado por getRelations y deleteRelation (createRelation
// necesita confirmar dos ids en una sola query, así que no aplica ahí).
const findTaskInProject = async (id, projectId) => {
  const result = await pool.query(
    `SELECT id FROM tasks WHERE id = $1 AND project_id = $2;`,
    [id, projectId]
  );

  return result.rows[0] || null;
};

// Resuelve todas las relaciones (de cualquier relation_type) de una tarea, con
// el label ya orientado desde su punto de vista y la tarea del otro lado
// proyectada via TASK_SELECT. Reusado por getRelations (HTTP) y por
// boardController.getTaskDetail (agregado de una sola pantalla) -- un solo
// lugar resuelve "la otra tarea" + el label, ninguno de los dos reimplementa
// la lógica de dirección.
const fetchRelationsForTask = async (id, projectId) => {
  // (task_id = $1) se resuelve en SQL, no comparando strings en JS: la
  // comparación de uuid en Postgres no depende del casing con el que llegó el
  // parámetro, evitar eso a mano acá sería repetir un bug ya corregido en
  // createRelation.
  const relations = await pool.query(
    `
    SELECT
      id AS relation_id,
      created_at,
      relation_type,
      (task_id = $1) AS anchor_is_task_id,
      CASE WHEN task_id = $1 THEN related_task_id ELSE task_id END AS related_task_id
    FROM task_relations
    WHERE task_id = $1 OR related_task_id = $1
    ORDER BY created_at;
    `,
    [id]
  );

  if (relations.rows.length === 0) {
    return [];
  }

  // Mismo patrón que getBacklogView: ids primero, después un solo SELECT con
  // ANY($1) reusando TASK_SELECT, merge en JS. t.project_id = $2 es defensa en
  // profundidad (ver "Task rules" en CLAUDE.md), no solo un filtro.
  const relatedTaskIds = relations.rows.map((row) => row.related_task_id);
  const tasks = await pool.query(
    `${TASK_SELECT} WHERE t.id = ANY($1) AND t.project_id = $2;`,
    [relatedTaskIds, projectId]
  );
  const tasksById = Object.fromEntries(tasks.rows.map((task) => [task.id, task]));

  // Las dos queries no van en la misma transacción: si la tarea relacionada se
  // borra justo en el medio (CASCADE también borra la fila de task_relations),
  // tasksById no la va a tener. Se descarta ese item en vez de devolver un
  // { task: undefined } que rompería a un cliente que asume row.task.id --
  // coincide con el estado real después de la carrera: esa relación ya no existe.
  return relations.rows
    .map((row) => ({
      relation_id: row.relation_id,
      related_since: row.created_at,
      type: resolveLabel(row.relation_type, row.anchor_is_task_id),
      task: tasksById[row.related_task_id]
    }))
    .filter((row) => row.task !== undefined);
};

// ----------------------------
// Crear un link entre dos tareas del mismo proyecto
// ----------------------------
const createRelation = async (req, res) => {
  const project_id = req.project.id;
  const { id } = req.params;
  const { related_task_id, relation_type } = req.body || {};

  if (!related_task_id || typeof related_task_id !== 'string') {
    return res.status(400).json({ message: 'related_task_id is required' });
  }

  // Default RELATED_TO: preserva el contrato de los clientes que ya llamaban
  // este endpoint antes de que existieran los demás tipos.
  let relationTypeNormalized = 'RELATED_TO';
  if (relation_type !== undefined && relation_type !== null) {
    relationTypeNormalized = String(relation_type).toUpperCase();

    if (!RELATION_TYPES.includes(relationTypeNormalized)) {
      return res.status(400).json({ message: `relation_type must be one of: ${RELATION_TYPES.join(', ')}` });
    }
  }

  // Comparación case-insensitive: un UUID es el mismo valor sin importar el
  // casing, y Postgres lo trata así, pero '===' entre strings de JS no.
  if (related_task_id.toLowerCase() === id.toLowerCase()) {
    return res.status(400).json({ message: 'A task cannot be related to itself' });
  }

  try {
    // Una sola query confirma que las dos tareas existen en este proyecto,
    // en vez de una consulta por cada una.
    const tasks = await pool.query(
      `SELECT id FROM tasks WHERE id = ANY($1) AND project_id = $2;`,
      [[id, related_task_id], project_id]
    );

    if (tasks.rows.length < 2) {
      return res.status(404).json({ message: 'Task or related_task_id not found in this project' });
    }

    const relation = await pool.query(
      `
      INSERT INTO task_relations (id, task_id, related_task_id, relation_type, created_by)
      VALUES (gen_random_uuid(), $1, $2, $3, $4)
      RETURNING *;
      `,
      [id, related_task_id, relationTypeNormalized, req.user.id]
    );

    res.status(201).json(relation.rows[0]);

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Task or related_task_id not found in this project' });
    }

    // Índice único (simétrico para RELATED_TO, direccional para el resto): ya
    // existía este link, con este mismo relation_type.
    if (error.code === '23505') {
      return res.status(409).json({ message: 'This relation already exists' });
    }

    // Una de las dos tareas (o, en el caso límite de un usuario borrado entre
    // la emisión del JWT y este INSERT, el propio autor) era válida al
    // chequearla pero dejó de existir antes de que este INSERT corriera. El
    // nombre de la FK violada dice cuál.
    if (error.code === '23503') {
      const FK_MESSAGES = {
        task_relations_task_id_fkey: 'Task no longer exists',
        task_relations_created_by_fkey: 'Acting user no longer exists'
      };
      const message = FK_MESSAGES[error.constraint] || 'related_task_id no longer exists';
      return res.status(409).json({ message });
    }

    console.error("CREATE TASK RELATION ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Listar las tareas relacionadas con una tarea dada
// ----------------------------
const getRelations = async (req, res) => {
  const project_id = req.project.id;
  const { id } = req.params;

  try {
    const task = await findTaskInProject(id, project_id);

    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const result = await fetchRelationsForTask(id, project_id);

    res.status(200).json(result);

  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Task not found' });
    }

    console.error("GET TASK RELATIONS ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

// ----------------------------
// Borrar un link
// ----------------------------
const deleteRelation = async (req, res) => {
  const project_id = req.project.id;
  const { id, relationId } = req.params;

  // Try/catch separado del de abajo: para cuando llegamos a la query de
  // DELETE, :id ya se probó válido y existente, así que un 22P02 ahí solo
  // puede venir de relationId -- de lo contrario un relationId mal formado
  // terminaría reportado como "Task not found" (la tarea ancla, que sí existe).
  let task;
  try {
    task = await findTaskInProject(id, project_id);
  } catch (error) {
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Task not found' });
    }

    console.error("DELETE TASK RELATION ERROR:", error);
    return res.status(500).json({ message: 'Server error' });
  }

  if (!task) {
    return res.status(404).json({ message: 'Task not found' });
  }

  try {
    // Se borra por el id propio de la fila, no por el par de tareas: con
    // varios relation_type posibles entre las mismas dos tareas (ej. RELATED_TO
    // y BLOCKS a la vez), borrar por par sería ambiguo y borraría más de una
    // fila. El AND (task_id = $2 OR related_task_id = $2) exige además que la
    // relación involucre a :id, para no poder borrar una relación ajena solo
    // adivinando su id.
    const deleted = await pool.query(
      `
      DELETE FROM task_relations
      WHERE id = $1 AND (task_id = $2 OR related_task_id = $2)
      RETURNING id;
      `,
      [relationId, id]
    );

    if (deleted.rows.length === 0) {
      return res.status(404).json({ message: 'Relation not found' });
    }

    res.json({ message: 'Relation removed successfully' });

  } catch (error) {
    // relationId mal formado: nunca puede matchear una relación real.
    if (error.code === '22P02') {
      return res.status(404).json({ message: 'Relation not found' });
    }

    console.error("DELETE TASK RELATION ERROR:", error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  createRelation,
  getRelations,
  deleteRelation,
  // Reusado por boardController.js para el endpoint agregado de detalle.
  fetchRelationsForTask,
  // Reusado por taskCommentController.js: mismo chequeo de "esta tarea es de
  // este proyecto" que necesita cualquier recurso anidado bajo /tasks/:id.
  findTaskInProject
};
