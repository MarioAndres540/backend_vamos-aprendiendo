-- ==============================================================================
-- MIGRACIÓN: TELEMETRÍA UNITY, PATRONES COGNITIVOS Y DASHBOARDS DINÁMICOS
-- Proyecto: Vamos Aprendiendo Web
-- ==============================================================================

-- 1. Tipos Enumerados para Telemetría y Trazos
DO $$ BEGIN
    CREATE TYPE trazo_tipo_enum AS ENUM ('numero', 'letra', 'palabra', 'frase', 'operacion');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE trazo_direccion_enum AS ENUM ('arriba_abajo', 'abajo_arriba', 'izq_der', 'der_izq', 'mixto_atipico');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE game_session_status_enum AS ENUM ('activa', 'completada', 'timeout', 'cancelada');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Categorías Cognitivas del Sistema
CREATE TABLE IF NOT EXISTS public.categorias_cognitivas (
    id VARCHAR(50) PRIMARY KEY, -- 'memoria', 'atencion', 'concentracion', 'lectoescritura', 'logica_matematica', 'motricidad_fina', 'control_impulsos'
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Rangos de Desarrollo por Edad (Baremos Normativos)
CREATE TABLE IF NOT EXISTS public.rangos_desarrollo (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    edad_min INT NOT NULL,
    edad_max INT NOT NULL,
    area VARCHAR(50) NOT NULL, -- 'numeros', 'letras', 'operaciones', 'motricidad'
    metrica VARCHAR(50) NOT NULL, -- 'tiempo_trazo_seg', 'precision_pct', 'pausas_permitidas', 'impulsividad_max'
    valor_esperado_min NUMERIC NOT NULL,
    valor_esperado_max NUMERIC NOT NULL,
    tiempo_esperado_seg INT NOT NULL,
    tolerancia NUMERIC DEFAULT 0.15,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_rango_edad_area_metrica UNIQUE (edad_min, edad_max, area, metrica)
);

-- 4. Progreso Acumulado por Categoría
CREATE TABLE IF NOT EXISTS public.progreso_categoria (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    estudiante_id UUID NULL REFERENCES public.students(id) ON DELETE CASCADE,
    categoria_id VARCHAR(50) NOT NULL REFERENCES public.categorias_cognitivas(id) ON DELETE CASCADE,
    puntaje_inicial NUMERIC NOT NULL DEFAULT 0,
    puntaje_actual NUMERIC NOT NULL DEFAULT 0,
    meta NUMERIC NOT NULL DEFAULT 100,
    nivel_actual INT NOT NULL DEFAULT 1,
    observaciones JSONB NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_usuario_estudiante_categoria UNIQUE (usuario_id, estudiante_id, categoria_id)
);

-- 5. Configuración de Dashboards Dinámicos
CREATE TABLE IF NOT EXISTS public.dashboard_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    estudiante_id UUID NULL REFERENCES public.students(id) ON DELETE CASCADE,
    perfil VARCHAR(100) NOT NULL DEFAULT 'estandar', -- 'niño_hiperactividad_concentracion', 'adulto_memoria_preventivo', etc.
    widgets JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_dashboard_usuario_estudiante UNIQUE (usuario_id, estudiante_id)
);

