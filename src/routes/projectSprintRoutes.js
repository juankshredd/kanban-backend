const express = require('express');
// mergeParams para ver el :projectId del router padre.
const router = express.Router({ mergeParams: true });
const {
  createSprint,
  getSprints,
  getActiveSprint,
  startSprint,
  completeSprint,
  deleteSprint
} = require('../controllers/sprintController');
const projectRetroRoutes = require('./projectRetroRoutes');

// Se monta en projectRoutes.js detrás de requireProjectMember, así que la
// membresía ya está verificada y req.project cargado antes de llegar acá.
// Cualquier miembro puede gestionar sprints: no es una acción administrativa
// como borrar el proyecto o manejar members (eso sí exige OWNER).
router.post('/', createSprint);
router.get('/', getSprints);
router.get('/active', getActiveSprint);
router.patch('/:sprintId/start', startSprint);
router.patch('/:sprintId/complete', completeSprint);
router.delete('/:sprintId', deleteSprint);

// Retro de un sprint puntual: /api/projects/:projectId/sprints/:sprintId/retrospective
router.use('/:sprintId/retrospective', projectRetroRoutes);

module.exports = router;
