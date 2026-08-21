# Backend Development Guidelines - Vamos Aprendiendo Web

## Technology Stack
- **Framework**: NestJS 11 (Express platform)
- **Database / BaaS**: Supabase (PostgreSQL, Auth, Realtime)
- **Auth**: Passport JWT + Refresh Tokens + Bcrypt
- **Validation**: `class-validator` + `class-transformer` (ValidationPipe with `whitelist: true, transform: true`)
- **Testing**: Jest (`.spec.ts`) + Supertest (E2E)

---

## Architectural Principles
1. **Modules (`src/modules/<feature>`)**:
   - Every feature must be contained in its own folder under `src/modules/<feature>`:
     - `<feature>.module.ts`
     - `<feature>.controller.ts`
     - `<feature>.service.ts`
     - `dto/` (e.g. `create-<feature>.dto.ts`, `update-<feature>.dto.ts`)
     - `interfaces/` or `entities/`
     - `<feature>.service.spec.ts` and `<feature>.controller.spec.ts`

2. **Data Access via Supabase**:
   - Inject `SupabaseService` (`src/modules/supabase/supabase.service.ts`).
   - Obtain the client with `this.supabaseService.getClient()`.
   - Check `{ data, error }` returned from Supabase queries and throw appropriate NestJS exceptions:
     ```typescript
     const { data, error } = await this.supabaseService.getClient()
       .from('my_table')
       .select('*');
     if (error) {
       throw new InternalServerErrorException(error.message);
     }
     ```

3. **Security & Authentication**:
   - Use `@UseGuards(JwtAuthGuard)` on private endpoints.
   - Use custom decorators like `@GetUser()` to extract the authenticated user from `req.user`.

4. **Testing**:
   - Write unit tests for all services with mocked `SupabaseService`.
   - Ensure `npm run test` passes without errors.
