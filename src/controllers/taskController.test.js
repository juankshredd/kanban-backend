jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

const pool = require('../db');
const {
  createTask,
  getProjectTasks,
  getMyTasks,
  updateTask,
  updateTaskType,
  deleteTask
} = require('./taskController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('taskController.createTask', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('201 + task with derived ticket_id when title is valid', async () => {
    const taskRow = {
      id: 'task-uuid',
      project_id: 'project-uuid',
      ticket_number: 5,
      user_id: 'user-uuid',
      title: 'New Task',
      description: 'desc',
      type: 'STORY',
      status: 'TODO',
      rank: 3000,
      details: {},
      parent_id: null
    };

    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce(undefined)                                    // BEGIN
      .mockResolvedValueOnce({ rows: [{ key: 'ACM', ticket_number: 5 }] })  // atomic counter
      .mockResolvedValueOnce({ rows: [{ next_rank: 3000 }] })              // rank (end of project sequence)
      .mockResolvedValueOnce({ rows: [taskRow] })                          // INSERT INTO tasks
      .mockResolvedValueOnce(undefined);                                   // COMMIT
    pool.connect.mockResolvedValue(client);

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: { title: 'New Task', description: 'desc' }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(client.query.mock.calls[2][0]).toEqual(expect.stringContaining('COALESCE(MAX(rank), 0) + 1000'));
    expect(client.query.mock.calls[3][0]).toEqual(expect.stringContaining('INSERT INTO tasks'));
    expect(client.query.mock.calls[3][1]).toEqual([
      'project-uuid', 5, 'user-uuid', 'New Task', 'desc', 'STORY', 3000, {}, null, null, null, []
    ]);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ...taskRow, ticket_id: 'ACM-5', project_key: 'ACM' });
    expect(client.release).toHaveBeenCalled();
  });

  it('400 when req.body has no title', async () => {
    const req = { user: { id: 'user-uuid' }, project: { id: 'project-uuid' }, body: {} };
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Title is required' });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('201 + task with valid details for the type (BUG)', async () => {
    const taskRow = {
      id: 'task-uuid',
      project_id: 'project-uuid',
      ticket_number: 6,
      user_id: 'user-uuid',
      title: 'Broken button',
      type: 'BUG',
      rank: 4000,
      details: { steps_to_reproduce: 'Click it' }
    };

    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ key: 'ACM', ticket_number: 6 }] })
      .mockResolvedValueOnce({ rows: [{ next_rank: 4000 }] })
      .mockResolvedValueOnce({ rows: [taskRow] })
      .mockResolvedValueOnce(undefined);
    pool.connect.mockResolvedValue(client);

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: {
        title: 'Broken button',
        type: 'bug',
        details: { steps_to_reproduce: '  Click it  ' }
      }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(client.query.mock.calls[3][1]).toEqual([
      'project-uuid', 6, 'user-uuid', 'Broken button', null, 'BUG', 4000, { steps_to_reproduce: 'Click it' }, null, null, null, []
    ]);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('400 when details has a key not valid for the type', async () => {
    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: { title: 'Broken button', type: 'bug', details: { acceptance_criteria: 'nope' } }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: '"acceptance_criteria" is not a valid detail field for type BUG'
    });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('400 when a detail value is not a string', async () => {
    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: { title: 'Broken button', type: 'bug', details: { steps_to_reproduce: 42 } }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: '"steps_to_reproduce" must be a string' });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('201 + task with a valid parent_id (same project, required parent type)', async () => {
    const taskRow = {
      id: 'task-uuid', project_id: 'project-uuid', ticket_number: 7, user_id: 'user-uuid',
      title: 'Login story', type: 'STORY', rank: 5000, details: {}, parent_id: 'feature-uuid'
    };

    pool.query.mockResolvedValueOnce({ rows: [{ type: 'FEATURE' }] }); // validateParentId lookup

    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ key: 'ACM', ticket_number: 7 }] })
      .mockResolvedValueOnce({ rows: [{ next_rank: 5000 }] })
      .mockResolvedValueOnce({ rows: [taskRow] })
      .mockResolvedValueOnce(undefined);
    pool.connect.mockResolvedValue(client);

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: { title: 'Login story', type: 'story', parent_id: 'feature-uuid' }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['feature-uuid', 'project-uuid']);
    expect(client.query.mock.calls[3][1]).toEqual([
      'project-uuid', 7, 'user-uuid', 'Login story', null, 'STORY', 5000, {}, 'feature-uuid', null, null, []
    ]);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('400 when parent_id references a task of the wrong type', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ type: 'EPIC' }] }); // STORY needs a FEATURE parent, not EPIC

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: { title: 'Login story', type: 'story', parent_id: 'epic-uuid' }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'parent_id must reference a FEATURE task' });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('400 when parent_id references a task from another project', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // no row: not found in this project

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: { title: 'Login story', type: 'story', parent_id: 'other-project-feature-uuid' }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'parent_id does not belong to this project' });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('400 when parent_id is sent on an EPIC (which allows no parent)', async () => {
    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: { title: 'New epic', type: 'epic', parent_id: 'some-uuid' }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'EPIC cannot have a parent' });
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('409 when parent_id was deleted between validation and the INSERT (race)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ type: 'FEATURE' }] }); // validateParentId: still valid at this point

    const fkError = new Error('insert or update on table "tasks" violates foreign key constraint');
    fkError.code = '23503';
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce(undefined)                                    // BEGIN
      .mockResolvedValueOnce({ rows: [{ key: 'ACM', ticket_number: 8 }] })  // atomic counter
      .mockResolvedValueOnce({ rows: [{ next_rank: 6000 }] })              // rank
      .mockRejectedValueOnce(fkError)                                     // INSERT: parent_id was just deleted
      .mockResolvedValueOnce(undefined);                                   // ROLLBACK
    pool.connect.mockResolvedValue(client);

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: { title: 'Login story', type: 'story', parent_id: 'feature-uuid' }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: 'parent_id no longer exists' });
  });

  it('409 blaming assignee_id (not parent_id) when its FK is the one violated mid-race', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ user_id: 'member-uuid' }] }); // validateAssigneeId: still a member at this point

    const fkError = new Error('insert or update on table "tasks" violates foreign key constraint');
    fkError.code = '23503';
    fkError.constraint = 'tasks_assignee_id_fkey';
    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ key: 'ACM', ticket_number: 9 }] })
      .mockResolvedValueOnce({ rows: [{ next_rank: 5500 }] })
      .mockRejectedValueOnce(fkError)                                     // INSERT: assignee_id was just removed
      .mockResolvedValueOnce(undefined);
    pool.connect.mockResolvedValue(client);

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: { title: 'Design login', assignee_id: 'member-uuid' }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: 'assignee_id no longer exists' });
  });

  it('201 + task with assignee_id, points and labels', async () => {
    const taskRow = {
      id: 'task-uuid', project_id: 'project-uuid', ticket_number: 10, user_id: 'user-uuid',
      title: 'Design login', type: 'STORY', rank: 8000, details: {}, parent_id: null,
      assignee_id: 'member-uuid', points: 3, labels: ['ui']
    };

    pool.query.mockResolvedValueOnce({ rows: [{ user_id: 'member-uuid' }] }); // validateAssigneeId membership check

    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ key: 'ACM', ticket_number: 10 }] })
      .mockResolvedValueOnce({ rows: [{ next_rank: 8000 }] })
      .mockResolvedValueOnce({ rows: [taskRow] })
      .mockResolvedValueOnce(undefined);
    pool.connect.mockResolvedValue(client);

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: { title: 'Design login', assignee_id: 'member-uuid', points: 3, labels: ['ui'] }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(client.query.mock.calls[3][1]).toEqual([
      'project-uuid', 10, 'user-uuid', 'Design login', null, 'STORY', 8000, {}, null, 'member-uuid', 3, ['ui']
    ]);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('400 when assignee_id is not a member of the project', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // not a project member

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: { title: 'Design login', assignee_id: 'outsider-uuid' }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'assignee_id must be a member of this project' });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('400 when points is not a non-negative integer', async () => {
    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: { title: 'Design login', points: -2 }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'points must be a non-negative integer' });
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('400 when points is a non-number that would coerce to a valid integer (regression: true/""/[5])', async () => {
    // Number(true) === 1, Number('') === 0, Number([5]) === 5 -- all would
    // pass Number.isInteger if points weren't type-checked first.
    for (const badPoints of [true, '', [5]]) {
      const req = {
        user: { id: 'user-uuid' },
        project: { id: 'project-uuid' },
        body: { title: 'Design login', points: badPoints }
      };
      const res = mockRes();

      await createTask(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: 'points must be a non-negative integer' });
    }
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('400 when a label is not a non-empty string', async () => {
    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      body: { title: 'Design login', labels: ['ui', ''] }
    };
    const res = mockRes();

    await createTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'each label must be a non-empty string' });
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

