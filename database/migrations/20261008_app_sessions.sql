-- ==============================================================================
-- MIGRACIÓN: SESIONES DE USO DE LA APP (UNITY) PARA EL DASHBOARD DEL TUTOR
-- Proyecto: Vamos Aprendiendo Web
--
-- Cada vez que la app de Unity se abre con la cuenta del tutor (o del adulto) se crea una fila.
-- La app envía un "latido" (heartbeat) periódico; si deja de enviarlo, el backend cierra la sesión
-- por inactividad. Con esto el tutor ve en el dashboard: si la app está conectada, desde qué hora
-- y cuánto tiempo lleva, o cuándo se desconectó y cuánto duró la última sesión.
--
-- Reemplaza a 'user_presence' (una sola fila por usuario), que no soporta varios dispositivos
-- ni guarda historial. 'user_presence' se conserva pero deja de usarse.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.app_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Cuenta con la que se ingresó (tutor o adulto)
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    -- Hijo que está jugando (opcional: cuenta de tutor con varios hijos)
    student_id UUID NULL REFERENCES public.students(id) ON DELETE SET NULL,
    -- Cliente que abrió la sesión
    client VARCHAR(20) NOT NULL DEFAULT 'unity' CHECK (client IN ('unity', 'web')),
    device_info VARCHAR(255) NULL,
    app_version VARCHAR(50) NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    last_heartbeat_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE NULL,
    -- 'app_closed': la app avisó el cierre · 'logout': el usuario cerró sesión
    -- 'timeout': la app dejó de enviar latidos (cierre forzado, sin red, batería...)
    end_reason VARCHAR(20) NULL CHECK (end_reason IN ('app_closed', 'logout', 'timeout')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Consultas del dashboard: últimas sesiones de un usuario por cliente
CREATE INDEX IF NOT EXISTS idx_app_sessions_user_client_started
    ON public.app_sessions(user_id, client, started_at DESC);

-- Sesiones abiertas (para detectar conexión activa y cerrar las inactivas)
CREATE INDEX IF NOT EXISTS idx_app_sessions_open
    ON public.app_sessions(user_id, client)
    WHERE ended_at IS NULL;

-- Refrescar la caché de esquema de PostgREST
NOTIFY pgrst, 'reload schema';
