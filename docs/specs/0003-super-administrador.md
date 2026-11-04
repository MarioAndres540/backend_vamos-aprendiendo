# Spec 0003: Perfil super administrador

- **Estado:** borrador para revisión
- **Fecha:** 2026-11-03
- **Relacionado:**
  - spec 0001 (módulo del profesor);
  - análisis de los flujos de registro del 2026-11-03;
  - módulo `admin` actual.

## Contexto

Hoy los colegios, las preautorizaciones de docentes, los grupos, las asignaciones, las matrículas con grupo y las cuentas de alumno solo se crean con scripts SQL. Por eso, un profesor recién registrado llega a un dashboard vacío. Además, nadie puede vincular a un tutor con un alumno que el colegio ya tiene.

El rol `admin` actual solo administra usuarios: listar, editar, cambiar el correo, extender la prueba y eliminar. Este rol **pasa a ser el super administrador**. Es un solo rol de plataforma: el valor `admin` se conserva en la base de datos, y la interfaz lo muestra como "Super administrador".

## Decisiones tomadas

| # | Decisión |
| --- | --- |
| D-1 | El rol `admin` se amplía a super administrador. No se crea un rol nuevo. |
| D-2 | **Eliminar** es en realidad **desactivar**: el registro deja de verse y de dar acceso, conserva su historial y se puede reactivar. Aparte existe **Borrar definitivamente**, con confirmación escribiendo el nombre, para atender solicitudes de supresión de datos (Ley 1581). |
| D-3 | Al alumno se le puede crear una cuenta propia (opcional). Si se crea, el sistema genera una **contraseña temporal que se muestra una sola vez**, para entregarla al colegio. |
| D-4 | El profesor ingresa con su correo y contraseña. Si no tiene ningún vínculo activo con un colegio activo, no puede ingresar. Una vez dentro, solo ve sus colegios activos. |
| D-5 | El vínculo entre un tutor y un alumno del colegio lo crea el super administrador. El tutor no puede reclamar por su cuenta a un alumno que ya existe. |
| D-6 | **Los tutores nunca se borran: solo se desactivan.** Un menor puede tener varios tutores; por ejemplo, el papá y la mamá, cada uno con su licencia. |
| D-7 | **Cada licencia es un ecosistema individual que no se combina con otro.** El espacio de hogar de cada par (tutor, menor) tiene su propio progreso, ejercicios aprobados y XP, y lo cubre la licencia de ese tutor. Un tutor no ve, no suma ni hereda el espacio de otro tutor, ni siquiera cuando el otro se desactiva o su licencia vence. El colegio es otro ecosistema con su propio progreso escolar. |

## Historias de usuario

- **HU-1.** Como super administrador, quiero crear, editar, desactivar y borrar colegios, para tener al día los colegios que usan la plataforma.
- **HU-2.** Como super administrador, quiero cargar a los profesores de cada colegio, para que solo ellos puedan registrarse e ingresar como docentes de ese colegio.
- **HU-3.** Como super administrador, quiero crear los grupos de un colegio y asignar a cada profesor sus grupos y materias, para que el profesor vea a sus alumnos.
- **HU-4.** Como super administrador, quiero crear alumnos, ubicarlos en un grupo y, si hace falta, darles una cuenta, para que su progreso escolar quede a su nombre.
- **HU-5.** Como super administrador, quiero ver y administrar a los tutores y sus hijos, y vincular a un tutor con un alumno del colegio, para que el mismo niño no quede duplicado.
- **HU-6.** Como profesor, solo quiero poder registrarme en un colegio que me tenga cargado como docente.
- **HU-7.** Como super administrador, quiero un entorno pensado para mi rol, con navegación por colegios, profesores, alumnos, tutores y usuarios.

## Criterios de aceptación

### Rol y acceso (SA-ROLE)

