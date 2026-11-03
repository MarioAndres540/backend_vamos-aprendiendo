-- ==============================================================================
-- MIGRACIÓN: REGISTRO DE ACCESO A DATOS PERSONALES DE ESTUDIANTES
-- Proyecto: Vamos Aprendiendo Web
-- Spec 0001 (TACC-04): cada consulta del detalle de un estudiante (datos personales de un menor) queda registrada:
-- quién la hizo, qué estudiante, desde qué asignación y cuándo. Ley 1581 de 2012 (datos de menores).
-- Idempotente.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.data_access_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    assignment_id UUID NULL REFERENCES public.teacher_assignments(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,              -- 'teacher_student_detail'
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_access_log_student ON public.data_access_log(student_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_access_log_actor ON public.data_access_log(actor_profile_id, created_at DESC);

-- Solo el backend (service_role) escribe y lee el registro
ALTER TABLE public.data_access_log ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
