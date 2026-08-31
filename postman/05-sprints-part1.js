'use strict';
const { lines, request, folder, asUserA, status, hasProp, messageIsString, bodyVar } = require('./helpers');

const sprintsPart1Folder = folder('05 - Sprints (part 1)', [
  request('Get Board - No Active Sprint Yet (negative)', 'GET', '{{baseUrl}}/projects/{{projectId}}/board', {
    auth: asUserA,
    description: 'Se hace antes de crear/arrancar cualquier sprint, para cubrir el 404 de getBoard sin pisar el happy-path de más adelante.',
    tests: lines(status(404), messageIsString()),
  }),
  request('Create Sprint 1', 'POST', '{{baseUrl}}/projects/{{projectId}}/sprints', {
    auth: asUserA,
    body: { name: 'Sprint 1', goal: 'Cerrar el login end-to-end', start_date: '2026-09-01', end_date: '2026-09-14' },
    tests: lines(
      status(201),
      bodyVar,
      "pm.test('Starts as PLANNED with task_count 0', function () {",
      "  pm.expect(body.status).to.eql('PLANNED');",
      "  pm.expect(body.task_count).to.eql(0);",
      '});',
      "pm.environment.set('sprint1Id', body.id);"
    ),
  }),
  request('Create Sprint - Missing Name (negative)', 'POST', '{{baseUrl}}/projects/{{projectId}}/sprints', {
    auth: asUserA,
    body: { goal: 'sin nombre' },
    tests: lines(status(400), messageIsString()),
  }),
  request('List Sprints', 'GET', '{{baseUrl}}/projects/{{projectId}}/sprints', {
    auth: asUserA,
    tests: lines(status(200), bodyVar, "pm.test('Contains sprint1', function () { pm.expect(body.some((s) => s.id === pm.environment.get('sprint1Id'))).to.be.true; });"),
  }),
  request('Get Active Sprint - None Active Yet (negative)', 'GET', '{{baseUrl}}/projects/{{projectId}}/sprints/active', {
    auth: asUserA,
    tests: lines(status(404), messageIsString()),
  }),
  request('Get Sprint By Id', 'GET', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}', {
    auth: asUserA,
    tests: lines(status(200), bodyVar, "pm.expect(body.id).to.eql(pm.environment.get('sprint1Id'));"),
  }),
  request('Get Sprint By Id - Not Found (negative)', 'GET', '{{baseUrl}}/projects/{{projectId}}/sprints/00000000-0000-0000-0000-000000000000', {
    auth: asUserA,
    tests: lines(status(404), messageIsString()),
  }),
  request('Update Sprint (goal)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}', {
    auth: asUserA,
    body: { goal: 'Cerrar login y registro' },
    tests: lines(status(200), bodyVar, "pm.expect(body.goal).to.eql('Cerrar login y registro');"),
  }),
  request('Update Sprint - Nothing To Update (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}', {
    auth: asUserA,
    body: {},
    tests: lines(status(400), messageIsString()),
  }),
  request('Assign task2 to Sprint 1', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task2Id}}', {
    auth: asUserA,
    body: { sprint_id: '{{sprint1Id}}' },
    tests: lines(status(200), bodyVar, "pm.expect(body.sprint_id).to.eql(pm.environment.get('sprint1Id'));"),
  }),
  request('Assign Task - sprint_id from another project (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/tasks/{{task1Id}}', {
    auth: asUserA,
    body: { sprint_id: '11111111-1111-1111-1111-111111111111' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Start Sprint 1 (PLANNED -> ACTIVE)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/start', {
    auth: asUserA,
    tests: lines(status(200), bodyVar, "pm.expect(body.status).to.eql('ACTIVE');"),
  }),
  request('Start Sprint 1 Again (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/start', {
    auth: asUserA,
    description: 'Ya está ACTIVE, no PLANNED.',
    tests: lines(status(400), messageIsString()),
  }),
  request('Create Sprint 2', 'POST', '{{baseUrl}}/projects/{{projectId}}/sprints', {
    auth: asUserA,
    body: { name: 'Sprint 2' },
    tests: lines(status(201), bodyVar, "pm.environment.set('sprint2Id', body.id);"),
  }),
  request('Start Sprint 2 While Sprint 1 Active (negative, 409)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint2Id}}/start', {
    auth: asUserA,
    description: 'Choca con el índice parcial one_active_sprint_per_project.',
    tests: lines(status(409), messageIsString()),
  }),
  request('Get Active Sprint (now returns Sprint 1)', 'GET', '{{baseUrl}}/projects/{{projectId}}/sprints/active', {
    auth: asUserA,
    tests: lines(status(200), bodyVar, "pm.expect(body.id).to.eql(pm.environment.get('sprint1Id'));"),
  }),
], { description: 'Ciclo de vida de sprints hasta ACTIVE, más el conflicto one-active-sprint-per-project. Board/Backlog corre a continuación mientras Sprint 1 sigue activo.' });

module.exports = sprintsPart1Folder;