-- 6. Sesiones de Juego Unity
CREATE TABLE IF NOT EXISTS public.game_sessions (
    id VARCHAR(100) PRIMARY KEY, -- 'sess_abc123'
    usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    estudiante_id UUID NULL REFERENCES public.students(id) ON DELETE CASCADE,
    device_id VARCHAR(100),
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE NULL,
    last_heartbeat_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    duration_seconds INT NOT NULL DEFAULT 0,
    status game_session_status_enum NOT NULL DEFAULT 'activa',
    ip VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_sessions_status ON public.game_sessions(status, last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_game_sessions_user_student ON public.game_sessions(usuario_id, estudiante_id, started_at);

-- 7. Eventos Durante la Sesión de Juego
CREATE TABLE IF NOT EXISTS public.game_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
    tipo VARCHAR(50) NOT NULL, -- 'nivel_iniciado', 'nivel_completado', 'error_patron', 'pausa_larga', 'acierto'
    categoria VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_game_events_session ON public.game_events(session_id, timestamp);

-- 8. Trazos Cinemáticos y Motores (Números y Letras)
CREATE TABLE IF NOT EXISTS public.trazos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
    usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    estudiante_id UUID NULL REFERENCES public.students(id) ON DELETE CASCADE,
    tipo_elemento trazo_tipo_enum NOT NULL,
    valor_esperado VARCHAR(50) NOT NULL, -- '6', 'A', 'suma_3+2'
    puntos_trazo JSONB NOT NULL, -- [{"x":10, "y":200, "t":0}, ...]
    direccion_detectada trazo_direccion_enum NOT NULL DEFAULT 'arriba_abajo',
    rotacion_detectada NUMERIC NOT NULL DEFAULT 0, -- Grados (ej. 180° = al revés)
    precision_pct NUMERIC NOT NULL DEFAULT 0,
    tiempo_trazo_seg NUMERIC NOT NULL DEFAULT 0,
    intentos INT NOT NULL DEFAULT 1,
    es_correcto BOOLEAN NOT NULL DEFAULT FALSE,
    desviaciones JSONB NULL, -- {"alerta": "Escribe de abajo hacia arriba y gira el 6", "patron_atipico": true}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trazos_lookup ON public.trazos(usuario_id, estudiante_id, created_at);
CREATE INDEX IF NOT EXISTS idx_trazos_session ON public.trazos(session_id);

-- 9. Operaciones Matemáticas Resueltas en Unity
CREATE TABLE IF NOT EXISTS public.operaciones_resueltas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
    usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    estudiante_id UUID NULL REFERENCES public.students(id) ON DELETE CASCADE,
    tipo_operacion VARCHAR(30) NOT NULL, -- 'suma', 'resta', 'multiplicacion', 'division'
    operandos JSONB NOT NULL, -- [3, 2]
    resultado_esperado NUMERIC NOT NULL,
    resultado_dado NUMERIC NOT NULL,
    tiempo_seg NUMERIC NOT NULL,
    correcto BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operaciones_lookup ON public.operaciones_resueltas(usuario_id, estudiante_id, tipo_operacion);

-- 10. Intentos de Lectoescritura
CREATE TABLE IF NOT EXISTS public.lectoescritura_intentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(100) NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
    usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    estudiante_id UUID NULL REFERENCES public.students(id) ON DELETE CASCADE,
    tipo VARCHAR(30) NOT NULL, -- 'letra', 'palabra', 'frase'
    esperado TEXT NOT NULL,
    dado TEXT NOT NULL,
    tiempo_seg NUMERIC NOT NULL,
    precision_pct NUMERIC NOT NULL DEFAULT 0,
    correcto BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lectoescritura_lookup ON public.lectoescritura_intentos(usuario_id, estudiante_id, tipo);

-- 11. Poblado Inicial de Categorías Cognitivas y Rangos de Desarrollo
INSERT INTO public.categorias_cognitivas (id, nombre, descripcion)
VALUES
    ('atencion', 'Atención Sostenida', 'Capacidad de mantener el foco en la tarea sin distracciones.'),
    ('concentracion', 'Concentración y Enfoque', 'Control de pausas e inactividad en la resolución de actividades.'),
    ('control_impulsos', 'Control de Impulsividad', 'Tasa de toques rápidos y ejecución reflexiva.'),
    ('motricidad_fina', 'Coordinación Visomotriz y Trazado', 'Direccionalidad, rotación y precisión del trazo de letras y números.'),
    ('logica_matematica', 'Sentido Numérico y Operaciones', 'Resolución fluida de sumas, restas y secuencias numéricas.'),
    ('lectoescritura', 'Lectoescritura y Fluidez Verbal', 'Formación de letras, palabras y comprensión de frases.'),
    ('memoria', 'Memoria de Trabajo y Evocación', 'Retención de secuencias, instrucciones y memoria reciente.')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.rangos_desarrollo (edad_min, edad_max, area, metrica, valor_esperado_min, valor_esperado_max, tiempo_esperado_seg, tolerancia)
VALUES
    -- 4 a 6 años
    (4, 6, 'numeros', 'precision_pct', 70, 100, 8, 0.20),
    (4, 6, 'numeros', 'tiempo_trazo_seg', 4, 10, 6, 0.25),
    (4, 6, 'letras', 'precision_pct', 65, 100, 10, 0.20),
    (4, 6, 'operaciones', 'tiempo_trazo_seg', 5, 12, 8, 0.30),
    -- 7 a 9 años (Edad clave caso canónico hiperactividad)
    (7, 9, 'numeros', 'precision_pct', 85, 100, 5, 0.15),
    (7, 9, 'numeros', 'tiempo_trazo_seg', 2, 6, 4, 0.15),
    (7, 9, 'letras', 'precision_pct', 80, 100, 6, 0.15),
    (7, 9, 'operaciones', 'tiempo_trazo_seg', 3, 8, 5, 0.20),
    -- 10 a 12 años
    (10, 12, 'numeros', 'precision_pct', 90, 100, 3, 0.10),
    (10, 12, 'numeros', 'tiempo_trazo_seg', 1.5, 4, 2.5, 0.10),
    (10, 12, 'letras', 'precision_pct', 88, 100, 4, 0.10),
    (10, 12, 'operaciones', 'tiempo_trazo_seg', 2, 5, 3, 0.15),
    -- 18 a 99 años (Adultos y Seniors)
    (18, 99, 'numeros', 'precision_pct', 90, 100, 3, 0.10),
    (18, 99, 'letras', 'precision_pct', 90, 100, 4, 0.10),
    (18, 99, 'operaciones', 'tiempo_trazo_seg', 2, 6, 4, 0.15)
ON CONFLICT (edad_min, edad_max, area, metrica) DO NOTHING;
