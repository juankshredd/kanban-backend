const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { createTask, getTasks, updateTaskStatus,  deleteTask } = require('../controllers/taskController');

router.post('/', authMiddleware, createTask);
router.get('/', authMiddleware, getTasks);
router.patch('/:id', authMiddleware, updateTaskStatus);
router.delete('/:id', authMiddleware, deleteTask);

module.exports = router;