-- ==============================================================================
-- MIGRACIÓN: PROTECCIÓN DE DATOS PERSONALES (LEY 1581 DE 2012)
-- Proyecto: Vamos Aprendiendo Web
-- Spec 0004. Prueba de las autorizaciones, solicitudes de los titulares (consultas y reclamos),
-- registro de auditoría del super administrador (spec 0003) y supresión limitada al ecosistema del titular.
-- Idempotente.
-- ==============================================================================

-- 1. Autorizaciones: filas inmutables; un cambio (otorgar o revocar) agrega una fila nueva
CREATE TABLE IF NOT EXISTS public.privacy_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    -- Menor al que se refiere la autorización (datos de menores); se conserva la prueba aunque el menor se borre
    student_id UUID NULL REFERENCES public.students(id) ON DELETE SET NULL,
    consent_type VARCHAR(30) NOT NULL
        CHECK (consent_type IN ('tratamiento_datos', 'datos_menores', 'datos_sensibles')),
    granted BOOLEAN NOT NULL,
    policy_version VARCHAR(20) NOT NULL,
    ip_address VARCHAR(64),
    user_agent VARCHAR(300),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_privacy_consents_profile
    ON public.privacy_consents(profile_id, consent_type, created_at DESC);

-- 2. Solicitudes de los titulares (consultas: 10 días hábiles; reclamos: 15 días hábiles)
CREATE TABLE IF NOT EXISTS public.data_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    student_id UUID NULL REFERENCES public.students(id) ON DELETE SET NULL,
    request_type VARCHAR(30) NOT NULL
        CHECK (request_type IN ('consulta', 'actualizacion', 'rectificacion', 'supresion', 'revocatoria', 'prueba_autorizacion')),
    description TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'radicada'
        CHECK (status IN ('radicada', 'en_tramite', 'resuelta', 'rechazada')),
    due_at TIMESTAMP WITH TIME ZONE NOT NULL,
    response TEXT,
    resolved_by UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Una sola solicitud abierta por titular, tipo y menor (el menor nulo cuenta como un valor)
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_requests_open
    ON public.data_requests(profile_id, request_type, COALESCE(student_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE status IN ('radicada', 'en_tramite');
CREATE INDEX IF NOT EXISTS idx_data_requests_status ON public.data_requests(status, due_at);

-- 3. Auditoría de las acciones del super administrador (spec 0003, SA-ROLE-04)
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_profile_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
    action VARCHAR(30) NOT NULL,
    entity_type VARCHAR(40) NOT NULL,
    entity_id UUID NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON public.admin_audit_log(created_at DESC);

-- 4. Solo el backend (service_role) accede
ALTER TABLE public.privacy_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- 5. Supresión de los datos de un titular, limitada a SU ecosistema (spec 0003 D-7, spec 0004 PD-D3 y PD-D4).
--    · p_student_id dado: borra los datos de ese menor en el ecosistema del titular y el vínculo entre los dos.
--    · p_student_id nulo: lo anterior para todos sus menores + sus datos propios + anonimiza y desactiva el perfil.
--    Un menor se borra solo si queda sin tutores, sin matrícula activa y sin cuenta propia.
--    Las licencias se conservan (soporte contable); el perfil anonimizado ya no identifica al titular.
--    El acceso al usuario de Auth lo cierra el backend (cambio de correo, contraseña y bloqueo).
CREATE OR REPLACE FUNCTION public.suppress_titular_data(p_profile_id UUID, p_student_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_role TEXT;
    v_students UUID[];
    v_student UUID;
    v_deleted UUID[] := ARRAY[]::UUID[];
    v_unlinked UUID[] := ARRAY[]::UUID[];
BEGIN
    SELECT role::TEXT INTO v_role FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'TITULAR_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
    -- Profesores, estudiantes y administradores: los datos escolares los responde el colegio (PD-D5)
    IF v_role NOT IN ('usuario', 'test') THEN
        RAISE EXCEPTION 'TITULAR_NOT_SUPPORTED' USING ERRCODE = 'P0001';
    END IF;

    IF p_student_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.tutor_students WHERE tutor_profile_id = p_profile_id AND student_id = p_student_id) THEN
            RAISE EXCEPTION 'STUDENT_NOT_LINKED' USING ERRCODE = 'P0002';
        END IF;
        v_students := ARRAY[p_student_id];
    ELSE
        SELECT COALESCE(array_agg(student_id), ARRAY[]::UUID[]) INTO v_students
        FROM public.tutor_students WHERE tutor_profile_id = p_profile_id;
    END IF;

    -- Datos de hogar del titular: con un menor, solo los de ese menor; sin menor, todos (incluidos los propios del adulto).
    -- Orden por llaves foráneas: xp_ledger → exercise_completions → trazos → intentos → game_sessions
    DELETE FROM public.xp_ledger
        WHERE usuario_id = p_profile_id AND (p_student_id IS NULL OR estudiante_id = p_student_id);
    DELETE FROM public.exercise_completions
        WHERE usuario_id = p_profile_id AND (p_student_id IS NULL OR estudiante_id = p_student_id);
    DELETE FROM public.trazos
        WHERE usuario_id = p_profile_id AND (p_student_id IS NULL OR estudiante_id = p_student_id);
    DELETE FROM public.operaciones_resueltas
        WHERE usuario_id = p_profile_id AND (p_student_id IS NULL OR estudiante_id = p_student_id);
    DELETE FROM public.lectoescritura_intentos
        WHERE usuario_id = p_profile_id AND (p_student_id IS NULL OR estudiante_id = p_student_id);
    DELETE FROM public.game_sessions
        WHERE usuario_id = p_profile_id AND (p_student_id IS NULL OR estudiante_id = p_student_id);
    DELETE FROM public.progreso_categoria
        WHERE usuario_id = p_profile_id AND (p_student_id IS NULL OR estudiante_id = p_student_id);
    DELETE FROM public.dashboard_config
        WHERE usuario_id = p_profile_id AND (p_student_id IS NULL OR estudiante_id = p_student_id);
    DELETE FROM public.app_sessions
        WHERE user_id = p_profile_id AND (p_student_id IS NULL OR student_id = p_student_id);
    DELETE FROM public.initial_assessments
        WHERE evaluator_profile_id = p_profile_id AND (p_student_id IS NULL OR student_id = p_student_id);

    -- Vínculos con los menores y borrado de los que quedan sin nadie que los respalde
    FOREACH v_student IN ARRAY v_students LOOP
        DELETE FROM public.tutor_students WHERE tutor_profile_id = p_profile_id AND student_id = v_student;

        IF NOT EXISTS (SELECT 1 FROM public.tutor_students WHERE student_id = v_student)
           AND NOT EXISTS (SELECT 1 FROM public.student_enrollments WHERE student_id = v_student AND is_active)
           AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE student_id = v_student) THEN
            DELETE FROM public.students WHERE id = v_student;
            v_deleted := v_deleted || v_student;
        ELSE
            v_unlinked := v_unlinked || v_student;
        END IF;
    END LOOP;

    -- Supresión total: anonimizar y desactivar el perfil (los tutores no se borran, spec 0003 D-6)
    IF p_student_id IS NULL THEN
        DELETE FROM public.refresh_tokens WHERE user_id = p_profile_id;
        DELETE FROM public.user_presence WHERE user_id = p_profile_id;

        UPDATE public.profiles SET
            first_name = 'Titular',
            last_name = 'suprimido',
            -- document_number es único y de máximo 30 caracteres: 'SUP-' + 26 caracteres del id
            document_number = 'SUP-' || left(replace(p_profile_id::TEXT, '-', ''), 26),
            phone = '0000000000',
            email = 'suprimido-' || p_profile_id::TEXT || '@supresion.invalid',
            is_active = FALSE,
            updated_at = NOW()
        WHERE id = p_profile_id;
    END IF;

    RETURN jsonb_build_object(
        'deletedStudents', to_jsonb(v_deleted),
        'unlinkedStudents', to_jsonb(v_unlinked),
        'anonymized', p_student_id IS NULL
    );
END;
$$;

REVOKE ALL ON FUNCTION public.suppress_titular_data(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suppress_titular_data(UUID, UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