| ID | Criterio |
| --- | --- |
| SA-ROLE-01 | Todas las rutas `/admin/**` exigen JWT y el rol `admin`. Los demás roles reciben 403. |
| SA-ROLE-02 | El super administrador no puede desactivarse, borrarse ni cambiarse de rol a sí mismo, y no se puede dejar la plataforma sin ningún `admin` activo. En esos casos responde **409**. |
| SA-ROLE-03 | En el frontend, el perfil `admin` entra a `/admin` y no ve el formulario inicial, el dashboard del tutor ni el del profesor. |
| SA-ROLE-04 | Cada creación, edición, desactivación, reactivación y borrado que hace el super administrador queda registrado en `admin_audit_log` (quién, acción, tipo de entidad, id y fecha). Si el registro falla, la operación no se revierte, pero se deja un aviso en el log. |

### Colegios (SA-INST)

| ID | Criterio |
| --- | --- |
| SA-INST-01 | `GET /admin/institutions`: lista paginada con búsqueda por nombre o código, filtro activo o inactivo y conteos de profesores, grupos y alumnos activos. |
| SA-INST-02 | `POST /admin/institutions`: crea un colegio con nombre (obligatorio), código DANE, dirección, teléfono y correo. Si el código ya existe responde **409**. |
| SA-INST-03 | `GET /admin/institutions/:id` y `PATCH /admin/institutions/:id`: ven y editan los datos del colegio. Si no existe responde 404. |
| SA-INST-04 | `PATCH /admin/institutions/:id/status { isActive }`: desactiva o reactiva el colegio. Mientras está inactivo:<ul><li>no aparece en la lista de colegios del registro;</li><li>sus preautorizaciones no sirven para registrarse;</li><li>sus asignaciones no se muestran al profesor;</li><li>las cuentas de alumno de ese colegio no pueden ingresar.</li></ul> |
| SA-INST-05 | `DELETE /admin/institutions/:id` (borrado definitivo):<ul><li>solo se permite si el colegio está inactivo y no tiene alumnos ni vínculos con profesores; si no, responde **409** y explica qué falta;</li><li>borra también sus grupos y sus preautorizaciones.</li></ul> |

### Profesores (SA-TCH)

| ID | Criterio |
| --- | --- |
| SA-TCH-01 | `GET /admin/institutions/:id/teachers`: lista a los profesores del colegio en dos estados:<ul><li>**pendiente de registro**: está preautorizado y todavía no tiene cuenta;</li><li>**registrado**: tiene cuenta y vínculo con el colegio, activo o inactivo.</li></ul> |
| SA-TCH-02 | `POST /admin/institutions/:id/teachers { documentNumber, email, fullName }`: carga a un profesor en el colegio.<ul><li>Si ya existe una cuenta de profesor con ese correo, lo vincula de inmediato (`teacher_institutions` activo).</li><li>Si no existe, crea la preautorización.</li><li>Si el correo pertenece a una cuenta que no es de profesor, responde **409**.</li><li>Si el profesor ya está cargado en ese colegio, responde **409**.</li></ul> |
| SA-TCH-03 | `PATCH` sobre una preautorización pendiente: edita el documento, el correo y el nombre. Una preautorización ya usada no se edita; lo que se edita es el usuario, en SA-USR. |
| SA-TCH-04 | `PATCH /admin/institutions/:id/teachers/:teacherId/status { isActive }`: desactiva o reactiva el vínculo del profesor con el colegio. Al desactivarlo, también se cierran sus asignaciones en ese colegio. |
| SA-TCH-05 | `DELETE` de una preautorización pendiente la borra. El borrado definitivo de un profesor registrado se hace como usuario (SA-USR-04). |

### Registro e ingreso del profesor (TREG)

| ID | Criterio |
| --- | --- |
| TREG-01 | El registro como profesor solo se completa si existe una preautorización **no usada** para el colegio elegido, con el mismo documento y correo (sin distinguir mayúsculas), y si ese colegio está activo. En cualquier otro caso responde **403** con el mensaje "No figuras como docente autorizado por este colegio. Comunícate con el administrador." |
| TREG-02 | La lista de colegios del registro solo muestra colegios activos. |
| TREG-03 | Ingreso (`/auth/login`): una cuenta con rol `profesor` sin ningún vínculo activo en un colegio activo recibe **403** con el mensaje "Tu cuenta de docente no está vinculada a ningún colegio activo. Comunícate con el administrador." No se emiten tokens. |
| TREG-04 | La misma regla se aplica al renovar la sesión (`/auth/refresh`): si al profesor le quitaron todos sus colegios, la sesión deja de renovarse. |
| TREG-05 | La misma regla aplica a las cuentas con rol `estudiante`: su colegio debe estar activo y el alumno debe estar activo. |

