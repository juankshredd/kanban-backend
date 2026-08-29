# Postman / Newman — suite de QA para kanban-backend

Colección de pruebas automatizadas de la API completa (Express + PostgreSQL),
pensada para correr tanto desde Postman (manual, para explorar/depurar) como
desde Newman (headless, en CI).

## Qué cubre

**126 requests** organizados en 10 carpetas que corren en orden (01 → 10) y
encadenan variables de entorno entre sí (tokens, ids de company/project/task/
sprint/note). Cobertura: cada función exportada de los controladores (ver la
sección "Architecture" del `CLAUDE.md` raíz) tiene al menos 1 request
happy-path y 1 negative-path — el mismo criterio que el propio proyecto exige
para sus tests unitarios de Jest — más las reglas de negocio no triviales:

- Rank/reorder de tareas (`after_task_id`) y su efecto en el orden del Board/Backlog.
- `one_active_sprint_per_project` (409 al intentar arrancar un segundo sprint activo).
- Cascadas de borrado con el guard `409` / `?force=true` en company y project.
- El guard de "no se puede degradar/quitar al último OWNER" (company y project).
- El guard "autor o project OWNER" para editar/borrar notas de retro.
- Soft deactivate/activate de usuarios y su efecto inmediato sobre el login.

No depende de datos sembrados: cada corrida registra sus propios usuarios
(A, B, C) con emails únicos (`Date.now()` + random), así que es segura de
correr repetidamente sin chocar con "email already registered".

## Cómo correrla

**Requisito:** el server tiene que estar corriendo y escuchando en el puerto
5000 (`npm run dev`), con la base de datos migrada.

```bash
npm run dev &                # o en otra terminal, sin el &
npm run test:postman         # newman run postman/kanban-backend.postman_collection.json -e postman/kanban-backend.postman_environment.json
```

O importando ambos archivos (`kanban-backend.postman_collection.json` y
`kanban-backend.postman_environment.json`) en la app de Postman: seleccioná el
environment "Kanban Backend - Local" y corré la colección completa con el
Collection Runner, de punta a punta (no carpetas sueltas fuera de orden — cada
una depende de variables que dejó la anterior).

## Cómo se genera (y cómo regenerarla)

El JSON de la colección **no se edita a mano**. Se genera con un script desde
módulos de JS en esta misma carpeta (uno por carpeta lógica: `01-auth.js`,
`02-companies.js`, ..., `10-cleanup.js`, más `helpers.js` con las funciones
compartidas). Esto la hace revisable en un PR como cualquier otro cambio de
código, en vez de un diff de miles de líneas de JSON.

Si cambia un endpoint, una regla de negocio o un mensaje de error: editá el
módulo correspondiente y volvé a generar:

```bash
node postman/generate-collection.js
```

Esto sobreescribe `kanban-backend.postman_collection.json` y
`kanban-backend.postman_environment.json`.

## CI

`.github/workflows/ci.yml` corre esta colección con Newman en cada push/PR a
`master`/`dev`, después de los tests de Jest: levanta el server con `npm run
dev` en background, espera a que responda en `/test-db` (`wait-on`), y corre
`npm run test:postman`. Un fallo ahí es un check rojo igual que un fallo de
Jest.

## Notas de diseño

- **Orden importa.** Las carpetas son un flujo de punta a punta (registrar
  usuarios → crear company/project → tasks → sprints → board/backlog →
  retro → deactivate/activate → cleanup con cascadas), no una lista de
  endpoints sueltos. Reordenar una carpeta sin revisar sus dependencias rompe
  las que vienen después.
- **Autenticación por carpeta/request.** El bearer token (`{{userAToken}}`,
  `{{userBToken}}`, `{{userCToken}}`) se setea por request según quién debe
  hacer la llamada (dueño del recurso, miembro sin permisos, o un tercero sin
  acceso), no a nivel colección — así cada negative-test de autorización usa
  el usuario que realmente tiene que fallar.
- **`10 - Cleanup` es intencional**, no un afterEach: prueba explícitamente
  los guards de borrado (`409` sin `?force=true`, `200` con `?force=true`) que
  de otra forma solo se ejercitan borrando datos reales.
