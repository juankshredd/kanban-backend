const express = require('express');
// mergeParams para que estas rutas vean el :projectId del router padre.
const router = express.Router({ mergeParams: true });
const {
  createTask,
  getProjectTasks,
  updateTask,
  updateTaskType,
  deleteTask
} = require('../controllers/taskController');
const {
  createRelation,
  getRelations,
  deleteRelation
} = require('../controllers/taskRelationController');
const {
  createComment,
  getComments,
  deleteComment
} = require('../controllers/taskCommentController');
const { getTaskDetail } = require('../controllers/boardController');

// Rutas canónicas del board: /api/projects/:projectId/tasks
//
// No declaran middlewares de acceso porque el router se monta detrás de
// requireProjectMember en projectRoutes.js: cuando una request llega acá, la
// membresía ya está verificada y req.project cargado.
router.post('/', createTask);
router.get('/', getProjectTasks);
router.patch('/:id', updateTask);
router.patch('/:id/type', updateTaskType);
router.delete('/:id', deleteTask);

// Detalle agregado (tarea + padre + children + relaciones + sprint) para el
// modal de detalle de ticket -- ver boardController.getTaskDetail.
router.get('/:id/detail', getTaskDetail);

// Relaciones tipadas (relates to / blocks / duplicates / clones, distintas de
// la jerarquía parent_id) -- ver taskRelationController.js. Se borra por el id
// propio de la relación, no por la otra tarea: dos tareas pueden tener más de
// un relation_type activo entre sí a la vez.
router.post('/:id/relations', createRelation);
router.get('/:id/relations', getRelations);
router.delete('/:id/relations/:relationId', deleteRelation);

// Comentarios (sección "Activity" del modal de detalle) -- ver
// taskCommentController.js.
router.post('/:id/comments', createComment);
router.get('/:id/comments', getComments);
router.delete('/:id/comments/:commentId', deleteComment);

module.exports = router;
