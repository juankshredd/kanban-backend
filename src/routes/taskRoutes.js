const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const {
  requireProjectMemberFromBody,
  requireProjectMemberForResource
} = require('../middlewares/projectAccess');
const {
  createTask,
  getMyTasks,
  updateTask,
  updateTaskType,
  deleteTask
} = require('../controllers/taskController');
const {
  createRelation,
  getRelations,
  deleteRelation
} = require('../controllers/taskRelationController');

// Rutas transversales a los proyectos: sirven la vista "mi trabajo" y permiten
// operar una tarea por id sin conocer su proyecto. El board de un proyecto vive
// en /api/projects/:projectId/tasks (ver projectTaskRoutes.js).
//
// Cada una resuelve el proyecto por su cuenta antes de tocar nada: del body al
// crear, y de la tarea misma al modificarla.
const requireTaskAccess = requireProjectMemberForResource('tasks');

router.use(authMiddleware);

router.get('/', getMyTasks);
router.post('/', requireProjectMemberFromBody, createTask);
router.patch('/:id', requireTaskAccess, updateTask);
router.patch('/:id/type', requireTaskAccess, updateTaskType);
router.delete('/:id', requireTaskAccess, deleteTask);

// Relaciones "related to", resueltas por la tarea :id igual que PATCH/DELETE
// de arriba -- ver taskRelationController.js.
router.post('/:id/relations', requireTaskAccess, createRelation);
router.get('/:id/relations', requireTaskAccess, getRelations);
router.delete('/:id/relations/:relatedTaskId', requireTaskAccess, deleteRelation);

module.exports = router;
