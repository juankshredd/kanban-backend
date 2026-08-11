-- Expand step: cada proyecto va a vivir dentro de una company. Arranca
-- nullable a propósito porque ya hay proyectos creados; el backfill (011) y
-- el NOT NULL (012) cierran el expand/contract, mismo patrón que se usó para
-- tasks.project_id en 003/004/006.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_projects_company_id ON projects(company_id);
