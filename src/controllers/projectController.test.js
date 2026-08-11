jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

const pool = require('../db');
const {
  createProject,
  getProjects,
  getCompanyProjects,
  getProjectById,
  updateProject,
  deleteProject,
  addProjectMember,
  updateProjectMemberRole,
  removeProjectMember
} = require('./projectController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('projectController.createProject', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('201 + project with OWNER role, deriving a key from the name', async () => {
    const projectRow = {
      id: 'project-uuid',
      key: 'ACM',
      name: 'Acme',
      description: 'desc',
      created_by: 'user-uuid',
      company_id: 'company-uuid'
    };

    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce(undefined)              // BEGIN
      .mockResolvedValueOnce({ rows: [] })            // generateProjectKey: taken keys lookup
      .mockResolvedValueOnce({ rows: [projectRow] })  // INSERT INTO projects
      .mockResolvedValueOnce(undefined)               // INSERT INTO project_members
      .mockResolvedValueOnce(undefined);              // COMMIT
    pool.connect.mockResolvedValue(client);

    const req = {
      user: { id: 'user-uuid' },
      company: { id: 'company-uuid' },
      body: { name: 'Acme', description: 'desc' }
    };
    const res = mockRes();

    await createProject(req, res);

    expect(client.query.mock.calls[1][0]).toEqual(expect.stringContaining('SELECT key FROM projects'));
    expect(client.query.mock.calls[2][0]).toEqual(expect.stringContaining('INSERT INTO projects'));
    expect(client.query.mock.calls[2][1]).toEqual(['ACM', 'Acme', 'desc', 'user-uuid', 'company-uuid']);
    expect(client.query.mock.calls[3][0]).toEqual(expect.stringContaining('INSERT INTO project_members'));
    expect(client.query).toHaveBeenNthCalledWith(5, 'COMMIT');

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ...projectRow, role: 'OWNER' });
    expect(client.release).toHaveBeenCalled();
  });

  it('400 when req.body has no name', async () => {
    const req = { user: { id: 'user-uuid' }, company: { id: 'company-uuid' }, body: {} };
    const res = mockRes();

    await createProject(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Name is required' });
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

describe('projectController.getProjects', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + the list of projects the user belongs to', async () => {
    const rows = [{ id: 'project-uuid', key: 'ACM', name: 'Acme', role: 'OWNER' }];
    pool.query.mockResolvedValue({ rows });

    const req = { user: { id: 'user-uuid' }, query: {} };
    const res = mockRes();

    await getProjects(req, res);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['user-uuid', null]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(rows);
  });

  it('400 when company_id is not a valid uuid', async () => {
    const error = new Error('invalid input syntax for type uuid');
    error.code = '22P02';
    pool.query.mockRejectedValue(error);

    const req = { user: { id: 'user-uuid' }, query: { company_id: 'not-a-uuid' } };
    const res = mockRes();

    await getProjects(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid company_id' });
  });
});

describe('projectController.getCompanyProjects', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + the projects the user belongs to within the company', async () => {
    const rows = [{ id: 'project-uuid', key: 'ACM', role: 'MEMBER' }];
    pool.query.mockResolvedValue({ rows });

    const req = { user: { id: 'user-uuid' }, company: { id: 'company-uuid' } };
    const res = mockRes();

    await getCompanyProjects(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(rows);
  });

  it('500 when the query fails', async () => {
    pool.query.mockRejectedValue(new Error('connection lost'));

    const req = { user: { id: 'user-uuid' }, company: { id: 'company-uuid' } };
    const res = mockRes();

    await getCompanyProjects(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Server error' });
  });
});

describe('projectController.getProjectById', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + project detail with members and task_count', async () => {
    const members = [{ id: 'user-uuid', username: 'juank', role: 'OWNER' }];
    pool.query
      .mockResolvedValueOnce({ rows: members })          // members
      .mockResolvedValueOnce({ rows: [{ task_count: 5 }] }); // task count

    const req = {
      project: { id: 'project-uuid', key: 'ACM', name: 'Acme' },
      projectRole: 'OWNER'
    };
    const res = mockRes();

    await getProjectById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      id: 'project-uuid',
      key: 'ACM',
      name: 'Acme',
      role: 'OWNER',
      task_count: 5,
      members
    });
  });

  it('500 when a query fails', async () => {
    pool.query.mockRejectedValue(new Error('db down'));

    const req = { project: { id: 'project-uuid' }, projectRole: 'OWNER' };
    const res = mockRes();

    await getProjectById(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Server error' });
  });
});

