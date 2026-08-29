'use strict';
const { lines, request, folder, asUserA, asUserB, asUserC, status, hasProp, messageIsString, bodyVar } = require('./helpers');

const projectsFolder = folder('03 - Projects', [
  request('Create Project (canonical, under company)', 'POST', '{{baseUrl}}/companies/{{companyId}}/projects', {
    auth: asUserA,
    body: { name: 'Kanban QA Board' },
    tests: lines(
      status(201),
      bodyVar,
      hasProp('body', 'key'),
      "pm.test('Key auto-derived matches format ^[A-Z][A-Z0-9]{1,9}$', function () {",
      "  pm.expect(body.key).to.match(/^[A-Z][A-Z0-9]{1,9}$/);",
      '});',
      "pm.test('Creator is OWNER', function () { pm.expect(body.role).to.eql('OWNER'); });",
      "pm.environment.set('projectId', body.id);",
      "pm.environment.set('projectKey', body.key);"
    ),
  }),
  request('Create Project - Custom Key', 'POST', '{{baseUrl}}/companies/{{companyId}}/projects', {
    auth: asUserA,
    body: { name: 'Segundo tablero', key: 'sprintqa' },
    tests: lines(
      status(201),
      bodyVar,
      "pm.test('Key is upper-cased', function () { pm.expect(body.key).to.eql('SPRINTQA'); });",
      "pm.environment.set('projectKeyTestId', body.id);"
    ),
  }),
  request('Create Project - Invalid Key Format (negative)', 'POST', '{{baseUrl}}/companies/{{companyId}}/projects', {
    auth: asUserA,
    body: { name: 'Key invalida', key: '1AB' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Create Project - Missing Name (negative)', 'POST', '{{baseUrl}}/companies/{{companyId}}/projects', {
    auth: asUserA,
    body: {},
    tests: lines(status(400), messageIsString()),
  }),
  request('Create Project - Cross-Company Route', 'POST', '{{baseUrl}}/projects', {
    auth: asUserA,
    description: 'POST /api/projects (transversal), requireCompanyMemberFromBody con company_id en el body.',
    body: { name: 'Proyecto cross-company', company_id: '{{companyId}}' },
    tests: lines(status(201), bodyVar, "pm.environment.set('project2Id', body.id);"),
  }),
  request('Create Project - Cross-Company - Missing company_id (negative)', 'POST', '{{baseUrl}}/projects', {
    auth: asUserA,
    body: { name: 'Sin company' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Create Project - Cross-Company - Not a Company Member (negative)', 'POST', '{{baseUrl}}/projects', {
    auth: asUserC,
    description: 'userC no pertenece a companyId: 404, igual que si la company no existiera.',
    body: { name: 'Intento de userC', company_id: '{{companyId}}' },
    tests: lines(status(404), messageIsString()),
  }),
  request('List My Projects', 'GET', '{{baseUrl}}/projects', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Contains the created project', function () {",
      "  pm.expect(body.some((p) => p.id === pm.environment.get('projectId'))).to.be.true;",
      '});'
    ),
  }),
  request('List My Projects - Filter by company_id', 'GET', '{{baseUrl}}/projects?company_id={{companyId}}', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Every project belongs to the filtered company', function () {",
      "  pm.expect(body.length).to.be.above(0);",
      "  body.forEach((p) => pm.expect(p.company_id).to.eql(pm.environment.get('companyId')));",
      '});'
    ),
  }),
  request('List My Projects - Invalid company_id (negative)', 'GET', '{{baseUrl}}/projects?company_id=not-a-uuid', {
    auth: asUserA,
    tests: lines(status(400), messageIsString()),
  }),
  request('Get Company Projects (nested list)', 'GET', '{{baseUrl}}/companies/{{companyId}}/projects', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Contains the created project', function () {",
      "  pm.expect(body.some((p) => p.id === pm.environment.get('projectId'))).to.be.true;",
      '});'
    ),
  }),
  request('Get Project By Id', 'GET', '{{baseUrl}}/projects/{{projectId}}', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Includes members and task_count', function () {",
      "  pm.expect(body.members).to.be.an('array');",
      "  pm.expect(body).to.have.property('task_count');",
      '});'
    ),
  }),
  request('Get Project By Id - Not a Member (negative)', 'GET', '{{baseUrl}}/projects/{{projectId}}', {
    auth: asUserC,
    tests: lines(status(404), messageIsString()),
  }),
  request('Update Project', 'PATCH', '{{baseUrl}}/projects/{{projectId}}', {
    auth: asUserA,
    body: { description: 'Board principal de la suite QA' },
    tests: lines(status(200), bodyVar, "pm.test('Description updated', function () { pm.expect(body.description).to.eql('Board principal de la suite QA'); });"),
  }),
  request('Update Project - Nothing To Update (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}', {
    auth: asUserA,
    body: {},
    tests: lines(status(400), messageIsString()),
  }),
  request('Remove Project Member - Cannot Remove Last Owner (negative)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}/members/{{userAId}}', {
    auth: asUserA,
    tests: lines(status(409), messageIsString()),
  }),
  request('Add Project Member (userB)', 'POST', '{{baseUrl}}/projects/{{projectId}}/members', {
    auth: asUserA,
    body: { email: '{{userBEmail}}' },
    tests: lines(status(201), bodyVar, "pm.test('Defaults to MEMBER', function () { pm.expect(body.role).to.eql('MEMBER'); });"),
  }),
  request('Add Project Member - Duplicate (negative)', 'POST', '{{baseUrl}}/projects/{{projectId}}/members', {
    auth: asUserA,
    body: { email: '{{userBEmail}}' },
    tests: lines(status(409), messageIsString()),
  }),
  request('Update Project Member Role - Invalid Role (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/members/{{userBId}}', {
    auth: asUserA,
    body: { role: 'SUPERADMIN' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Update Project Member Role - Promote userB to OWNER', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/members/{{userBId}}', {
    auth: asUserA,
    body: { role: 'OWNER' },
    tests: lines(status(200), bodyVar, "pm.expect(body.role).to.eql('OWNER');"),
  }),
  request('Update Project Member Role - Demote userB back to MEMBER', 'PATCH', '{{baseUrl}}/projects/{{projectId}}/members/{{userBId}}', {
    auth: asUserA,
    body: { role: 'MEMBER' },
    tests: lines(status(200), bodyVar, "pm.expect(body.role).to.eql('MEMBER');"),
  }),
  request('Update Project - As Non-Owner (negative)', 'PATCH', '{{baseUrl}}/projects/{{projectId}}', {
    auth: asUserB,
    body: { name: 'Intento de userB' },
    tests: lines(status(403), messageIsString()),
  }),
  request('Remove Project Member (userB)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}/members/{{userBId}}', {
    auth: asUserA,
    tests: lines(status(200), messageIsString()),
  }),
  request('Remove Project Member - Not a Member (negative)', 'DELETE', '{{baseUrl}}/projects/{{projectId}}/members/{{userBId}}', {
    auth: asUserA,
    tests: lines(status(404), messageIsString()),
  }),
  request('Re-Add Project Member (userB) for later use', 'POST', '{{baseUrl}}/projects/{{projectId}}/members', {
    auth: asUserA,
    description: 'userB queda como MEMBER del proyecto para los tests de retro (autor vs. no-autor).',
    body: { email: '{{userBEmail}}' },
    tests: lines(status(201)),
  }),
], { description: 'CRUD de projects (rutas canónica y cross-company), miembros y el guard del último OWNER. Deja projectId/projectKey listos para Tasks/Sprints.' });

module.exports = projectsFolder;
