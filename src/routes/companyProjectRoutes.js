const express = require('express');
// mergeParams para que estas rutas vean el :companyId del router padre.
const router = express.Router({ mergeParams: true });
const { createProject, getCompanyProjects } = require('../controllers/projectController');

// Rutas canónicas de creación: /api/companies/:companyId/projects
//
// No declaran middlewares de acceso propios porque el router se monta detrás
// de requireCompanyMember en companyRoutes.js: cuando una request llega acá,
// la membresía a la company ya está verificada y req.company cargado.
router.post('/', createProject);
router.get('/', getCompanyProjects);

module.exports = router;