describe('projectController.updateProject', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + updated project when a valid name is sent', async () => {
    const updatedRow = { id: 'project-uuid', key: 'ACM', name: 'New Name' };
    pool.query.mockResolvedValue({ rows: [updatedRow] });

    const req = {
      project: { id: 'project-uuid' },
      projectRole: 'OWNER',
      body: { name: 'New Name' }
    };
    const res = mockRes();

    await updateProject(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ...updatedRow, role: 'OWNER' });
  });

  it('400 when neither name nor description is sent', async () => {
    const req = { project: { id: 'project-uuid' }, projectRole: 'OWNER', body: {} };
    const res = mockRes();

    await updateProject(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Nothing to update: send name and/or description'
    });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('projectController.deleteProject', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 deletes the project when it has no tasks', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ n: 0 }] }) // task count
      .mockResolvedValueOnce({});                  // DELETE

    const req = { project: { id: 'project-uuid' }, query: {} };
    const res = mockRes();

    await deleteProject(req, res);

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM projects'),
      ['project-uuid']
    );
    expect(res.json).toHaveBeenCalledWith({ message: 'Project deleted successfully' });
  });

  it('409 when the project still has tasks and force is not set', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ n: 4 }] });

    const req = { project: { id: 'project-uuid' }, query: {} };
    const res = mockRes();

    await deleteProject(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Project has 4 task(s). Send ?force=true to delete the project and all of its content',
      task_count: 4
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('projectController.addProjectMember', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('201 adds a member found by email with the default MEMBER role', async () => {
    const user = { id: 'new-user-uuid', username: 'newbie', email: 'new@mail.com' };
    pool.query
      .mockResolvedValueOnce({ rows: [user] })                                        // SELECT users
      .mockResolvedValueOnce({ rows: [{ role: 'MEMBER', joined_at: '2026-08-10' }] }); // INSERT project_members

    const req = { project: { id: 'project-uuid' }, body: { email: 'new@mail.com' } };
    const res = mockRes();

    await addProjectMember(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ...user, role: 'MEMBER', joined_at: '2026-08-10' });
  });

  it('400 when neither email nor userId is sent', async () => {
    const req = { project: { id: 'project-uuid' }, body: {} };
    const res = mockRes();

    await addProjectMember(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'email or userId is required' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('projectController.updateProjectMemberRole', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 promotes an existing member to OWNER', async () => {
    const updatedRow = { user_id: 'member-uuid', role: 'OWNER', joined_at: '2026-08-10' };
    pool.query
      .mockResolvedValueOnce({ rows: [{ role: 'MEMBER' }] }) // membership lookup
      .mockResolvedValueOnce({ rows: [updatedRow] });        // UPDATE

    const req = {
      project: { id: 'project-uuid' },
      params: { userId: 'member-uuid' },
      body: { role: 'owner' }
    };
    const res = mockRes();

    await updateProjectMemberRole(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(updatedRow);
  });

  it('400 when role is not OWNER or MEMBER', async () => {
    const req = {
      project: { id: 'project-uuid' },
      params: { userId: 'member-uuid' },
      body: { role: 'ADMIN' }
    };
    const res = mockRes();

    await updateProjectMemberRole(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid role value' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('projectController.removeProjectMember', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 removes a member who is not the last owner', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ role: 'MEMBER' }] })         // membership lookup
      .mockResolvedValueOnce({ rows: [{ user_id: 'other-owner' }] }) // isLastOwner check
      .mockResolvedValueOnce({});                                    // DELETE

    const req = { project: { id: 'project-uuid' }, params: { userId: 'member-uuid' } };
    const res = mockRes();

    await removeProjectMember(req, res);

    expect(res.json).toHaveBeenCalledWith({ message: 'Member removed successfully' });
  });

  it('409 when trying to remove the last owner', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ role: 'OWNER' }] })          // membership lookup
      .mockResolvedValueOnce({ rows: [{ user_id: 'member-uuid' }] }); // isLastOwner check -> true

    const req = { project: { id: 'project-uuid' }, params: { userId: 'member-uuid' } };
    const res = mockRes();

    await removeProjectMember(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: 'Cannot remove the last owner of the project' });
  });
});
