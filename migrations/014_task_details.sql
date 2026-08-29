-- Campos propios de cada tipo de tarjeta (steps to reproduce/expected/actual
-- behavior en un BUG, acceptance_criteria en un STORY, etc.), guardados como
-- JSON en vez de una columna por campo: la lista de campos válidos por tipo
-- vive en el controller (TASK_DETAIL_FIELDS), así agregar un campo o un tipo
-- nuevo no pide migración.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;
