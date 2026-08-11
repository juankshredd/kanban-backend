jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

const pool = require('../db');
const { createNote, getNotes, updateNote, deleteNote } = require('./retroController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('retroController.createNote', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('201 + note when content and category are valid', async () => {
    const noteRow = {
      id: 'note-uuid',
      sprint_id: 'sprint-uuid',
      category: 'WENT_WELL',
      content: 'Great sprint',
      author_id: 'user-uuid',
      author_name: 'juank'
    };

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'sprint-uuid' }] }) // findSprintInProject
      .mockResolvedValueOnce({ rows: [{ id: 'note-uuid' }] })   // INSERT
      .mockResolvedValueOnce({ rows: [noteRow] });              // re-read via NOTE_SELECT

    const req = {
      params: { sprintId: 'sprint-uuid' },
      project: { id: 'project-uuid' },
      user: { id: 'user-uuid' },
      body: { category: 'went_well', content: 'Great sprint' }
    };
    const res = mockRes();

    await createNote(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(noteRow);
  });

  it('400 when req.body has no content', async () => {
    const req = {
      params: { sprintId: 'sprint-uuid' },
      project: { id: 'project-uuid' },
      user: { id: 'user-uuid' },
      body: {}
    };
    const res = mockRes();

    await createNote(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Content is required' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('retroController.getNotes', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + notes grouped by category', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'sprint-uuid' }] }) // findSprintInProject
      .mockResolvedValueOnce({
        rows: [
          { id: 'n1', category: 'WENT_WELL', content: 'a' },
          { id: 'n2', category: 'TO_IMPROVE', content: 'b' }
        ]
      });

    const req = { params: { sprintId: 'sprint-uuid' }, project: { id: 'project-uuid' } };
    const res = mockRes();

    await getNotes(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      WENT_WELL: [{ id: 'n1', category: 'WENT_WELL', content: 'a' }],
      TO_IMPROVE: [{ id: 'n2', category: 'TO_IMPROVE', content: 'b' }],
      ACTION_ITEM: []
    });
  });

  it('404 when the sprint does not belong to the project', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // findSprintInProject

    const req = { params: { sprintId: 'sprint-uuid' }, project: { id: 'project-uuid' } };
    const res = mockRes();

    await getNotes(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Sprint not found' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('retroController.updateNote', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + updated note when the author edits their own note', async () => {
    const existingNote = { id: 'note-uuid', sprint_id: 'sprint-uuid', author_id: 'user-uuid' };
    const updatedNote = { id: 'note-uuid', content: 'Updated content', category: 'WENT_WELL' };

    pool.query
      .mockResolvedValueOnce({ rows: [existingNote] }) // findOwnNote
      .mockResolvedValueOnce({})                       // UPDATE
      .mockResolvedValueOnce({ rows: [updatedNote] }); // re-read via NOTE_SELECT

    const req = {
      params: { sprintId: 'sprint-uuid', noteId: 'note-uuid' },
      project: { id: 'project-uuid' },
      user: { id: 'user-uuid' },
      body: { content: 'Updated content' }
    };
    const res = mockRes();

    await updateNote(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(updatedNote);
  });

  it('403 when the requester is not the author', async () => {
    const existingNote = { id: 'note-uuid', sprint_id: 'sprint-uuid', author_id: 'other-user-uuid' };
    pool.query.mockResolvedValueOnce({ rows: [existingNote] }); // findOwnNote

    const req = {
      params: { sprintId: 'sprint-uuid', noteId: 'note-uuid' },
      project: { id: 'project-uuid' },
      user: { id: 'user-uuid' },
      body: { content: 'Trying to edit someone else\'s note' }
    };
    const res = mockRes();

    await updateNote(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Only the author can edit this note' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('retroController.deleteNote', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 deletes a note when the requester is the author', async () => {
    const existingNote = { id: 'note-uuid', sprint_id: 'sprint-uuid', author_id: 'user-uuid' };
    pool.query
      .mockResolvedValueOnce({ rows: [existingNote] }) // findOwnNote
      .mockResolvedValueOnce({});                      // DELETE

    const req = {
      params: { sprintId: 'sprint-uuid', noteId: 'note-uuid' },
      project: { id: 'project-uuid' },
      user: { id: 'user-uuid' },
      projectRole: 'MEMBER'
    };
    const res = mockRes();

    await deleteNote(req, res);

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM retrospective_notes'),
      ['note-uuid']
    );
    expect(res.json).toHaveBeenCalledWith({ message: 'Note deleted successfully' });
  });

  it('403 when the requester is neither the author nor the project owner', async () => {
    const existingNote = { id: 'note-uuid', sprint_id: 'sprint-uuid', author_id: 'other-user-uuid' };
    pool.query.mockResolvedValueOnce({ rows: [existingNote] }); // findOwnNote

    const req = {
      params: { sprintId: 'sprint-uuid', noteId: 'note-uuid' },
      project: { id: 'project-uuid' },
      user: { id: 'user-uuid' },
      projectRole: 'MEMBER'
    };
    const res = mockRes();

    await deleteNote(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Only the author or the project owner can delete this note'
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
