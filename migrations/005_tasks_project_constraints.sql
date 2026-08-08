-- Protege la unicidad del ticket id ya con los datos migrados.
--
-- Ojo: project_id y ticket_number quedan nullable a propósito. El controller de
-- tareas todavía no los escribe, así que ponerlos NOT NULL acá rompería la
-- creación de tareas. El SET NOT NULL va en una migración posterior, junto con
-- el cambio de controller que siempre asigna proyecto (expand / contract).
--
-- La constraint UNIQUE no molesta mientras tanto: en Postgres los NULL no
-- colisionan entre sí, así que las filas nuevas sin proyecto no se bloquean.

-- El ticket id visible (KAN-42) tiene que ser único dentro del proyecto.
ALTER TABLE tasks
  ADD CONSTRAINT tasks_project_ticket_unique UNIQUE (project_id, ticket_number);

-- Todo listado de tareas filtra primero por proyecto.
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);
