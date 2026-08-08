-- Retrospective: notas libres ligadas a un sprint, agrupadas en las tres
-- columnas clásicas de una retro (qué salió bien / qué mejorar / acción a
-- tomar). A diferencia de tasks, una nota de retro no tiene identidad propia
-- fuera del sprint: por eso el borrado es en cascada y no ON DELETE SET NULL.

DO $$ BEGIN
  CREATE TYPE retro_category AS ENUM ('WENT_WELL', 'TO_IMPROVE', 'ACTION_ITEM');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS retrospective_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sprint_id   uuid NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id),
  category    retro_category NOT NULL,
  content     text NOT NULL,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_retro_notes_sprint_id ON retrospective_notes(sprint_id);
