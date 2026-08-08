-- Esquema base (users + tasks).
--
-- Estas tablas ya existían en la base de datos, creadas a mano antes de que el
-- repo tuviera migraciones. Se documentan acá con IF NOT EXISTS para que una
-- base nueva se pueda levantar desde cero: sobre la base actual no hace nada.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE task_status AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username       varchar(100) NOT NULL,
  email          varchar(150) NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  created_at     timestamp DEFAULT now(),
  is_active      boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        varchar(200) NOT NULL,
  description  text,
  status       task_status DEFAULT 'TODO',
  user_id      uuid REFERENCES users(id),
  created_at   timestamp DEFAULT now(),
  updated_at   timestamp DEFAULT now()
);
