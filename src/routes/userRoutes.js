const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');

const { deactivateUser, activateUser } = require('../controllers/userController');

router.patch('/:id/deactivate', authMiddleware, deactivateUser);
router.patch('/:id/activate', authMiddleware, activateUser);

module.exports = router;