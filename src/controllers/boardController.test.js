jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

const pool = require('../db');
const { getBoard, getBacklogView, getTaskHierarchy, getTaskDetail } = require('./boardController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('boardController.getBoard', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + the active sprint and its tasks, ordered by rank', async () => {
    const activeSprint = { id: 'sprint-uuid', project_id: 'project-uuid', status: 'ACTIVE' };
    const tasks = [
      { id: 'task-1', sprint_id: 'sprint-uuid', rank: 1000 },
      { id: 'task-2', sprint_id: 'sprint-uuid', rank: 2000 }
    ];

    pool.query
      .mockResolvedValueOnce({ rows: [activeSprint] }) // active sprint lookup
      .mockResolvedValueOnce({ rows: tasks });         // tasks of that sprint

    const req = { project: { id: 'project-uuid' } };
    const res = mockRes();

    await getBoard(req, res);

    expect(pool.query.mock.calls[1][0]).toEqual(expect.stringContaining('ORDER BY t.rank'));
    expect(pool.query.mock.calls[1][1]).toEqual(['project-uuid', 'sprint-uuid']);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ sprint: activeSprint, tasks });
  });

  it('404 when there is no active sprint', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // active sprint lookup

    const req = { project: { id: 'project-uuid' } };
    const res = mockRes();

    await getBoard(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'No active sprint' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('boardController.getBacklogView', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + future sprints (each with their tasks) and the backlog tasks', async () => {
    const plannedSprint = { id: 'sprint-2-uuid', project_id: 'project-uuid', status: 'PLANNED' };
    const sprintTask = { id: 'task-1', sprint_id: 'sprint-2-uuid', rank: 1000 };
    const backlogTask = { id: 'task-2', sprint_id: null, rank: 500 };

    pool.query
      .mockResolvedValueOnce({ rows: [plannedSprint] }) // future sprints
      .mockResolvedValueOnce({ rows: [backlogTask] })   // backlog tasks
      .mockResolvedValueOnce({ rows: [sprintTask] });   // tasks for those sprints

    const req = { project: { id: 'project-uuid' } };
    const res = mockRes();

    await getBacklogView(req, res);

    expect(pool.query.mock.calls[2][0]).toEqual(expect.stringContaining('sprint_id = ANY'));
    expect(pool.query.mock.calls[2][1]).toEqual([['sprint-2-uuid']]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      sprints: [{ ...plannedSprint, tasks: [sprintTask] }],
      backlog: [backlogTask]
    });
  });

  it('500 when a query fails', async () => {
    pool.query.mockRejectedValue(new Error('connection lost'));

    const req = { project: { id: 'project-uuid' } };
    const res = mockRes();

    await getBacklogView(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Server error' });
  });
});

describe('boardController.getTaskHierarchy', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + nests EPIC -> FEATURE -> STORY -> TASK/BUG from one flat query', async () => {
    const epic = { id: 'epic-1', type: 'EPIC', parent_id: null };
    const feature = { id: 'feature-1', type: 'FEATURE', parent_id: 'epic-1' };
    const story = { id: 'story-1', type: 'STORY', parent_id: 'feature-1' };
    const task = { id: 'task-1', type: 'TASK', parent_id: 'story-1' };
    const bug = { id: 'bug-1', type: 'BUG', parent_id: 'story-1' };

    // Orden deliberadamente mezclado: el agrupado no depende del orden de filas.
    pool.query.mockResolvedValueOnce({ rows: [task, epic, bug, story, feature] });

    const req = { project: { id: 'project-uuid' } };
    const res = mockRes();

    await getTaskHierarchy(req, res);

    expect(pool.query).toHaveBeenCalledTimes(1); // una sola consulta sin importar el tamaño del árbol
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      roots: [
        {
          ...epic,
          children: [
            {
              ...feature,
              children: [
                {
                  ...story,
                  children: [
                    { ...task, children: [] },
                    { ...bug, children: [] }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });
  });

  it('200 + a non-EPIC task with no parent still appears as a root (not silently dropped)', async () => {
    const orphanStory = { id: 'story-2', type: 'STORY', parent_id: null };

    pool.query.mockResolvedValueOnce({ rows: [orphanStory] });

    const req = { project: { id: 'project-uuid' } };
    const res = mockRes();

    await getTaskHierarchy(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ roots: [{ ...orphanStory, children: [] }] });
  });

  it('200 + empty roots list when the project has no tasks', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const req = { project: { id: 'project-uuid' } };
    const res = mockRes();

    await getTaskHierarchy(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ roots: [] });
  });

  it('500 when the query fails', async () => {
    pool.query.mockRejectedValue(new Error('connection lost'));

    const req = { project: { id: 'project-uuid' } };
    const res = mockRes();

    await getTaskHierarchy(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Server error' });
  });
});

