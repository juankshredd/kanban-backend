-- Backfill: mete los proyectos que ya existen dentro de una company.
--
-- Se crea una única company "devTest" con el usuario f8f66cfa-... (juanDev)
-- como OWNER, y se agregan como MEMBER todos los usuarios que ya son
-- miembros de algún proyecto, para no perderles acceso cuando se filtre por
-- company. Después se apunta cada proyecto existente a esta company.
--
-- Guardado detrás de un IF: en una base nueva (CI, un dev recién clonado) no
-- existe ese usuario ni hay proyectos sin company, así que esto no hace nada
-- en vez de romper por la FK de company_members.user_id.

DO $$
DECLARE
  owner_id uuid := 'f8f66cfa-9068-4d82-8941-fb1b4a4e2ad3';
  new_company_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = owner_id)
     AND EXISTS (SELECT 1 FROM projects WHERE company_id IS NULL) THEN

    INSERT INTO companies (name, description, created_by)
    VALUES ('devTest', 'Company creada automáticamente para agrupar los proyectos existentes.', owner_id)
    RETURNING id INTO new_company_id;

    INSERT INTO company_members (company_id, user_id, role)
    VALUES (new_company_id, owner_id, 'OWNER');

    -- Todo usuario que ya sea miembro de algún proyecto entra como MEMBER,
    -- para no perder acceso a lo que ya tenía cuando se filtre por company.
    INSERT INTO company_members (company_id, user_id, role)
    SELECT DISTINCT new_company_id, pm.user_id, 'MEMBER'
    FROM project_members pm
    WHERE pm.user_id <> owner_id;

    UPDATE projects SET company_id = new_company_id WHERE company_id IS NULL;

  END IF;
END $$;