describe('taskController.getProjectTasks', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + the tasks of the project with no filters', async () => {
    const rows = [{ id: 'task-uuid', ticket_id: 'ACM-1', status: 'TODO' }];
    pool.query.mockResolvedValue({ rows });

    const req = { project: { id: 'project-uuid' }, query: {} };
    const res = mockRes();

    await getProjectTasks(req, res);

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY t.rank'), ['project-uuid']);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(rows);
  });

  it('400 when the status filter is invalid', async () => {
    const req = { project: { id: 'project-uuid' }, query: { status: 'bogus' } };
    const res = mockRes();

    await getProjectTasks(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid status value' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('400 when the DB rejects a malformed parent_id filter', async () => {
    const error = new Error('invalid input syntax for type uuid');
    error.code = '22P02';
    pool.query.mockRejectedValue(error);

    const req = { project: { id: 'project-uuid' }, query: { parent_id: 'not-a-uuid' } };
    const res = mockRes();

    await getProjectTasks(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid sprint_id or parent_id' });
  });

  it('200 + filters by search term across title and ticket key', async () => {
    const rows = [{ id: 'task-uuid', ticket_id: 'ACM-1', title: 'Fix login' }];
    pool.query.mockResolvedValue({ rows });

    const req = { project: { id: 'project-uuid' }, query: { search: 'login' } };
    const res = mockRes();

    await getProjectTasks(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ILIKE'),
      ['project-uuid', '%login%', '%login%']
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(rows);
  });
});

describe('taskController.getMyTasks', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + the tasks across every project the user belongs to', async () => {
    const rows = [{ id: 'task-uuid', ticket_id: 'ACM-1', status: 'TODO' }];
    pool.query.mockResolvedValue({ rows });

    const req = { user: { id: 'user-uuid' }, query: {} };
    const res = mockRes();

    await getMyTasks(req, res);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['user-uuid']);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(rows);
  });

  it('400 when the DB rejects a malformed uuid in a filter', async () => {
    const error = new Error('invalid input syntax for type uuid');
    error.code = '22P02';
    pool.query.mockRejectedValue(error);

    const req = { user: { id: 'user-uuid' }, query: { sprint_id: 'not-a-uuid' } };
    const res = mockRes();

    await getMyTasks(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid project_id, sprint_id or parent_id' });
  });
});