describe('boardController.getTaskDetail', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Las 4 queries de detalle corren en paralelo (Promise.all), así que el
  // orden exacto de llamadas a pool.query no está garantizado por índice --
  // se resuelve cada una inspeccionando el SQL, en vez de encadenar
  // mockResolvedValueOnce como en los describes secuenciales de arriba.
  it('200 + task, parent, children, relaciones agrupadas y sprint en una sola respuesta', async () => {
    const task = { id: 'task-uuid', parent_id: 'parent-uuid', sprint_id: 'sprint-uuid', title: 'Story' };
    const parent = { id: 'parent-uuid', title: 'Parent feature' };
    const child = { id: 'child-uuid', parent_id: 'task-uuid', title: 'Subtask' };
    const relatedTask = { id: 'related-uuid', title: 'Blocked task' };
    const sprint = { id: 'sprint-uuid', name: 'Sprint 4', start_date: '2026-08-24', end_date: '2026-09-06' };

    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('WHERE t.id = $1 AND t.project_id = $2') && params[0] === 'task-uuid') {
        return Promise.resolve({ rows: [task] });
      }
      if (sql.includes('WHERE t.id = $1 AND t.project_id = $2') && params[0] === 'parent-uuid') {
        return Promise.resolve({ rows: [parent] });
      }
      if (sql.includes('WHERE t.parent_id = $1 AND t.project_id = $2')) {
        return Promise.resolve({ rows: [child] });
      }
      if (sql.includes('FROM task_relations')) {
        return Promise.resolve({
          rows: [{
            relation_id: 'relation-uuid',
            created_at: '2026-08-30T00:00:00.000Z',
            relation_type: 'BLOCKS',
            anchor_is_task_id: true,
            related_task_id: 'related-uuid'
          }]
        });
      }
      if (sql.includes('t.id = ANY($1)')) {
        return Promise.resolve({ rows: [relatedTask] });
      }
      if (sql.includes('FROM sprints')) {
        return Promise.resolve({ rows: [sprint] });
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-uuid' } };
    const res = mockRes();

    await getTaskDetail(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      task,
      parent,
      children: [child],
      relations: {
        blocks: [{
          relation_id: 'relation-uuid',
          related_since: '2026-08-30T00:00:00.000Z',
          type: 'blocks',
          task: relatedTask
        }]
      },
      sprint
    });
  });

  it('200 + parent/sprint null y children/relations vacíos cuando la tarea no tiene ninguno', async () => {
    const task = { id: 'task-uuid', parent_id: null, sprint_id: null, title: 'Root task' };

    pool.query.mockImplementation((sql) => {
      if (sql.includes('WHERE t.id = $1 AND t.project_id = $2')) {
        return Promise.resolve({ rows: [task] });
      }
      if (sql.includes('WHERE t.parent_id = $1 AND t.project_id = $2')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('FROM task_relations')) {
        return Promise.resolve({ rows: [] });
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-uuid' } };
    const res = mockRes();

    await getTaskDetail(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      task,
      parent: null,
      children: [],
      relations: {},
      sprint: null
    });
  });

  it('404 when the task does not belong to the project', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const req = { project: { id: 'project-uuid' }, params: { id: 'task-uuid' } };
    const res = mockRes();

    await getTaskDetail(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'Task not found' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});
