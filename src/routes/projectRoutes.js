const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { requireProjectMember, requireProjectOwner } = require('../middlewares/projectAccess');
const { requireCompanyMemberFromBody } = require('../middlewares/companyAccess');
const projectTaskRoutes = require('./projectTaskRoutes');
const projectSprintRoutes = require('./projectSprintRoutes');
const {
  createProject,
  getProjects,
  getProjectById,
  updateProject,
  deleteProject,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember
} = require('../controllers/projectController');
const { getBoard, getBacklogView } = require('../controllers/boardController');

// Se aplica una vez para todo el router (incluidos los routers anidados que se
// monten más adelante bajo /:projectId) en lugar de repetirlo ruta por ruta.
router.use(authMiddleware);

router.post('/', requireCompanyMemberFromBody, createProject);
router.get('/', getProjects);

router.get('/:projectId', requireProjectMember, getProjectById);
router.patch('/:projectId', requireProjectOwner, updateProject);
router.delete('/:projectId', requireProjectOwner, deleteProject);

// Vistas agregadas para las pantallas Board y Backlog (sprint activo +
// tareas / sprints futuros + tareas + Backlog, cada una en un solo request).
router.get('/:projectId/board', requireProjectMember, getBoard);
router.get('/:projectId/backlog', requireProjectMember, getBacklogView);

router.post('/:projectId/members', requireProjectOwner, addProjectMember);
router.patch('/:projectId/members/:userId', requireProjectOwner, updateProjectMemberRole);
router.delete('/:projectId/members/:userId', requireProjectOwner, removeProjectMember);

// Contenido del proyecto. El chequeo de membresía se hace una sola vez acá y
// los routers hijos lo dan por hecho; los que vengan (sprints, retro) se montan
// igual, con router({ mergeParams: true }) para ver el :projectId.
router.use('/:projectId/tasks', requireProjectMember, projectTaskRoutes);
router.use('/:projectId/sprints', requireProjectMember, projectSprintRoutes);

module.exports = router;
