-- ==============================================================================
-- MIGRACIÓN: GESTIÓN INTEGRAL DE INSTITUCIONES, PROFESORES, LICENCIAS Y EVALUACIONES
-- Proyecto: Vamos Aprendiendo Web
-- ==============================================================================

-- 1. Crear Tipos Enumerados
DO $$ BEGIN
    CREATE TYPE institution_type_enum AS ENUM ('publico', 'privado');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE license_plan_enum AS ENUM ('free', 'trial', 'pro');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE license_origin_enum AS ENUM ('personal', 'institucional');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE assessment_target_enum AS ENUM ('nino', 'adulto');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Adaptar tabla 'institutions'
ALTER TABLE public.institutions
    ADD COLUMN IF NOT EXISTS nit VARCHAR(50),
    ADD COLUMN IF NOT EXISTS type institution_type_enum NOT NULL DEFAULT 'privado',
    ADD COLUMN IF NOT EXISTS city VARCHAR(100) DEFAULT 'Bogotá D.C.',
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE NULL;

-- 3. Tabla de Pre-autorización de Profesores por Institución
CREATE TABLE IF NOT EXISTS public.institution_preauth_teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
    document_number VARCHAR(50) NOT NULL,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(150),
    is_registered BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_institution_preauth UNIQUE (institution_id, document_number)
);

CREATE INDEX IF NOT EXISTS idx_preauth_query ON public.institution_preauth_teachers(institution_id, document_number, email);

-- 4. Tabla de Profesores
CREATE TABLE IF NOT EXISTS public.teachers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    professional_license VARCHAR(100),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Tabla intermedia: Profesor ↔ Institución (M:N)
CREATE TABLE IF NOT EXISTS public.teacher_institutions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
    institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_teacher_institution UNIQUE (teacher_id, institution_id)
);

-- 6. Tabla de Grados por Profesor
CREATE TABLE IF NOT EXISTS public.teacher_grades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
    institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
    grade VARCHAR(50) NOT NULL,
    academic_year INT NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_teacher_grade_year UNIQUE (teacher_id, institution_id, grade, academic_year)
);

-- 7. Historial de Matrícula: Estudiante ↔ Institución
CREATE TABLE IF NOT EXISTS public.student_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE RESTRICT,
    grade VARCHAR(50) NOT NULL,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_enrollments_student_active ON public.student_enrollments(student_id, is_active);

-- 8. Relación M:N Profesor ↔ Estudiante
CREATE TABLE IF NOT EXISTS public.teacher_students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_teacher_student UNIQUE (teacher_id, student_id, institution_id)
);

-- 9. Relación Tutor ↔ Estudiante (Hijo / Tutelado)
CREATE TABLE IF NOT EXISTS public.tutor_students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tutor_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    relationship VARCHAR(50) NOT NULL DEFAULT 'padre',
    is_primary_tutor BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_tutor_student UNIQUE (tutor_profile_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_tutor_students ON public.tutor_students(tutor_profile_id, student_id);

-- 10. Sistema de Licencias (Free, Trial 14d, Pro Personal / Institucional)
CREATE TABLE IF NOT EXISTS public.licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_type license_plan_enum NOT NULL DEFAULT 'free',
    origin license_origin_enum NOT NULL DEFAULT 'personal',
    owner_profile_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    institution_id UUID NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
    student_id UUID NULL REFERENCES public.students(id) ON DELETE CASCADE,
    starts_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_licenses_lookup ON public.licenses(owner_profile_id, student_id, is_active, expires_at);

-- 11. Evaluaciones Diagnósticas Iniciales (Cribado ≤ 10 preguntas)
CREATE TABLE IF NOT EXISTS public.initial_assessments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    evaluator_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    student_id UUID NULL REFERENCES public.students(id) ON DELETE CASCADE,
    target_type assessment_target_enum NOT NULL,
    total_score INT NOT NULL,
    max_score INT NOT NULL DEFAULT 40,
    risk_level VARCHAR(50) NOT NULL, -- 'bajo', 'moderado', 'alto'
    primary_condition VARCHAR(100) NULL, -- 'dislexia', 'discalculia', 'tdah', 'memoria', 'preventivo'
    answers JSONB NOT NULL,
    recommendations TEXT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessments_evaluator ON public.initial_assessments(evaluator_profile_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assessments_student ON public.initial_assessments(student_id, created_at);

-- 12. Datos Semilla Iniciales (Instituciones y Docentes Pre-autorizados)
INSERT INTO public.institutions (id, name, nit, type, city, address, phone, email, is_active)
VALUES 
    ('11111111-1111-1111-1111-111111111111', 'Colegio Distrital República de Colombia', '899999001-1', 'publico', 'Bogotá D.C.', 'Calle 68 # 24-50', '6013456789', 'rectoria@republicacolombia.edu.co', TRUE),
    ('22222222-2222-2222-2222-222222222222', 'Gimnasio Los Laureles Bilingüe', '900123456-7', 'privado', 'Medellín', 'Carrera 43A # 12 Sur-20', '6044567890', 'admin@loslaureles.edu.co', TRUE),
    ('33333333-3333-3333-3333-333333333333', 'Institución Educativa Técnica San Juan', '890203401-3', 'publico', 'Cali', 'Avenida 4N # 32-15', '6025678901', 'contacto@sanjuan.edu.co', TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.institution_preauth_teachers (institution_id, document_number, email, full_name, is_registered)
VALUES
    ('11111111-1111-1111-1111-111111111111', '1020304050', 'carlos.mendoza@republicacolombia.edu.co', 'Carlos Mendoza', FALSE),
    ('22222222-2222-2222-2222-222222222222', '9876543210', 'laura.gomez@loslaureles.edu.co', 'Laura Gómez', FALSE),
    ('33333333-3333-3333-3333-333333333333', '1122334455', 'profesor@vamosaprendiendo.edu', 'Profesor Demo', FALSE)
ON CONFLICT (institution_id, document_number) DO NOTHING;
