-- ==============================================================================
-- MIGRACIÓN: IMPORTAR LOS EJERCICIOS YA COMPLETADOS EN EL DISPOSITIVO (UNITY)
-- Proyecto: Vamos Aprendiendo Web
--
-- Antes de 20261031, Unity guardaba "completado" solo en el dispositivo (PlayerPrefs) y nunca lo enviaba. Esos
-- ejercicios no tienen cobertura ni exactitud, así que no pueden pasar por record_exercise_attempt. Esta migración
-- permite declararlos una sola vez, de forma EXPLÍCITA y trazable:
--   · trazos.source = 'import' distingue estos registros de los intentos reales (source = 'game').
--   · Sin cobertura, exactitud ni precisión: quedan NULL (no se inventan).
--   · El XP sale de la regla propia 'exercise_imported' (por defecto 10, igual que un ejercicio aprobado). Para que lo
--     importado no dé XP:  UPDATE reward_rules SET is_active = FALSE WHERE rule_key = 'exercise_imported';
--   · La app lo declara (el backend no puede comprobarlo): es la misma confianza que ya existe con la cobertura y la
--     exactitud que envía la app.
-- Es idempotente: un ejercicio que ya está aprobado se omite (sin duplicar nada ni XP).
-- ==============================================================================

ALTER TABLE public.trazos
    ADD COLUMN IF NOT EXISTS source VARCHAR(10) NOT NULL DEFAULT 'game';

DO $$ BEGIN
    ALTER TABLE public.trazos ADD CONSTRAINT chk_trazos_source CHECK (source IN ('game', 'import'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO public.reward_rules (rule_key, description, xp_amount, min_coverage, min_accuracy)
VALUES ('exercise_imported', 'Ejercicio que el dispositivo ya tenía completado antes de enviarse al backend (importado)', 10, 0, 0)
ON CONFLICT (rule_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.import_completed_exercises(
    p_user_id UUID,
    p_student_id UUID,
    p_exercise_ids TEXT[]
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
        PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::TEXT || '|' || v_id, 0));

        IF EXISTS (SELECT 1 FROM public.exercise_completions WHERE owner_id = v_owner AND exercise_id = v_id) THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        INSERT INTO public.trazos (
            usuario_id, estudiante_id, tipo_elemento, valor_esperado, exercise_id,
            intentos, es_correcto, source
        ) VALUES (
            p_user_id, p_student_id, v_exercise.element_type, split_part(v_exercise.glyph_id, '_', 2), v_id,
            1, TRUE, 'import'
        ) RETURNING id INTO v_attempt_id;

        INSERT INTO public.exercise_completions (usuario_id, estudiante_id, exercise_id, attempt_id)
        VALUES (p_user_id, p_student_id, v_id, v_attempt_id)
        ON CONFLICT (owner_id, exercise_id) DO NOTHING
        RETURNING id INTO v_completion_id;

        IF v_completion_id IS NULL THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END IF;

        v_imported := v_imported + 1;
        IF v_rule.is_active THEN
            v_xp := COALESCE(v_exercise.xp_reward, v_rule.xp_amount);
            INSERT INTO public.xp_ledger (usuario_id, estudiante_id, source_type, source_id, rule_key, xp_amount, completion_id)
            VALUES (p_user_id, p_student_id, 'exercise', v_id, v_rule.rule_key, v_xp, v_completion_id);
            v_xp_total := v_xp_total + v_xp;
        END IF;
    END LOOP;

    SELECT COALESCE(SUM(xp_amount), 0) INTO v_total FROM public.xp_ledger WHERE owner_id = v_owner;

    RETURN jsonb_build_object(
        'imported', v_imported,
        'skipped', v_skipped,
        'unknown', v_unknown,
        'xpAwarded', v_xp_total,
        'totalXp', v_total
    );
END;
$$;

REVOKE ALL ON FUNCTION public.import_completed_exercises(UUID, UUID, TEXT[]) FROM PUBLIC;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION public.import_completed_exercises(UUID, UUID, TEXT[]) TO service_role;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

NOTIFY pgrst, 'reload schema';
