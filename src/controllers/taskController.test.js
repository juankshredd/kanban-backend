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
      details: {}
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
      'project-uuid', 5, 'user-uuid', 'New Task', 'desc', 'STORY', 3000, {}
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
      'project-uuid', 6, 'user-uuid', 'Broken button', null, 'BUG', 4000, { steps_to_reproduce: 'Click it' }
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
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid project_id or sprint_id' });
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
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { status: 'done' }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
  });

  it('400 when neither status, type, sprint_id, details nor after_task_id is sent', async () => {
    const req = { project: { id: 'project-uuid' }, params: { id: 'task-uuid' }, body: {} };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Nothing to update: send status, type, sprint_id, details and/or after_task_id'
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
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { details: { expected_behavior: '  Opens  ' } }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(pool.query.mock.calls[0][0]).toEqual(expect.stringContaining('SELECT type FROM tasks'));
    expect(pool.query.mock.calls[1][0]).toEqual(expect.stringContaining('details = $'));
    expect(pool.query.mock.calls[1][1]).toContainEqual({ expected_behavior: 'Opens' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
  });

  it('200 updates type and details together, validated against the new type with no extra lookup', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', type: 'BUG', details: { steps_to_reproduce: 'Click it' } };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] }) // UPDATE tasks
      .mockResolvedValueOnce({ rows: [taskRow] });            // re-read via TASK_SELECT

    const req = {
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { type: 'bug', details: { steps_to_reproduce: 'Click it' } }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(pool.query).toHaveBeenCalledTimes(2); // no current-type lookup: type was sent
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
  });

  it('400 when details has a key invalid for the effective type', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ type: 'STORY' }] }); // current-type lookup

    const req = {
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
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { details: { acceptance_criteria: 'Done when...' } }
    };
    const res = mockRes();

    await updateTask(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Task not found' });
  });
});

describe('taskController.updateTaskType', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + updated task when a valid type is sent', async () => {
    const taskRow = { id: 'task-uuid', ticket_id: 'ACM-1', type: 'BUG' };
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'task-uuid' }] }) // UPDATE tasks
      .mockResolvedValueOnce({ rows: [taskRow] });            // re-read via TASK_SELECT

    const req = {
      project: { id: 'project-uuid' },
      params: { id: 'task-uuid' },
      body: { type: 'bug' }
    };
    const res = mockRes();

    await updateTaskType(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(taskRow);
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
});
