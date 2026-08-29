-- Jerarquía de tarjetas: EPIC -> FEATURE -> STORY -> TASK/BUG, un solo nivel
-- de padre por tarea (parent_id), validado en el controller contra
-- TASK_PARENT_TYPE (qué tipo de padre admite cada tipo). Sin ON DELETE
-- explícito: por defecto RESTRICT, así borrar una tarea con hijos falla con
-- una violación de FK en vez de cascadear o dejar hijos huérfanos en
-- silencio (deleteTask la traduce a 409).

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES tasks(id);

DO $$ BEGIN
  ALTER TABLE tasks ADD CONSTRAINT tasks_parent_not_self CHECK (parent_id IS NULL OR parent_id != id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id);
