jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

const pool = require('../db');
const {
  createCompany,
  getCompanies,
  getCompanyById,
  updateCompany,
  deleteCompany,
  addCompanyMember,
  updateCompanyMemberRole,
  removeCompanyMember
} = require('./companyController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('companyController.createCompany', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('201 + company with OWNER role when name is valid', async () => {
    const companyRow = {
      id: 'company-uuid',
      name: 'Acme',
      description: 'desc',
      created_by: 'user-uuid',
      created_at: '2026-08-10T00:00:00.000Z',
      updated_at: '2026-08-10T00:00:00.000Z'
    };

    const client = { query: jest.fn(), release: jest.fn() };
    client.query
      .mockResolvedValueOnce(undefined)                     // BEGIN
      .mockResolvedValueOnce({ rows: [companyRow] })         // INSERT INTO companies
      .mockResolvedValueOnce(undefined)                      // INSERT INTO company_members
      .mockResolvedValueOnce(undefined);                     // COMMIT
    pool.connect.mockResolvedValue(client);

    const req = { user: { id: 'user-uuid' }, body: { name: 'Acme', description: 'desc' } };
    const res = mockRes();

    await createCompany(req, res);

    expect(client.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(client.query.mock.calls[1][0]).toEqual(expect.stringContaining('INSERT INTO companies'));
    expect(client.query.mock.calls[1][1]).toEqual(['Acme', 'desc', 'user-uuid']);
    expect(client.query.mock.calls[2][0]).toEqual(expect.stringContaining('INSERT INTO company_members'));
    expect(client.query.mock.calls[2][1]).toEqual(['company-uuid', 'user-uuid']);
    expect(client.query).toHaveBeenNthCalledWith(4, 'COMMIT');

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ...companyRow, role: 'OWNER' });
    expect(client.release).toHaveBeenCalled();
  });

  it('400 when req.body has no name (including req.body being undefined)', async () => {
    const req = { user: { id: 'user-uuid' }, body: undefined };
    const res = mockRes();

    await createCompany(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Name is required' });
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

describe('companyController.getCompanies', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + the list of companies the user belongs to', async () => {
    const rows = [{ id: 'company-uuid', name: 'Acme', role: 'OWNER' }];
    pool.query.mockResolvedValue({ rows });

    const req = { user: { id: 'user-uuid' } };
    const res = mockRes();

    await getCompanies(req, res);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['user-uuid']);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(rows);
  });

  it('500 when the query fails', async () => {
    pool.query.mockRejectedValue(new Error('connection lost'));

    const req = { user: { id: 'user-uuid' } };
    const res = mockRes();

    await getCompanies(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Server error' });
  });
});

describe('companyController.getCompanyById', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + company detail with members and project_count', async () => {
    const members = [{ id: 'user-uuid', username: 'juank', role: 'OWNER' }];
    pool.query
      .mockResolvedValueOnce({ rows: members })            // members
      .mockResolvedValueOnce({ rows: [{ project_count: 2 }] }); // project count

    const req = {
      company: { id: 'company-uuid', name: 'Acme' },
      companyRole: 'OWNER'
    };
    const res = mockRes();

    await getCompanyById(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      id: 'company-uuid',
      name: 'Acme',
      role: 'OWNER',
      project_count: 2,
      members
    });
  });

  it('500 when a query fails', async () => {
    pool.query.mockRejectedValue(new Error('db down'));

    const req = { company: { id: 'company-uuid' }, companyRole: 'OWNER' };
    const res = mockRes();

    await getCompanyById(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Server error' });
  });
});

