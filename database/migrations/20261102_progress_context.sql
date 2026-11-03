-- ==============================================================================
-- MIGRACIÓN: CONTEXTO DEL PROGRESO (HOGAR / ESCOLAR)
-- Proyecto: Vamos Aprendiendo Web
--
-- Un mismo niño puede jugar en casa (cuenta del tutor) y en el colegio (su cuenta de estudiante). Son ambientes
-- distintos: cada uno lleva su propio progreso, sus ejercicios aprobados y su XP, y no se mezclan.
--   · context = 'hogar'   → actividad registrada desde la cuenta de un tutor o de un adulto.
--   · context = 'escolar' → actividad registrada desde la cuenta de estudiante de un colegio (+ institution_id).
-- El backend decide el contexto según la cuenta autenticada; la app no lo envía.
-- Los registros existentes vienen todos de cuentas de tutor o adulto: quedan como 'hogar' (valor por defecto).
-- Ejecutar DESPUÉS de 20261102_school_groups_and_student_accounts.sql. Idempotente.
-- ==============================================================================

-- 1. Columna de contexto en toda la telemetría, y colegio en los registros escolares
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'trazos', 'exercise_completions', 'xp_ledger', 'progreso_categoria', 'game_sessions',
        'operaciones_resueltas', 'lectoescritura_intentos', 'app_sessions'
    ] LOOP
        EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS context VARCHAR(10) NOT NULL DEFAULT %L', t, 'hogar');
        BEGIN
            EXECUTE format(
                'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (context IN (%L, %L))',
                t, 'chk_' || t || '_context', 'hogar', 'escolar'
            );
        EXCEPTION WHEN duplicate_object THEN NULL;
        END;
    END LOOP;

    FOREACH t IN ARRAY ARRAY['trazos', 'exercise_completions', 'xp_ledger', 'game_sessions', 'app_sessions'] LOOP
        EXECUTE format(
            'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS institution_id UUID REFERENCES public.institutions(id) ON DELETE SET NULL',
            t
        );
    END LOOP;
END $$;

