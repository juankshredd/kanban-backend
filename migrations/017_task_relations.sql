-- Segundo tipo de relación entre tareas, distinto de la jerarquía parent_id
-- (016_task_parent_id.sql): "related to" es simétrica (A-B es lo mismo que
-- B-A), sin restricción de tipo, y multivaluada (una tarea puede tener N
-- relaciones), así que no encaja como columna en tasks -- necesita su propia
-- tabla N:M, igual que project_members/company_members.

-- created_by es NOT NULL (igual que projects.created_by y
-- retrospective_notes.author_id): cada relación tiene que tener un autor
-- identificable.
CREATE TABLE IF NOT EXISTS task_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  related_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ON DELETE CASCADE (a diferencia de parent_id, que es RESTRICT): un link
-- "related to" es una referencia liviana, no una relación de contención, así
-- que borrar cualquiera de las dos tareas no debería bloquearse -- el link
-- simplemente desaparece con ella.

DO $$ BEGIN
  ALTER TABLE task_relations ADD CONSTRAINT task_relations_not_self CHECK (task_id <> related_task_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Relación simétrica: (A,B) y (B,A) son el mismo vínculo, así que el índice
-- único va sobre el par sin orden (LEAST/GREATEST), no sobre las columnas
-- crudas -- si no, ambas direcciones se podrían insertar como si fueran
-- relaciones distintas. Mismo truco que one_active_sprint_per_project: la
-- carrera la resuelve el índice (23505 -> 409), no un check-then-write.
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_relations_unique_pair
  ON task_relations (LEAST(task_id, related_task_id), GREATEST(task_id, related_task_id));

CREATE INDEX IF NOT EXISTS idx_task_relations_task_id ON task_relations(task_id);
CREATE INDEX IF NOT EXISTS idx_task_relations_related_task_id ON task_relations(related_task_id);