describe('companyController.updateCompany', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + updated company when a valid name is sent', async () => {
    const updatedRow = { id: 'company-uuid', name: 'New Name', description: 'desc' };
    pool.query.mockResolvedValue({ rows: [updatedRow] });

    const req = {
      company: { id: 'company-uuid' },
      companyRole: 'OWNER',
      body: { name: 'New Name' }
    };
    const res = mockRes();

    await updateCompany(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ...updatedRow, role: 'OWNER' });
  });

  it('400 when neither name nor description is sent', async () => {
    const req = { company: { id: 'company-uuid' }, companyRole: 'OWNER', body: {} };
    const res = mockRes();

    await updateCompany(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Nothing to update: send name and/or description'
    });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('companyController.deleteCompany', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 deletes the company when it has no projects', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ n: 0 }] }) // project count
      .mockResolvedValueOnce({});                  // DELETE

    const req = { company: { id: 'company-uuid' }, query: {} };
    const res = mockRes();

    await deleteCompany(req, res);

    expect(pool.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM companies'),
      ['company-uuid']
    );
    expect(res.json).toHaveBeenCalledWith({ message: 'Company deleted successfully' });
  });

  it('409 when the company still has projects and force is not set', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ n: 3 }] });

    const req = { company: { id: 'company-uuid' }, query: {} };
    const res = mockRes();

    await deleteCompany(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      message: 'Company has 3 project(s). Send ?force=true to delete the company and all of its content',
      project_count: 3
    });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('companyController.addCompanyMember', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('201 adds a member found by email with the default MEMBER role', async () => {
    const user = { id: 'new-user-uuid', username: 'newbie', email: 'new@mail.com' };
    pool.query
      .mockResolvedValueOnce({ rows: [user] })                                        // SELECT users
      .mockResolvedValueOnce({ rows: [{ role: 'MEMBER', joined_at: '2026-08-10' }] }); // INSERT company_members

    const req = { company: { id: 'company-uuid' }, body: { email: 'new@mail.com' } };
    const res = mockRes();

    await addCompanyMember(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ...user, role: 'MEMBER', joined_at: '2026-08-10' });
  });

  it('400 when neither email nor userId is sent', async () => {
    const req = { company: { id: 'company-uuid' }, body: {} };
    const res = mockRes();

    await addCompanyMember(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'email or userId is required' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('companyController.updateCompanyMemberRole', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 promotes an existing member to OWNER', async () => {
    const updatedRow = { user_id: 'member-uuid', role: 'OWNER', joined_at: '2026-08-10' };
    pool.query
      .mockResolvedValueOnce({ rows: [{ role: 'MEMBER' }] }) // membership lookup
      .mockResolvedValueOnce({ rows: [updatedRow] });        // UPDATE

    const req = {
      company: { id: 'company-uuid' },
      params: { userId: 'member-uuid' },
      body: { role: 'owner' }
    };
    const res = mockRes();

    await updateCompanyMemberRole(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(updatedRow);
  });

  it('400 when role is not OWNER or MEMBER', async () => {
    const req = {
      company: { id: 'company-uuid' },
      params: { userId: 'member-uuid' },
      body: { role: 'ADMIN' }
    };
    const res = mockRes();

    await updateCompanyMemberRole(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid role value' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('companyController.removeCompanyMember', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 removes a member who is not the last owner', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ role: 'MEMBER' }] })         // membership lookup
      .mockResolvedValueOnce({ rows: [{ user_id: 'other-owner' }] }) // isLastOwner check
      .mockResolvedValueOnce({});                                    // DELETE

    const req = { company: { id: 'company-uuid' }, params: { userId: 'member-uuid' } };
    const res = mockRes();

    await removeCompanyMember(req, res);

    expect(res.json).toHaveBeenCalledWith({ message: 'Member removed successfully' });
  });

  it('409 when trying to remove the last owner', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ role: 'OWNER' }] })          // membership lookup
      .mockResolvedValueOnce({ rows: [{ user_id: 'member-uuid' }] }); // isLastOwner check -> true

    const req = { company: { id: 'company-uuid' }, params: { userId: 'member-uuid' } };
    const res = mockRes();

    await removeCompanyMember(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: 'Cannot remove the last owner of the company' });
  });
});
