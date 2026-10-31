# Backend — Vamos Aprendiendo Web

API REST del proyecto educativo **Vamos Aprendiendo** (SENA). La consumen el frontend web (Nuxt) y la app de Unity.

**Stack:** NestJS 11 · TypeScript · Supabase (PostgreSQL + Auth) · Passport JWT · Swagger · Jest

---

## Requisitos previos

- Node.js >= 20
- Un proyecto en [Supabase](https://supabase.com)
- Puerto `3000` libre (el frontend corre en `4242`)

## Instalación

```bash
npm install
cp .env.example .env
```

## Variables de entorno

| Variable | Descripción | Por defecto |
|---|---|---|
| `PORT` | Puerto del servidor | `3000` |
| `SUPABASE_URL` | URL del proyecto Supabase | — (obligatoria) |
| `SUPABASE_KEY` | Clave que usa `SupabaseService`. Si falta, usa `SUPABASE_ANON_KEY` y luego `SUPABASE_SERVICE_ROLE_KEY` | — (obligatoria) |
| `JWT_SECRET` | Secreto del access token | `default_secret_key_vamos_aprendiendo` |
| `JWT_EXPIRES_IN` | Vigencia del access token | `15m` |
| `JWT_REFRESH_SECRET` | Secreto del refresh token | `default_refresh_secret` |
| `JWT_REFRESH_EXPIRES_IN` | Vigencia del refresh token | `7d` |

> [!CAUTION]
> Nunca uses los secretos por defecto fuera de un entorno local de desarrollo.

## Scripts

```bash
npm run start:dev    # desarrollo con recarga
npm run build        # compila a dist/
npm run start:prod   # node dist/main
npm run lint         # eslint --fix
npm run test         # unitarios (Jest)
npm run test:cov     # con cobertura
npm run test:e2e     # end-to-end
```

## API y Swagger

- Prefijo global: `/api/v1`
- Swagger (con autenticación Bearer): <http://localhost:3000/api/docs>
- CORS: acepta `http://localhost:4242` con credenciales (ver `src/main.ts`).

La autenticación va por header `Authorization: Bearer <accessToken>`. **El backend no escribe cookies**; las cookies de sesión las gestiona el frontend.

## Módulos y rutas

| Módulo | Ruta base | Endpoints | Acceso |
|---|---|---|---|
| `auth` | `/auth` | `POST register`, `login`, `oauth`, `refresh`; `POST logout`, `GET profile` | público / JWT |
| `profile` | `/profile` | `GET me`, `PATCH me`, `PATCH me/email` | JWT |
| `admin` | `/admin` | `GET users`, `GET users/:id`, `PATCH users/:id`, `PATCH users/:id/email`, `PATCH users/:id/extend-trial`, `DELETE users/:id` | rol `admin` |
| `teacher` | `/teacher` | `GET dashboard` | rol `profesor` + acceso activo |
| `institutions` | `/institutions` | `GET /`, `GET :id`, `POST preauth-check`, `POST /` | JWT; crear: `admin` |
| `licenses` | `/licenses` | `GET current`, `POST /` | JWT; crear: `admin` |
| `students` | `/students` | `POST setup`, `GET mine`, `GET setup-status`, `POST /`, `GET :id` | JWT; `POST /`: `usuario`, `test` |
| `assessments` | `/assessments` | `POST /`, `GET history` | JWT |
| `presence` | `/presence` | `POST sessions`, `POST sessions/:id/heartbeat`, `POST sessions/:id/end`, `GET me`, `GET history`, `GET status/:userId` | JWT; `status`: `profesor`, `admin` |
| `telemetry` | `/telemetry` | `GET progress`, `GET performance` (solo lectura) | JWT |
| `supabase` | — | Proveedor interno del cliente Supabase | — |

Pendiente en `telemetry`: endpoints de **escritura** para que Unity guarde sesiones de juego, trazos y progreso.

## Roles

`admin`, `usuario`, `profesor`, `test` (`src/common/enums/role.enum.ts`). El rol `test` tiene 14 días de prueba (`ActiveAccessGuard`). Además, el login devuelve `profileType` (`admin`, `profesor`, `tester`, `tutor`, `adulto`) y `audience` (`ninos` / `adultos` / `null`) para Unity.

## Base de datos

Las migraciones SQL están en `database/migrations/` y se ejecutan en Supabase en orden cronológico (por nombre de archivo).

## Documentación

- Arquitectura y guía de desarrollo: [`ARQUITECTURA.md`](./ARQUITECTURA.md)
- Reglas para agentes de IA: [`AGENTS.md`](./AGENTS.md)
- Integración Unity (sesiones de uso): [`docs/unity-app-sessions.md`](./docs/unity-app-sessions.md)
- Historial de cambios: [`CHANGELOG.md`](./CHANGELOG.md)
- Especificación funcional del sistema: [`../SPEC.md`](../SPEC.md)
