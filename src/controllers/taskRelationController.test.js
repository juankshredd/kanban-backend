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

  it('201 + relation row defaulting to RELATED_TO when relation_type is omitted', async () => {
    const relationRow = {
      id: 'relation-uuid',
      task_id: 'task-1',
      related_task_id: 'task-2',
      relation_type: 'RELATED_TO',
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
    expect(pool.query.mock.calls[1][1]).toEqual(['task-1', 'task-2', 'RELATED_TO', 'user-uuid']);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(relationRow);
  });

  it('201 + relation row with an explicit directional relation_type, upper-cased', async () => {
    const relationRow = {
      id: 'relation-uuid',
      task_id: 'task-1',
      related_task_id: 'task-2',
      relation_type: 'BLOCKS',
      created_by: 'user-uuid',
      created_at: '2026-08-30T00:00:00.000Z'
    };

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }, { id: 'task-2' }] })
      .mockResolvedValueOnce({ rows: [relationRow] });

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-1' },
      body: { related_task_id: 'task-2', relation_type: 'blocks' }
    };
    const res = mockRes();

    await createRelation(req, res);

    expect(pool.query.mock.calls[1][1]).toEqual(['task-1', 'task-2', 'BLOCKS', 'user-uuid']);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('400 when relation_type is not one of the whitelisted values', async () => {
    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-1' },
      body: { related_task_id: 'task-2', relation_type: 'FRIENDS_WITH' }
    };
    const res = mockRes();

    await createRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'relation_type must be one of: RELATED_TO, BLOCKS, DUPLICATES, CLONES'
    });
    expect(pool.query).not.toHaveBeenCalled();
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

  it('409 when the same (pair, relation_type) already exists (unique index violation)', async () => {
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
    expect(res.json).toHaveBeenCalledWith({ message: 'This relation already exists' });
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

  it('409 blaming the acting user when created_by no longer references a valid user', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }, { id: 'task-2' }] })
      .mockRejectedValueOnce({ code: '23503', constraint: 'task_relations_created_by_fkey' });

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-1' },
      body: { related_task_id: 'task-2' }
    };
    const res = mockRes();

    await createRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: 'Acting user no longer exists' });
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

  it('200 + a RELATED_TO link labeled the same way from either side', async () => {
    const relatedTask = { id: 'task-2', ticket_id: 'ACM-2', title: 'Related task' };

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }] })
      .mockResolvedValueOnce({
        rows: [{
          relation_id: 'relation-uuid',
          created_at: '2026-08-30T00:00:00.000Z',
          relation_type: 'RELATED_TO',
          anchor_is_task_id: true,
          related_task_id: 'task-2'
        }]
      })
      .mockResolvedValueOnce({ rows: [relatedTask] });

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-1' } };
    const res = mockRes();

    await getRelations(req, res);

    expect(pool.query.mock.calls[2][1]).toEqual([['task-2'], 'project-uuid']);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([
      { relation_id: 'relation-uuid', related_since: '2026-08-30T00:00:00.000Z', type: 'relates to', task: relatedTask }
    ]);
  });

  it('200 + resolves the inverse label when the anchor is on the related_task_id side of a directional link', async () => {
    const blocker = { id: 'task-9', ticket_id: 'ACM-9', title: 'Blocking task' };

    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }] })
      .mockResolvedValueOnce({
        rows: [{
          relation_id: 'relation-uuid',
          created_at: '2026-08-30T00:00:00.000Z',
          relation_type: 'BLOCKS',
          anchor_is_task_id: false, // task-1 is related_task_id -> task-9 BLOCKS task-1
          related_task_id: 'task-9'
        }]
      })
      .mockResolvedValueOnce({ rows: [blocker] });

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-1' } };
    const res = mockRes();

    await getRelations(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([
      { relation_id: 'relation-uuid', related_since: '2026-08-30T00:00:00.000Z', type: 'is blocked by', task: blocker }
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
          {
            relation_id: 'relation-uuid-1',
            created_at: '2026-08-30T00:00:00.000Z',
            relation_type: 'RELATED_TO',
            anchor_is_task_id: true,
            related_task_id: 'task-2'
          },
          {
            relation_id: 'relation-uuid-2',
            created_at: '2026-08-30T00:01:00.000Z',
            relation_type: 'RELATED_TO',
            anchor_is_task_id: true,
            related_task_id: 'task-3'
          }
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
      { relation_id: 'relation-uuid-1', related_since: '2026-08-30T00:00:00.000Z', type: 'relates to', task: survivingTask }
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

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-1', relationId: 'relation-uuid' } };
    const res = mockRes();

    await deleteRelation(req, res);

    expect(pool.query.mock.calls[1][1]).toEqual(['relation-uuid', 'task-1']);
    expect(res.json).toHaveBeenCalledWith({ message: 'Relation removed successfully' });
  });

  it('404 when the relation does not exist or does not involve the anchor task', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-1', relationId: 'relation-uuid' } };
    const res = mockRes();

    await deleteRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Relation not found' });
  });

  it('404 "Relation not found" when relationId is malformed, not "Task not found" (the anchor task exists)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-1' }] })     // anchor task found
      .mockRejectedValueOnce({ code: '22P02' });                // DELETE fails on the malformed relationId

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-1', relationId: 'not-a-uuid' } };
    const res = mockRes();

    await deleteRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Relation not found' });
  });

  it('404 "Task not found" when the anchor id itself is malformed', async () => {
    pool.query.mockRejectedValueOnce({ code: '22P02' }); // findTaskInProject fails on the malformed :id

    const req = { project: { id: 'project-uuid' }, params: { id: 'not-a-uuid', relationId: 'relation-uuid' } };
    const res = mockRes();

    await deleteRelation(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Task not found' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
