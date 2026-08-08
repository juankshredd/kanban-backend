-- Cuelga las tareas del proyecto y les da un número de ticket.
--
-- Las columnas entran nullable a propósito: las filas que ya existen se
-- completan en 004 y recién en 005 pasan a NOT NULL. Así la migración se puede
-- aplicar sobre una base con datos sin quedar a medias.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS ticket_number integer;
