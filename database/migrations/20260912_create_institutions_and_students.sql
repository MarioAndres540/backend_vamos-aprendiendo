-- ==============================================================================
    -- MIGRACIÓN: CREACIÓN DE TABLAS 'institutions', 'students' Y VÍNCULO EN 'profiles'
    -- Proyecto: Vamos Aprendiendo Web
    -- ==============================================================================

    -- 1. Crear tabla de Instituciones Educativas
    CREATE TABLE IF NOT EXISTS public.institutions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        code VARCHAR(50) UNIQUE, -- Código DANE o identificador institucional
        address TEXT,
        phone VARCHAR(50),
        email VARCHAR(255),
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- 2. Agregar clave foránea institution_id a public.profiles
    ALTER TABLE public.profiles
        ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES public.institutions(id) ON DELETE SET NULL;

    -- Índice para optimizar búsquedas de perfiles por institución
    CREATE INDEX IF NOT EXISTS idx_profiles_institution_id ON public.profiles(institution_id);

    -- 3. Crear tabla de Estudiantes (Alumnos vinculados a la institución y a un profesor)
    CREATE TABLE IF NOT EXISTS public.students (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE,
        teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        document_type VARCHAR(20) DEFAULT 'TI',
        document_number VARCHAR(50),
        grade VARCHAR(50) NOT NULL, -- Grado o curso (ej: 'Transición', '1° Primaria')
        birth_date DATE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    -- Índices para optimizar consultas de estudiantes
    CREATE INDEX IF NOT EXISTS idx_students_institution_id ON public.students(institution_id);
    CREATE INDEX IF NOT EXISTS idx_students_teacher_id ON public.students(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_students_is_active ON public.students(is_active);

    -- 4. Triggers para auto-actualizar 'updated_at' (reutilizando la función de migración previa)
    DROP TRIGGER IF EXISTS trigger_institutions_updated_at ON public.institutions;
    CREATE TRIGGER trigger_institutions_updated_at
        BEFORE UPDATE ON public.institutions
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();

    DROP TRIGGER IF EXISTS trigger_students_updated_at ON public.students;
    CREATE TRIGGER trigger_students_updated_at
        BEFORE UPDATE ON public.students
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();

    -- ==============================================================================
    -- SCRIPT DE PRUEBA / INSERCIÓN INICIAL (Ejecutar en el SQL Editor de Supabase si deseas probar):
    --
    -- INSERT INTO public.institutions (id, name, code, address, email)
    -- VALUES ('a0000000-0000-0000-0000-000000000001', 'Colegio San José', 'DANE-101', 'Calle 10 # 5-20', 'rectoria@sanjose.edu.co')
    -- ON CONFLICT (id) DO NOTHING;
    --
    -- UPDATE public.profiles
    -- SET institution_id = 'a0000000-0000-0000-0000-000000000001'
    -- WHERE email = 'tu_correo_profesor@ejemplo.com';
    -- ==============================================================================