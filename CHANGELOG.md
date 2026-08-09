# 📝 Changelog - Sistema de Autenticación y Telemetría Backend

Todas las modificaciones destacables realizadas en el módulo de autenticación, seguridad de tokens y registro de peticiones HTTP en el backend NestJS.

---

## 🚀 [Unreleased] - 2026-08-09

### ✨ Nuevas Características (Features)
- **Autenticación Social (OAuth 2.0)**:
  - Implementado el endpoint `POST /api/v1/auth/oauth` que valida e intercambia `idToken` y `accessToken` de proveedores sociales (Google, GitHub, Apple) mediante Supabase Auth (`signInWithIdToken`).
  - Creación y vinculación automática de perfil inicial en la tabla `public.profiles` para registros mediante OAuth.
- **Gestión y Rotación Estricta de Refresh Tokens (RTR)**:
  - Implementado el endpoint `POST /api/v1/auth/refresh` que renueva de forma transparente el par de tokens (`accessToken` de 15 min y `refreshToken` de 7 días).
  - Almacenamiento seguro de tokens en la base de datos usando **Hashing SHA-256** para consultas inmediatas $O(1)$.
  - **Detección de Reutilización de Tokens (Token Reuse Detection)**: Si se detecta un intento de reutilización de un token revocado, el sistema revoca automáticamente todas las sesiones del usuario por seguridad.
  - Endpoint `POST /api/v1/auth/logout` para revocar el Refresh Token activo y cerrar la sesión.
- **Intercepción y Registro HTTP (Logging Interceptor)**:
  - Creado `LoggingInterceptor` en `src/common/interceptors/logging.interceptor.ts` que registra el método HTTP, URL, código de respuesta, IP, User-Agent y tiempo de latencia en milisegundos (`ms`).

### 🛠️ DTOs Creados
- `OAuthLoginDto` (`src/modules/auth/dto/oauth-login.dto.ts`): Validación de payload para inicio de sesión social.
- `RefreshTokenDto` (`src/modules/auth/dto/refresh-token.dto.ts`): Validación de payload para renovación y revocación de tokens.

### 🛡️ Mejoras de Seguridad y Resiliencia
- **Resguardo (Fallback) de JWT Secret**: Agregado fallback por defecto en `JwtStrategy` y `AuthModule` para prevenir cierres inesperados de la aplicación por variables de entorno omitidas.
- **Configuración de Variables de Entorno**: Actualizado `.env.example` con las variables de configuración de JWT y Refresh Token.

---

## 🗃️ Cambios en Base de Datos (PostgreSQL / Supabase)

### 1. Tabla `public.profiles`
- Verificación y habilitación de políticas de inserción y consulta (RLS o `DISABLE ROW LEVEL SECURITY`).

### 2. Tabla `public.refresh_tokens`
```sql
CREATE TABLE public.refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON public.refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON public.refresh_tokens(token_hash);
ALTER TABLE public.refresh_tokens DISABLE ROW LEVEL SECURITY;
```
