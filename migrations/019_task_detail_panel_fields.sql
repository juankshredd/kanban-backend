-- Campos que necesita el panel de detalle del modal de ticket estilo Jira:
-- assignee (distinto de tasks.user_id, que ya es el reporter/creador), points,
-- labels de texto libre (sin catalogo, ver CLAUDE.md), y quien hizo el ultimo
-- cambio (updated_at ya existia pero sin quien).

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS points INTEGER,
  ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_id ON tasks(assignee_id);
