const express = require('express');
// mergeParams para ver :projectId y :sprintId de los routers padre.
const router = express.Router({ mergeParams: true });
const { createNote, getNotes, updateNote, deleteNote } = require('../controllers/retroController');

// Se monta en projectSprintRoutes.js, que ya está detrás de
// requireProjectMember: req.project y req.projectRole ya están disponibles.
router.post('/', createNote);
router.get('/', getNotes);
router.patch('/:noteId', updateNote);
router.delete('/:noteId', deleteNote);

module.exports = router;
