const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { requireCompanyMember, requireCompanyOwner } = require('../middlewares/companyAccess');
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

module.exports = router;
