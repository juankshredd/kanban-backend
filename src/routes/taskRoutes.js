const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const { createTask, getTasks, updateTaskStatus, updateTaskType, deleteTask } = require('../controllers/taskController');

router.post('/', authMiddleware, createTask);
router.get('/', authMiddleware, getTasks);
router.patch('/:id', authMiddleware, updateTaskStatus);
router.patch('/:id/type', authMiddleware, updateTaskType);
router.delete('/:id', authMiddleware, deleteTask);

module.exports = router;