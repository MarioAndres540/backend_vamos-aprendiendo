# Spec 0001 — Módulo del profesor y contexto del progreso

- **Estado:** aprobado para implementar (fase 1 y 2 del análisis "Perfil de profesor")
- **Fecha:** 2026-11-02
- **Relacionado:** migraciones `20261102_*`, análisis "Perfil de profesor: análisis técnico y funcional"

## Contexto

Un mismo niño puede jugar en casa (cuenta del tutor) y en el colegio (su cuenta de estudiante). Son ambientes distintos: el progreso, los ejercicios aprobados y el XP de cada uno no se mezclan. El profesor solo ve el progreso **escolar** de los estudiantes de los grupos y materias que tiene asignados.

## Historias de usuario

- **HU-1.** Como tutor, quiero ver solo lo que mi hijo hace en casa, para que el seguimiento del hogar no se confunda con el del colegio.
- **HU-2.** Como estudiante de un colegio, quiero que mi progreso en el colegio quede a mi nombre, aunque en casa juegue con la cuenta de mi tutor.
- **HU-3.** Como profesor, quiero ver los indicadores de cada grupo y materia asignados, para saber cómo va el grupo.
- **HU-4.** Como profesor, quiero abrir el seguimiento de un estudiante de mi grupo, para ver su progreso escolar en mi materia.

## Criterios de aceptación

### Contexto del progreso (CTX)

| ID | Criterio |
| --- | --- |
| CTX-01 | Dado un estudiante con cuenta propia y matrícula activa, cuando registra o importa un ejercicio, entonces se guarda con `context = 'escolar'` y el `institution_id` de su matrícula activa. |
| CTX-02 | Dada una cuenta de tutor o de adulto, cuando registra o importa un ejercicio, entonces se guarda con `context = 'hogar'` y sin colegio. |
| CTX-03 | El contexto lo decide el backend según la cuenta autenticada; la petición no puede elegirlo. |
| CTX-04 | Las lecturas de progreso, desempeño, rutas y XP filtran por el contexto de la cuenta: el tutor ve solo `hogar`; la cuenta de estudiante solo `escolar`. |
| CTX-05 | Un mismo ejercicio se aprueba y entrega XP una vez por estudiante **en cada** contexto (aprobarlo en casa no lo marca aprobado en el colegio). |
| CTX-06 | Las sesiones de la app (`app_sessions`) guardan el contexto y el colegio de la cuenta. |

### Acceso del profesor (TACC)

| ID | Criterio |
| --- | --- |
| TACC-01 | Toda consulta de un grupo o estudiante lleva el id de una asignación. Responde **404** si la asignación no es del profesor, está cerrada, su grupo está inactivo o el vínculo del profesor con el colegio no está activo. |
| TACC-02 | Responde **404** si el estudiante no tiene matrícula activa en el grupo de la asignación (incluye estudiantes de otros grupos y colegios). Nunca 403: no se revela si existe. |
| TACC-03 | Solo el rol `profesor` accede (el resto recibe 403 por rol; el administrador conserva su acceso de soporte). |
| TACC-04 | Cada consulta del detalle de un estudiante (datos personales) queda registrada en `data_access_log`: quién, qué estudiante, desde qué asignación y cuándo. Si el registro falla, la consulta no se bloquea y se deja un aviso en el log. |

### Indicadores del grupo (TSUM) — `GET /teacher/assignments/:assignmentId/summary`

| ID | Criterio |
| --- | --- |
| TSUM-01 | `enrolled`: estudiantes con matrícula activa en el grupo. |
| TSUM-02 | `withActiveLicense`: de ellos, cuántos tienen una licencia institucional activa y vigente del colegio del grupo. |
| TSUM-03 | `activeRecently`: de ellos, cuántos tienen actividad escolar (intento de ejercicio o sesión de la app) en los últimos 7 días. |
| TSUM-04 | Por estudiante: ejercicios aprobados y total de las rutas de la materia, dominio (aprobados / total, %), intentos, fecha del último intento escolar en esas rutas y `hasData` (tiene al menos un intento o aprobado escolar en esas rutas). Sin datos, el dominio y la fecha son `null`. |
| TSUM-05 | `averageMastery`: promedio del dominio solo de los estudiantes con `hasData`; `null` si ninguno tiene datos. `withoutData` cuenta los que no tienen datos. |
| TSUM-06 | Solo cuenta datos `escolar` del colegio del grupo y de las rutas de la materia (`subject_routes`). Nada del hogar. |
| TSUM-07 | No incluye documentos ni datos de contacto. |

### Seguimiento de un estudiante (TPROG) — `GET /teacher/assignments/:assignmentId/students/:studentId`

| ID | Criterio |
| --- | --- |
| TPROG-01 | Devuelve los datos del estudiante: nombres, apellidos, fecha de nacimiento, edad, tipo y número de documento, colegio, grado y grupo. |
| TPROG-02 | Devuelve las materias que ese profesor tiene asignadas en el grupo del estudiante (puede ser más de una). |
| TPROG-03 | Por cada una de esas materias: progreso por ruta (aprobados, en progreso, pendientes), cada ejercicio con su estado, intentos y mejor exactitud, la exactitud promedio y la última actividad. |
| TPROG-04 | XP escolar del estudiante en ese colegio. Tiempo con la app abierta en el contexto escolar en los últimos 30 días. |
| TPROG-05 | Solo datos `escolar` del colegio del grupo: los datos del hogar del mismo niño no aparecen. |

## Fuera de alcance

- Clasificación del rendimiento (superior / esperado / por debajo): necesita criterios del equipo pedagógico. Mientras tanto se muestran las métricas sin clasificar.
- Datos del adulto responsable en el detalle: pendiente de definir la autorización (Ley 1581 de 2012).
- Pantallas para administrar grupos, matrículas y asignaciones.
- Separar el consumo de licencias por contexto en `GET /licenses`.

## Contrato técnico

- Tablas: `context` en la telemetría (migración `20261102_progress_context.sql`), `data_access_log` (migración `20261102_data_access_log.sql`).
- Backend: `TeacherAccessService` (TACC), `TeacherService.getAssignmentSummary` (TSUM), `TeacherService.getStudentDetail` (TPROG); `TelemetryService` y `PresenceService` con contexto (CTX).
- Frontend: tarjetas de indicadores y listado con dominio en `pages/teacher/dashboard.vue`; nueva página `pages/teacher/assignments/[assignmentId]/students/[studentId].vue`.

## Pruebas

Cada criterio tiene al menos una prueba que lleva su ID en el nombre (`it('CTX-01: …')`):

| Criterios | Archivo |
| --- | --- |
| CTX-01 a CTX-04 | `src/modules/telemetry/telemetry-context.service.spec.ts`, `import-exercises.service.spec.ts` |
| CTX-05 | `database/tests/progress-context.integration.cjs` (PostgreSQL real, embebido) |
| CTX-06 | `src/modules/presence/presence.service.spec.ts` |
| TACC, TSUM, TPROG | `src/modules/teacher/teacher-assignments.service.spec.ts` (base en memoria que aplica los filtros) |

**Sin pruebas automáticas en el frontend:** el proyecto Nuxt no tiene Vitest ni Playwright. Las páginas se validan compilándolas, con `npm run build` y probando el backend de punta a punta.
