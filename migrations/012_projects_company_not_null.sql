-- Contract step: a partir de acá todo proyecto vive dentro de una company.
-- Si quedó alguno sin company es porque el backfill (011) no corrió sobre
-- estos datos (base nueva sin el usuario esperado, o datos legacy no
-- previstos): se corta con un mensaje claro en vez de fallar más adelante con
-- un error genérico del ALTER, mismo estilo que 006_tasks_project_not_null.

DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count FROM projects WHERE company_id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Quedan % proyecto(s) sin company. Asignalos a mano antes de correr esta migración.',
      orphan_count;
  END IF;
END $$;

ALTER TABLE projects ALTER COLUMN company_id SET NOT NULL;
