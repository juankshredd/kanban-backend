'use strict';
const { lines, request, folder, asUserA, status, messageIsString, bodyVar } = require('./helpers');

const cleanupFolder = folder('10 - Cleanup (deletes & cascades)', [
  request('Delete Task (TODO, cross-project route)', 'DELETE', '{{baseUrl}}/tasks/{{task3Id}}', {
    auth: asUserA,
    description: 'task3 sigue en TODO. Ruta transversal: ejercita requireProjectMemberForResource en DELETE.',
    tests: lines(status(200), messageIsString()),
  }),
  request('Delete Task - Not Found (negative)', 'DELETE', '{{baseUrl}}/tasks/{{task3Id}}', {
    auth: asUserA,
    description: 'task3 ya fue borrada en el paso anterior.',
    tests: lines(status(404), messageIsString()),
  }),
  request('Delete Project - Has Tasks (negative, 409)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}', {
    auth: asUserA,
    description: 'task1 (IN_PROGRESS) y task2 (TODO, de vuelta en backlog) siguen en el proyecto.',
    tests: lines(status(409), bodyVar, "pm.expect(body).to.have.property('task_count');"),
  }),
  request('Delete Project - Force (200, cascades tasks/sprints/members)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}?force=true', {
    auth: asUserA,
    tests: lines(status(200), messageIsString()),
  }),
  request('Delete Company - Has Projects (negative, 409)', 'DELETE', '{{baseUrl}}/companies/{{companyId}}', {
    auth: asUserA,
    description: 'project2Id y projectKeyTestId (creados en 03 - Projects) siguen vivos bajo esta company.',
    tests: lines(status(409), bodyVar, "pm.expect(body).to.have.property('project_count');"),
  }),
  request('Delete Company - Force (200, cascades remaining projects)', 'DELETE', '{{baseUrl}}/companies/{{companyId}}?force=true', {
    auth: asUserA,
    tests: lines(status(200), messageIsString()),
  }),
], { description: 'Baja completa: borrado de tarea, y las cascadas con guard 409 / ?force=true de project y company, en ese orden.' });

module.exports = cleanupFolder;
