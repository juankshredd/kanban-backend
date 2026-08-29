'use strict';
const { lines, request, folder, noAuth, withBadToken, status, hasProp, messageIsString, bodyVar } = require('./helpers');

const setupScript = lines(
  '// Genera credenciales únicas para esta corrida (usuarios A, B y C).',
  '// Evita choques de "email ya registrado" entre corridas sucesivas de Newman.',
  "const stamp = Date.now() + '-' + Math.floor(Math.random() * 100000);",
  "pm.environment.set('testPassword', 'Passw0rd!23');",
  "pm.environment.set('userAEmail', 'qa.usera.' + stamp + '@example.test');",
  "pm.environment.set('userAUsername', 'qa_user_a_' + stamp);",
  "pm.environment.set('userBEmail', 'qa.userb.' + stamp + '@example.test');",
  "pm.environment.set('userBUsername', 'qa_user_b_' + stamp);",
  "pm.environment.set('userCEmail', 'qa.userc.' + stamp + '@example.test');",
  "pm.environment.set('userCUsername', 'qa_user_c_' + stamp);"
);

const authFolder = folder('01 - Auth', [
  request('Register User A', 'POST', '{{baseUrl}}/auth/register', {
    auth: noAuth,
    prerequest: setupScript,
    body: { username: '{{userAUsername}}', email: '{{userAEmail}}', password: '{{testPassword}}' },
    tests: lines(
      status(201),
      bodyVar,
      hasProp('body', 'id'),
      "pm.test('Returns the username and email sent', function () {",
      "  pm.expect(body.username).to.eql(pm.environment.get('userAUsername'));",
      "  pm.expect(body.email).to.eql(pm.environment.get('userAEmail'));",
      '});',
      "pm.test('Response does not leak the password hash', function () {",
      "  pm.expect(body).to.not.have.property('password_hash');",
      '});',
      "pm.environment.set('userAId', body.id);"
    ),
  }),
  request('Register User A - Duplicate Email (negative)', 'POST', '{{baseUrl}}/auth/register', {
    auth: noAuth,
    body: { username: 'someone-else', email: '{{userAEmail}}', password: '{{testPassword}}' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Register - Missing Fields (negative)', 'POST', '{{baseUrl}}/auth/register', {
    auth: noAuth,
    body: { username: 'incomplete' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Register - Invalid Email Format (negative)', 'POST', '{{baseUrl}}/auth/register', {
    auth: noAuth,
    body: { username: 'bademail', email: 'not-an-email', password: '{{testPassword}}' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Register - Password Too Short (negative)', 'POST', '{{baseUrl}}/auth/register', {
    auth: noAuth,
    body: { username: 'shortpwd', email: 'shortpwd.{{$timestamp}}@example.test', password: '123' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Register User B', 'POST', '{{baseUrl}}/auth/register', {
    auth: noAuth,
    body: { username: '{{userBUsername}}', email: '{{userBEmail}}', password: '{{testPassword}}' },
    tests: lines(status(201), bodyVar, "pm.environment.set('userBId', body.id);"),
  }),
  request('Register User C', 'POST', '{{baseUrl}}/auth/register', {
    auth: noAuth,
    body: { username: '{{userCUsername}}', email: '{{userCEmail}}', password: '{{testPassword}}' },
    tests: lines(status(201), bodyVar, "pm.environment.set('userCId', body.id);"),
  }),
  request('Login User A', 'POST', '{{baseUrl}}/auth/login', {
    auth: noAuth,
    body: { email: '{{userAEmail}}', password: '{{testPassword}}' },
    tests: lines(
      status(200),
      bodyVar,
      hasProp('body', 'token'),
      "pm.test('Token is a non-empty string', function () { pm.expect(typeof body.token).to.eql('string'); pm.expect(body.token.length).to.be.above(10); });",
      "pm.environment.set('userAToken', body.token);"
    ),
  }),
  request('Login User B', 'POST', '{{baseUrl}}/auth/login', {
    auth: noAuth,
    body: { email: '{{userBEmail}}', password: '{{testPassword}}' },
    tests: lines(status(200), bodyVar, "pm.environment.set('userBToken', body.token);"),
  }),
  request('Login User C', 'POST', '{{baseUrl}}/auth/login', {
    auth: noAuth,
    body: { email: '{{userCEmail}}', password: '{{testPassword}}' },
    tests: lines(status(200), bodyVar, "pm.environment.set('userCToken', body.token);"),
  }),
  request('Login - Wrong Password (negative)', 'POST', '{{baseUrl}}/auth/login', {
    auth: noAuth,
    body: { email: '{{userAEmail}}', password: 'wrong-password' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Login - Nonexistent Email (negative)', 'POST', '{{baseUrl}}/auth/login', {
    auth: noAuth,
    body: { email: 'nobody.{{$timestamp}}@example.test', password: '{{testPassword}}' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Login - Missing Password (negative)', 'POST', '{{baseUrl}}/auth/login', {
    auth: noAuth,
    body: { email: '{{userAEmail}}' },
    tests: lines(status(400), messageIsString()),
  }),
  request('Access Protected Route Without Token (negative)', 'GET', '{{baseUrl}}/companies', {
    auth: noAuth,
    tests: lines(status(401), messageIsString()),
  }),
  request('Access Protected Route With Invalid Token (negative)', 'GET', '{{baseUrl}}/companies', {
    auth: withBadToken,
    tests: lines(status(401), messageIsString()),
  }),
], { description: 'Registro, login y el guard de authMiddleware. Deja userA/B/CToken listos para el resto de la colección.' });

module.exports = authFolder;
