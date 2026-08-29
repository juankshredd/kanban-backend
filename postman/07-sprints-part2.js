'use strict';
const { lines, request, folder, asUserA, status, messageIsString, bodyVar } = require('./helpers');

const sprintsPart2Folder = folder('07 - Sprints (part 2)', [
  request('Complete Sprint 1 (ACTIVE -> COMPLETED)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/complete', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Status is COMPLETED', function () { pm.expect(body.status).to.eql('COMPLETED'); });",
      "pm.test('task2 (still TODO, not DONE) moved back to backlog', function () {",
      "  pm.expect(body.moved_to_backlog).to.eql(1);",
      '});'
    ),
  }),
  request('Complete Sprint 1 Again (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/complete', {
    auth: asUserA,
    description: 'Ya está COMPLETED, no ACTIVE.',
    tests: lines(status(400), messageIsString()),
  }),
  request('Delete Sprint 2 (still PLANNED)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint2Id}}', {
    auth: asUserA,
    tests: lines(status(200), messageIsString()),
  }),
  request('Delete Sprint 1 (negative, is COMPLETED)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}', {
    auth: asUserA,
    description: 'Solo se puede borrar un sprint que nunca arrancó (PLANNED).',
    tests: lines(status(400), messageIsString()),
  }),
], { description: 'Cierre de sprint (con el paso de tareas no terminadas al backlog) y la regla de borrado solo-si-PLANNED.' });

module.exports = sprintsPart2Folder;
