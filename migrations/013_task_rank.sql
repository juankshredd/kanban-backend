-- Orden manual de tareas (drag-and-drop) dentro de un proyecto: un único
-- `rank` global por proyecto, no uno por sprint. El Board (tareas de un
-- sprint) y cada sección del Backlog (tareas de otro sprint, o sin sprint)
-- son la misma secuencia global filtrada por sprint_id, así que el orden
-- relativo ya sale correcto en cualquier vista filtrada, sin duplicar rank
-- por contexto.
--
-- numeric (no float) para poder insertar entre dos vecinos promediando
-- ((a+b)/2) sin perder precisión aunque se reordene muchas veces seguidas.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rank numeric;

UPDATE tasks t
SET rank = sub.seq * 1000
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at) AS seq
  FROM tasks
) sub
WHERE t.id = sub.id AND t.rank IS NULL;

ALTER TABLE tasks ALTER COLUMN rank SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_board_order ON tasks(project_id, sprint_id, rank);
