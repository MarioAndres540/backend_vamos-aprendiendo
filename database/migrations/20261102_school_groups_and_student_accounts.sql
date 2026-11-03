-- ==============================================================================
-- MIGRACIÓN: GRUPOS, MATERIAS, ASIGNACIONES DE PROFESORES Y CUENTAS DE ESTUDIANTE
-- Proyecto: Vamos Aprendiendo Web
-- Fase 1 del análisis "Perfil de profesor": el profesor ve solo los estudiantes de los grupos y materias
-- que tiene asignados, y cada alumno de un colegio puede tener su propia cuenta (rol 'estudiante').
-- Ejecutar DESPUÉS de 20261102_add_estudiante_role.sql. Idempotente.
-- ==============================================================================

-- 1. Materias (catálogo global) y su relación con las rutas de aprendizaje del juego
CREATE TABLE IF NOT EXISTS public.subjects (
    id VARCHAR(30) PRIMARY KEY,                 -- 'espanol', 'matematicas'
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.subjects (id, name)
VALUES ('espanol', 'Español'), ('matematicas', 'Matemáticas')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.subject_routes (
    subject_id VARCHAR(30) NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
    route_id VARCHAR(30) NOT NULL REFERENCES public.learning_routes(id) ON DELETE CASCADE,
    PRIMARY KEY (subject_id, route_id)
);

INSERT INTO public.subject_routes (subject_id, route_id)
VALUES ('espanol', 'escritura'), ('matematicas', 'matematicas')
ON CONFLICT DO NOTHING;

-- 2. Grupos o secciones de un colegio por año lectivo (ej. 2A de 2° Primaria en 2026)
CREATE TABLE IF NOT EXISTS public.class_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
    academic_year INT NOT NULL,
    grade VARCHAR(50) NOT NULL,
    name VARCHAR(20) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_class_group UNIQUE (institution_id, academic_year, name)
);

-- 3. Asignación académica: profesor + grupo + materia. Define qué estudiantes y qué progreso ve el profesor
CREATE TABLE IF NOT EXISTS public.teacher_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
    class_group_id UUID NOT NULL REFERENCES public.class_groups(id) ON DELETE CASCADE,
    subject_id VARCHAR(30) NOT NULL REFERENCES public.subjects(id),
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Una misma asignación activa no se repite; al cerrarla (is_active = false) queda en el historial
CREATE UNIQUE INDEX IF NOT EXISTS uq_teacher_assignment_active
    ON public.teacher_assignments(teacher_id, class_group_id, subject_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher ON public.teacher_assignments(teacher_id, is_active);

-- 4. La matrícula apunta al grupo, y un estudiante tiene como máximo una matrícula activa
ALTER TABLE public.student_enrollments
    ADD COLUMN IF NOT EXISTS class_group_id UUID REFERENCES public.class_groups(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_student_active_enrollment
    ON public.student_enrollments(student_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_enrollments_group_active ON public.student_enrollments(class_group_id, is_active);

-- 5. Cuenta propia del estudiante: el perfil con rol 'estudiante' apunta a su registro en 'students'
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS student_id UUID UNIQUE REFERENCES public.students(id) ON DELETE SET NULL;

-- Las cuentas eran solo de adultos (edad >= 18); la del estudiante lleva la edad real del niño
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_age_check;
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_age_check CHECK (age >= 18 OR (role = 'estudiante' AND age BETWEEN 3 AND 17));

-- 6. Solo el backend (service_role) accede a las tablas nuevas
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subject_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