### Grupos y asignaciones (SA-GRP)

| ID | Criterio |
| --- | --- |
| SA-GRP-01 | `GET/POST /admin/institutions/:id/groups`: lista y crea los grupos de un colegio, con año lectivo, grado y nombre (por ejemplo "2A"). Si ya existe un grupo con el mismo colegio, año y nombre, responde **409**. |
| SA-GRP-02 | `PATCH /admin/groups/:groupId`: edita el grado y el nombre, o desactiva o reactiva el grupo. Un grupo inactivo no aparece al profesor. |
| SA-GRP-03 | `DELETE /admin/groups/:groupId` (borrado definitivo): solo se permite si el grupo no tiene matrículas. Si las tiene, responde **409**. |
| SA-GRP-04 | `POST /admin/groups/:groupId/assignments { teacherId, subjectId }`: asigna al profesor ese grupo y esa materia.<ul><li>El profesor debe tener un vínculo activo con el colegio del grupo; si no, responde **400**.</li><li>Si la asignación ya existe, responde **409**.</li></ul> |
| SA-GRP-05 | `DELETE /admin/assignments/:id`: cierra la asignación (`is_active = false`, `end_date = hoy`) y la deja en el historial. |

### Alumnos (SA-STU)

| ID | Criterio |
| --- | --- |
| SA-STU-01 | `GET /admin/institutions/:id/students`: lista paginada con búsqueda por nombre o documento y filtros por grupo y por estado. Cada alumno muestra su grupo, si tiene cuenta y sus tutores. |
| SA-STU-02 | `POST /admin/institutions/:id/students`: crea un alumno con:<ul><li>nombres, apellidos, tipo y número de documento, fecha de nacimiento y grado (obligatorios);</li><li>`classGroupId` y `createAccount` (opcionales).</li></ul>Si se indica grupo, crea la matrícula activa en ese grupo. |
| SA-STU-03 | Si ya existe un alumno con el mismo tipo y número de documento, responde **409** e indica el alumno existente, para que se vincule en lugar de duplicarlo. Esto se respalda con un índice único en la base de datos (ver Datos). |
| SA-STU-04 | Con `createAccount: true` se crea una cuenta de rol `estudiante` vinculada al alumno.<ul><li>El correo se puede indicar; si no, se genera `<nombre>.<apellido>.<4 dígitos>@<STUDENT_EMAIL_DOMAIN>`.</li><li>La contraseña temporal es aleatoria, de 12 caracteres, y se devuelve **solo** en esa respuesta: no se guarda en texto ni aparece en los logs.</li></ul> |
| SA-STU-05 | `POST /admin/students/:id/account/reset-password`: genera una contraseña temporal nueva, que se muestra una sola vez. |
| SA-STU-06 | `PATCH /admin/students/:id`: edita los datos del alumno. Para cambiar de grupo, cierra la matrícula activa y crea una nueva en el grupo destino, que debe ser del mismo colegio. |
| SA-STU-07 | `PATCH /admin/students/:id/status`: desactiva o reactiva al alumno. Al desactivarlo, su cuenta deja de poder ingresar y sale de las vistas del profesor. |
| SA-STU-08 | `DELETE /admin/students/:id` (borrado definitivo, con confirmación): borra al alumno, sus matrículas, sus vínculos con tutores, su progreso, sus licencias y su cuenta, incluido el usuario de Supabase Auth. |

### Tutores e hijos (SA-TUT)

