-- Companies: contenedor por encima de los proyectos. Una company agrupa
-- varios proyectos; quién puede administrarla y crear proyectos dentro se
-- define acá, igual que project_members define lo mismo un nivel abajo.

CREATE TABLE IF NOT EXISTS companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        varchar(100) NOT NULL,
  description text,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

-- Mismos roles que project_role: OWNER administra la company (rename, borrar,
-- gestionar miembros); MEMBER puede crear proyectos dentro de ella.
DO $$ BEGIN
  CREATE TYPE company_role AS ENUM ('OWNER', 'MEMBER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS company_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        company_role NOT NULL DEFAULT 'MEMBER',
  created_at  timestamp NOT NULL DEFAULT now(),
  CONSTRAINT company_members_unique UNIQUE (company_id, user_id)
);

-- Listar "mis companies" arranca siempre por user_id.
CREATE INDEX IF NOT EXISTS idx_company_members_user_id
  ON company_members(user_id);