describe('taskController.updateTask', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + updated task when a valid status is sent', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', status: 'DONE' };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] }) // UPDATE tasks
      .mockResolvedValueOnce({ rows: [taskRow] });            // re-read via TASK_SELECT

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { status: 'done' }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
  });

  it('400 when neither status, type, sprint_id, details, parent_id nor after_task_id is sent', async () => {
    const req = { user: { id: 'user-uuid' }, project: { id: 'project-uuid' }, params: { id: 'task-uuid' }, body: {} };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Nothing to update: send status, type, sprint_id, details, parent_id, assignee_id, points, labels and/or after_task_id'
    });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('200 reorders a task within its destination list (also moving sprint in the same call)', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', sprint_id: 'sprint-uuid', rank: 1500 };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'sprint-uuid' }] })            // sprint_id ownership check
      .mockResolvedValueOnce({
        rows: [
          { id: 'task-2', rank: '1000' },
          { id: 'task-3', rank: '2000' }
        ]
      })                                                                   // destination list, ordered by rank
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] })              // UPDATE tasks
      .mockResolvedValueOnce({ rows: [taskRow] });                         // re-read via TASK_SELECT

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { sprint_id: 'sprint-uuid', after_task_id: 'task-2' }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(pool.query.mock.calls[2][0]).toEqual(expect.stringContaining('rank = $'));
    expect(pool.query.mock.calls[2][1]).toContain(1500); // midpoint between 1000 and 2000
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
  });

  it('400 when after_task_id does not belong to the destination list', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'sprint-uuid' }] })             // sprint_id ownership check
      .mockResolvedValueOnce({ rows: [{ id: 'task-2', rank: '1000' }] });   // destination list, no 'other-task'

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { sprint_id: 'sprint-uuid', after_task_id: 'other-task' }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'after_task_id does not belong to the destination list'
    });
  });

  it('200 updates details alone, looking up the current type to validate against', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', type: 'BUG', details: { expected_behavior: 'Opens' } };
    pool.query
      .mockResolvedValueOnce({ rows: [{ type: 'BUG' }] })      // current-type lookup
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] })  // UPDATE tasks
      .mockResolvedValueOnce({ rows: [taskRow] });             // re-read via TASK_SELECT

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { details: { expected_behavior: '  Opens  ' } }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('SELECT type, details, parent_id, sprint_id FROM tasks'));
    expect(pool.query.mock.calls[1][0]).toEqual(expect.stringContaining('details = $'));
    expect(pool.query.mock.calls[1][1]).toContainEqual({ expected_behavior: 'Opens' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
  });

  it('200 updates type and details together, no extra lookup for details (parent_id still re-checked once)', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', type: 'BUG', details: { steps_to_reproduce: 'Click it' } };
    pool.query
      .mockResolvedValueOnce({ rows: [{ type: 'STORY', parent_id: null }] }) // current row (for parent_id re-check)
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] })                // UPDATE tasks
      .mockResolvedValueOnce({ rows: [taskRow] });                          // re-read via TASK_SELECT

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { type: 'bug', details: { steps_to_reproduce: 'Click it' } }
    };
    const res = mockRes();

    await updateTask(req, res);

    // effectiveType for 'details' comes straight from typeNormalized (no extra
    // query for that); the single current-row fetch is only for re-validating
    // the existing (null) parent_id against the new type.
    expect(pool.query).toHaveBeenCalledTimes(3);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
  });

  it('200 updates details and parent_id together, needing exactly one current-row lookup (not two)', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', type: 'BUG', details: { expected_behavior: 'Opens' }, parent_id: 'story-uuid' };
    pool.query
      .mockResolvedValueOnce({ rows: [{ type: 'BUG' }] })          // single current-row fetch (type, for effectiveType)
      .mockResolvedValueOnce({ rows: [{ type: 'STORY' }] })        // parent_id ownership+type check
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] })      // UPDATE tasks
      .mockResolvedValueOnce({ rows: [taskRow] });                 // re-read via TASK_SELECT

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { details: { expected_behavior: 'Opens' }, parent_id: 'story-uuid' }
    };
    const res = mockRes();

    await updateTask(req, res);

    // Exactly one "current row" lookup even though both details and parent_id
    // need the task's current type — regression guard for the consolidation.
    expect(pool.query).toHaveBeenCalledTimes(4);
    expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('SELECT type, details, parent_id, sprint_id FROM tasks'));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
  });

  it('200 sets parent_id on a valid same-project parent of the required type', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', type: 'STORY', parent_id: 'feature-uuid' };
    pool.query
      .mockResolvedValueOnce({ rows: [{ type: 'TASK', details: {} }] }) // current-row fetch (details-vs-new-type guard)
      .mockResolvedValueOnce({ rows: [{ type: 'FEATURE' }] })           // validateParentId: parent lookup
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] })           // UPDATE tasks
      .mockResolvedValueOnce({ rows: [taskRow] });                      // re-read via TASK_SELECT

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { type: 'story', parent_id: 'feature-uuid' }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(pool.query.mock.calls[1][1]).toEqual(['feature-uuid', 'project-uuid']);
    expect(pool.query.mock.calls[2][0]).toEqual(expect.stringContaining('parent_id = $'));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
  });

  it('200 detaches parent_id when sent as null (no lookup needed)', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', parent_id: null };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] }) // UPDATE tasks
      .mockResolvedValueOnce({ rows: [taskRow] });            // re-read via TASK_SELECT

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { parent_id: null }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('parent_id = NULL'));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
  });

  it('400 when parent_id references a task of the wrong type', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ type: 'TASK', details: {} }] }) // current-row fetch (details-vs-new-type guard)
      .mockResolvedValueOnce({ rows: [{ type: 'EPIC' }] });             // wrong type for a STORY's parent

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { type: 'story', parent_id: 'epic-uuid' }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'parent_id must reference a FEATURE task' });
  });

  it('400 when changing type would leave an existing parent_id incompatible', async () => {
    // Tarea actualmente FEATURE con padre EPIC; pasarla a TASK dejaría ese
    // padre huérfano (TASK requiere padre STORY).
    pool.query.mockResolvedValueOnce({ rows: [{ type: 'FEATURE', parent_id: 'epic-uuid' }] })
      .mockResolvedValueOnce({ rows: [{ type: 'EPIC' }] }); // re-check: parent's actual type

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { type: 'task' }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: expect.stringContaining('existing parent_id is incompatible with the new type')
    });
  });

  it('409 when parent_id was deleted between validation and the UPDATE (race)', async () => {
    const fkError = new Error('update on table "tasks" violates foreign key constraint');
    fkError.code = '23503';
    pool.query
      .mockResolvedValueOnce({ rows: [{ type: 'TASK', details: {} }] }) // current-row fetch (details-vs-new-type guard)
      .mockResolvedValueOnce({ rows: [{ type: 'FEATURE' }] })           // validateParentId: still valid at this point
      .mockRejectedValueOnce(fkError);                                 // UPDATE: parent_id was just deleted

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { type: 'story', parent_id: 'feature-uuid' }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: 'parent_id no longer exists' });
  });

  it('409 blaming assignee_id (not parent_id) when its FK is the one violated mid-race', async () => {
    const fkError = new Error('update on table "tasks" violates foreign key constraint');
    fkError.code = '23503';
    fkError.constraint = 'tasks_assignee_id_fkey';
    pool.query
      .mockResolvedValueOnce({ rows: [{ user_id: 'member-uuid' }] }) // validateAssigneeId: still a member at this point
      .mockRejectedValueOnce(fkError);                               // UPDATE: assignee_id was just removed

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { assignee_id: 'member-uuid' }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: 'assignee_id no longer exists' });
  });

  it('400 when details has a key invalid for the effective type', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ type: 'STORY' }] }); // current-type lookup

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { details: { steps_to_reproduce: 'Click it' } }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: '"steps_to_reproduce" is not a valid detail field for type STORY'
    });
  });

  it('404 when the current-type lookup finds no matching task', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // current-type lookup, no match

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { details: { acceptance_criteria: 'Done when...' } }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Task not found' });
  });

  it('200 sets assignee_id to a valid project member', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', assignee_id: 'member-uuid' };
    pool.query
      .mockResolvedValueOnce({ rows: [{ user_id: 'member-uuid' }] }) // validateAssigneeId membership check
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] })        // UPDATE tasks
      .mockResolvedValueOnce({ rows: [taskRow] });                   // re-read via TASK_SELECT

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { assignee_id: 'member-uuid' }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(pool.query.mock.calls[0][1]).toEqual(['member-uuid', 'project-uuid']);
    expect(pool.query.mock.calls[1][0]).toEqual(expect.stringContaining('assignee_id = $'));
    expect(pool.query.mock.calls[1][1]).toContain('member-uuid');
    expect(pool.query.mock.calls[1][1]).toContain('user-uuid'); // updated_by = req.user.id
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
  });

  it('400 when assignee_id is not a member of the project', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // not a project member

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { assignee_id: 'outsider-uuid' }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'assignee_id must be a member of this project' });
  });

  it('200 unassigns when assignee_id is sent as null (no membership lookup needed)', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', assignee_id: null };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] }) // UPDATE tasks
      .mockResolvedValueOnce({ rows: [taskRow] });            // re-read via TASK_SELECT

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { assignee_id: null }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('assignee_id = NULL'));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('200 sets points', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', points: 5 };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] })
      .mockResolvedValueOnce({ rows: [taskRow] });

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { points: 5 }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('points = $'));
    expect(pool.query.mock.calls[0][1]).toContain(5);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('400 when points is negative', async () => {
    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { points: -1 }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'points must be a non-negative integer' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('200 replaces labels wholesale', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', labels: ['ui', 'integration'] };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] })
      .mockResolvedValueOnce({ rows: [taskRow] });

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { labels: ['ui', '  integration  '] }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(pool.query.mock.calls[0][1]).toContainEqual(['ui', 'integration']);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('400 when labels contains a non-string entry', async () => {
    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { labels: ['ui', 42] }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'each label must be a non-empty string' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('200 reorders among siblings under the same parent_id (reorder_scope: siblings)', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', parent_id: 'story-uuid', rank: 1500 };
    pool.query
      .mockResolvedValueOnce({ rows: [{ type: 'TASK', details: {}, parent_id: 'story-uuid', sprint_id: null } ] }) // current row (parent_id needed)
      .mockResolvedValueOnce({
        rows: [
          { id: 'sibling-1', rank: '1000' },
          { id: 'sibling-2', rank: '2000' }
        ]
      }) // siblings scoped by parent_id, not sprint_id
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] }) // UPDATE tasks
      .mockResolvedValueOnce({ rows: [taskRow] });            // re-read via TASK_SELECT

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { reorder_scope: 'siblings', after_task_id: 'sibling-1' }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(pool.query.mock.calls[1][0]).toEqual(expect.stringContaining('parent_id = $2'));
    expect(pool.query.mock.calls[1][1]).toEqual(['project-uuid', 'story-uuid']);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
  });

  it('400 when reorder_scope "siblings" is used on a task with no parent_id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ type: 'STORY', details: {}, parent_id: null, sprint_id: null }] }); // current row

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { reorder_scope: 'siblings', after_task_id: null }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'reorder_scope "siblings" requires the task to have a parent_id'
    });
  });
});