| ID | Criterio |
| --- | --- |
| SA-TUT-01 | `GET /admin/tutors`: lista paginada de las cuentas con hijos, con búsqueda. Cada tutor muestra su estado, su licencia y sus hijos. Para cada hijo se ven su colegio y grupo, si los tiene, y **los demás tutores** del menor. |
| SA-TUT-02 | `POST /admin/tutors/:profileId/children`: agrega un hijo nuevo, con los mismos datos y validaciones que el registro del tutor, incluida la regla de documento único de SA-STU-03. |
| SA-TUT-03 | `POST /admin/tutors/:profileId/children/link { studentId, relationship }`: vincula al tutor con un alumno que ya existe, por ejemplo uno del colegio. Si el vínculo ya existe, responde **409**. |
| SA-TUT-04 | `DELETE /admin/tutors/:profileId/children/:studentId`: quita el vínculo. El alumno no se borra. |
| SA-TUT-05 | `PATCH` sobre los datos de un hijo: usa el mismo endpoint de SA-STU-06. |
| SA-TUT-06 | Un menor puede tener **varios tutores activos** al mismo tiempo, y además estar matriculado en un colegio. Vincular a un segundo tutor no cambia nada de los otros tutores ni del colegio. |
| SA-TUT-07 | `PATCH /admin/tutors/:profileId/status { isActive }`: desactiva o reactiva al tutor.<ul><li>Desactivado, no ingresa ni renueva su sesión.</li><li>Su espacio de hogar con cada menor y su historial se conservan.</li><li>Los demás tutores del menor y el colegio no se ven afectados.</li></ul>**No existe borrado definitivo de tutores.** |
| SA-TUT-08 | Si un tutor registra a un menor cuyo documento ya existe, ya sea en su registro o desde Configuración:<ul><li>no se crea un duplicado;</li><li>se crea una **solicitud de vínculo pendiente**;</li><li>el tutor ve "Este menor ya está registrado. El administrador revisará tu solicitud para vincularlo a tu cuenta."</li></ul> |
| SA-TUT-09 | `GET /admin/link-requests` y `POST /admin/link-requests/:id/approve` o `/reject`: el super administrador revisa las solicitudes de vínculo. Al aprobar una, se crea el vínculo entre el tutor y el menor, y el espacio de hogar de ese tutor queda vacío y listo para empezar. |

### Espacio de hogar por tutor (HOG)

Este bloque cambia el modelo de la spec 0001 (CTX-02 y CTX-05). Hoy, el progreso de hogar es del menor y no distingue de qué tutor viene.

| ID | Criterio |
| --- | --- |
| HOG-01 | Toda la actividad de hogar de un menor guarda el tutor dueño del espacio (`tutor_profile_id`), es decir, la cuenta autenticada. El backend lo decide; la petición no puede elegirlo. |
| HOG-02 | Un ejercicio se aprueba y da XP una vez por cada espacio: **(menor, tutor)** en hogar, y una sola vez por menor en el ámbito escolar. Que el papá lo apruebe no lo marca aprobado en el espacio de la mamá. |
| HOG-03 | Las lecturas de progreso, desempeño, rutas y XP del tutor filtran por su espacio con el menor. Un tutor nunca ve el progreso de hogar de otro tutor. |
| HOG-04 | La licencia que habilita el espacio es la del tutor para ese menor (`licenses.owner_profile_id` + `student_id`). Cuando vence la licencia de un tutor, no afecta el espacio del otro. |
| HOG-05 | Migración de los datos que ya existen: el progreso de hogar actual se asigna al tutor que lo registró (`usuario_id`). Las cuentas de adulto, que no tienen menor, mantienen su comportamiento actual. |

### Usuarios (SA-USR)

| ID | Criterio |
| --- | --- |
| SA-USR-01 | Se conservan los endpoints actuales de `/admin/users`: listar, ver, editar, cambiar correo y extender prueba. El filtro por rol incluye `estudiante`. |
| SA-USR-02 | Al editar el rol se aplican estas reglas:<ul><li>no se puede asignar `profesor` ni `estudiante` desde aquí, porque esas cuentas nacen de SA-TCH y SA-STU;</li><li>se aplica SA-ROLE-02.</li></ul>Si no se cumplen, responde **400** o **409**. |
| SA-USR-03 | `PATCH /admin/users/:id/status`: desactiva o reactiva la cuenta. Una cuenta inactiva no ingresa ni renueva su sesión, como ya ocurre hoy. |
| SA-USR-04 | `DELETE /admin/users/:id` (borrado definitivo, con confirmación): borra la cuenta en Auth y su perfil. **No aplica a cuentas que tengan menores vinculados.** En ese caso responde **409** con el mensaje "Los tutores no se eliminan, solo se desactivan" (D-6). |

### Entorno del super administrador (SA-UI)

