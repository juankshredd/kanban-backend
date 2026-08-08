/**
 * Seed idempotente del usuario que usan los tests de integración
 * (src/sample.test.js espera nuevo@mail.com / 123456 ya existente).
 *
 * Pensado para correr en CI contra una base efímera recién migrada;
 * en local también es seguro (ON CONFLICT DO NOTHING).
 *
 * Uso: node scripts/seedTestUser.js
 */
const bcrypt = require('bcrypt');
const pool = require('../src/db');

const TEST_USER = {
  username: 'nuevo',
  email: 'nuevo@mail.com',
  password: '123456',
};

const run = async () => {
  const passwordHash = await bcrypt.hash(TEST_USER.password, 10);

  await pool.query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING`,
    [TEST_USER.username, TEST_USER.email, passwordHash]
  );

  console.log(`Seed listo: ${TEST_USER.email}`);
};

run()
  .catch((error) => {
    console.error('SEED ERROR:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
