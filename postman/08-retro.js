'use strict';
const { lines, request, folder, asUserA, asUserB, status, messageIsString, bodyVar } = require('./helpers');

const retroFolder = folder('08 - Retrospective', [
  request('Create Retro Note - WENT_WELL', 'POST', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/retrospective', {
    auth: asUserA,
    body: { category: 'WENT_WELL', content: 'El login quedó estable antes de lo esperado' },
    tests: lines(status(201), bodyVar, "pm.environment.set('note1Id', body.id);", "pm.expect(body.author_name).to.not.be.undefined;"),
  }),
  request('Create Retro Note - TO_IMPROVE', 'POST', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/retrospective', {
    auth: asUserA,
    body: { category: 'TO_IMPROVE', content: 'Deberíamos estimar mejor las tareas de tipo BUG' },
    tests: lines(status(201), bodyVar, "pm.environment.set('note2Id', body.id);"),
  }),
  request('Create Retro Note - ACTION_ITEM', 'POST', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/retrospective', {
    auth: asUserA,
    body: { category: 'ACTION_ITEM', content: 'Agregar validación de email en el frontend' },
    tests: lines(status(201)),
  }),
  request('Create Retro Note - Missing Content (negative)', 'POST', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/retrospective', {
    auth: asUserA,
    body: { category: 'WENT_WELL' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Create Retro Note - Invalid Category (negative)', 'POST', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/retrospective', {
    auth: asUserA,
    body: { category: 'RANDOM', content: 'categoria invalida' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Create Retro Note - Sprint Not Found (negative)', 'POST', '{{baseUrl}}/projects/{{projectId}}/sprints/00000000-0000-0000-0000-000000000000/retrospective', {
    auth: asUserA,
    body: { category: 'WENT_WELL', content: 'sprint que no existe' },
    tests: lines(status(404), messageIsString()),
  }),
  request('Get Retro Notes (grouped by category)', 'GET', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/retrospective', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Response is grouped into the 3 fixed categories', function () {",
      "  pm.expect(body).to.have.all.keys('WENT_WELL', 'TO_IMPROVE', 'ACTION_ITEM');",
      "  pm.expect(body.WENT_WELL.length).to.be.above(0);",
      "  pm.expect(body.TO_IMPROVE.length).to.be.above(0);",
      "  pm.expect(body.ACTION_ITEM.length).to.be.above(0);",
      '});'
    ),
  }),
  request('Update Retro Note (as author)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/retrospective/{{note1Id}}', {
    auth: asUserA,
    body: { content: 'El login quedó estable y con tests de Postman' },
    tests: lines(status(200), bodyVar, "pm.expect(body.content).to.eql('El login quedó estable y con tests de Postman');"),
  }),
  request('Update Retro Note - Not Author (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/retrospective/{{note1Id}}', {
    auth: asUserB,
    description: 'userB es miembro del proyecto pero no el autor de la nota.',
    body: { content: 'Intento de userB' },
    tests: lines(status(403), messageIsString()),
  }),
  request('Update Retro Note - Nothing To Update (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/retrospective/{{note1Id}}', {
    auth: asUserA,
    body: {},
    tests: lines(status(400), messageIsString()),
  }),
  request('Delete Retro Note - Not Author And Not Owner (negative)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/retrospective/{{note2Id}}', {
    auth: asUserB,
    description: 'note2 es de userA (OWNER del proyecto); userB no es autor ni OWNER.',
    tests: lines(status(403), messageIsString()),
  }),
  request('Delete Retro Note (as author)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/retrospective/{{note1Id}}', {
    auth: asUserA,
    tests: lines(status(200), messageIsString()),
  }),
  request('Delete Retro Note - Not Found (negative)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}/sprints/{{sprint1Id}}/retrospective/{{note1Id}}', {
    auth: asUserA,
    description: 'note1 ya fue borrada en el paso anterior.',
    tests: lines(status(404), messageIsString()),
  }),
], { description: 'Notas de retro agrupadas por categoría, y el guard "autor o project OWNER" para editar/borrar.' });

module.exports = retroFolder;
