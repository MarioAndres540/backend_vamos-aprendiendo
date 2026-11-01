-- ==============================================================================
-- MIGRACIÓN: INTENTOS DE EJERCICIOS, RUTAS DE APRENDIZAJE Y EXPERIENCIA (XP)
-- Proyecto: Vamos Aprendiendo Web
--
-- Qué agrega:
--   · learning_routes / exercise_catalog: rutas (Matemáticas, Escritura) y el catálogo de ejercicios de Unity,
--     con un id único por ejercicio (ej. 'escritura.lo_a'), para calcular completados / en progreso / pendientes.
--   · reward_rules: regla de aprobación y XP, configurable sin cambiar código.
--   · trazos (existente): se REUTILIZA como registro de intentos. Se le agregan columnas (ejercicio, id de
--     idempotencia, cobertura, exactitud, punto de inicio, orden, trayectoria esperada) y se relajan los NOT NULL
--     que obligaban a inventar valores (session_id, precisión, tiempo, dirección) mientras Unity no los envíe.
--   · exercise_completions: un ejercicio aprobado por estudiante (índice único = sin duplicados).
--   · xp_ledger: libro de experiencia; una fila por recompensa (índice único = sin XP duplicado).
--   · record_exercise_attempt(): guarda el intento, el ejercicio aprobado y el XP en UNA transacción, con candado
--     por (estudiante, ejercicio) para que peticiones simultáneas no dupliquen nada.
--
-- Los niveles NO se implementan aquí: se calcularán después a partir de SUM(xp_ledger.xp_amount).
-- ==============================================================================

