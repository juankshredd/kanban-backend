'use strict';
const { lines, request, folder, asUserA, asUserB, asUserC, status, hasProp, messageIsString, bodyVar } = require('./helpers');

const tasksFolder = folder('04 - Tasks', [
  request('Create Task (canonical, under project)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks', {
    auth: asUserA,
    body: { title: 'Diseñar pantalla de login', description: 'Wireframe + estados de error' },
    tests: lines(
      status(201),
      bodyVar,
      "pm.test('Ticket id uses the project key', function () {",
      "  pm.expect(body.ticket_id).to.eql(pm.environment.get('projectKey') + '-' + body.ticket_number);",
      '});',
      "pm.test('Defaults to type STORY and status TODO', function () {",
      "  pm.expect(body.type).to.eql('STORY');",
      "  pm.expect(body.status).to.eql('TODO');",
      '});',
      "pm.environment.set('task1Id', body.id);"
    ),
  }),
  request('Create Task - Missing Title (negative)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks', {
    auth: asUserA,
    body: { description: 'sin titulo' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Create Task - Invalid Type (negative)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks', {
    auth: asUserA,
    body: { title: 'Tipo invalido', type: 'NOTATYPE' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Create Task With Type BUG', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks', {
    auth: asUserA,
    body: { title: 'Arreglar bug de login', type: 'BUG' },
    tests: lines(status(201), bodyVar, "pm.environment.set('task2Id', body.id);"),
  }),
  request('Create Task - Cross-Project Route', 'POST', '{{baseUrl}}/tasks', {
    auth: asUserA,
    description: 'POST /api/tasks (transversal), requireProjectMemberFromBody con project_id en el body.',
    body: { project_id: '{{projectId}}', title: 'Tarea creada por ruta transversal' },
    tests: lines(status(201), bodyVar, "pm.environment.set('task3Id', body.id);"),
  }),
  request('Create Task - Cross-Project - Missing project_id (negative)', 'POST', '{{baseUrl}}/tasks', {
    auth: asUserA,
    body: { title: 'Sin proyecto' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Create Task - Cross-Project - Not a Project Member (negative)', 'POST', '{{baseUrl}}/tasks', {
    auth: asUserC,
    body: { project_id: '{{projectId}}', title: 'Intento de userC' },
    tests: lines(status(404), messageIsString()),
  }),
  request('List Project Tasks (board order by rank)', 'GET', '{{baseUrl}}/projects/{{projectId}}/tasks', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Contains the 3 created tasks', function () {",
      "  const ids = body.map((t) => t.id);",
      "  pm.expect(ids).to.include(pm.environment.get('task1Id'));",
      "  pm.expect(ids).to.include(pm.environment.get('task2Id'));",
      "  pm.expect(ids).to.include(pm.environment.get('task3Id'));",
      '});',
      "pm.test('Ordered by rank ascending', function () {",
      "  const ranks = body.map((t) => Number(t.rank));",
      "  const sorted = [...ranks].sort((a, b) => a - b);",
      '  pm.expect(ranks).to.eql(sorted);',
      '});'
    ),
  }),
  request('List Project Tasks - Filter by type=BUG', 'GET', '{{baseUrl}}/projects/{{projectId}}/tasks?type=BUG', {
    auth: asUserA,
    tests: lines(status(200), bodyVar, "pm.test('Only BUG tasks returned', function () { body.forEach((t) => pm.expect(t.type).to.eql('BUG')); });"),
  }),
  request('List Project Tasks - Filter by sprint_id=backlog', 'GET', '{{baseUrl}}/projects/{{projectId}}/tasks?sprint_id=backlog', {
    auth: asUserA,
    tests: lines(status(200), bodyVar, "pm.test('None of the tasks are assigned to a sprint yet', function () { body.forEach((t) => pm.expect(t.sprint_id).to.be.null); });"),
  }),
  request('List Project Tasks - Invalid status filter (negative)', 'GET', '{{baseUrl}}/projects/{{projectId}}/tasks?status=NOT_A_STATUS', {
    auth: asUserA,
    tests: lines(status(400), messageIsString()),
  }),
  request('Get My Tasks ("mi trabajo")', 'GET', '{{baseUrl}}/tasks', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Contains tasks created by userA', function () {",
      "  pm.expect(body.some((t) => t.id === pm.environment.get('task1Id'))).to.be.true;",
      '});'
    ),
  }),
  request('Get My Tasks - Filter by project_id', 'GET', '{{baseUrl}}/tasks?project_id={{projectId}}', {
    auth: asUserA,
    tests: lines(status(200), bodyVar, "pm.test('All tasks belong to the filtered project', function () { body.forEach((t) => pm.expect(t.project_id).to.eql(pm.environment.get('projectId'))); });"),
  }),
  request('Update Task - Status (cross-project route)', 'PATCH', '{{baseUrl}}/tasks/{{task1Id}}', {
    auth: asUserA,
    description: 'Usa la ruta transversal /api/tasks/:id para ejercitar requireProjectMemberForResource.',
    body: { status: 'in_progress' },
    tests: lines(status(200), bodyVar, "pm.test('Status normalized to IN_PROGRESS', function () { pm.expect(body.status).to.eql('IN_PROGRESS'); });"),
  }),
  request('Update Task - Invalid Status (negative)', 'PATCH', '{{baseUrl}}/tasks/{{task1Id}}', {
    auth: asUserA,
    body: { status: 'archived' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Update Task Type (dedicated endpoint)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task2Id}}/type', {
    auth: asUserA,
    body: { type: 'TASK' },
    tests: lines(status(200), bodyVar, "pm.expect(body.type).to.eql('TASK');"),
  }),
  request('Update Task Type - Missing Type (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task2Id}}/type', {
    auth: asUserA,
    body: {},
    tests: lines(status(400), messageIsString()),
  }),
  request('Update Task - Reorder to top (after_task_id=null)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task3Id}}', {
    auth: asUserA,
    body: { after_task_id: null },
    tests: lines(status(200)),
  }),
  request('Verify Reorder - task3 now ranks first', 'GET', '{{baseUrl}}/projects/{{projectId}}/tasks', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('task3 has the lowest rank (first in Backlog/board)', function () {",
      "  const task3 = body.find((t) => t.id === pm.environment.get('task3Id'));",
      "  const others = body.filter((t) => t.id !== pm.environment.get('task3Id'));",
      "  others.forEach((t) => pm.expect(Number(task3.rank)).to.be.below(Number(t.rank)));",
      '});'
    ),
  }),
  request('Update Task - Invalid after_task_id (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task3Id}}', {
    auth: asUserA,
    body: { after_task_id: '00000000-0000-0000-0000-000000000000' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Update Task - Nothing To Update (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task3Id}}', {
    auth: asUserA,
    body: {},
    tests: lines(status(400), messageIsString()),
  }),
  request('Update Task - Not Found (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/tasks/00000000-0000-0000-0000-000000000000', {
    auth: asUserA,
    body: { status: 'done' },
    tests: lines(status(404), messageIsString()),
  }),
  request('Create Relation "relates to" (canonical route, default relation_type)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task1Id}}/relations', {
    auth: asUserA,
    description: 'Relación simétrica y sin restricción de tipo, distinta de la jerarquía parent_id. relation_type se omite -> default RELATED_TO.',
    body: { related_task_id: '{{task2Id}}' },
    tests: lines(
      status(201),
      bodyVar,
      "pm.test('Relation links task1 and task2 as RELATED_TO', function () {",
      "  pm.expect(body.task_id).to.eql(pm.environment.get('task1Id'));",
      "  pm.expect(body.related_task_id).to.eql(pm.environment.get('task2Id'));",
      "  pm.expect(body.relation_type).to.eql('RELATED_TO');",
      '});',
      "pm.environment.set('relation1Id', body.id);"
    ),
  }),
  request('Create Relation - Self Relation (negative)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task1Id}}/relations', {
    auth: asUserA,
    body: { related_task_id: '{{task1Id}}' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Create Relation - Already Related (negative)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task1Id}}/relations', {
    auth: asUserA,
    description: 'task1/task2 ya están relacionadas por el request anterior; el índice único del par vuelve esto 409.',
    body: { related_task_id: '{{task2Id}}' },
    tests: lines(status(409), messageIsString()),
  }),
  request('Create Relation - Reverse Pair Also Conflicts (negative)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task2Id}}/relations', {
    auth: asUserA,
    description: 'Mismo par en el orden inverso: la relación es simétrica, así que también es 409.',
    body: { related_task_id: '{{task1Id}}' },
    tests: lines(status(409), messageIsString()),
  }),
  request('Create Relation - Task Not Found (negative)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task1Id}}/relations', {
    auth: asUserA,
    body: { related_task_id: '00000000-0000-0000-0000-000000000000' },
    tests: lines(status(404), messageIsString()),
  }),
  request('List Relations For task1', 'GET', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task1Id}}/relations', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Includes task2 as a related task, labeled \"relates to\"', function () {",
      "  const rel = body.find((r) => r.task.id === pm.environment.get('task2Id'));",
      "  pm.expect(rel).to.not.be.undefined;",
      "  pm.expect(rel.type).to.eql('relates to');",
      '});'
    ),
  }),
  request('Create Relation - Directional (task2 BLOCKS task1)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task2Id}}/relations', {
    auth: asUserA,
    description: 'relation_type explícito, direccional: no pasa por el índice único simétrico.',
    body: { related_task_id: '{{task1Id}}', relation_type: 'blocks' },
    tests: lines(status(201), bodyVar, "pm.environment.set('relation2Id', body.id);"),
  }),
  request('List Relations For task1 - Sees The Inverse Label', 'GET', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task1Id}}/relations', {
    auth: asUserA,
    description: 'task1 es el lado related_task_id del BLOCKS que acaba de crear task2, así que ve el inverso.',
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Sees task2 labeled \"is blocked by\" (inverse of BLOCKS)', function () {",
      "  const rel = body.find((r) => r.task.id === pm.environment.get('task2Id') && r.type === 'is blocked by');",
      "  pm.expect(rel).to.not.be.undefined;",
      '});'
    ),
  }),
  request('Delete Relation - By relationId (cross-project route)', 'DELETE', '{{baseUrl}}/tasks/{{task1Id}}/relations/{{relation1Id}}', {
    auth: asUserA,
    description: 'Ejercita la ruta transversal /api/tasks/:id/relations/:relationId, resuelta vía requireProjectMemberForResource. Se borra por el id propio de la relación, no por la otra tarea, porque puede haber más de un relation_type activo entre el mismo par.',
    tests: lines(status(200), bodyVar, "pm.expect(body.message).to.eql('Relation removed successfully');"),
  }),
  request('Delete Relation - Not Found (negative)', 'DELETE', '{{baseUrl}}/tasks/{{task1Id}}/relations/{{relation1Id}}', {
    auth: asUserA,
    description: 'Ya se borró en el request anterior.',
    tests: lines(status(404), messageIsString()),
  }),
  request('Delete Relation - task2 BLOCKS task1 (cleanup)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task2Id}}/relations/{{relation2Id}}', {
    auth: asUserA,
    tests: lines(status(200)),
  }),
  request('Delete Task - Not TODO (negative)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task1Id}}', {
    auth: asUserA,
    description: 'task1 está en IN_PROGRESS: solo se puede borrar en TODO.',
    tests: lines(status(400), messageIsString()),
  }),

  // --- Panel de detalle del modal de ticket: assignee/points/labels, búsqueda,
  // reorder de subtasks por parent_id, comentarios y el endpoint agregado. Usa
  // task4Id (STORY dedicada) en vez de task1/2/3 para no dejarles hijos colgando
  // -- esos tres siguen intactos para 05-sprints-part1.js.
  request('Create Task With points/labels/assignee_id', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks', {
    auth: asUserA,
    body: { title: 'Story para el modal de detalle', points: 5, labels: ['ui', 'integration'], assignee_id: '{{userBId}}' },
    tests: lines(
      status(201),
      bodyVar,
      "pm.test('Persists points, labels and assignee', function () {",
      "  pm.expect(body.points).to.eql(5);",
      "  pm.expect(body.labels).to.eql(['ui', 'integration']);",
      "  pm.expect(body.assignee_id).to.eql(pm.environment.get('userBId'));",
      '});',
      "pm.environment.set('task4Id', body.id);"
    ),
  }),
  request('Create Task - assignee_id Not A Project Member (negative)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks', {
    auth: asUserA,
    body: { title: 'Asignada a alguien de afuera', assignee_id: '{{userCId}}' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Update Task - Reassign, Re-point, Re-label', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task4Id}}', {
    auth: asUserA,
    body: { assignee_id: null, points: 8, labels: [] },
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('assignee_id cleared, points and labels replaced wholesale', function () {",
      "  pm.expect(body.assignee_id).to.be.null;",
      "  pm.expect(body.points).to.eql(8);",
      "  pm.expect(body.labels).to.eql([]);",
      "  pm.expect(body.updated_by).to.eql(pm.environment.get('userAId'));",
      '});'
    ),
  }),
  request('Update Task - Invalid points (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task4Id}}', {
    auth: asUserA,
    body: { points: -3 },
    tests: lines(status(400), messageIsString()),
  }),
  request('List Project Tasks - Search by title', 'GET', '{{baseUrl}}/projects/{{projectId}}/tasks?search=modal de detalle', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Finds task4 by title substring', function () {",
      "  pm.expect(body.some((t) => t.id === pm.environment.get('task4Id'))).to.be.true;",
      '});'
    ),
  }),
  request('List Project Tasks - Search by ticket key', 'GET', '{{baseUrl}}/projects/{{projectId}}/tasks?search={{projectKey}}-1', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Finds task1 by ticket key', function () {",
      "  pm.expect(body.some((t) => t.id === pm.environment.get('task1Id'))).to.be.true;",
      '});'
    ),
  }),
  request('Create Subtask A (parent_id = task4)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks', {
    auth: asUserA,
    body: { title: 'Subtask A', type: 'TASK', parent_id: '{{task4Id}}' },
    tests: lines(status(201), bodyVar, "pm.environment.set('task5Id', body.id);"),
  }),
  request('Create Subtask B (parent_id = task4)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks', {
    auth: asUserA,
    body: { title: 'Subtask B', type: 'TASK', parent_id: '{{task4Id}}' },
    tests: lines(status(201), bodyVar, "pm.environment.set('task6Id', body.id);"),
  }),
  request('Update Task - Reorder Subtask B to top (reorder_scope: siblings)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task6Id}}', {
    auth: asUserA,
    description: 'Reordena entre hermanos bajo el mismo parent_id, sin importar el sprint_id de cada uno -- distinto del reorder por defecto (Board/Backlog por sprint_id).',
    body: { reorder_scope: 'siblings', after_task_id: null },
    tests: lines(status(200)),
  }),
  request('Update Task - reorder_scope siblings without a parent_id (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task1Id}}', {
    auth: asUserA,
    description: 'task1 no tiene parent_id, así que no hay lista de hermanos que reordenar.',
    body: { reorder_scope: 'siblings', after_task_id: null },
    tests: lines(status(400), messageIsString()),
  }),
  request('Create Comment on task4', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task4Id}}/comments', {
    auth: asUserA,
    body: { content: 'Linked this to a blocker -- @qadetailstester can you retest?' },
    tests: lines(status(201), bodyVar, "pm.environment.set('comment1Id', body.id);"),
  }),
  request('Create Comment - Missing Content (negative)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task4Id}}/comments', {
    auth: asUserA,
    body: {},
    tests: lines(status(400), messageIsString()),
  }),
  request('Create Comment - userB replies', 'POST', '{{baseUrl}}/tasks/{{task4Id}}/comments', {
    auth: asUserB,
    description: 'Ruta transversal /api/tasks/:id/comments.',
    body: { content: 'Reproduced it, tracking above.' },
    tests: lines(status(201), bodyVar, "pm.environment.set('comment2Id', body.id);"),
  }),
  request('List Comments on task4', 'GET', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task4Id}}/comments', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Contains both comments, ordered by created_at', function () {",
      "  const ids = body.map((c) => c.id);",
      "  pm.expect(ids).to.eql([pm.environment.get('comment1Id'), pm.environment.get('comment2Id')]);",
      '});'
    ),
  }),
  request("Delete Comment - userA (OWNER) moderates userB's comment", 'DELETE', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task4Id}}/comments/{{comment2Id}}', {
    auth: asUserA,
    tests: lines(status(200), bodyVar, "pm.expect(body.message).to.eql('Comment deleted successfully');"),
  }),
  request('Delete Comment - Not Found (negative)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task4Id}}/comments/{{comment2Id}}', {
    auth: asUserA,
    description: 'Ya se borró en el request anterior.',
    tests: lines(status(404), messageIsString()),
  }),
  request('Get Task Detail (aggregate: task + parent + children + relations + sprint)', 'GET', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task4Id}}/detail', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Includes the task itself, its 2 children and no parent/sprint yet', function () {",
      "  pm.expect(body.task.id).to.eql(pm.environment.get('task4Id'));",
      "  pm.expect(body.children.map((c) => c.id)).to.have.members([pm.environment.get('task5Id'), pm.environment.get('task6Id')]);",
      "  pm.expect(body.parent).to.be.null;",
      "  pm.expect(body.sprint).to.be.null;",
      '});'
    ),
  }),
  request('Get Task Detail - Not Found (negative)', 'GET', '{{baseUrl}}/projects/{{projectId}}/tasks/00000000-0000-0000-0000-000000000000/detail', {
    auth: asUserA,
    tests: lines(status(404), messageIsString()),
  }),
], { description: 'CRUD de tasks (rutas canónica y transversal), filtros/búsqueda, tipos, reorder por rank (Board/Backlog y hermanos por parent_id), relaciones tipadas y direccionales, comentarios, el endpoint agregado de detalle, y la regla "solo se borra en TODO". Deja task1/2/3Id listos para Sprints.' });

module.exports = tasksFolder;
