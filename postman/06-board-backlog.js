'use strict';
const { lines, request, folder, asUserA, status, bodyVar } = require('./helpers');

const boardBacklogFolder = folder('06 - Board & Backlog', [
  request('Get Board - Active Sprint', 'GET', '{{baseUrl}}/projects/{{projectId}}/board', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Sprint is ACTIVE and matches sprint1', function () {",
      "  pm.expect(body.sprint.id).to.eql(pm.environment.get('sprint1Id'));",
      "  pm.expect(body.sprint.status).to.eql('ACTIVE');",
      '});',
      "pm.test('Tasks include task2 (assigned to the sprint), ordered by rank', function () {",
      "  pm.expect(body.tasks.some((t) => t.id === pm.environment.get('task2Id'))).to.be.true;",
      "  const ranks = body.tasks.map((t) => Number(t.rank));",
      '  const sorted = [...ranks].sort((a, b) => a - b);',
      '  pm.expect(ranks).to.eql(sorted);',
      '});'
    ),
  }),
  request('Get Backlog View', 'GET', '{{baseUrl}}/projects/{{projectId}}/backlog', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Sprint 2 (PLANNED) is listed with its embedded tasks', function () {",
      "  const s2 = body.sprints.find((s) => s.id === pm.environment.get('sprint2Id'));",
      "  pm.expect(s2).to.not.be.undefined;",
      "  pm.expect(s2.tasks).to.be.an('array');",
      '});',
      "pm.test('Unassigned tasks (task1, task3) are in the flat backlog list', function () {",
      "  const ids = body.backlog.map((t) => t.id);",
      "  pm.expect(ids).to.include(pm.environment.get('task1Id'));",
      "  pm.expect(ids).to.include(pm.environment.get('task3Id'));",
      "  pm.expect(ids).to.not.include(pm.environment.get('task2Id'));",
      '});'
    ),
  }),
], { description: 'Vistas agregadas de Board (sprint activo + tareas) y Backlog (sprints PLANNED + backlog), exactamente 1 y 3 queries respectivamente.' });

module.exports = boardBacklogFolder;
