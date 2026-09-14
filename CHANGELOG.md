# Changelog

Todas las modificaciones notables de este proyecto serán documentadas en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y este proyecto sigue [Semantic Versioning](https://semver.org/lang/es/).

---

## [Unreleased] - 2026-09-12

### 1. Módulo de Profesor e Integración Institucional (`teacher`)

#### ✅ Implementado
- **Migración DDL de Base de Datos (`database/migrations/20260912_create_institutions_and_students.sql`)**:
  - Creación de tabla `institutions` (nombre, código DANE, teléfono, email, dirección, estado activo).
  - Adición de clave foránea `institution_id` en `public.profiles` con índice de consulta optimizado.
  - Creación de tabla `students` con clave foránea a `institutions` y `teacher_id` hacia `profiles`.
  - Triggers automáticos para actualización de `updated_at`.
- **Estructura e Implementación del Módulo `src/modules/teacher/`**:
  - `interfaces/teacher-dashboard.interface.ts`: Tipos TypeScript `InstitutionData`, `StudentData` y `TeacherDashboardData`.
  - `dto/teacher-institution-response.dto.ts`: DTOs con decoradores `@ApiProperty` para OpenAPI/Swagger.
  - `teacher.service.ts`: Lógica de validación de rol de docente, consulta de institución asociada y listado ordenado de estudiantes activos a cargo.
  - `teacher.controller.ts`: Rutas protegidas (`GET /api/v1/teacher/dashboard`) con `@UseGuards(JwtAuthGuard, RolesGuard, ActiveAccessGuard)` y `@Roles(Role.TEACHER)`.
  - `teacher.module.ts`: Declarado y exportado con inyección de `SupabaseModule`.
  - `teacher.service.spec.ts` y `teacher.controller.spec.ts`: Cobertura de pruebas unitarias base.
- **Registro Global en `AppModule`**:
  - `TeacherModule` importado y registrado en `src/app.module.ts`.
- **Limpieza de Código**:
  - Eliminación del método stub obsoleto `getTeacherInstitutionData` en `src/modules/supabase/supabase.service.ts`.

---

### 2. Sistema de Invitaciones a Docentes por Correo (Magic Links de Un Solo Uso)

#### ⏳ Pendiente por Implementar (Próximos Pasos)
1. **Migración SQL (`database/migrations/20260913_create_teacher_invitations.sql`)**:
   - Crear tabla `public.teacher_invitations`:
     - `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
     - `email VARCHAR(255) NOT NULL`
     - `institution_id UUID NOT NULL REFERENCES public.institutions(id) ON DELETE CASCADE`
     - `token_hash VARCHAR(64) NOT NULL UNIQUE` (Hash SHA-256 del token seguro)
     - `expires_at TIMESTAMP WITH TIME ZONE NOT NULL` (vigencia temporal, ej. 72 horas)
     - `used_at TIMESTAMP WITH TIME ZONE NULL` (garantiza el único uso del enlace)
     - `created_by UUID REFERENCES public.profiles(id)`
     - `created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`
   - Índices para búsquedas rápidas por `token_hash` y control de duplicidad por `email`.
2. **Servicio y Módulo de Correo (`MailModule` & `MailService`)**:
   - Instalación de `nodemailer` y `@types/nodemailer`.
   - Implementación de `MailService` configurado con variables SMTP de Ethereal (`ETHEREAL_HOST`, `ETHEREAL_PORT`, `ETHEREAL_USER`, `ETHEREAL_PASS`, `EMAIL_FROM`, `FRONTEND_URL`).
   - Plantilla HTML responsiva con branding institucional y botón CTA de invitación al registro docente.
3. **Endpoints Administrativos de Invitación (`admin`)**:
   - `POST /api/v1/admin/invitations/teachers`:
     - Protegido para administradores (`@Roles(Role.ADMIN)`).
     - Validación de institución activa y no existencia previa de cuenta docente con ese email.
     - Generación de token criptográfico (`crypto.randomBytes(32).toString('hex')`).
     - Almacenamiento del hash SHA-256 en BD con expiración a 72h.
     - Despacho del correo con el enlace: `${FRONTEND_URL}/register-teacher?token=${token}`.
4. **Endpoints de Validación y Registro Docente (`auth`)**:
   - `GET /api/v1/auth/teacher-invitations/validate?token=...`:
     - Endpoint público para validar que el token exista, no haya expirado, `used_at IS NULL` y la institución permanezca activa.
     - Retorna datos iniciales para la vista (`email`, `institutionName`).
   - `POST /api/v1/auth/register-teacher`:
     - DTO `RegisterTeacherDto` con datos del docente (contraseña, nombres, documento, teléfono).
     - Creación del usuario en Supabase Auth (`auth.users`) y perfil en `profiles` con `role = 'profesor'`, `institution_id` y `trial_ends_at = null`.
     - Actualización del estado de la invitación (`used_at = NOW()`).
     - Generación de par de tokens JWT para inicio de sesión inmediato.
