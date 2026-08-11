const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { requireCompanyMember, requireCompanyOwner } = require('../middlewares/companyAccess');
const companyProjectRoutes = require('./companyProjectRoutes');
const {
  createCompany,
  getCompanies,
  getCompanyById,
  updateCompany,
  deleteCompany,
  addCompanyMember,
  updateCompanyMemberRole,
  removeCompanyMember
} = require('../controllers/companyController');

// Se aplica una vez para todo el router (incluidos los routers anidados que se
// monten más adelante bajo /:companyId) en lugar de repetirlo ruta por ruta.
router.use(authMiddleware);

router.post('/', createCompany);
router.get('/', getCompanies);

router.get('/:companyId', requireCompanyMember, getCompanyById);
router.patch('/:companyId', requireCompanyOwner, updateCompany);
router.delete('/:companyId', requireCompanyOwner, deleteCompany);

router.post('/:companyId/members', requireCompanyOwner, addCompanyMember);
router.patch('/:companyId/members/:userId', requireCompanyOwner, updateCompanyMemberRole);
router.delete('/:companyId/members/:userId', requireCompanyOwner, removeCompanyMember);

// Creación/listado canónico de proyectos dentro de una company. El chequeo de
// membresía se hace una sola vez acá; el router hijo lo da por hecho.
router.use('/:companyId/projects', requireCompanyMember, companyProjectRoutes);

module.exports = router;
