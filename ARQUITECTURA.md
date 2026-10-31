# Arquitectura y Guía de Desarrollo — Backend

**Proyecto:** Vamos Aprendiendo Web · **Stack:** NestJS 11 + Supabase (PostgreSQL)

Esta guía reemplaza a `ARQUITECTURA_Y_GUIA_PROYECTO.md` y `GUIA_BACKEND_ARQUITECTURA.md`. Los ejemplos con `courses` son **ilustrativos**: ese módulo no existe.

## Contenido
1. [Filosofía](#1-filosofía)
2. [Estructura de carpetas](#2-estructura-de-carpetas)
3. [Ciclo de una petición](#3-ciclo-de-una-petición)
4. [Autenticación, roles y cookies](#4-autenticación-roles-y-cookies)
5. [Crear un módulo paso a paso](#5-crear-un-módulo-paso-a-paso)
6. [Crear un guard](#6-crear-un-guard)
7. [Pruebas](#7-pruebas)
8. [Reglas del proyecto](#8-reglas-del-proyecto)

---

## 1. Filosofía

Arquitectura modular por funcionalidad (*feature modules*):

- **Controladores**: reciben HTTP, validan con DTOs, aplican guards y delegan.
- **Servicios**: reglas de negocio y acceso a Supabase (vía `SupabaseService`).
- **DTOs**: `class-validator` + `@ApiProperty` (Swagger).
- **Guards / decoradores** (`src/common`): autenticación, roles y acceso.
- Inyección de dependencias con `@Injectable()`.
- Un *repository* separado es opcional; hoy los módulos consultan Supabase desde el servicio.

## 2. Estructura de carpetas

```text
backend_vamos-aprendiendo/
├── .agents/skills/            # Skills para agentes de IA
├── database/migrations/       # SQL versionado por fecha (se ejecuta en Supabase en orden)
├── docs/                      # Guías técnicas (p. ej. unity-app-sessions.md)
├── src/
│   ├── common/
│   │   ├── decorators/        # @CurrentUser, @Roles
│   │   ├── enums/             # Role (admin, usuario, profesor, test)
│   │   ├── guards/            # JwtAuthGuard, RolesGuard, ActiveAccessGuard, SupabaseAuthGuard
│   │   └── interceptors/      # LoggingInterceptor (global)
│   ├── modules/
│   │   ├── admin/  assessments/  auth/  institutions/  licenses/
│   │   ├── presence/  profile/  students/  teacher/  telemetry/
│   │   └── supabase/          # Proveedor del cliente Supabase
│   ├── app.module.ts          # Ensambla módulos, ConfigModule global y LoggingInterceptor
│   └── main.ts                # Prefijo /api/v1, ValidationPipe, CORS, Swagger
├── test/                      # E2E (Supertest)
├── .env / .env.example
└── package.json
```

## 3. Ciclo de una petición

```
Cliente → main.ts (prefijo /api/v1, CORS, ValidationPipe)
        → LoggingInterceptor (mide latencia)
        → JwtAuthGuard (token Bearer) → RolesGuard (@Roles) → ActiveAccessGuard (activo / trial)
        → Controller → Service → SupabaseService → PostgreSQL
        → respuesta JSON  ·  log "[GET] /api/v1/... 200 - 15ms"
```

## 4. Autenticación, roles y cookies

- **Tokens**: access token (`JWT_EXPIRES_IN`) y refresh token con rotación; en base de datos solo se guarda el hash SHA-256 (migración `20261007_refresh_tokens_session_family.sql`).
- **Roles** (`Role`): `admin`, `usuario`, `profesor`, `test`. El rol `test` tiene 14 días de prueba.
- **Tipo de perfil** (`profileType`): `admin`, `profesor`, `tester`, `tutor`, `adulto`. Lo calcula el backend en `login` y en `refresh`, y de él sale `audience` (`ninos` para tutor, `adultos` para adulto, `null` para el resto). Decide la ruta inicial en la web y el contenido en Unity.
- **Cookies**: el backend **no** gestiona cookies; `login`, `register` y `refresh` devuelven los tokens en el JSON y `JwtStrategy` solo lee `Authorization: Bearer`. El frontend los guarda en cookies de Nuxt (`auth_token`, `refresh_token`, …) y los reenvía como Bearer (ver `frontend-vamos-aprendiendo/ARQUITECTURA.md`).
- **Cookies `HttpOnly` (opcional, no implementado)**: para mitigar XSS habría que instalar `cookie-parser`, emitir las cookies con `res.cookie(..., { httpOnly: true, secure, sameSite })` usando `@Res({ passthrough: true })`, añadir un extractor de cookie en `JwtStrategy` (`ExtractJwt.fromExtractors`) y ajustar el frontend. CORS ya tiene `credentials: true`.

## 5. Crear un módulo paso a paso

Orden recomendado (ejemplo `courses`):

```
1. Migración SQL → 2. DTOs → 3. Servicio → 4. Controlador → 5. Módulo → 6. app.module.ts → 7. Pruebas
```

```text
src/modules/courses/
├── dto/create-course.dto.ts
├── courses.controller.ts
├── courses.service.ts
├── courses.service.spec.ts
└── courses.module.ts
```

**1. Migración** — `database/migrations/AAAAMMDD_create_courses_table.sql`:
```sql
CREATE TABLE IF NOT EXISTS public.courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(150) NOT NULL,
    tutor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**2. DTO**:
```typescript
export class CreateCourseDto {
  @ApiProperty({ example: 'Introducción a la lógica' })
  @IsString() @IsNotEmpty() @MaxLength(120)
  title: string;
}
```

**3. Servicio**:
```typescript
@Injectable()
export class CoursesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll() {
    const { data, error } = await this.supabaseService.getClient()
      .from('courses').select('*').order('created_at', { ascending: false });
    if (error) throw new InternalServerErrorException(error.message);
    return data;
  }
}
```

**4. Controlador** (guards desde `src/common`):
```typescript
@ApiTags('Courses')
@Controller('courses')
export class CoursesController {
  constructor(private readonly coursesService: CoursesService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  findAll() { return this.coursesService.findAll(); }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard, ActiveAccessGuard)
  @Roles(Role.ADMIN, Role.USER)
  @ApiBearerAuth('bearer')
  create(@Body() dto: CreateCourseDto, @CurrentUser() user: any) {
    return this.coursesService.create(dto, user.userId);
  }
}
```

**5. Módulo**: `imports: [SupabaseModule]`, `controllers`, `providers`, `exports` si otro módulo lo usa.
**6.** Agregar `CoursesModule` a `imports` en `src/app.module.ts`.

## 6. Crear un guard

Un guard implementa `CanActivate`; si devuelve `true` la petición sigue, si lanza excepción se bloquea. Va en `src/common/guards/` con su `.spec.ts` (ver `roles.guard.ts`, `active-access.guard.ts`). Se usa con `@UseGuards(JwtAuthGuard, MiGuard)`: `JwtAuthGuard` primero, porque rellena `req.user`.

## 7. Pruebas

Cada servicio y guard tiene su `.spec.ts` con `SupabaseService` simulado:

```typescript
const module = await Test.createTestingModule({
  providers: [CoursesService, { provide: SupabaseService, useValue: mockSupabase }],
}).compile();
```

Cubre camino feliz y error de Supabase. Ejecuta `npm run test` (y `npm run test:e2e` si tocas rutas).

## 8. Reglas del proyecto

1. Nunca instanciar `createClient`; usar `SupabaseService.getClient()`.
2. Todo DTO con `class-validator` y `@ApiProperty`.
3. Desestructurar `{ data, error }` y lanzar excepciones de NestJS.
4. Un `.spec.ts` por servicio/guard; `npm run test` en verde.
5. Mantener Swagger al día (`@ApiTags`, `@ApiOperation`, `@ApiResponse`).
6. Registrar los cambios en `CHANGELOG.md`.