-- 1. Rutas de aprendizaje -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learning_routes (
    id VARCHAR(30) PRIMARY KEY,                 -- 'matematicas', 'escritura'
    name VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.learning_routes (id, name, sort_order)
VALUES ('matematicas', 'Matemáticas', 1), ('escritura', 'Escritura', 2)
ON CONFLICT (id) DO NOTHING;

-- 2. Catálogo de ejercicios -----------------------------------------------------
-- glyph_id es la clave de progreso que ya usa Unity (TraceGlyph.Id): 'd_7', 'lo_a', 'up_A'.
CREATE TABLE IF NOT EXISTS public.exercise_catalog (
    id VARCHAR(80) PRIMARY KEY,                 -- '<ruta>.<glyph_id>', ej. 'escritura.lo_a'
    route_id VARCHAR(30) NOT NULL REFERENCES public.learning_routes(id) ON DELETE CASCADE,
    element_type trazo_tipo_enum NOT NULL,      -- 'numero' | 'letra'
    glyph_id VARCHAR(20) NOT NULL,
    label VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    -- Solo los ejercicios activos cuentan como "disponibles" (pendientes). Se activan cuando Unity los habilita.
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    -- XP propio del ejercicio; NULL = usa el de reward_rules
    xp_reward INT NULL CHECK (xp_reward IS NULL OR xp_reward >= 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_exercise_route_glyph UNIQUE (route_id, glyph_id)
);

CREATE INDEX IF NOT EXISTS idx_exercise_catalog_route ON public.exercise_catalog(route_id, sort_order);

-- Matemáticas: números del 0 al 9 (TraceCatalog.Digits)
INSERT INTO public.exercise_catalog (id, route_id, element_type, glyph_id, label, sort_order)
SELECT 'matematicas.d_' || n, 'matematicas', 'numero', 'd_' || n, 'El número ' || n, n
FROM generate_series(0, 9) AS n
ON CONFLICT (id) DO NOTHING;

-- Escritura: vocales en mayúscula y minúscula (TraceCatalog.Vowels) — 10 ejercicios activos
INSERT INTO public.exercise_catalog (id, route_id, element_type, glyph_id, label, sort_order)
SELECT 'escritura.up_' || v, 'escritura', 'letra', 'up_' || v, 'Letra ' || v || ' (mayúscula)', (i - 1) * 2 + 1
FROM unnest(ARRAY['A', 'E', 'I', 'O', 'U']) WITH ORDINALITY AS t(v, i)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.exercise_catalog (id, route_id, element_type, glyph_id, label, sort_order)
SELECT 'escritura.lo_' || lower(v), 'escritura', 'letra', 'lo_' || lower(v), 'Letra ' || lower(v) || ' (minúscula)', (i - 1) * 2 + 2
FROM unnest(ARRAY['A', 'E', 'I', 'O', 'U']) WITH ORDINALITY AS t(v, i)
ON CONFLICT (id) DO NOTHING;

-- Escritura: consonantes. Existen en el catálogo de Unity pero la tarjeta "Consonantes" aún está bloqueada
-- ("Próximamente"), así que quedan INACTIVAS: no cuentan como pendientes. Activarlas: UPDATE ... SET is_active = TRUE.
INSERT INTO public.exercise_catalog (id, route_id, element_type, glyph_id, label, sort_order, is_active)
SELECT 'escritura.up_' || c, 'escritura', 'letra', 'up_' || c, 'Letra ' || c || ' (mayúscula)', 100 + (i - 1) * 2 + 1, FALSE
FROM unnest(ARRAY['B','C','D','F','G','H','J','K','L','M','N','Ñ','P','Q','R','S','T','V','W','X','Y','Z']) WITH ORDINALITY AS t(c, i)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.exercise_catalog (id, route_id, element_type, glyph_id, label, sort_order, is_active)
SELECT 'escritura.lo_' || lower(c), 'escritura', 'letra', 'lo_' || lower(c), 'Letra ' || lower(c) || ' (minúscula)', 100 + (i - 1) * 2 + 2, FALSE
FROM unnest(ARRAY['B','C','D','F','G','H','J','K','L','M','N','Ñ','P','Q','R','S','T','V','W','X','Y','Z']) WITH ORDINALITY AS t(c, i)
ON CONFLICT (id) DO NOTHING;

-- 3. Reglas de recompensa (configurables) ---------------------------------------
-- Cobertura y exactitud son fracciones 0..1, igual que TraceValidator de Unity (MinCoverage 0.85, MinAccuracy 0.97).
CREATE TABLE IF NOT EXISTS public.reward_rules (
    rule_key VARCHAR(50) PRIMARY KEY,
    description TEXT,
    xp_amount INT NOT NULL CHECK (xp_amount >= 0),
    min_coverage NUMERIC(4, 3) NOT NULL CHECK (min_coverage BETWEEN 0 AND 1),
    min_accuracy NUMERIC(4, 3) NOT NULL CHECK (min_accuracy BETWEEN 0 AND 1),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

INSERT INTO public.reward_rules (rule_key, description, xp_amount, min_coverage, min_accuracy)
VALUES ('exercise_approved', 'Letra o número trazado correctamente (una sola vez por ejercicio y estudiante)', 10, 0.85, 0.97)
ON CONFLICT (rule_key) DO NOTHING;

-- 4. Registro de intentos: se reutiliza 'trazos' --------------------------------
-- Sin datos reales de Unity todavía (nunca se ha escrito en esta tabla), así que relajar las restricciones es seguro.
ALTER TABLE public.trazos ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE public.trazos ALTER COLUMN puntos_trazo DROP NOT NULL;
ALTER TABLE public.trazos ALTER COLUMN direccion_detectada DROP NOT NULL;
ALTER TABLE public.trazos ALTER COLUMN direccion_detectada DROP DEFAULT;
ALTER TABLE public.trazos ALTER COLUMN rotacion_detectada DROP NOT NULL;
ALTER TABLE public.trazos ALTER COLUMN rotacion_detectada DROP DEFAULT;
ALTER TABLE public.trazos ALTER COLUMN precision_pct DROP NOT NULL;
ALTER TABLE public.trazos ALTER COLUMN precision_pct DROP DEFAULT;
ALTER TABLE public.trazos ALTER COLUMN tiempo_trazo_seg DROP NOT NULL;
ALTER TABLE public.trazos ALTER COLUMN tiempo_trazo_seg DROP DEFAULT;

ALTER TABLE public.trazos
    ADD COLUMN IF NOT EXISTS exercise_id VARCHAR(80) REFERENCES public.exercise_catalog(id),
    -- Id que genera Unity por intento: si la petición se repite (reintento por red) no se duplica
    ADD COLUMN IF NOT EXISTS client_attempt_id UUID,
    ADD COLUMN IF NOT EXISTS coverage_pct NUMERIC(5, 2),   -- cobertura 0..100 (la plantilla que quedó cubierta)
    ADD COLUMN IF NOT EXISTS accuracy_pct NUMERIC(5, 2),   -- exactitud 0..100 (el trazo que cayó sobre la plantilla)
    ADD COLUMN IF NOT EXISTS start_point_ok BOOLEAN,       -- ¿empezó en el punto 1?
    ADD COLUMN IF NOT EXISTS order_ok BOOLEAN,             -- ¿respetó el orden de los trazos?
    ADD COLUMN IF NOT EXISTS expected_path JSONB,          -- trayectoria esperada (plantilla)
    ADD COLUMN IF NOT EXISTS off_path_count INT;           -- veces que se salió de la línea

CREATE UNIQUE INDEX IF NOT EXISTS uq_trazos_client_attempt
    ON public.trazos(usuario_id, client_attempt_id) WHERE client_attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trazos_exercise
    ON public.trazos(usuario_id, estudiante_id, exercise_id) WHERE exercise_id IS NOT NULL;

-- 5. Ejercicios aprobados -------------------------------------------------------
-- owner_id = el estudiante (tutor) o, si no hay estudiante, la propia cuenta (adulto / tester).
CREATE TABLE IF NOT EXISTS public.exercise_completions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    estudiante_id UUID NULL REFERENCES public.students(id) ON DELETE CASCADE,
    owner_id UUID GENERATED ALWAYS AS (COALESCE(estudiante_id, usuario_id)) STORED,
    exercise_id VARCHAR(80) NOT NULL REFERENCES public.exercise_catalog(id),
    attempt_id UUID NOT NULL REFERENCES public.trazos(id) ON DELETE CASCADE,
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_completion_owner_exercise UNIQUE (owner_id, exercise_id)
);

-- 6. Libro de experiencia (XP) --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.xp_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    estudiante_id UUID NULL REFERENCES public.students(id) ON DELETE CASCADE,
    owner_id UUID GENERATED ALWAYS AS (COALESCE(estudiante_id, usuario_id)) STORED,
    source_type VARCHAR(30) NOT NULL DEFAULT 'exercise',
    source_id VARCHAR(80) NOT NULL,                       -- id del ejercicio
    rule_key VARCHAR(50) NOT NULL REFERENCES public.reward_rules(rule_key),
    xp_amount INT NOT NULL CHECK (xp_amount >= 0),
    completion_id UUID NULL REFERENCES public.exercise_completions(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_xp_owner_source UNIQUE (owner_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_xp_ledger_owner ON public.xp_ledger(owner_id, created_at DESC);

-- 7. Registro atómico de un intento + recompensa --------------------------------
-- Lo llama el backend con la clave de servicio (ya verificó que el estudiante es del tutor autenticado).
-- p_payload (jsonb): coverage y accuracy (0..1, obligatorios) y opcionales: durationSeconds, precisionPct,
--   startPointOk, orderOk, direction, rotationDegrees, offPathCount, expectedPath, userStrokes, deviations.
CREATE OR REPLACE FUNCTION public.record_exercise_attempt(
    p_user_id UUID,
    p_student_id UUID,
    p_exercise_id VARCHAR,
    p_client_attempt_id UUID,
    p_payload JSONB
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
    SELECT * INTO v_exercise FROM public.exercise_catalog WHERE id = p_exercise_id AND is_active;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'EXERCISE_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_rule FROM public.reward_rules WHERE rule_key = 'exercise_approved';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'REWARD_RULE_MISSING' USING ERRCODE = 'P0001';
    END IF;

    -- Un solo proceso a la vez por (estudiante, ejercicio): el número de intento y la recompensa no se pisan
    PERFORM pg_advisory_xact_lock(hashtextextended(v_owner::TEXT || '|' || p_exercise_id, 0));

    -- Reenvío de un intento ya guardado (ej. Unity reintentó por falta de red): se responde lo mismo, sin repetir nada
    IF p_client_attempt_id IS NOT NULL THEN
        SELECT * INTO v_existing FROM public.trazos
        WHERE usuario_id = p_user_id AND client_attempt_id = p_client_attempt_id;

        IF FOUND THEN
            SELECT l.xp_amount INTO v_prior_xp
            FROM public.exercise_completions c
            JOIN public.xp_ledger l ON l.completion_id = c.id
            WHERE c.attempt_id = v_existing.id;

            SELECT COALESCE(SUM(xp_amount), 0) INTO v_total FROM public.xp_ledger WHERE owner_id = v_owner;

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

    -- Aprobado = cobertura y exactitud mínimas (reward_rules). El cliente no decide si aprobó.
    v_passed := v_coverage >= v_rule.min_coverage AND v_accuracy >= v_rule.min_accuracy;

    SELECT COUNT(*) + 1 INTO v_attempt_number FROM public.trazos
    WHERE exercise_id = p_exercise_id AND usuario_id = p_user_id
      AND estudiante_id IS NOT DISTINCT FROM p_student_id;

    INSERT INTO public.trazos (
        usuario_id, estudiante_id, tipo_elemento, valor_esperado, exercise_id, client_attempt_id,
        puntos_trazo, expected_path, direccion_detectada, rotacion_detectada, precision_pct, tiempo_trazo_seg,
        intentos, es_correcto, desviaciones, coverage_pct, accuracy_pct, start_point_ok, order_ok, off_path_count
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
        (p_payload->>'offPathCount')::INT
    ) RETURNING id INTO v_attempt_id;

    IF v_passed THEN
        -- Si ya estaba aprobado, el índice único hace que no se inserte nada (y por tanto no hay XP)
        INSERT INTO public.exercise_completions (usuario_id, estudiante_id, exercise_id, attempt_id)
        VALUES (p_user_id, p_student_id, p_exercise_id, v_attempt_id)
        ON CONFLICT (owner_id, exercise_id) DO NOTHING
        RETURNING id INTO v_completion_id;

        IF v_completion_id IS NOT NULL AND v_rule.is_active THEN
            v_xp := COALESCE(v_exercise.xp_reward, v_rule.xp_amount);
            INSERT INTO public.xp_ledger (usuario_id, estudiante_id, source_type, source_id, rule_key, xp_amount, completion_id)
            VALUES (p_user_id, p_student_id, 'exercise', p_exercise_id, v_rule.rule_key, v_xp, v_completion_id);
        END IF;
    END IF;

    SELECT COALESCE(SUM(xp_amount), 0) INTO v_total FROM public.xp_ledger WHERE owner_id = v_owner;

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

-- Solo el backend (clave de servicio) puede ejecutarla
REVOKE ALL ON FUNCTION public.record_exercise_attempt(UUID, UUID, VARCHAR, UUID, JSONB) FROM PUBLIC;
DO $$ BEGIN
    GRANT EXECUTE ON FUNCTION public.record_exercise_attempt(UUID, UUID, VARCHAR, UUID, JSONB) TO service_role;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Refrescar la caché de esquema de PostgREST
NOTIFY pgrst, 'reload schema';
