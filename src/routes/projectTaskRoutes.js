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

module.exports = router;
