/**
 * Runner de migraciones.
 *
 * Ejecuta, en orden alfabético, los archivos .sql de la carpeta `migrations/`
 * que todavía no se hayan aplicado. Cada archivo corre dentro de una
 * transacción: si falla, se revierte completo y no queda registrado.
 *
 * Uso:
 *   npm run migrate          -> aplica las migraciones pendientes
 *   npm run migrate:status   -> lista aplicadas / pendientes sin ejecutar nada
 */
const fs = require('fs');
const path = require('path');
const pool = require('../src/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

// Tabla de control: registra qué archivos ya se corrieron
const ensureMigrationsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    varchar(255) PRIMARY KEY,
      applied_at  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
};

const getMigrationFiles = () =>
  fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

const getAppliedMigrations = async () => {
  const result = await pool.query('SELECT filename FROM schema_migrations');
  return new Set(result.rows.map((r) => r.filename));
};

const applyMigration = async (filename) => {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1)',
      [filename]
    );
    await client.query('COMMIT');
    console.log(`  ✔ ${filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`  ✖ ${filename} — revertida`);
    throw error;
  } finally {
    client.release();
  }
};

const run = async () => {
  const statusOnly = process.argv.includes('status');

  await ensureMigrationsTable();

  const files = getMigrationFiles();
  const applied = await getAppliedMigrations();
  const pending = files.filter((f) => !applied.has(f));

  if (statusOnly) {
    console.log('Migraciones:');
    files.forEach((f) => {
      console.log(`  ${applied.has(f) ? '[aplicada]  ' : '[pendiente] '} ${f}`);
    });
    return;
  }

  if (pending.length === 0) {
    console.log('Sin migraciones pendientes.');
    return;
  }

  console.log(`Aplicando ${pending.length} migración(es):`);
  for (const filename of pending) {
    await applyMigration(filename);
  }
  console.log('Listo.');
};

run()
  .catch((error) => {
    console.error('MIGRATION ERROR:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
