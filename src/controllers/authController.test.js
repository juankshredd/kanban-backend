jest.mock('../db', () => ({
  connect: jest.fn(),
  query: jest.fn()
}));

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn()
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn()
}));

const pool = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { register, login } = require('./authController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('authController.register', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('201 + new user when all fields are valid', async () => {
    const newUser = { id: 'user-uuid', username: 'juank', email: 'juank@mail.com' };

    pool.query
      .mockResolvedValueOnce({ rows: [] })          // SELECT id FROM users WHERE email
      .mockResolvedValueOnce({ rows: [newUser] });   // INSERT INTO users
    bcrypt.hash.mockResolvedValue('hashed-password');

    const req = {
      body: { username: 'juank', email: 'juank@mail.com', password: '123456' }
    };
    const res = mockRes();

    await register(req, res);

    expect(bcrypt.hash).toHaveBeenCalledWith('123456', 10);
    expect(pool.query.mock.calls[1][0]).toEqual(expect.stringContaining('INSERT INTO users'));
    expect(pool.query.mock.calls[1][1]).toEqual(['juank', 'juank@mail.com', 'hashed-password']);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(newUser);
  });

  it('400 when a required field is missing', async () => {
    const req = { body: { username: 'juank', email: 'juank@mail.com' } };
    const res = mockRes();

    await register(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'All fields are required' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('authController.login', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('200 + token when credentials are valid', async () => {
    const user = { id: 'user-uuid', email: 'juank@mail.com', password_hash: 'hashed-password' };
    pool.query.mockResolvedValue({ rows: [user] });
    bcrypt.compare.mockResolvedValue(true);
    jwt.sign.mockReturnValue('fake-jwt-token');

    const req = { body: { email: 'juank@mail.com', password: '123456' } };
    const res = mockRes();

    await login(req, res);

    expect(bcrypt.compare).toHaveBeenCalledWith('123456', 'hashed-password');
    expect(jwt.sign).toHaveBeenCalledWith({ id: 'user-uuid' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ token: 'fake-jwt-token' });
  });

  it('400 when email or password is missing', async () => {
    const req = { body: { email: 'juank@mail.com' } };
    const res = mockRes();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Email and password required' });
    expect(pool.query).not.toHaveBeenCalled();
  });
});
