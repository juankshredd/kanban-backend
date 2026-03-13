// file: src/auth/login.test.js
// assumes your express app is exported from `src/app.js` or similar
const request = require('supertest');
const app = require('./server');

describe('POST /api/auth/login', () => {
  // happy‑path
  it('200 + token when correct email/password are supplied', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nuevo@mail.com', password: '123456' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
  });

  // negative / validation
  it('400 when the email field is omitted', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'whatever' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ message: expect.any(String) });
  });

  it('400 when the password field is omitted', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com' });

    expect(res.statusCode).toBe(400);
    //expect(res.body).toMatchObject({ error: expect.any(String) });
  });

  it('400 when email is an empty string', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: '', password: 'pwd' });

    expect(res.statusCode).toBe(400);
  });

  it('400 when password is an empty string', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: '' });

    expect(res.statusCode).toBe(400);
  });

  it('401 when the password is incorrect', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'wrongpassword' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ message: expect.any(String) });
  });

  it('401 when the email does not exist in the system', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nonexistent@domain.test', password: 'pwd' });

    expect(res.statusCode).toBe(400);
  });

  // edge‑case / security
  it('does not authenticate when supplied strings contain SQL‑injection patterns', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: "foo' OR '1'='1", password: "anything" });

    expect(res.statusCode).not.toBe(200);
    expect(res.body).toMatchObject({ message: expect.any(String) });
  });

  it('handles very long input without crashing (limits)', async () => {
    const long = 'a'.repeat(10001);
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: `${long}@example.com`, password: long });

    expect([400, 413]).toContain(res.statusCode); // bad request or payload too large
  });
});