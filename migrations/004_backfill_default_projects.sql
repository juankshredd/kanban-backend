-- Backfill: mete las tareas que ya existen dentro de un proyecto.
--
-- Hasta ahora cada tarea colgaba directo de un usuario, así que se le crea a
-- cada usuario con tareas un proyecto propio del que queda OWNER, y sus tareas
-- se numeran por orden de creación (KAN-1, KAN-2, ...).

-- Sin user_id no hay a quién atribuirle la tarea: se corta acá con un mensaje
-- claro en lugar de fallar más adelante al poner project_id NOT NULL.
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT count(*) INTO orphan_count FROM tasks WHERE user_id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Hay % tarea(s) sin user_id, no se pueden asignar a un proyecto. Resolvelas antes de correr esta migración.',
      orphan_count;
  END IF;
END $$;

-- 1. Un proyecto por usuario con tareas. Keys: KAN, KAN2, KAN3...
WITH owners AS (
  SELECT
    t.user_id,
    ROW_NUMBER() OVER (ORDER BY MIN(t.created_at), t.user_id) AS rn
  FROM tasks t
  WHERE t.project_id IS NULL
  GROUP BY t.user_id
)
INSERT INTO projects (key, name, description, created_by)
SELECT
  'KAN' || CASE WHEN o.rn = 1 THEN '' ELSE o.rn::text END,
  left(u.username, 90) || ' Board',
  'Proyecto creado automáticamente al migrar las tareas existentes.',
  o.user_id
FROM owners o
JOIN users u ON u.id = o.user_id;

-- 2. El creador del proyecto queda como OWNER.
INSERT INTO project_members (project_id, user_id, role)
SELECT p.id, p.created_by, 'OWNER'
FROM projects p
WHERE NOT EXISTS (
  SELECT 1 FROM project_members pm
  WHERE pm.project_id = p.id AND pm.user_id = p.created_by
);

-- 3. Asignar cada tarea a su proyecto y numerarla por orden de creación.
WITH user_project AS (
  SELECT DISTINCT ON (created_by)
    created_by AS user_id,
    id AS project_id
  FROM projects
  ORDER BY created_by, created_at, id
),
numbered AS (
  SELECT
    t.id,
    up.project_id,
    ROW_NUMBER() OVER (PARTITION BY up.project_id ORDER BY t.created_at, t.id) AS ticket_number
  FROM tasks t
  JOIN user_project up ON up.user_id = t.user_id
  WHERE t.project_id IS NULL
)
UPDATE tasks t
SET project_id = n.project_id,
    ticket_number = n.ticket_number
FROM numbered n
WHERE t.id = n.id;

-- 4. Dejar el contador listo para el próximo ticket de cada proyecto.
UPDATE projects p
SET next_ticket_number = COALESCE(m.max_number, 0) + 1
FROM (
  SELECT project_id, MAX(ticket_number) AS max_number
  FROM tasks
  WHERE project_id IS NOT NULL
  GROUP BY project_id
) m
WHERE p.id = m.project_id;
