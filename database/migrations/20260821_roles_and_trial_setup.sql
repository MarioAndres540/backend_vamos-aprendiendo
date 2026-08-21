-- ==============================================================================
-- MIGRACIÓN: SISTEMA DE ROLES (ADMIN, USUARIO, TEST) Y CONTROL DE PRUEBA (14 DÍAS)
-- Proyecto: Vamos Aprendiendo Web
-- ==============================================================================

-- 1. Crear el ENUM para los roles de usuario (admin, usuario, test)
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('admin', 'usuario', 'test');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Asegurar y actualizar las columnas en la tabla public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'test',
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '14 days'),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 3. Crear índices para optimizar consultas de roles, filtros de prueba y estado
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_trial_ends_at ON public.profiles(trial_ends_at);
CREATE INDEX IF NOT EXISTS idx_profiles_is_active ON public.profiles(is_active);

-- 4. Crear trigger para actualizar 'updated_at' automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trigger_profiles_updated_at ON public.profiles;

CREATE TRIGGER trigger_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ==============================================================================
-- INSTRUCCIONES PARA ASIGNAR TU PRIMER ADMINISTRADOR MANUALMENTE:
-- Reemplaza 'tu_correo_admin@ejemplo.com' con el email del usuario administrador:
-- 
-- UPDATE public.profiles
-- SET role = 'admin', trial_ends_at = NULL, is_active = TRUE
-- WHERE email = 'tu_correo_admin@ejemplo.com';
-- ==============================================================================
