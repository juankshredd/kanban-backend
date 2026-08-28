jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

const pool = require('../db');
const { deactivateUser, activateUser } = require('./userController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('userController.deactivateUser', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('403 for the account owner (deactivation is disabled)', async () => {
    const req = { params: { id: 'self-uuid' }, user: { id: 'self-uuid' } };
    const res = mockRes();

    await deactivateUser(req, res);

    expect(pool.query).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Account deactivation is currently disabled' });
  });

  it('403 for another user\'s account (deactivation is disabled)', async () => {
    const req = { params: { id: 'other-uuid' }, user: { id: 'self-uuid' } };
    const res = mockRes();

    await deactivateUser(req, res);

    expect(pool.query).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Account deactivation is currently disabled' });
  });
});

describe('userController.activateUser', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 activates an existing user', async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: 'user-uuid', username: 'juank', is_active: true }]
    });

    const req = { params: { id: 'user-uuid' }, user: { id: 'user-uuid' } };
    const res = mockRes();

    await activateUser(req, res);

    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['user-uuid']);
    expect(res.json).toHaveBeenCalledWith({ message: 'User activated successfully' });
  });

  it('404 when the user does not exist', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    const req = { params: { id: 'missing-uuid' }, user: { id: 'missing-uuid' } };
    const res = mockRes();

    await activateUser(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: 'User not found' });
  });

  it('403 when acting on another user\'s account', async () => {
    const req = { params: { id: 'other-uuid' }, user: { id: 'self-uuid' } };
    const res = mockRes();

    await activateUser(req, res);

    expect(pool.query).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'You can only activate your own account' });
  });
});
