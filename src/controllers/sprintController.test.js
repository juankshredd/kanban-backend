jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

const pool = require('../db');
const {
  createSprint,
  getSprints,
  getActiveSprint,
  getSprintById,
  updateSprint,
  startSprint,
  completeSprint,
  deleteSprint
} = require('./sprintController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('sprintController.createSprint', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('201 + sprint (PLANNED, task_count 0) when name is valid', async () => {
    const sprintRow = {
      id: 'sprint-uuid',
      project_id: 'project-uuid',
      name: 'Sprint 1',
      goal: 'Ship the thing',
      status: 'PLANNED',
      start_date: null,
      end_date: null
    };
    pool.query.mockResolvedValue({ rows: [sprintRow] });

    const req = { project: { id: 'project-uuid' }, body: { name: 'Sprint 1', goal: 'Ship the thing' } };
    const res = mockRes();

    await createSprint(req, res);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sprints'),
      ['project-uuid', 'Sprint 1', 'Ship the thing', null, null]
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ...sprintRow, task_count: 0 });
  });

  it('400 when req.body has no name', async () => {
    const req = { project: { id: 'project-uuid' }, body: {} };
    const res = mockRes();

    await createSprint(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Name is required' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('sprintController.getSprints', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + the sprints of the project', async () => {
    const rows = [{ id: 'sprint-uuid', name: 'Sprint 1', status: 'PLANNED', task_count: 0 }];
    pool.query.mockResolvedValue({ rows });

    const req = { project: { id: 'project-uuid' } };
    const res = mockRes();

    await getSprints(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(rows);
  });

  it('500 when the query fails', async () => {
    pool.query.mockRejectedValue(new Error('connection lost'));

    const req = { project: { id: 'project-uuid' } };
    const res = mockRes();

    await getSprints(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Server error' });
  });
});

describe('sprintController.getActiveSprint', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + the active sprint when one exists', async () => {
    const activeSprint = { id: 'sprint-uuid', name: 'Sprint 1', status: 'ACTIVE', task_count: 3 };
    pool.query.mockResolvedValue({ rows: [activeSprint] });

    const req = { project: { id: 'project-uuid' } };
    const res = mockRes();

    await getActiveSprint(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(activeSprint);
  });

  it('404 when there is no active sprint', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const req = { project: { id: 'project-uuid' } };
    const res = mockRes();

    await getActiveSprint(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'No active sprint' });
  });
});

describe('sprintController.getSprintById', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + the sprint when it belongs to the project', async () => {
    const sprintRow = { id: 'sprint-uuid', name: 'Sprint 1', status: 'PLANNED', task_count: 0 };
    pool.query.mockResolvedValue({ rows: [sprintRow] });

    const req = { project: { id: 'project-uuid' }, params: { sprintId: 'sprint-uuid' } };
    const res = mockRes();

    await getSprintById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(sprintRow);
  });

  it('404 when the sprint does not exist in the project', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const req = { project: { id: 'project-uuid' }, params: { sprintId: 'missing-uuid' } };
    const res = mockRes();

    await getSprintById(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Sprint not found' });
  });
});

