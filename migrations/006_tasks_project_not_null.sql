-- Cierra el modelo: a partir de acá toda tarea vive dentro de un proyecto.
--
-- La parte "contract" del expand/contract arrancado en 003. Corre junto con el
-- cambio de taskController que siempre asigna proyecto y número de ticket, así
-- que ya no hay forma de crear filas incompletas.

-- Puede haber quedado alguna tarea sin proyecto, creada por el endpoint viejo
-- entre el backfill (004) y este cambio: se asigna al proyecto más antiguo del
-- usuario, numerada a partir del contador de ese proyecto.
WITH user_project AS (
  SELECT DISTINCT ON (pm.user_id)
    pm.user_id,
    p.id AS project_id
  FROM project_members pm
  JOIN projects p ON p.id = pm.project_id
  ORDER BY pm.user_id, p.created_at, p.id
),
orphans AS (
  SELECT
    t.id,
    up.project_id,
    ROW_NUMBER() OVER (PARTITION BY up.project_id ORDER BY t.created_at, t.id) AS seq
  FROM tasks t
  JOIN user_project up ON up.user_id = t.user_id
  WHERE t.project_id IS NULL
),
assigned AS (
  UPDATE tasks t
  SET project_id = o.project_id,
      ticket_number = p.next_ticket_number + o.seq - 1
  FROM orphans o
  JOIN projects p ON p.id = o.project_id
  WHERE t.id = o.id
  RETURNING t.project_id, t.ticket_number
)
UPDATE projects p
SET next_ticket_number = sub.max_number + 1
FROM (
  SELECT project_id, MAX(ticket_number) AS max_number
  FROM assigned
  GROUP BY project_id
) sub
WHERE p.id = sub.project_id;

-- Si todavía queda alguna sin proyecto es porque su usuario no es miembro de
-- ninguno: se corta con un mensaje claro en vez de fallar en el ALTER.
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count FROM tasks WHERE project_id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Quedan % tarea(s) sin proyecto cuyo usuario no pertenece a ninguno. Asignalas a mano antes de correr esta migración.',
      orphan_count;
  END IF;
END $$;

ALTER TABLE tasks ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE tasks ALTER COLUMN ticket_number SET NOT NULL;
