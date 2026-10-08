-- ==============================================================================
-- MIGRACIÓN: AJUSTE DE 'students' PARA EL REGISTRO DE HIJOS DESDE EL TUTOR
-- Proyecto: Vamos Aprendiendo Web
-- Ejecutar DESPUÉS de las migraciones 20261001_*.
-- ==============================================================================

-- 1. Edad del estudiante (se calcula en el frontend a partir de la fecha de nacimiento)
ALTER TABLE public.students
    ADD COLUMN IF NOT EXISTS age INTEGER CHECK (age BETWEEN 3 AND 17);

-- 2. Un hijo registrado por su tutor puede no tener colegio asignado (la matrícula vive en
--    'student_enrollments'), ni grado definido al momento del registro
ALTER TABLE public.students
    ALTER COLUMN institution_id DROP NOT NULL,
    ALTER COLUMN grade DROP NOT NULL;

-- 3. Refrescar la caché de esquema de PostgREST para que la API vea los cambios de inmediato
NOTIFY pgrst, 'reload schema';
