-- Segundo tipo de link ademas de RELATED_TO (017_task_relations.sql): el modal de
-- detalle de ticket necesita blocks/is blocked by/duplicates/clones, ademas de
-- relates to. RELATED_TO sigue siendo simetrico; BLOCKS/DUPLICATES/CLONES son
-- direccionales -- quien crea el link elige un lado, el inverso se resuelve al
-- leer (ver taskRelationController.js), no se guarda dos veces.

DO $$ BEGIN
  CREATE TYPE task_relation_type AS ENUM ('RELATED_TO', 'BLOCKS', 'DUPLICATES', 'CLONES');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE task_relations
  ADD COLUMN IF NOT EXISTS relation_type task_relation_type NOT NULL DEFAULT 'RELATED_TO';

DROP INDEX IF EXISTS idx_task_relations_unique_pair;

-- RELATED_TO sigue siendo simetrico -> unico por par sin orden (LEAST/GREATEST).
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_relations_symmetric_unique
  ON task_relations (relation_type, LEAST(task_id, related_task_id), GREATEST(task_id, related_task_id))
  WHERE relation_type = 'RELATED_TO';

-- BLOCKS/DUPLICATES/CLONES son direccionales -> unico por (tipo, orden exacto), no
-- por par sin orden: task1 BLOCKS task2 y task2 BLOCKS task1 son links distintos y
-- ambos validos (a diferencia de RELATED_TO, donde son el mismo vinculo).
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_relations_directional_unique
  ON task_relations (relation_type, task_id, related_task_id)
  WHERE relation_type <> 'RELATED_TO';
