const express = require('express');
const router = express.Router();
const validateRegister = require('../middlewares/validateRegister');
const { register, login } = require('../controllers/authController');

router.post('/register', validateRegister, register);
router.post('/login', login);

module.exports = router;