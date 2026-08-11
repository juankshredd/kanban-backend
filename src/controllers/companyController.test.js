jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

const pool = require('../db');
const { createCompany } = require('./companyController');

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
