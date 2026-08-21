# 📝 Changelog - Sistema de Autenticación y Telemetría Backend

Todas las modificaciones destacables realizadas en el módulo de autenticación, seguridad de tokens y registro de peticiones HTTP en el backend NestJS.

---

## 🚀 [Unreleased] - 2026-08-21

### ✨ Nuevas Características (Features)
- **Documentación Swagger / OpenAPI**:
  - Instalación e integración de `@nestjs/swagger` y `swagger-ui-express`.
  - Habilitación del plugin Swagger en `nest-cli.json` para inferencia automática de metadatos.
  - Configuración del endpoint interactivo en `/api/docs` con soporte de autorización Bearer JWT (`@ApiBearerAuth`).
  - Documentación completa en endpoints de autenticación, administración y chequeo de salud.
- **Sistema de Roles y Control de Acceso (Admin, Usuario, Test)**:
  - Creación del Enum centralizado `Role` (`admin`, `usuario`, `test`) en `src/common/enums/role.enum.ts`.
  - Actualización del flujo de registro (`RegisterDto` y `AuthService.register`): el registro público solo permite asignar `usuario` o `test` (por defecto `test` con cálculo de 14 días de prueba). El rol `admin` queda reservado exclusivamente a asignación por base de datos.
  - Implementación del decorador `@Roles()` y el guard `RolesGuard` para protección de rutas basada en roles (RBAC).
  - Implementación del guard `ActiveAccessGuard` que valida el estado activo de la cuenta y bloquea automáticamente con código `TRIAL_EXPIRED` (403 Forbidden) cuando el rol `test` supera los 14 días.
  - Inyección y sincronización de `role`, `trialEndsAt`, `isActive` en el payload del JWT (`JwtStrategy`) y cálculo dinámico de `daysRemaining` en `GET /api/v1/auth/profile`.
- **Módulo Administrativo de Gestión de Usuarios (`AdminModule`)**:
  - Creación de `src/modules/admin/` con controlador, servicio y DTOs dedicados protegidos por `@Roles(Role.ADMIN)`.
  - `GET /api/v1/admin/users`: Consulta de usuarios con paginación, filtros por rol y búsqueda textual.
  - `GET /api/v1/admin/users/:id`: Obtención de detalles completos de un usuario y sus métricas de prueba.
  - `PATCH /api/v1/admin/users/:id`: Modificación de datos personales, teléfono, documento, cambio de rol y activación/desactivación.
  - `PATCH /api/v1/admin/users/:id/email`: Modificación del correo electrónico en Supabase Auth (`supabase.auth.admin.updateUserById`) y en `public.profiles`.
  - `PATCH /api/v1/admin/users/:id/extend-trial`: Extensión de días de prueba para usuarios con rol `test`.
  - `DELETE /api/v1/admin/users/:id`: Eliminación segura del usuario en Supabase Auth, perfil y sesiones.

### 🛠️ DTOs Creados / Actualizados
- `AdminQueryUsersDto` (`src/modules/admin/dto/admin-query-users.dto.ts`): Paginación y filtros de listado.
- `AdminUpdateUserDto` (`src/modules/admin/dto/admin-update-user.dto.ts`): Modificación de perfil de usuario por el admin.
- `AdminUpdateEmailDto` (`src/modules/admin/dto/admin-update-email.dto.ts`): Cambio de email.
- `AdminExtendTrialDto` (`src/modules/admin/dto/admin-extend-trial.dto.ts`): Extensión de días de prueba.
- `RegisterDto` (`src/modules/auth/dto/register.dto.ts`): Actualizado con selección de rol inicial y decoradores OpenAPI.

### 🗃️ Base de Datos & Migraciones (PostgreSQL / Supabase)
- Script de migración `database/migrations/20260821_roles_and_trial_setup.sql`:
  - Tipo `user_role` (`admin`, `usuario`, `test`).
  - Columnas en `public.profiles`: `role`, `trial_ends_at`, `is_active`, `updated_at`.
  - Trigger automático `trigger_profiles_updated_at` para actualización de timestamp.
  - Índices en `role`, `trial_ends_at` e `is_active`.

### 🧪 Pruebas Unitarias (Jest)
- Suite de pruebas unitarias implementadas para `RolesGuard`, `ActiveAccessGuard`, `AdminService` y `AdminController` (19 pruebas superadas con éxito).

---

## 🚀 [0.1.0] - 2026-08-09

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