| ID | Criterio |
| --- | --- |
| SA-UI-01 | Hay un layout propio en `/admin`, con un menú lateral (en móvil, plegable): **Inicio, Colegios, Profesores, Alumnos, Tutores, Usuarios**. El encabezado muestra "Super administrador". |
| SA-UI-02 | **Inicio** muestra conteos (colegios, profesores registrados y pendientes, alumnos, tutores y usuarios) y las últimas acciones del registro de auditoría. |
| SA-UI-03 | **Colegios** muestra una tabla con búsqueda. Al abrir un colegio aparecen las pestañas **Datos, Profesores, Grupos y asignaciones y Alumnos**, con las acciones de SA-INST, SA-TCH, SA-GRP y SA-STU. |
| SA-UI-04 | **Profesores** y **Alumnos** son vistas globales, con filtro por colegio, que llevan al colegio correspondiente. **Tutores** cubre SA-TUT y **Usuarios** cubre SA-USR. |
| SA-UI-05 | Las acciones de desactivar piden confirmación simple. El **borrado definitivo** pide escribir el nombre exacto del registro y explica qué se borra. |
| SA-UI-06 | La contraseña temporal de un alumno se muestra una sola vez en un diálogo con botón de copiar, junto con el aviso "No se volverá a mostrar". |
| SA-UI-07 | Los errores 409 y 400 muestran el mensaje del backend en español, por ejemplo "Ya existe un alumno con ese documento: Ver alumno". |

## Datos (migración)

- **`admin_audit_log`**
  - Columnas: `id`, `actor_profile_id`, `action` (`create`, `update`, `deactivate`, `reactivate`, `delete`), `entity_type`, `entity_id`, `details jsonb` (sin datos sensibles) y `created_at`.
  - Con RLS activo y sin políticas: solo accede el backend.
- **Documento único de alumno**
  - Índice único sobre `(document_type, document_number)` de `students`, solo cuando `document_number` no es nulo.
  - En la base de desarrollo no hay duplicados (revisado el 2026-11-03), así que el índice se puede crear directamente. En producción se repite la revisión antes de migrar.
- **`STUDENT_EMAIL_DOMAIN`**: nueva variable de entorno, que se valida en `validateEnv`.
- **`tutor_link_requests`**
  - Columnas: `id`, `tutor_profile_id`, `student_id`, `relationship`, `status` (`pending`, `approved` o `rejected`), `reviewed_by`, `reviewed_at` y `created_at`.
  - Restricción: solo puede haber una solicitud pendiente por cada par (tutor, menor).
- **Espacio de hogar (HOG):** agregar `tutor_profile_id` a las tablas de telemetría y progreso.
  - Cambiar las restricciones únicas de aprobación y XP a `(owner_id, context, tutor_profile_id, …)`, de modo que el valor nulo cuente como un solo espacio, el escolar o el del adulto.
  - Ajustar `record_exercise_attempt` e `import_completed_exercises`.
  - Llenar `tutor_profile_id` en los registros existentes a partir de `usuario_id`.

## Fuera de alcance

- Un administrador por colegio, con alcance limitado a su colegio. Puede ser un rol futuro.
- Obligar al alumno a cambiar la contraseña temporal en su primer ingreso.
- La carga masiva de alumnos y profesores desde Excel o CSV.
- La gestión de licencias desde el panel. Solo se conserva "extender prueba".

## Plan de implementación

1. **Fase 1:**
   - Migración, auditoría y colegios (SA-INST).
   - Profesores (SA-TCH) y las reglas de registro e ingreso (TREG).
   - Layout del panel con Inicio y Colegios.
2. **Fase 2:**
   - Grupos y asignaciones (SA-GRP).
   - Alumnos y cuentas (SA-STU).
3. **Fase 3:**
   - Tutores e hijos (SA-TUT), con las solicitudes de vínculo.
   - Espacio de hogar por tutor (HOG). Esta parte toca las funciones SQL de progreso, así que va con pruebas sobre la base de desarrollo.
   - Ajustes de usuarios (SA-USR).
   - Vistas globales.

Cada fase sigue el mismo orden: primero las pruebas en rojo, después el código, y al final la verificación en la aplicación real.
