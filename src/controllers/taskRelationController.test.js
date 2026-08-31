jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

const pool = require('../db');
const {
  createRelation,
  getRelations,
  deleteRelation
} = require('./taskRelationController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('taskRelationController.createRelation', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('201 + relation row when both tasks belong to the project', async () => {
    const relationRow = {
      id: 'relation-uuid',
      task_id: 'task-1',
      related_task_id: 'task-2',
      created_by: 'user-uuid',
      created_at: '2026-08-30T00:00:00.000Z'
    };

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }, { id: 'task-2' }] }) // both tasks exist in project
      .mockResolvedValueOnce({ rows: [relationRow] });                       // INSERT

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-1' },
      body: { related_task_id: 'task-2' }
    };
    const res = mockRes();

    await createRelation(req, res);

    expect(pool.query.mock.calls[0][1]).toEqual([['task-1', 'task-2'], 'project-uuid']);
    expect(pool.query.mock.calls[1][0]).toEqual(expect.stringContaining('INSERT INTO task_relations'));
    expect(pool.query.mock.calls[1][1]).toEqual(['task-1', 'task-2', 'user-uuid']);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(relationRow);
  });

  it('400 when related_task_id is missing', async () => {
    const req = { user: { id: 'user-uuid' }, project: { id: 'project-uuid' }, params: { id: 'task-1' }, body: {} };
    const res = mockRes();

    await createRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'related_task_id is required' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('400 when related_task_id is the same task (self-relation)', async () => {
    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-1' },
      body: { related_task_id: 'task-1' }
    };
    const res = mockRes();

    await createRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'A task cannot be related to itself' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('400 when related_task_id is the same task with different casing (self-relation)', async () => {
    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'AAAA1111-bbbb-2222-cccc-333344445555' },
      body: { related_task_id: 'aaaa1111-BBBB-2222-CCCC-333344445555' }
    };
    const res = mockRes();

    await createRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'A task cannot be related to itself' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('404 when one of the two tasks does not belong to the project', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'task-1' }] }); // only one found

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-1' },
      body: { related_task_id: 'task-2' }
    };
    const res = mockRes();

    await createRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Task or related_task_id not found in this project' });
  });

  it('409 when the pair is already related (unique index violation)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }, { id: 'task-2' }] })
      .mockRejectedValueOnce({ code: '23505' });

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-1' },
      body: { related_task_id: 'task-2' }
    };
    const res = mockRes();

    await createRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: 'Tasks are already related' });
  });

  it('409 when related_task_id was deleted between the check and the insert (23503 race)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }, { id: 'task-2' }] })
      .mockRejectedValueOnce({ code: '23503', constraint: 'task_relations_related_task_id_fkey' });

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-1' },
      body: { related_task_id: 'task-2' }
    };
    const res = mockRes();

    await createRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: 'related_task_id no longer exists' });
  });

  it('409 blaming the anchor task when it (not related_task_id) was deleted mid-race', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }, { id: 'task-2' }] })
      .mockRejectedValueOnce({ code: '23503', constraint: 'task_relations_task_id_fkey' });

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-1' },
      body: { related_task_id: 'task-2' }
    };
    const res = mockRes();

    await createRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: 'Task no longer exists' });
  });
});

describe('taskRelationController.getRelations', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + empty array when the task has no relations', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }] }) // task belongs to project
      .mockResolvedValueOnce({ rows: [] });                // no relations

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-1' } };
    const res = mockRes();

    await getRelations(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it('200 + related tasks resolved from either side of the stored pair', async () => {
    const relatedTask = { id: 'task-2', ticket_id: 'ACM-2', title: 'Related task' };

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }] })
      .mockResolvedValueOnce({
        rows: [{ relation_id: 'relation-uuid', created_at: '2026-08-30T00:00:00.000Z', related_task_id: 'task-2' }]
      })
      .mockResolvedValueOnce({ rows: [relatedTask] });

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-1' } };
    const res = mockRes();

    await getRelations(req, res);

    expect(pool.query.mock.calls[2][1]).toEqual([['task-2']]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([
      { relation_id: 'relation-uuid', related_since: '2026-08-30T00:00:00.000Z', task: relatedTask }
    ]);
  });

  it('404 when the anchor task does not belong to the project', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-1' } };
    const res = mockRes();

    await getRelations(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Task not found' });
  });

  it('200 + drops a relation whose related task was deleted between the two queries (race)', async () => {
    const survivingTask = { id: 'task-2', ticket_id: 'ACM-2', title: 'Still here' };

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }] })
      .mockResolvedValueOnce({
        rows: [
          { relation_id: 'relation-uuid-1', created_at: '2026-08-30T00:00:00.000Z', related_task_id: 'task-2' },
          { relation_id: 'relation-uuid-2', created_at: '2026-08-30T00:01:00.000Z', related_task_id: 'task-3' }
        ]
      })
      // task-3 was CASCADE-deleted (along with its relation row) between this
      // query and the one above, so only task-2 comes back.
      .mockResolvedValueOnce({ rows: [survivingTask] });

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-1' } };
    const res = mockRes();

    await getRelations(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([
      { relation_id: 'relation-uuid-1', related_since: '2026-08-30T00:00:00.000Z', task: survivingTask }
    ]);
  });
});

describe('taskRelationController.deleteRelation', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 when the relation is removed', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }] })       // task belongs to project
      .mockResolvedValueOnce({ rows: [{ id: 'relation-uuid' }] }); // DELETE

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-1', relatedTaskId: 'task-2' } };
    const res = mockRes();

    await deleteRelation(req, res);

    expect(pool.query.mock.calls[1][1]).toEqual(['task-1', 'task-2']);
    expect(res.json).toHaveBeenCalledWith({ message: 'Relation removed successfully' });
  });

  it('404 when there is no relation between the two tasks', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-1', relatedTaskId: 'task-2' } };
    const res = mockRes();

    await deleteRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Relation not found' });
  });

  it('404 when the anchor task does not belong to the project', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-1', relatedTaskId: 'task-2' } };
    const res = mockRes();

    await deleteRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Task not found' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