describe('taskController.updateTaskType', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + updated task when a valid type is sent (existing details are compatible)', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', type: 'BUG' };
    pool.query
      .mockResolvedValueOnce({ rows: [{ details: {} }] })     // existing-details compatibility check
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] }) // UPDATE tasks
      .mockResolvedValueOnce({ rows: [taskRow] });            // re-read via TASK_SELECT

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { type: 'bug' }
    };
    const res = mockRes();

    await updateTaskType(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
  });

  it('400 when changing type would leave existing details incompatible', async () => {
    // Tarea actualmente STORY con acceptance_criteria; pasarla a BUG dejaría
    // ese campo huérfano (BUG no lo tiene en su whitelist).
    pool.query.mockResolvedValueOnce({ rows: [{ details: { acceptance_criteria: 'Done when...' } }] });

    const req = {
      user: { id: 'user-uuid' },
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { type: 'bug' }
    };
    const res = mockRes();

    await updateTaskType(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: expect.stringContaining('existing details are incompatible with the new type')
    });
  });

  it('400 when req.body is undefined (regression: no Content-Type header)', async () => {
    const req = { project: { id: 'project-uuid' }, params: { id: 'task-uuid' }, body: undefined };
    const res = mockRes();

    await updateTaskType(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Type is required' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('taskController.deleteTask', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 deletes a task that is still in TODO', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'TODO' }] }) // SELECT status
      .mockResolvedValueOnce({});                            // DELETE

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-uuid' } };
    const res = mockRes();

    await deleteTask(req, res);

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM tasks'),
      ['task-uuid']
    );
    expect(res.json).toHaveBeenCalledWith({ message: 'Task deleted successfully' });
  });

  it('400 when the task is not in TODO', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ status: 'IN_PROGRESS' }] });

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-uuid' } };
    const res = mockRes();

    await deleteTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Only tasks with status TODO can be deleted'
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('409 when the task still has child tasks (FK violation on delete)', async () => {
    const fkError = new Error('update or delete on table "tasks" violates foreign key constraint');
    fkError.code = '23503';
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'TODO' }] }) // SELECT status
      .mockRejectedValueOnce(fkError);                       // DELETE, blocked by a child's parent_id FK

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-uuid' } };
    const res = mockRes();

    await deleteTask(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: 'Cannot delete: task has child tasks' });
  });
});
