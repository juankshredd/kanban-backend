'use strict';
const { lines, request, folder, asUserA, asUserB, status, hasProp, messageIsString, bodyVar } = require('./helpers');

const longName = 'N'.repeat(101);

const companiesFolder = folder('02 - Companies', [
  request('Create Company', 'POST', '{{baseUrl}}/companies', {
    auth: asUserA,
    body: { name: 'HackBali QA Corp', description: 'Company creada por la suite de Postman' },
    tests: lines(
      status(201),
      bodyVar,
      hasProp('body', 'id'),
      "pm.test('Creator is OWNER', function () { pm.expect(body.role).to.eql('OWNER'); });",
      "pm.environment.set('companyId', body.id);"
    ),
  }),
  request('Create Company - Missing Name (negative)', 'POST', '{{baseUrl}}/companies', {
    auth: asUserA,
    body: { description: 'sin nombre' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Create Company - Name Too Long (negative)', 'POST', '{{baseUrl}}/companies', {
    auth: asUserA,
    body: { name: longName },
    tests: lines(status(400), messageIsString()),
  }),
  request('List My Companies', 'GET', '{{baseUrl}}/companies', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Contains the created company with counts', function () {",
      "  const mine = body.find((c) => c.id === pm.environment.get('companyId'));",
      "  pm.expect(mine).to.not.be.undefined;",
      "  pm.expect(mine).to.have.property('project_count');",
      "  pm.expect(mine).to.have.property('member_count');",
      "  pm.expect(mine.role).to.eql('OWNER');",
      '});'
    ),
  }),
  request('Get Company By Id', 'GET', '{{baseUrl}}/companies/{{companyId}}', {
    auth: asUserA,
    tests: lines(
      status(200),
      bodyVar,
      "pm.test('Includes members array with the owner', function () {",
      "  pm.expect(body.members).to.be.an('array');",
      "  const owner = body.members.find((m) => m.id === pm.environment.get('userAId'));",
      "  pm.expect(owner).to.not.be.undefined;",
      "  pm.expect(owner.role).to.eql('OWNER');",
      '});'
    ),
  }),
  request('Get Company By Id - Not a Member (negative)', 'GET', '{{baseUrl}}/companies/{{companyId}}', {
    auth: asUserB,
    description: 'userB todavía no es miembro de esta company: debe dar 404, no 403 (no se filtra existencia).',
    tests: lines(status(404), messageIsString()),
  }),
  request('Update Company', 'PATCH', '{{baseUrl}}/companies/{{companyId}}', {
    auth: asUserA,
    body: { description: 'Descripción actualizada por Newman' },
    tests: lines(status(200), bodyVar, "pm.test('Description updated', function () { pm.expect(body.description).to.eql('Descripción actualizada por Newman'); });"),
  }),
  request('Update Company - Nothing To Update (negative)', 'PATCH', '{{baseUrl}}/companies/{{companyId}}', {
    auth: asUserA,
    body: {},
    tests: lines(status(400), messageIsString()),
  }),
  request('Remove Company Member - Cannot Remove Last Owner (negative)', 'DELETE', '{{baseUrl}}/companies/{{companyId}}/members/{{userAId}}', {
    auth: asUserA,
    tests: lines(status(409), messageIsString()),
  }),
  request('Add Company Member (userB)', 'POST', '{{baseUrl}}/companies/{{companyId}}/members', {
    auth: asUserA,
    body: { email: '{{userBEmail}}' },
    tests: lines(
      status(201),
      bodyVar,
      "pm.test('Defaults to MEMBER role', function () { pm.expect(body.role).to.eql('MEMBER'); });",
      "pm.environment.set('companyMemberBId', body.id);"
    ),
  }),
  request('Add Company Member - Duplicate (negative)', 'POST', '{{baseUrl}}/companies/{{companyId}}/members', {
    auth: asUserA,
    body: { email: '{{userBEmail}}' },
    tests: lines(status(409), messageIsString()),
  }),
  request('Add Company Member - User Not Found (negative)', 'POST', '{{baseUrl}}/companies/{{companyId}}/members', {
    auth: asUserA,
    body: { email: 'no-such-user-{{$timestamp}}@example.test' },
    tests: lines(status(404), messageIsString()),
  }),
  request('Update Company - As Non-Owner (negative)', 'PATCH', '{{baseUrl}}/companies/{{companyId}}', {
    auth: asUserB,
    body: { name: 'Intento de userB' },
    tests: lines(status(403), messageIsString()),
  }),
  request('Update Company Member Role - Invalid Role (negative)', 'PATCH', '{{baseUrl}}/companies/{{companyId}}/members/{{userBId}}', {
    auth: asUserA,
    body: { role: 'ADMIN' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Update Company Member Role - Promote userB to OWNER', 'PATCH', '{{baseUrl}}/companies/{{companyId}}/members/{{userBId}}', {
    auth: asUserA,
    body: { role: 'OWNER' },
    tests: lines(status(200), bodyVar, "pm.test('Role is OWNER now', function () { pm.expect(body.role).to.eql('OWNER'); });"),
  }),
  request('Update Company Member Role - Demote userB back to MEMBER', 'PATCH', '{{baseUrl}}/companies/{{companyId}}/members/{{userBId}}', {
    auth: asUserA,
    description: 'Permitido: con userB también OWNER, userA sigue sin ser el último owner.',
    body: { role: 'MEMBER' },
    tests: lines(status(200), bodyVar, "pm.test('Role is MEMBER again', function () { pm.expect(body.role).to.eql('MEMBER'); });"),
  }),
  request('Remove Company Member (userB)', 'DELETE', '{{baseUrl}}/companies/{{companyId}}/members/{{userBId}}', {
    auth: asUserA,
    tests: lines(status(200), messageIsString()),
  }),
  request('Remove Company Member - Not a Member (negative)', 'DELETE', '{{baseUrl}}/companies/{{companyId}}/members/{{userBId}}', {
    auth: asUserA,
    description: 'userB ya fue removido en el paso anterior.',
    tests: lines(status(404), messageIsString()),
  }),
], { description: 'CRUD de companies + administración de miembros y el guard del último OWNER. Deja companyId listo para Projects.' });

module.exports = companiesFolder;
