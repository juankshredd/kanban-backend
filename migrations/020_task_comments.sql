-- Comentarios por tarea (seccion "Activity" del modal de detalle). Mismo shape
-- que retrospective_notes: autor via FK, sin identidad fuera de la tarea (CASCADE).
-- Las @menciones son solo texto plano dentro de content -- el resaltado es un
-- regex del frontend, no hace falta parsear/validar nada aca.

CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES users(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON task_comments(task_id);
