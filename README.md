# Backend — Vamos Aprendiendo Web

API REST del proyecto educativo **Vamos Aprendiendo** (SENA).

**Stack:** NestJS 11 · TypeScript 5.7 · Supabase (PostgreSQL + Auth) · Passport JWT · Swagger

---

## Requisitos previos

- Node.js >= 20
- Cuenta y proyecto en [Supabase](https://supabase.com)
- Backend corriendo esperado en el puerto `3000`

---

## Instalación

```bash
npm install
```

---

## Variables de entorno

Copia el archivo de ejemplo y completa los valores:

```bash
cp .env.example .env
```

Variables requeridas en `.env`:

```env
SUPABASE_URL=https://<tu-proyecto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<tu-service-role-key>

JWT_SECRET=<secreto-fuerte-aleatorio>
JWT_EXPIRES_IN=15m

JWT_REFRESH_SECRET=<otro-secreto-fuerte>
JWT_REFRESH_EXPIRES_IN=7d

PORT=3000
```

> [!CAUTION]
> Nunca uses los valores por defecto (`default_secret_key_vamos_aprendiendo`) en un entorno que no sea puramente local de desarrollo.

---

## Scripts de ejecución

```bash
# Desarrollo con recarga automática
npm run start:dev

# Producción
npm run start:prod

# Build
npm run build
```

---

## Tests

```bash
# Unitarios
npm run test

# Unitarios en modo watch
npm run test:watch

# Con informe de cobertura
npm run test:cov

# End-to-End
npm run test:e2e
```

---

## API Docs (Swagger)

Con el servidor corriendo, accede a:

```
http://localhost:3000/api/docs
```

Soporta autenticación Bearer JWT directamente desde la UI.

---

## Prefijo global de rutas

Todas las rutas tienen el prefijo `/api/v1`:

```
POST   /api/v1/auth/login
POST   /api/v1/auth/register
GET    /api/v1/admin/users
GET    /api/v1/teacher/dashboard
...
```

---

## Módulos disponibles

| Módulo | Ruta base | Descripción |
|---|---|---|
| `auth` | `/api/v1/auth` | Login, registro, OAuth, refresh tokens |
| `admin` | `/api/v1/admin` | CRUD de usuarios (solo rol admin) |
| `teacher` | `/api/v1/teacher` | Dashboard del docente e institución |
| `students` | `/api/v1/students` | Setup de diagnóstico inicial del estudiante |
| `presence` | `/api/v1/presence` | Heartbeat y presencia en tiempo real |
| `telemetry` | `/api/v1/telemetry` | Telemetría del juego Unity (pendiente) |

---

## Base de datos

Las migraciones SQL viven en `database/migrations/`. Deben ejecutarse en Supabase en orden cronológico.

---

## Documentación técnica

- **Guía de desarrollo** (módulos, guards, DTOs): [`ARQUITECTURA.md`](./ARQUITECTURA.md)
- **Historial de cambios**: [`CHANGELOG.md`](./CHANGELOG.md)
- **Arquitectura completa del sistema**: [`../../docs/02-architecture.md`](../../docs/02-architecture.md)
- **Flujos de autenticación**: [`../../docs/04-auth-flows.md`](../../docs/04-auth-flows.md)
- **Esquema de base de datos**: [`../../docs/03-database-schema.md`](../../docs/03-database-schema.md)
