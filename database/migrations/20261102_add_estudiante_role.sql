-- ==============================================================================
-- MIGRACIÓN: ROL 'estudiante' (cuenta propia del alumno de un colegio)
-- Proyecto: Vamos Aprendiendo Web
-- Va en un archivo aparte: un valor nuevo de un ENUM no se puede usar en la misma transacción que lo crea.
-- Ejecutar ANTES de 20261102_school_groups_and_student_accounts.sql
-- ==============================================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'estudiante';
