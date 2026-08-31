'use strict';
const { lines, request, folder, asUserA, asUserC, status, hasProp, messageIsString, bodyVar } = require('./helpers');

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
  request('Create Relation "related to" (canonical route)', 'POST', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task1Id}}/relations', {
    auth: asUserA,
    description: 'Relación simétrica y sin restricción de tipo, distinta de la jerarquía parent_id.',
    body: { related_task_id: '{{task2Id}}' },
    tests: lines(
      status(201),
      bodyVar,
      "pm.test('Relation links task1 and task2', function () {",
      "  pm.expect(body.task_id).to.eql(pm.environment.get('task1Id'));",
      "  pm.expect(body.related_task_id).to.eql(pm.environment.get('task2Id'));",
      '});'
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
      "pm.test('Includes task2 as a related task', function () {",
      "  pm.expect(body.some((r) => r.task.id === pm.environment.get('task2Id'))).to.be.true;",
      '});'
    ),
  }),
  request('Delete Relation (cross-project route)', 'DELETE', '{{baseUrl}}/tasks/{{task1Id}}/relations/{{task2Id}}', {
    auth: asUserA,
    description: 'Ejercita la ruta transversal /api/tasks/:id/relations/:relatedTaskId, resuelta vía requireProjectMemberForResource.',
    tests: lines(status(200), bodyVar, "pm.expect(body.message).to.eql('Relation removed successfully');"),
  }),
  request('List Relations For task1 - Empty After Delete', 'GET', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task1Id}}/relations', {
    auth: asUserA,
    tests: lines(status(200), bodyVar, "pm.expect(body).to.eql([]);"),
  }),
  request('Delete Relation - Not Found (negative)', 'DELETE', '{{baseUrl}}/tasks/{{task1Id}}/relations/{{task2Id}}', {
    auth: asUserA,
    description: 'Ya se borró en el request anterior.',
    tests: lines(status(404), messageIsString()),
  }),
  request('Delete Task - Not TODO (negative)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task1Id}}', {
    auth: asUserA,
    description: 'task1 está en IN_PROGRESS: solo se puede borrar en TODO.',
    tests: lines(status(400), messageIsString()),
  }),
], { description: 'CRUD de tasks (rutas canónica y transversal), filtros, tipos, reorder por rank, relaciones "related to" y la regla "solo se borra en TODO". Deja task1/2/3Id listos para Sprints.' });

module.exports = tasksFolder;
