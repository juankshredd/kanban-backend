-- Nuevo tipo de tarjeta: FEATURE, entre EPIC y STORY en la jerarquía
-- (ver 016_task_parent_id.sql). Separado en su propia migración porque
-- agregar un valor a un ENUM es más seguro aislado de otros DDL.

ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'FEATURE';
