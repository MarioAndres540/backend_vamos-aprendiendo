-- La experiencia (XP) se entrega al abrir el cofre en el juego, no al aprobar el ejercicio.
--
-- Aprobar un ejercicio sigue registrando su fila en xp_ledger (con su XP), pero queda "por cobrar": claimed_at = NULL.
-- Cuando el jugador toca el cofre, la app llama a POST /telemetry/xp/claim y esas filas pasan a "cobradas".
-- GET /telemetry/xp (y el dashboard) suman solo lo cobrado; lo por cobrar se informa aparte (pendingXp).
--
-- No hay relleno de lo anterior: las filas que ya existen quedan por cobrar y la app vuelve a declarar como cobrado lo que
-- el jugador ya había cobrado en el cofre (lo guarda en el dispositivo) la próxima vez que abre el juego.
-- Si prefieres que todo lo anterior cuente ya como cobrado, ejecuta (una sola vez):
--   UPDATE public.xp_ledger SET claimed_at = created_at WHERE claimed_at IS NULL;
-- Idempotente. Aplicar en el SQL Editor de Supabase.

ALTER TABLE public.xp_ledger
    ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP WITH TIME ZONE NULL;

CREATE INDEX IF NOT EXISTS idx_xp_ledger_owner_claimed
    ON public.xp_ledger (owner_id, context, claimed_at);
