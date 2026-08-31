jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

const pool = require('../db');
const { createComment, getComments, deleteComment } = require('./taskCommentController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('taskCommentController.createComment', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('201 + comment when content is valid', async () => {
    const commentRow = {
      id: 'comment-uuid',
      task_id: 'task-uuid',
      content: 'Linked this to KAN3-14',
      author_id: 'user-uuid',
      author_name: 'juanDev'
    };

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] })    // findTaskInProject
      .mockResolvedValueOnce({ rows: [{ id: 'comment-uuid' }] }) // INSERT
      .mockResolvedValueOnce({ rows: [commentRow] });            // re-read via COMMENT_SELECT

    const req = {
      project: { id: 'project-uuid' },
      user: { id: 'user-uuid' },
      params: { id: 'task-uuid' },
      body: { content: 'Linked this to KAN3-14' }
    };
    const res = mockRes();

    await createComment(req, res);

    expect(pool.query.mock.calls[1][1]).toEqual(['task-uuid', 'user-uuid', 'Linked this to KAN3-14']);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(commentRow);
  });

  it('400 when content is missing', async () => {
    const req = {
      project: { id: 'project-uuid' },
      user: { id: 'user-uuid' },
      params: { id: 'task-uuid' },
      body: {}
    };
    const res = mockRes();

    await createComment(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Content is required' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('404 when the task does not belong to the project', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const req = {
      project: { id: 'project-uuid' },
      user: { id: 'user-uuid' },
      params: { id: 'task-uuid' },
      body: { content: 'Hello' }
    };
    const res = mockRes();

    await createComment(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Task not found' });
  });
});

describe('taskCommentController.getComments', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + comments ordered by created_at', async () => {
    const rows = [{ id: 'comment-uuid', content: 'Hello', author_name: 'juanDev' }];
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] }) // findTaskInProject
      .mockResolvedValueOnce({ rows });                        // list

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-uuid' } };
    const res = mockRes();

    await getComments(req, res);

    expect(pool.query.mock.calls[1][0]).toEqual(expect.stringContaining('ORDER BY c.created_at'));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(rows);
  });

  it('404 when the task does not belong to the project', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-uuid' } };
    const res = mockRes();

    await getComments(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Task not found' });
  });
});

describe('taskCommentController.deleteComment', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 when the author deletes their own comment', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] })         // findTaskInProject
      .mockResolvedValueOnce({ rows: [{ author_id: 'user-uuid' }] })  // ownership lookup
      .mockResolvedValueOnce({});                                    // DELETE

    const req = {
      project: { id: 'project-uuid' },
      projectRole: 'MEMBER',
      user: { id: 'user-uuid' },
      params: { id: 'task-uuid', commentId: 'comment-uuid' }
    };
    const res = mockRes();

    await deleteComment(req, res);

    expect(res.json).toHaveBeenCalledWith({ message: 'Comment deleted successfully' });
  });

  it('200 when the project OWNER deletes someone else\'s comment (moderation)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] })
      .mockResolvedValueOnce({ rows: [{ author_id: 'someone-else-uuid' }] })
      .mockResolvedValueOnce({});

    const req = {
      project: { id: 'project-uuid' },
      projectRole: 'OWNER',
      user: { id: 'user-uuid' },
      params: { id: 'task-uuid', commentId: 'comment-uuid' }
    };
    const res = mockRes();

    await deleteComment(req, res);

    expect(res.json).toHaveBeenCalledWith({ message: 'Comment deleted successfully' });
  });

  it('403 when a non-author, non-OWNER member tries to delete someone else\'s comment', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] })
      .mockResolvedValueOnce({ rows: [{ author_id: 'someone-else-uuid' }] });

    const req = {
      project: { id: 'project-uuid' },
      projectRole: 'MEMBER',
      user: { id: 'user-uuid' },
      params: { id: 'task-uuid', commentId: 'comment-uuid' }
    };
    const res = mockRes();

    await deleteComment(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Only the author or the project owner can delete this comment'
    });
  });

  it('404 when the comment does not exist', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] })
      .mockResolvedValueOnce({ rows: [] });

    const req = {
      project: { id: 'project-uuid' },
      projectRole: 'MEMBER',
      user: { id: 'user-uuid' },
      params: { id: 'task-uuid', commentId: 'comment-uuid' }
    };
    const res = mockRes();

    await deleteComment(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Comment not found' });
  });

  it('404 when the task does not belong to the project', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const req = {
      project: { id: 'project-uuid' },
      projectRole: 'MEMBER',
      user: { id: 'user-uuid' },
      params: { id: 'task-uuid', commentId: 'comment-uuid' }
    };
    const res = mockRes();

    await deleteComment(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Task not found' });
  });
});