describe('sprintController.updateSprint', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + updated sprint when a valid name is sent', async () => {
    const existingSprint = { id: 'sprint-uuid', project_id: 'project-uuid', status: 'PLANNED' };
    const updatedRow = { id: 'sprint-uuid', name: 'New Name', status: 'PLANNED', task_count: 0 };

    pool.query
      .mockResolvedValueOnce({ rows: [existingSprint] }) // findOwnSprint
      .mockResolvedValueOnce({})                         // UPDATE
      .mockResolvedValueOnce({ rows: [updatedRow] });     // re-read via SPRINT_SELECT

    const req = {
      project: { id: 'project-uuid' },
      params: { sprintId: 'sprint-uuid' },
      body: { name: 'New Name' }
    };
    const res = mockRes();

    await updateSprint(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(updatedRow);
  });

  it('400 when no field to update is sent', async () => {
    const req = { project: { id: 'project-uuid' }, params: { sprintId: 'sprint-uuid' }, body: {} };
    const res = mockRes();

    await updateSprint(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Nothing to update: send name, goal, start_date and/or end_date'
    });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('sprintController.startSprint', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 moves a PLANNED sprint to ACTIVE', async () => {
    const plannedSprint = { id: 'sprint-uuid', project_id: 'project-uuid', status: 'PLANNED' };
    const updatedRow = { id: 'sprint-uuid', project_id: 'project-uuid', status: 'ACTIVE' };
    pool.query
      .mockResolvedValueOnce({ rows: [plannedSprint] }) // findOwnSprint
      .mockResolvedValueOnce({ rows: [updatedRow] });   // UPDATE sprints

    const req = { project: { id: 'project-uuid' }, params: { sprintId: 'sprint-uuid' } };
    const res = mockRes();

    await startSprint(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ...updatedRow, task_count: undefined });
  });

  it('400 when the sprint is not PLANNED', async () => {
    const activeSprint = { id: 'sprint-uuid', project_id: 'project-uuid', status: 'ACTIVE' };
    pool.query.mockResolvedValueOnce({ rows: [activeSprint] }); // findOwnSprint

    const req = { project: { id: 'project-uuid' }, params: { sprintId: 'sprint-uuid' } };
    const res = mockRes();

    await startSprint(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Cannot start a sprint that is ACTIVE' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('sprintController.completeSprint', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 completes an ACTIVE sprint and reports tasks moved to backlog', async () => {
    const activeSprint = { id: 'sprint-uuid', project_id: 'project-uuid', status: 'ACTIVE' };
    const completedRow = { id: 'sprint-uuid', project_id: 'project-uuid', status: 'COMPLETED' };

    pool.query.mockResolvedValueOnce({ rows: [activeSprint] }); // findOwnSprint

    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce(undefined)                              // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 't1' }, { id: 't2' }] }) // UPDATE tasks (moved back)
      .mockResolvedValueOnce({ rows: [completedRow] })               // UPDATE sprints
      .mockResolvedValueOnce(undefined);                             // COMMIT
    pool.connect.mockResolvedValue(client);

    const req = { project: { id: 'project-uuid' }, params: { sprintId: 'sprint-uuid' } };
    const res = mockRes();

    await completeSprint(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ...completedRow, moved_to_backlog: 2 });
    expect(client.release).toHaveBeenCalled();
  });

  it('400 when the sprint is not ACTIVE', async () => {
    const plannedSprint = { id: 'sprint-uuid', project_id: 'project-uuid', status: 'PLANNED' };
    pool.query.mockResolvedValueOnce({ rows: [plannedSprint] }); // findOwnSprint

    const client = { query: jest.fn(), release: jest.fn() };
    pool.connect.mockResolvedValue(client);

    const req = { project: { id: 'project-uuid' }, params: { sprintId: 'sprint-uuid' } };
    const res = mockRes();

    await completeSprint(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Cannot complete a sprint that is PLANNED' });
    expect(client.query).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalled();
  });
});

describe('sprintController.deleteSprint', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 deletes a sprint that never started', async () => {
    const plannedSprint = { id: 'sprint-uuid', project_id: 'project-uuid', status: 'PLANNED' };
    pool.query
      .mockResolvedValueOnce({ rows: [plannedSprint] }) // findOwnSprint
      .mockResolvedValueOnce({});                       // DELETE

    const req = { project: { id: 'project-uuid' }, params: { sprintId: 'sprint-uuid' } };
    const res = mockRes();

    await deleteSprint(req, res);

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM sprints'),
      ['sprint-uuid']
    );
    expect(res.json).toHaveBeenCalledWith({ message: 'Sprint deleted successfully' });
  });

  it('400 when the sprint already started', async () => {
    const activeSprint = { id: 'sprint-uuid', project_id: 'project-uuid', status: 'ACTIVE' };
    pool.query.mockResolvedValueOnce({ rows: [activeSprint] }); // findOwnSprint

    const req = { project: { id: 'project-uuid' }, params: { sprintId: 'sprint-uuid' } };
    const res = mockRes();

    await deleteSprint(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Only a sprint that has not started can be deleted; complete it first'
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
