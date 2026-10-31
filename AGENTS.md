# Backend Development Guidelines - Vamos Aprendiendo Web

Antes de cambiar código lee [`ARQUITECTURA.md`](./ARQUITECTURA.md) y la especificación [`../SPEC.md`](../SPEC.md). Documenta cada cambio relevante en [`CHANGELOG.md`](./CHANGELOG.md).

## Technology Stack
- **Framework**: NestJS 11 (Express), prefijo global `/api/v1`
- **Database / BaaS**: Supabase (PostgreSQL, Auth)
- **Auth**: Passport JWT + refresh tokens rotativos (hash SHA-256) + Bcrypt
- **Validation**: `class-validator` + `class-transformer` (`ValidationPipe` con `whitelist`, `forbidNonWhitelisted`, `transform`)
- **Docs**: Swagger en `/api/docs`
- **Testing**: Jest (`.spec.ts`) + Supertest (E2E en `test/`)

---

## Architectural Principles
1. **Modules (`src/modules/<feature>`)** — una carpeta por funcionalidad:
   - `<feature>.module.ts`, `<feature>.controller.ts`, `<feature>.service.ts`
   - `dto/` (p. ej. `create-<feature>.dto.ts`), y `interfaces/` o `entities/` si se necesitan
   - `<feature>.service.spec.ts` (y `<feature>.controller.spec.ts` cuando el controlador tiene lógica)
   - Registrar el módulo en `src/app.module.ts`.
   - Módulos actuales: `admin, assessments, auth, institutions, licenses, presence, profile, students, supabase, teacher, telemetry`.

2. **Data access via Supabase**:
   - Inyectar `SupabaseService` (`src/modules/supabase/supabase.service.ts`) y usar `getClient()`. No crear clientes con `createClient`.
   - Revisar siempre `{ data, error }` y lanzar excepciones de NestJS:
     ```typescript
     const { data, error } = await this.supabaseService.getClient()
       .from('my_table')
       .select('*');
     if (error) {
       throw new InternalServerErrorException(error.message);
     }
     ```
   - Los cambios de esquema van en `database/migrations/` (archivo nuevo con fecha `AAAAMMDD_descripcion.sql`); nunca editar migraciones ya aplicadas.

3. **Security & Authentication** (guards en `src/common/guards/`, decoradores en `src/common/decorators/`):
   - `JwtAuthGuard` en endpoints privados.
   - `RolesGuard` + `@Roles(Role.ADMIN, ...)` para restringir por rol (`admin`, `usuario`, `profesor`, `test`; ver `common/enums/role.enum.ts`).
   - `ActiveAccessGuard` valida cuenta activa y el trial de 14 días del rol `test`.
   - `@CurrentUser()` extrae el usuario autenticado de `req.user`.
   - Orden de guards: `@UseGuards(JwtAuthGuard, RolesGuard, ActiveAccessGuard)`.
   - Los tokens viajan en el header `Authorization: Bearer`; el backend no usa cookies.

4. **Testing**:
   - Pruebas unitarias para todo servicio, con `SupabaseService` simulado.
   - `npm run test` debe pasar sin errores antes de dar una tarea por terminada.

5. **API docs**: decorar controladores y DTOs con `@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiProperty`; usar `@ApiBearerAuth('bearer')` en rutas privadas.

## Skills disponibles (`.agents/skills/`)
- `nestjs-module-generator` — crear módulos NestJS.
- `nuxt4-feature-builder` — páginas/composables del frontend (`../frontend-vamos-aprendiendo`).
- `fullstack-test-runner` — ejecutar pruebas y chequeos de calidad de ambos proyectos.

## Validación con Context7 (obligatoria)
Antes de terminar cualquier implementación, consulta la documentación vigente de las librerías usadas con el MCP Context7 (`resolve-library-id` → `query-docs`) y ajusta el código a ella; después ejecuta las verificaciones del proyecto. Detalle en `../AGENTS.md`.
