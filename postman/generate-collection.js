#!/usr/bin/env node
'use strict';
/**
 * Genera postman/kanban-backend.postman_collection.json y el entorno local a
 * partir de los módulos 01-auth.js .. 10-cleanup.js de esta misma carpeta.
 *
 * Por qué un script y no la colección "a mano" en la app de Postman:
 * - Es revisable en un PR como cualquier otro cambio de código (diff legible).
 * - Evita el drift entre lo que vive en Postman Cloud/local y lo que hay en el repo.
 * - Se puede regenerar con `node postman/generate-collection.js` si cambian
 *   endpoints o reglas de negocio, en vez de editar a mano un JSON de miles de líneas.
 *
 * Cobertura: cada función exportada de los controladores (ver CLAUDE.md) tiene al
 * menos 1 request happy-path y 1 negative-path -- el mismo criterio que el proyecto
 * ya exige para sus tests unitarios de Jest -- más las reglas de negocio no triviales:
 * rank/reorder, one-active-sprint-per-project, cascadas con ?force=true, el guard del
 * "último OWNER", etc.
 *
 * El orden de las carpetas ES el orden de ejecución en Newman/Postman Runner
 * (recorrido en profundidad). Cada carpeta deja variables de entorno listas para la
 * siguiente -- por eso el orden importa y no se debe reordenar sin revisar las
 * dependencias (ver el comentario de "description" de cada carpeta).
 */

const fs = require('fs');
const path = require('path');

const authFolder = require('./01-auth');
const companiesFolder = require('./02-companies');
const projectsFolder = require('./03-projects');
const tasksFolder = require('./04-tasks');
const sprintsPart1Folder = require('./05-sprints-part1');
const boardBacklogFolder = require('./06-board-backlog');
const sprintsPart2Folder = require('./07-sprints-part2');
const retroFolder = require('./08-retro');
const usersFolder = require('./09-users');
const cleanupFolder = require('./10-cleanup');

const collection = {
  info: {
    _postman_id: 'e6a6b6e0-6b6a-4b1a-9c1a-kanban-backend-qa',
    name: 'Kanban Backend API - QA Suite',
    description: lines(
      'Suite de pruebas automatizadas para kanban-backend (Express + PostgreSQL).',
      '',
      'Generada por postman/generate-collection.js -- no editar este JSON a mano,',
      'editar los módulos en postman/ y volver a correr:',
      '',
      '    node postman/generate-collection.js',
      '',
      'Uso con Newman (requiere el server local corriendo en el puerto 5000):',
      '',
      '    npm run dev &',
      '    npx newman run postman/kanban-backend.postman_collection.json \\',
      '      -e postman/kanban-backend.postman_environment.json',
      '',
      'Las carpetas corren en orden (01 a 10) y encadenan variables de entorno',
      '(tokens, ids de company/project/task/sprint/note) entre requests -- correr',
      'la colección completa de punta a punta, no carpetas sueltas fuera de orden.'
    ),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [
    authFolder,
    companiesFolder,
    projectsFolder,
    tasksFolder,
    sprintsPart1Folder,
    boardBacklogFolder,
    sprintsPart2Folder,
    retroFolder,
    usersFolder,
    cleanupFolder,
  ],
  variable: [{ key: 'baseUrl', value: 'http://localhost:5000/api', type: 'string' }],
};

function lines(...ls) {
  return ls.join('\n');
}

// Entorno local: baseUrl con valor real, todo lo demás arranca vacío y lo va
// llenando la propia colección (pm.environment.set en los tests de cada request).
const RUNTIME_VARS = [
  'testPassword',
  'userAEmail', 'userAUsername', 'userAId', 'userAToken',
  'userBEmail', 'userBUsername', 'userBId', 'userBToken',
  'userCEmail', 'userCUsername', 'userCId', 'userCToken',
  'companyId', 'companyMemberBId',
  'projectId', 'projectKey', 'projectKeyTestId', 'project2Id',
  'task1Id', 'task2Id', 'task3Id',
  'sprint1Id', 'sprint2Id',
  'note1Id', 'note2Id',
];

const environment = {
  id: 'kanban-backend-local',
  name: 'Kanban Backend - Local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:5000/api', type: 'default', enabled: true },
    ...RUNTIME_VARS.map((key) => ({ key, value: '', type: 'secret', enabled: true })),
  ],
  _postman_variable_scope: 'environment',
};

const outDir = path.join(__dirname);
fs.writeFileSync(path.join(outDir, 'kanban-backend.postman_collection.json'), JSON.stringify(collection, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'kanban-backend.postman_environment.json'), JSON.stringify(environment, null, 2) + '\n');

const countRequests = (items) =>
  items.reduce((acc, it) => acc + (it.item ? countRequests(it.item) : 1), 0);

console.log(`Colección generada: ${countRequests(collection.item)} requests en ${collection.item.length} carpetas.`);
console.log('Archivos escritos:');
console.log('  - postman/kanban-backend.postman_collection.json');
console.log('  - postman/kanban-backend.postman_environment.json');
