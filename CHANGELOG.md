# Changelog — Backend

Todas las modificaciones notables de este proyecto serán documentadas en este archivo.
El formato se basa en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y este proyecto sigue [Semantic Versioning](https://semver.org/lang/es/).

---

## [Unreleased]

### 🎮 Nuevo — Contenido de niños o de adultos para la app de Unity (2026-10-29)
- **`audience`** en `POST /auth/login` (en la raíz y en `user`): `ninos` para el tutor, `adultos` para el adulto y `null` para tester, profesor y admin (`audienceForProfile` en `auth.service.ts`). Antes la app solo recibía `profileType` y tenía que deducirlo.
- **`POST /auth/refresh` devuelve también `profileType` y `audience`** (recalculados en cada renovación). La app de Unity los necesita al reabrir con el token guardado, porque no repite el login. También sirve para que un cambio de rol o un hijo agregado se reflejen sin volver a iniciar sesión. Resuelve el pendiente #6.
- Guía `docs/unity-app-sessions.md` actualizada: tabla `profileType` → `audience`, respuesta de `/auth/refresh` y nueva sección 3.4 `GET /students/mine` para elegir el hijo.
- Verificado con la cuenta de prueba en una instancia temporal: login y refresh devuelven `tutor` / `ninos`.
- Pruebas: `auth.service.spec.ts` (+7, total 23). Suite completa: 100 pruebas.
- **Requiere reiniciar el backend.**

### 📊 Nuevo — Datos para Actividades y Analíticas (2026-10-26)
- **`GET /presence/history?days=30`** (`PresenceService.getHistory`): historial de uso de la app de Unity de la cuenta, de los últimos `days` días contando hoy (1 a 365, en hora de Colombia). Devuelve:
  - `summary`: sesiones, tiempo total, promedio, la más larga y el último ingreso.
  - `daily`: segundos y sesiones por día. Una sesión cuenta en el día en que empezó; una sesión abierta cuenta hasta ahora.
  - `sessions`: hasta 500 sesiones, con duración, motivo de cierre y estudiante.
  - DTO `QueryAppHistoryDto`.
- **Módulo `telemetry` implementado** (antes los archivos estaban vacíos), solo lectura:
  - `GET /telemetry/progress?studentId=`: las 7 categorías de `categorias_cognitivas` unidas con `progreso_categoria` (nivel, puntos, meta, si ya se jugó).
  - `GET /telemetry/performance?studentId=&days=30`:
    - Promedios de `trazos` (precisión y tiempo en números, precisión en letras) y de `operaciones_resueltas` (tiempo y % correctas).
    - Rangos esperados de `rangos_desarrollo` para la edad del estudiante (o del adulto), y un estado: `within` / `below` / `above`.
    - Cantidad de `game_sessions` y hasta 5 avisos de `trazos.desviaciones.alerta`.
  - Con `studentId` verifica el vínculo en `tutor_students` (`403` si no es de la cuenta); sin él usa los datos propios del usuario (`estudiante_id` vacío).
  - Pendiente: los endpoints de **escritura** para que Unity guarde sesiones de juego, trazos y progreso (DTOs `create-game-session.dto.ts` y `stroke-point.dto.ts` siguen vacíos).
- Verificado con la cuenta de prueba en una instancia temporal: historial real (7 sesiones del 8 oct, 2 min 44 s), progreso en nivel 1 sin jugar, rangos de 7 años; `403` con estudiante ajeno, `400` con parámetros inválidos, `401` sin sesión.
- Pruebas: `telemetry.service.spec.ts` (7) y `presence.service.spec.ts` (+3, total 13). Suite completa: 93 pruebas.

### 🔒 Corregido — Historial de formularios de otro estudiante (2026-10-26)
- `GET /assessments/history?studentId=…` devolvía el historial de **cualquier** estudiante. Ahora verifica que esté vinculado al tutor en `tutor_students` y, si no, responde `403`. Sin `studentId` sigue devolviendo los formularios que llenó el propio usuario. Lo usa la nueva pestaña Diagnósticos.
- La verificación es un método privado (`assertStudentLinked`) que también usa `POST /assessments`.
- Pruebas: `assessments.service.spec.ts` (+3, total 7).

### ⚙️ Nuevo — Configuración del tutor: perfil, hijos y diagnóstico por hijo (2026-10-25)
- **Módulo `profile`** (`src/modules/profile/`, requiere JWT):
  - `GET /profile/me`: nombres, apellidos, tipo y número de documento, teléfono y correo.
  - `PATCH /profile/me`: cambia **teléfono** y/o **tipo de documento** (`UpdateMyProfileDto`). Nombres y número de documento no se cambian desde aquí.
  - `PATCH /profile/me/email`: cambia el correo en Supabase Auth y en `profiles`. Pide la **contraseña actual** (`UpdateMyEmailDto`) para que nadie con la sesión abierta pueda apropiarse de la cuenta. Contraseña incorrecta → `400` (no `401`, que haría que el frontend intente renovar el token); correo de otra cuenta → `409`. Si falla `profiles`, se devuelve el correo anterior en Auth.
- **Estudiantes**:
  - `POST /students` (roles `usuario` y `test`): agrega un hijo o menor con los mismos datos y pasos del registro (estudiante, `tutor_students`, matrícula si tiene colegio, licencia de prueba de 14 días). Si algo falla se revierte; documento duplicado → `409`.
  - `GET /students/:id`: información del hijo elegido en el menú del dashboard; `404` si no está vinculado a la cuenta (también para ids con formato inválido).
  - `GET /students/mine` y `GET /students/:id` incluyen ahora `documentType` y `documentNumber`.
  - El formulario guardado sin estudiante se asigna al hijo solo si la cuenta tiene **un único** hijo (antes `GET /students/:id` no lo distinguía).
- **Seguridad en `POST /assessments`**: si llega `studentId`, se verifica que el estudiante esté vinculado al tutor en `tutor_students`; si no, `403`. Antes se podía guardar un formulario a nombre de cualquier estudiante.
- Pruebas: `profile.service.spec.ts` (10), `students.service.spec.ts` (+5, total 12) y `assessments.service.spec.ts` (+2).

### 👨‍👧 Nuevo — Hijos del tutor: `GET /students/mine` (2026-10-25)
- Devuelve los estudiantes vinculados a la cuenta (`tutor_students`) con nombre, grado, edad, fecha de nacimiento, parentesco, colegio y su **último formulario inicial** (nivel de alerta, condición principal y respuestas por dimensión). Requiere JWT.
- Lo usa la tarjeta "Tutor de" del dashboard y lo puede usar la app de Unity para saber qué `studentId` enviar al abrir la sesión.
- Los formularios de niños se guardan hoy sin `student_id` (el de Matías está así). Si el tutor tiene **un solo hijo**, ese formulario se le asigna; con varios hijos no se asigna porque no se sabe de quién es.
- Si fallan las consultas de colegios o formularios, la respuesta sale igual, sin esos datos (queda en el log). Si fallan los vínculos o los estudiantes, responde 500 con un mensaje genérico.
- Pruebas: `students.service.spec.ts` (7 casos). Las filas de Supabase se tipan con interfaces locales (`TutorLinkRow`, `StudentRow`, `InstitutionRow`, `AssessmentRow`), igual que en `PresenceService`; `students.service.ts` pasa ESLint sin errores.
- Prettier se aplicó a `students.service.ts` y `students.controller.ts`, así que también cambió la indentación del código anterior (`saveSetup`, `getSetupStatus`), sin cambios de lógica.

### 📡 Nuevo — Canal Unity ↔ Backend ↔ Web: sesiones de uso de la app
- **Objetivo**: el tutor (o el adulto) ve en su dashboard si la app de Unity está en uso: desde qué hora y cuánto tiempo lleva, o cuándo se desconectó y cuánto duró la última sesión.
- **Migración** `database/migrations/20261008_app_sessions.sql`: tabla `app_sessions` con una fila por sesión de uso. Columnas: `user_id`, `student_id`, `client` (`unity` | `web`), `device_info`, `app_version`, `started_at`, `last_heartbeat_at`, `ended_at` y `end_reason` (`app_closed` | `logout` | `timeout`). Reemplaza a `user_presence` (una sola fila por usuario y sin historial), que deja de usarse.
- **Endpoints** (`PresenceController`, requieren JWT):
  - `POST /presence/sessions`: abre una sesión. Devuelve `sessionId`, `heartbeatIntervalSeconds` (15) y `timeoutSeconds` (45). Valida que el `studentId` esté vinculado al tutor.
  - `POST /presence/sessions/:id/heartbeat`: latido. Responde `409 SESSION_ENDED` si la sesión expiró y `404 SESSION_NOT_FOUND` si no es de la cuenta.
  - `POST /presence/sessions/:id/end`: cierra la sesión (idempotente).
  - `GET /presence/me`: estado para el dashboard: `isOnline`, `current`, `lastSession` y `today` (hora de Colombia).
  - `GET /presence/status/:userId`: lo mismo para profesor o admin.
  - Se retiran `POST /presence/connect`, `/heartbeat` y `/disconnect`, que no tenían consumidores.
- **Cierre por inactividad**: tras 45 s sin latidos la sesión se cierra con `timeout`, tomando como hora de fin la del último latido, para que la duración sea real aunque la app se cierre a la fuerza o pierda la red.
- **Guía técnica para el equipo de Unity**: `docs/unity-app-sessions.md`. Incluye flujo, endpoints, errores, ciclo de vida (`OnApplicationPause` / `OnApplicationQuit`), servicio de referencia en C# (`UnityWebRequest`) y pruebas con `curl`.
- Pruebas: `presence.service.spec.ts` (10 casos).
- **Corrección en la guía (2026-10-08)**: en escritorio y en el Editor de Unity, `OnApplicationPause(true)` se dispara al perder el foco de la ventana. La app de Unity cerraba la sesión cada vez que se pasaba al navegador y el dashboard mostraba "Inactivo" mientras se jugaba. La guía (sección 4 y ejemplo C#) indica ahora cerrar sesiones por pausa solo en móvil y activar `Application.runInBackground` en escritorio. Se corrigió también `PresenceService.cs` en el proyecto de Unity.

### 🔀 Cambiado — Sesiones simultáneas sin restricción (app de Unity + web)
- **Decisión (2026-10-08)**: el niño usa la cuenta de su tutor (o el adulto la suya) tanto en la app de Unity como en la web, y una misma cuenta puede estar abierta en ambas a la vez, sin límite de sesiones.
- **Sesión por dispositivo**: cada inicio de sesión crea un `session_id`; al renovar, el token nuevo conserva el `session_id` (columna nueva en `refresh_tokens` y `sid` dentro del refresh token).
- **Reutilización de token**: antes se revocaban **todas** las sesiones del usuario, así que un reintento en la web podía sacar al niño de la app de Unity. Ahora se revoca **solo la sesión afectada** y se responde "Tu sesión en este dispositivo se cerró por seguridad. Inicia sesión de nuevo."
- **Tokens únicos**: el refresh token incluye `jti` aleatorio. Antes, dos inicios de sesión en el mismo segundo (ej. Unity y web) generaban el mismo token y uno se tomaba como reutilización del otro.
- El insert del refresh token ahora valida errores. Si falta la columna `session_id` (migración pendiente), reintenta sin ella y deja una advertencia en el log.
- **Verificado** contra el backend real con una cuenta de tutor: dos inicios de sesión simultáneos, cada uno se renueva por separado, y la reutilización del token de la web no afecta la sesión de Unity. 16 pruebas unitarias en `auth.service.spec.ts`.
- **Requiere** aplicar `database/migrations/20261007_refresh_tokens_session_family.sql`. Sin ella todo funciona, pero ante un token reutilizado no se puede revocar la cadena de esa sesión.

### 🔀 Cambiado — Flujo de registro e inicio de sesión por tipo de perfil
- `POST /auth/register` **ya no inicia sesión**: responde `{ message, user: { id, email, role } }` sin tokens. La persona debe iniciar sesión y en el login se decide su destino.
- `POST /auth/login` ahora incluye `profileType` (en la raíz y en `user.profileType`), resuelto por `AuthService.resolveProfileType()`:
  - `admin` → rol `admin`; `profesor` → rol `profesor`; `tester` → rol `test`.
  - Rol `usuario`: `tutor` si tiene estudiantes en `tutor_students`, si no `adulto`. Si la consulta falla no bloquea el login (se asume `adulto`).
- Pruebas: `auth.service.spec.ts` cubre el registro sin tokens y los 5 tipos de perfil (12 pruebas).

### 👤 Perfil Administrador — funcionalidades disponibles
- **Backend (`src/modules/admin/`, protegido con `JwtAuthGuard` + `RolesGuard` + `@Roles(Role.ADMIN)`)**:
  - `GET /admin/users`: listado paginado con filtros por rol, estado activo y búsqueda por nombre/correo; incluye `days_remaining` para testers.
  - `GET /admin/users/:id`: detalle de un usuario.
  - `PATCH /admin/users/:id`: modificar datos personales, rol o estado activo.
  - `PATCH /admin/users/:id/email`: cambiar el correo (Auth y perfil).
  - `PATCH /admin/users/:id/extend-trial`: extender el periodo de prueba de un tester.
  - `DELETE /admin/users/:id`: eliminar un usuario (Auth, perfil y sesiones).
  - `POST /institutions` y `POST /licenses`: crear instituciones y licencias.
- **Frontend**: panel `/admin` con resumen, búsqueda, filtro por rol, tabla y paginación (solo lectura). Las acciones de edición aún no tienen interfaz (ver pendientes).
- El administrador nunca ve el formulario inicial.

### 🐛 Corregido — Sesiones de usuario en el cliente compartido de Supabase (`SupabaseService`)
- `signUp`, `signInWithPassword` y `signInWithIdToken` se ejecutaban sobre el cliente compartido. supabase-js guarda la sesión obtenida y la usa en las consultas siguientes, así que después de un registro o un login **todo el backend consultaba la base como ese usuario (con RLS)** en lugar de usar la llave secreta. Síntoma: el registro fallaba con "No pudimos crear tu perfil" al insertar en `profiles`.
- Nuevo `SupabaseService.createAuthClient()`: cliente desechable para las operaciones que inician sesión. `getClient()` queda solo para la llave secreta, y ambos se crean con `persistSession: false`, `autoRefreshToken: false` y `detectSessionInUrl: false`.

### 🐛 Corregido — Manejo de errores en el registro (`AuthService.register()`)
- Se eliminó `birth_date` del insert en `profiles`: la columna no existe en la base de datos y hacía fallar todo registro con `Could not find the 'birth_date' column of 'profiles'`.
- Reversión completa ante fallos: si falla el perfil, el docente, un estudiante, su vínculo, su matrícula o una licencia, se eliminan los estudiantes y el perfil creados y el usuario de Supabase Auth. Si la reversión falla, se registra en el log para limpieza manual (antes el usuario quedaba huérfano en Auth y el correo bloqueado con `User already registered`).
- Los errores de estudiantes, matrículas y licencias ya no se ignoran en silencio.
- Mensajes claros en español: correo ya registrado y duplicados (`23505`) → `409 Conflict`; contraseña débil, correo inválido o límite de intentos → `400`; errores internos → `500` con mensaje genérico. El detalle técnico de Supabase solo queda en el log (`Logger`).
- La pre-autorización docente se marca como usada solo cuando todo el registro fue exitoso.
- Validación de IDs: `@IsUUID('4')` → `@IsUUID('loose')` con mensajes en español en `RegisterDto` (titular e hijos), `CreateLicenseDto`, `QueryLicensesDto` y `SubmitAssessmentDto`. Los colegios semilla (`11111111-…`) no son UUID v4 y el registro respondía `children.0.institutionId must be a UUID`; PostgreSQL acepta cualquier UUID con formato válido.
- Al registrar un hijo, `students` ahora guarda también `grade` e `institution_id` (requiere la migración `20261006_students_registration_fields.sql`).
- Pruebas unitarias en `auth.service.spec.ts` (registro exitoso, correo duplicado, documento duplicado, fallo de perfil y de estudiante con reversión).

### ⚠️ Acción requerida en el entorno
- `SUPABASE_SERVICE_ROLE_KEY` en `backend/.env` contiene una llave **pública** (`sb_publishable_…`). Debe reemplazarse por la llave **secreta** (`sb_secret_…`, Supabase → *Project Settings → API Keys*). Sin ella, `auth.admin.deleteUser()` falla (no se puede revertir un registro) y todas las consultas del backend quedan sujetas a RLS.
- Las migraciones del repositorio no reflejan el esquema real de `profiles` ni de `students` (ej. `students.age` no está en ninguna migración y `students.institution_id`/`grade` aparecen como `NOT NULL`). Conviene exportar el esquema real a una migración base.

---

## [1.1.0] - 2026-10-01

### 🏛️ Módulo de Instituciones, Pre-autorización y Licencias

#### ✅ Implementado
- **Migración DDL Integral (`database/migrations/20261001_institutions_licenses_assessments_schema.sql`)**:
  - `institutions`: Colegios públicos y privados (`type: 'publico' | 'privado'`), NIT, ciudad, dirección y soft-delete (`deleted_at`).
  - `institution_preauth_teachers`: Pre-autorización de docentes por institución (`institution_id`, `document_number`, `email`, `is_registered`).
  - `teachers`, `teacher_institutions` (M:N) y `teacher_grades`: Vinculación de profesores a múltiples instituciones y grados lectivos.
  - `student_enrollments`: Histórico de matrículas para cambio de colegio manteniendo el historial del alumno.
  - `teacher_students` y `tutor_students`: Relaciones formales profesor ↔ estudiante y tutor ↔ hijo.
  - `licenses`: Sistema unificado de licencias (`plan_type: 'free' | 'trial' | 'pro'`, `origin: 'personal' | 'institucional'`) con expiración calculada a 14 días.
  - `initial_assessments`: Evaluaciones psicopedagógicas medibles (≤ 10 preguntas) con `total_score`, `risk_level` ('bajo', 'moderado', 'alto'), `primary_condition` y respuestas en `jsonb`.
  - Datos semilla para colegios públicos/privados y docentes autorizados.
- **Nuevos Módulos NestJS**:
  - `src/modules/institutions/`: Endpoints `GET /institutions`, `GET /institutions/:id`, `POST /institutions/preauth-check` y `POST /institutions` (Admin).
  - `src/modules/licenses/`: Endpoints `GET /licenses/current` y `POST /licenses` (Admin) con algoritmo de resolución de plan activo (*Pro Institucional > Pro Personal > Trial 14d > Free*).
  - `src/modules/assessments/`: Endpoints `POST /assessments` y `GET /assessments/history` con cálculo de puntajes y actualización de `has_completed_setup = true`.
- **Actualización en `AuthModule` (`src/modules/auth/`)**:
  - `RegisterDto`: Soporte para registro condicional de Tutores (arreglo dinámico de $N$ hijos), Docentes (validación obligatoria de pre-autorización institucional) y Adultos.
  - `AuthService.register()`: Bloqueo con `403 Forbidden` si el docente no está pre-autorizado. Creación en cascada de estudiantes, tutorados, matrículas y licencias de prueba de 14 días.
  - `AuthService.login()`: Inyección de información de licencia activa (`plan`, `daysRemaining`, `origin`) y estado de configuración en la respuesta.
- **Pruebas Unitarias**:
  - `institutions.service.spec.ts`
  - `licenses.service.spec.ts`
  - `assessments.service.spec.ts`

---

## ⏳ Pendiente por Implementar (Próximos Pasos)

0. **🔴 URGENTE — Arreglar el entorno para que el registro funcione** (detalle en `[Unreleased]` → *Acción requerida en el entorno*):
   - [x] En `backend/.env`, reemplazar `SUPABASE_SERVICE_ROLE_KEY` por la llave **secreta** (`sb_secret_…`) y reiniciar el backend.
   - [x] Eliminar el usuario huérfano `marisolvice@gmail.com` en Supabase → *Authentication → Users*.
   - [x] **Aplicar las migraciones pendientes en Supabase → SQL Editor, en este orden** (aplicadas y verificadas el 2026-10-07: la base tiene 23 tablas) (verificado el 2026-10-06: la base solo tiene `institutions`, `profiles`, `refresh_tokens`, `students` y `user_presence`; por eso `GET /institutions` responde 500 con `column institutions.nit does not exist`):
     1. `database/migrations/20261001_institutions_licenses_assessments_schema.sql`
     2. `database/migrations/20261001_unity_telemetry_cognitive_dashboards.sql`
     3. `database/migrations/20261006_students_registration_fields.sql` (agrega `students.age` y vuelve opcionales `institution_id` y `grade`)
   - [x] Repetir la prueba de registro de un tutor con un hijo (2026-10-07: `marisolvice@gmail.com` quedó registrada como tutora de Matías, con licencias de prueba y formulario de niños completado).
   - [x] **Aplicar en Supabase → SQL Editor** `database/migrations/20261007_refresh_tokens_session_family.sql` (verificado el 2026-10-08: `refresh_tokens.session_id` existe).
   - [ ] **Aplicar en Supabase → SQL Editor** `database/migrations/20261008_app_sessions.sql` (tabla `app_sessions` para el estado de conexión de la app en el dashboard del tutor). Sin ella, `GET /presence/me` responde 500 y la tarjeta muestra un error.
   - [ ] Exportar el esquema base real de `profiles`, `students` y `refresh_tokens` a una migración inicial en `database/migrations/` (hoy no está en el repositorio).

1. **Módulo de Telemetría (`src/modules/telemetry/`)**:
   - Implementar la lógica de negocio en `telemetry.service.ts` y endpoints en `telemetry.controller.ts`.
   - Persistir sesiones de juego (`CreateGameSessionDto`) y trazos cinemáticos/táctiles (`StrokePointDto`).
   - Conectar los reportes del dashboard del docente a las métricas reales de telemetría.
2. **Carga Masiva de Docentes Pre-autorizados (Admin)**:
   - Endpoint administrativo para importar listados de docentes autorizados vía archivo CSV/Excel por institución (`POST /api/v1/admin/institutions/:id/preauth-import`).
3. **Módulo de Notificaciones y Magic Links por Correo (`MailModule`)**:
   - Integración con `nodemailer` para envío de invitaciones y alertas de vencimiento de licencias (Trial próximo a expirar).
4. **Inicio de sesión con Google (OAuth 2.0 / OIDC)** — el endpoint `POST /auth/oauth` ya existe (`AuthService.loginWithOAuth` con `supabase.auth.signInWithIdToken`), pero no está listo para usarse:
   - **Configuración previa (fuera del código)**:
     - Google Cloud Console: crear un *ID de cliente OAuth* tipo "Aplicación web" con los orígenes JavaScript autorizados (`http://localhost:<PUERTO_FRONT>` y el dominio de producción).
     - Supabase → *Authentication → Providers → Google*: habilitarlo con el Client ID y el Client Secret, y agregar el Client ID en **Authorized Client IDs** (sin esto `signInWithIdToken` rechaza el token).
   - **Correcciones necesarias en el backend**:
     - ✅ (Resuelto) `signInWithIdToken` ya usa el cliente desechable `SupabaseService.createAuthClient()`.
     - Quitar `github` del enum de `OAuthLoginDto` (no es un proveedor OIDC, así que no funciona con `signInWithIdToken`) o implementarlo con otro flujo.
     - Agregar `nonce` opcional a `OAuthLoginDto` y pasarlo a `signInWithIdToken` (evita tener que activar *Skip nonce checks* en Supabase).
     - Los perfiles creados por OAuth usan datos inventados (`document_number: OAUTH-xxxx`, `age: 18`, `phone: +0000000000`, rol `test`). Definir un endpoint para completar el perfil después del primer inicio de sesión.
   - Agregar pruebas unitarias de `loginWithOAuth` (usuario nuevo, usuario existente, cuenta desactivada y token inválido).
   - `loginWithOAuth` aún no devuelve `profileType`; agregarlo igual que en `login()` para que el frontend redirija según el perfil.
5. **Acceso del estudiante desde la app de Unity** (decisiones del 2026-10-07 y 2026-10-08):
   - ✅ **Definido**: el niño **no tiene cuenta propia**. En la app de Unity y en la web se usa la cuenta del tutor (o la del adulto), y esa misma cuenta puede estar abierta en ambas a la vez, sin restricción (implementado, ver `[Unreleased]`). `resolveProfileType()` no tendrá un tipo `estudiante`.
   - Pendiente con el equipo de Unity:
     - La app usa `POST /auth/login` y `POST /auth/refresh` igual que la web.
     - Definir cómo la app sabe con qué hijo se juega cuando el tutor tiene varios (ej. selector de hijo tras el login, con un endpoint que liste los hijos del tutor).
     - Exponer los endpoints de telemetría que la app necesite (pendiente #1).
7. ✅ **Presencia en línea con varios dispositivos**: resuelto con `app_sessions` (una fila por sesión y por cliente). Ver `[Unreleased]`.
8. ✅ **Endpoint para que Unity liste los hijos del tutor**: `GET /students/mine` (ver `[Unreleased]`). Falta que la app de Unity lo consuma.
   - ✅ (2026-10-25) El formulario de un hijo agregado desde Configuración ya se guarda con su `studentId`. Sigue pendiente: el formulario del **registro** (primer inicio de sesión) se guarda sin `studentId`; con varios hijos registrados de una vez no se sabe de cuál es.
9. **Integración de la app de Unity** con `docs/unity-app-sessions.md`: implementar el servicio de sesiones en Unity y probar el flujo completo con el dashboard del tutor.
6. ✅ **Refresco de token y tipo de perfil** (2026-10-29): `POST /auth/refresh` devuelve `profileType` y `audience`; la web actualiza la cookie `profile_type` y Unity su `PlayerSession`.
