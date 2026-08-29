'use strict';
const { lines, request, folder, asUserA, asUserC, noAuth, status, messageIsString, bodyVar } = require('./helpers');

const usersFolder = folder('09 - Users (deactivate/activate)', [
  request('Deactivate - Always Disabled, Even For Self (negative)', 'PATCH', '{{baseUrl}}/users/{{userCId}}/deactivate', {
    auth: asUserC,
    description: 'deactivateUser está deshabilitado sin excepciones (ni siquiera self-service): sin un mecanismo de recuperación de cuenta, desactivarse arriesgaría un lockout permanente en cuanto expire el JWT.',
    tests: lines(status(403), messageIsString()),
  }),
  request('Activate User C (self, 200)', 'PATCH', '{{baseUrl}}/users/{{userCId}}/activate', {
    auth: asUserC,
    description: 'activateUser exige ownership propio (id del param === id del token); como deactivate está deshabilitado, esto ejercita el camino feliz sobre una cuenta que ya está activa (idempotente).',
    tests: lines(status(200), messageIsString()),
  }),
  request('Activate User C - Wrong Owner (negative, 403)', 'PATCH', '{{baseUrl}}/users/{{userCId}}/activate', {
    auth: asUserA,
    description: 'El chequeo de ownership corre antes que la consulta a la base, así que no hay forma de llegar a un 404 real acá: cualquier id que no sea el propio del token da 403.',
    tests: lines(status(403), messageIsString()),
  }),
  request('Login User C', 'POST', '{{baseUrl}}/auth/login', {
    auth: noAuth,
    body: { email: '{{userCEmail}}', password: '{{testPassword}}' },
    tests: lines(status(200), bodyVar, "pm.expect(body).to.have.property('token');"),
  }),
], { description: 'deactivate está deshabilitado sin excepciones (evita lockout); activate exige ownership propio del id.' });

module.exports = usersFolder;