-- 2. Un ejercicio se aprueba (y da XP) una vez por estudiante EN CADA contexto
ALTER TABLE public.exercise_completions DROP CONSTRAINT IF EXISTS uq_completion_owner_exercise;
DO $$ BEGIN
    ALTER TABLE public.exercise_completions
        ADD CONSTRAINT uq_completion_owner_context_exercise UNIQUE (owner_id, context, exercise_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

ALTER TABLE public.xp_ledger DROP CONSTRAINT IF EXISTS uq_xp_owner_source;
DO $$ BEGIN
    ALTER TABLE public.xp_ledger
        ADD CONSTRAINT uq_xp_owner_context_source UNIQUE (owner_id, context, source_type, source_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DROP INDEX IF EXISTS public.idx_xp_ledger_owner;
CREATE INDEX IF NOT EXISTS idx_xp_ledger_owner_context ON public.xp_ledger(owner_id, context, created_at DESC);

-- Consultas del profesor: progreso escolar de un estudiante en un colegio
CREATE INDEX IF NOT EXISTS idx_trazos_school
    ON public.trazos(estudiante_id, institution_id, exercise_id) WHERE context = 'escolar';
CREATE INDEX IF NOT EXISTS idx_completions_school
    ON public.exercise_completions(estudiante_id, institution_id) WHERE context = 'escolar';

-- 3. record_exercise_attempt con contexto. Se elimina la firma anterior para no dejar dos versiones
DROP FUNCTION IF EXISTS public.record_exercise_attempt(UUID, UUID, VARCHAR, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.record_exercise_attempt(
    p_user_id UUID,
    p_student_id UUID,
    p_exercise_id VARCHAR,
    p_client_attempt_id UUID,
    p_payload JSONB,
    p_context VARCHAR DEFAULT 'hogar',
    p_institution_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_owner UUID := COALESCE(p_student_id, p_user_id);
    v_exercise public.exercise_catalog%ROWTYPE;
    v_rule public.reward_rules%ROWTYPE;
    v_existing public.trazos%ROWTYPE;
    v_attempt_id UUID;
    v_attempt_number INT;
    v_coverage NUMERIC := (p_payload->>'coverage')::NUMERIC;
    v_accuracy NUMERIC := (p_payload->>'accuracy')::NUMERIC;
    v_passed BOOLEAN;
    v_completion_id UUID;
    v_xp INT := 0;
    v_prior_xp INT;
    v_total BIGINT;
BEGIN
    IF p_context NOT IN ('hogar', 'escolar') THEN
        RAISE EXCEPTION 'INVALID_CONTEXT' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_exercise FROM public.exercise_catalog WHERE id = p_exercise_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'EXERCISE_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_rule FROM public.reward_rules WHERE rule_key = 'exercise_approved';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'REWARD_RULE_MISSING' USING ERRCODE = 'P0001';
    END IF;

    -- Candado por estudiante, contexto y ejercicio: dos intentos simultáneos no duplican la aprobación ni el XP
    PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::TEXT || '|' || p_context || '|' || p_exercise_id, 0));

    -- Reintento del mismo intento (misma clientAttemptId): se devuelve lo ya registrado
    IF p_client_attempt_id IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.trazos
        WHERE usuario_id = p_user_id AND client_attempt_id = p_client_attempt_id;

        IF FOUND THEN
            SELECT l.xp_amount INTO v_prior_xp
            FROM public.exercise_completions c
            JOIN public.xp_ledger l ON l.completion_id = c.id
            WHERE c.attempt_id = v_existing.id;

            SELECT COALESCE(SUM(xp_amount), 0) INTO v_total
            FROM public.xp_ledger WHERE owner_id = v_owner AND context = p_context;

            RETURN jsonb_build_object(
                'attemptId', v_existing.id,
                'exerciseId', p_exercise_id,
                'passed', v_existing.es_correcto,
                'attemptNumber', v_existing.intentos,
                'duplicate', TRUE,
                'alreadyCompleted', FALSE,
                'awarded', COALESCE(v_prior_xp, 0) > 0,
                'xpAwarded', COALESCE(v_prior_xp, 0),
                'totalXp', v_total
            );
        END IF;
    END IF;

    v_passed := v_coverage >= v_rule.min_coverage AND v_accuracy >= v_rule.min_accuracy;

    SELECT COUNT(*) + 1 INTO v_attempt_number FROM public.trazos
    WHERE exercise_id = p_exercise_id AND usuario_id = p_user_id
      AND estudiante_id IS NOT DISTINCT FROM p_student_id
      AND context = p_context;

    INSERT INTO public.trazos (
        usuario_id, estudiante_id, tipo_elemento, valor_esperado, exercise_id, client_attempt_id,
        puntos_trazo, expected_path, direccion_detectada, rotacion_detectada, precision_pct, tiempo_trazo_seg,
        intentos, es_correcto, desviaciones, coverage_pct, accuracy_pct, start_point_ok, order_ok, off_path_count,
        context, institution_id
    ) VALUES (
        p_user_id, p_student_id, v_exercise.element_type, split_part(v_exercise.glyph_id, '_', 2),
        p_exercise_id, p_client_attempt_id,
        p_payload->'userStrokes', p_payload->'expectedPath',
        NULLIF(p_payload->>'direction', '')::trazo_direccion_enum,
        (p_payload->>'rotationDegrees')::NUMERIC,
        (p_payload->>'precisionPct')::NUMERIC,
        (p_payload->>'durationSeconds')::NUMERIC,
        v_attempt_number, v_passed, p_payload->'deviations',
        ROUND(v_coverage * 100, 2), ROUND(v_accuracy * 100, 2),
        (p_payload->>'startPointOk')::BOOLEAN, (p_payload->>'orderOk')::BOOLEAN,
        (p_payload->>'offPathCount')::INT,
        p_context, p_institution_id
    ) RETURNING id INTO v_attempt_id;

    IF v_passed THEN
        INSERT INTO public.exercise_completions (usuario_id, estudiante_id, exercise_id, attempt_id, context, institution_id)
        VALUES (p_user_id, p_student_id, p_exercise_id, v_attempt_id, p_context, p_institution_id)
        ON CONFLICT (owner_id, context, exercise_id) DO NOTHING
        RETURNING id INTO v_completion_id;

        IF v_completion_id IS NOT NULL AND v_rule.is_active THEN
            v_xp := COALESCE(v_exercise.xp_reward, v_rule.xp_amount);
            INSERT INTO public.xp_ledger (
                usuario_id, estudiante_id, source_type, source_id, rule_key, xp_amount, completion_id,
                context, institution_id
            ) VALUES (
                p_user_id, p_student_id, 'exercise', p_exercise_id, v_rule.rule_key, v_xp, v_completion_id,
                p_context, p_institution_id
            );
        END IF;
    END IF;

    SELECT COALESCE(SUM(xp_amount), 0) INTO v_total
    FROM public.xp_ledger WHERE owner_id = v_owner AND context = p_context;

    RETURN jsonb_build_object(
        'attemptId', v_attempt_id,
        'exerciseId', p_exercise_id,
        'passed', v_passed,
        'attemptNumber', v_attempt_number,
        'duplicate', FALSE,
        'alreadyCompleted', v_passed AND v_completion_id IS NULL,
        'awarded', v_xp > 0,
        'xpAwarded', v_xp,
        'totalXp', v_total
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_exercise_attempt(UUID, UUID, VARCHAR, UUID, JSONB, VARCHAR, UUID) FROM PUBLIC;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION public.record_exercise_attempt(UUID, UUID, VARCHAR, UUID, JSONB, VARCHAR, UUID) TO service_role;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- 4. import_completed_exercises con contexto
DROP FUNCTION IF EXISTS public.import_completed_exercises(UUID, UUID, TEXT[]);

CREATE OR REPLACE FUNCTION public.import_completed_exercises(
    p_user_id UUID,
    p_student_id UUID,
    p_exercise_ids TEXT[],
    p_context VARCHAR DEFAULT 'hogar',
    p_institution_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_owner UUID := COALESCE(p_student_id, p_user_id);
    v_rule public.reward_rules%ROWTYPE;
    v_exercise public.exercise_catalog%ROWTYPE;
    v_id TEXT;
    v_attempt_id UUID;
    v_completion_id UUID;
    v_xp INT;
    v_imported INT := 0;
    v_skipped INT := 0;
    v_unknown INT := 0;
    v_xp_total INT := 0;
    v_total BIGINT;
BEGIN
    IF p_context NOT IN ('hogar', 'escolar') THEN
        RAISE EXCEPTION 'INVALID_CONTEXT' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_rule FROM public.reward_rules WHERE rule_key = 'exercise_imported';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'REWARD_RULE_MISSING' USING ERRCODE = 'P0001';
    END IF;

    -- Orden fijo y sin repetidos: dos importaciones simultáneas no se bloquean entre sí
    FOR v_id IN SELECT DISTINCT unnest(p_exercise_ids) AS id ORDER BY 1 LOOP
        SELECT * INTO v_exercise FROM public.exercise_catalog WHERE id = v_id AND is_active;
        IF NOT FOUND THEN
            v_unknown := v_unknown + 1;
            CONTINUE;
        END IF;

        -- Mismo candado que record_exercise_attempt: no se pisan con un intento que llegue a la vez
        PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::TEXT || '|' || p_context || '|' || v_id, 0));

        IF EXISTS (
            SELECT 1 FROM public.exercise_completions
            WHERE owner_id = v_owner AND context = p_context AND exercise_id = v_id
        ) THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        INSERT INTO public.trazos (
            usuario_id, estudiante_id, tipo_elemento, valor_esperado, exercise_id,
            intentos, es_correcto, source, context, institution_id
        ) VALUES (
            p_user_id, p_student_id, v_exercise.element_type, split_part(v_exercise.glyph_id, '_', 2), v_id,
            1, TRUE, 'import', p_context, p_institution_id
        ) RETURNING id INTO v_attempt_id;

        INSERT INTO public.exercise_completions (usuario_id, estudiante_id, exercise_id, attempt_id, context, institution_id)
        VALUES (p_user_id, p_student_id, v_id, v_attempt_id, p_context, p_institution_id)
        ON CONFLICT (owner_id, context, exercise_id) DO NOTHING
        RETURNING id INTO v_completion_id;

        IF v_completion_id IS NULL THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        v_imported := v_imported + 1;
        IF v_rule.is_active THEN
            v_xp := COALESCE(v_exercise.xp_reward, v_rule.xp_amount);
            INSERT INTO public.xp_ledger (
                usuario_id, estudiante_id, source_type, source_id, rule_key, xp_amount, completion_id,
                context, institution_id
            ) VALUES (
                p_user_id, p_student_id, 'exercise', v_id, v_rule.rule_key, v_xp, v_completion_id,
                p_context, p_institution_id
            );
            v_xp_total := v_xp_total + v_xp;
        END IF;
    END LOOP;

    SELECT COALESCE(SUM(xp_amount), 0) INTO v_total
    FROM public.xp_ledger WHERE owner_id = v_owner AND context = p_context;

    RETURN jsonb_build_object(
        'imported', v_imported,
        'skipped', v_skipped,
        'unknown', v_unknown,
        'xpAwarded', v_xp_total,
        'totalXp', v_total
    );
END;
$$;

REVOKE ALL ON FUNCTION public.import_completed_exercises(UUID, UUID, TEXT[], VARCHAR, UUID) FROM PUBLIC;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION public.import_completed_exercises(UUID, UUID, TEXT[], VARCHAR, UUID) TO service_role;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
