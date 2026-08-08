-- Tipo de tarjeta: Epic / Story / Task / Bug, con Story por defecto.
--
-- Ya se había aplicado a mano sobre la base local; queda versionada acá para
-- que una base nueva llegue al mismo estado.

DO $$ BEGIN
  CREATE TYPE task_type AS ENUM ('EPIC', 'STORY', 'TASK', 'BUG');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS type task_type NOT NULL DEFAULT 'STORY';
