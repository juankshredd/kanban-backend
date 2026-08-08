-- Sprints: lo que separa "Backlog" (sprint_id NULL) de "Current Sprint"
-- (el sprint del proyecto en status ACTIVE) dentro de un mismo board.

DO $$ BEGIN
  CREATE TYPE sprint_status AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS sprints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        varchar(100) NOT NULL,
  goal        text,
  status      sprint_status NOT NULL DEFAULT 'PLANNED',
  start_date  date,
  end_date    date,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

-- Nunca dos sprints activos a la vez en el mismo proyecto. Un índice único
-- parcial hace cumplir esto sin necesitar un chequeo aparte antes del UPDATE:
-- si ya hay uno ACTIVE, el segundo intento choca solo.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_sprint_per_project
  ON sprints(project_id) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_sprints_project_id ON sprints(project_id);

-- NULL = Backlog. ON DELETE SET NULL: borrar un sprint devuelve sus tareas al
-- backlog en vez de bloquear el borrado o arrastrarlas a un DELETE en cascada.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS sprint_id uuid REFERENCES sprints(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_project_sprint ON tasks(project_id, sprint_id);
