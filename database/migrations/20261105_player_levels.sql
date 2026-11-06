-- Nivel del jugador (nivel 1 → nivel 2) guardado en la base de datos, no en el dispositivo.
--
-- Una fila por estudiante (o por usuario adulto) y ambiente (context). El nivel solo sube: lo valida el backend, que exige haber
-- cobrado en el cofre la experiencia de todas las actividades activas del catálogo antes de abrir el portal y pasar al nivel 2.
--   · level           → 1 (por defecto) o 2.
--   · portal_passed   → el portal del nivel 1 ya se cruzó (activa la plataforma que sube al nivel 2).
-- Idempotente. Aplicar en el SQL Editor de Supabase (después de 20261103_xp_claims.sql).

CREATE TABLE IF NOT EXISTS public.player_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    estudiante_id UUID NULL REFERENCES public.students(id) ON DELETE CASCADE,
    owner_id UUID GENERATED ALWAYS AS (COALESCE(estudiante_id, usuario_id)) STORED,
    context VARCHAR(10) NOT NULL DEFAULT 'hogar' CHECK (context IN ('hogar', 'escolar')),
    institution_id UUID NULL REFERENCES public.institutions(id) ON DELETE SET NULL,
    level INT NOT NULL DEFAULT 1 CHECK (level >= 1),
    portal_passed BOOLEAN NOT NULL DEFAULT FALSE,
    level_reached_at TIMESTAMP WITH TIME ZONE NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_player_levels_owner_context UNIQUE (owner_id, context)
);

CREATE INDEX IF NOT EXISTS idx_player_levels_owner ON public.player_levels (owner_id, context);
