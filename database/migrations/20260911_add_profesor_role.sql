-- ==============================================================================
-- MIGRACIÓN: AGREGAR ROL 'profesor' AL ENUM user_role
-- Proyecto: Vamos Aprendiendo Web
-- ==============================================================================

-- 1. Agregar el valor 'profesor' al ENUM user_role si no existe en la base de datos
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'profesor';

-- ==============================================================================
-- INSTRUCCIONES PARA ASIGNAR EL ROL 'profesor' A UN USUARIO EXISTENTE:
-- UPDATE public.profiles
-- SET role = 'profesor', trial_ends_at = NULL, is_active = TRUE
-- WHERE email = 'correo_profesor@ejemplo.com';
-- ==============================================================================
