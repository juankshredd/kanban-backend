-- Proyectos: contenedor raíz del board, backlog, sprints y retrospectivas.
--
-- `key` es el prefijo del ticket id visible (ej. "KAN" -> KAN-42) y por eso es
-- único a nivel global y de formato acotado.
--
-- `next_ticket_number` es el contador de tickets del proyecto. Se incrementa de
-- forma atómica al crear una tarea (UPDATE ... RETURNING) en vez de calcular
-- MAX(ticket_number)+1, que se pisaría entre usuarios concurrentes.

CREATE TABLE IF NOT EXISTS projects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                 varchar(10) NOT NULL UNIQUE,
  name                varchar(100) NOT NULL,
  description         text,
  created_by          uuid NOT NULL REFERENCES users(id),
  next_ticket_number  integer NOT NULL DEFAULT 1,
  created_at          timestamp NOT NULL DEFAULT now(),
  updated_at          timestamp NOT NULL DEFAULT now(),
  CONSTRAINT projects_key_format CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$')
);

-- Membresía: quién puede ver y operar cada proyecto.
-- OWNER puede editar/borrar el proyecto y gestionar miembros; MEMBER trabaja
-- sobre el contenido (tareas, sprints, retro).
DO $$ BEGIN
  CREATE TYPE project_role AS ENUM ('OWNER', 'MEMBER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS project_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        project_role NOT NULL DEFAULT 'MEMBER',
  created_at  timestamp NOT NULL DEFAULT now(),
  CONSTRAINT project_members_unique UNIQUE (project_id, user_id)
);

-- Listar "mis proyectos" arranca siempre por user_id.
CREATE INDEX IF NOT EXISTS idx_project_members_user_id
  ON project_members(user_id);
