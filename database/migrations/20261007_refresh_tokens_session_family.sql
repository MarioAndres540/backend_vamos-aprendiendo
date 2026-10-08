-- ==============================================================================
-- MIGRACIÓN: SESIONES INDEPENDIENTES POR DISPOSITIVO EN 'refresh_tokens'
-- Proyecto: Vamos Aprendiendo Web
--
-- Una misma cuenta (tutor o adulto) puede estar abierta a la vez en la app de Unity y en la web.
-- 'session_id' agrupa los refresh tokens de una misma sesión (un dispositivo): al rotar el token
-- se conserva el session_id, y si se detecta la reutilización de un token se revoca solo esa sesión,
-- sin cerrar las demás.
-- ==============================================================================

-- 1. Identificador de la sesión (familia de tokens)
ALTER TABLE public.refresh_tokens
    ADD COLUMN IF NOT EXISTS session_id UUID;

-- 2. Tokens existentes: cada uno queda como su propia sesión
UPDATE public.refresh_tokens
SET session_id = id
WHERE session_id IS NULL;

-- 3. Índices para revocar una sesión y buscar tokens por usuario
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session_id ON public.refresh_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON public.refresh_tokens(user_id);

-- 4. Refrescar la caché de esquema de PostgREST
NOTIFY pgrst, 'reload schema';
