const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { requireProjectMember, requireProjectOwner } = require('../middlewares/projectAccess');
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

// Se aplica una vez para todo el router (incluidos los routers anidados que se
// monten más adelante bajo /:projectId) en lugar de repetirlo ruta por ruta.
router.use(authMiddleware);

router.post('/', createProject);
router.get('/', getProjects);

router.get('/:projectId', requireProjectMember, getProjectById);
router.patch('/:projectId', requireProjectOwner, updateProject);
router.delete('/:projectId', requireProjectOwner, deleteProject);

router.post('/:projectId/members', requireProjectOwner, addProjectMember);
router.patch('/:projectId/members/:userId', requireProjectOwner, updateProjectMemberRole);
router.delete('/:projectId/members/:userId', requireProjectOwner, removeProjectMember);

// Acá se cuelga el contenido del proyecto (tareas, sprints, retro) a medida que
// se vaya implementando, con router({ mergeParams: true }) para que el router
// hijo también vea :projectId. Ej:
//   router.use('/:projectId/tasks', requireProjectMember, projectTaskRoutes);

module.exports = router;
