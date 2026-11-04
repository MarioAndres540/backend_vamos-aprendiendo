# Spec 0004: Protección de datos personales (Ley 1581 de 2012)

- **Estado:** aprobado para implementar
- **Fecha:** 2026-11-03
- **Marco legal:**
  - Ley 1581 de 2012.
  - Decreto 1377 de 2013, compilado en el Decreto 1074 de 2015, capítulo 25.
  - Artículo 7 de la Ley 1581: datos de niños, niñas y adolescentes.
  - Artículos 5 y 6 de la Ley 1581: datos sensibles.
- **Relacionado:** spec 0003, en particular D-6 (los tutores no se borran) y D-7 (cada licencia es un ecosistema individual).

> Esta spec cubre la parte técnica del cumplimiento. El texto de la política y los datos del responsable deben revisarse con un asesor legal antes de publicar.

## Contexto

La plataforma trata tres tipos de datos que requieren cuidado especial:

- Datos personales de adultos: nombre, documento, edad, teléfono y correo.
- Datos de **menores de edad**: identificación, colegio, grado y progreso.
- **Datos sensibles relativos a la salud**: las evaluaciones iniciales miden atención, memoria, control de impulsos, orientación y desarrollo de la lectoescritura y el cálculo, y asignan un "nivel de riesgo".

Lo que tiene la plataforma hoy no cumple:

- Hay **una sola casilla** genérica de términos.
- No hay una política publicada.
- No se guarda la versión aceptada ni la fecha de la autorización.
- La evaluación es obligatoria para entrar.
- El titular no tiene un canal para consultar, rectificar, revocar o pedir la supresión de sus datos.
- El ingreso con Google crea cuentas marcadas como "aceptó términos" sin habérselos mostrado.

## Decisiones

| # | Decisión |
| --- | --- |
| PD-D1 | Hay tres autorizaciones separadas, y ninguna viene marcada de antemano:<ul><li>**tratamiento de datos personales** (obligatoria);</li><li>**datos de menores como representante legal** (obligatoria si se registran menores);</li><li>**datos sensibles** (facultativa).</li></ul> |
| PD-D2 | Responder la evaluación inicial es **facultativo**. Quien no autoriza los datos sensibles puede omitirla y usar la plataforma igual. |
| PD-D3 | La **supresión** de un tutor o adulto **anonimiza** su cuenta y la deja inactiva, sin borrarla (D-6). Se borran los datos de su ecosistema. Los menores que no tengan otro tutor, ni colegio, ni cuenta propia se borran. Las licencias se conservan sin datos personales, por la obligación contable de conservar los registros de facturación. |
| PD-D4 | La supresión **se limita al ecosistema del titular** (D-7). Suprimir los datos del papá nunca toca el espacio de la mamá ni el del colegio. |
| PD-D5 | Los datos que el colegio trata de sus alumnos (la cuenta de estudiante y el progreso escolar) los responde el colegio como responsable. Las solicitudes sobre esos datos las tramita el super administrador con el colegio y no se suprimen automáticamente. |

## Criterios de aceptación

### Política y aviso (PD-POL)

| ID | Criterio |
| --- | --- |
| PD-POL-01 | Existe una página pública `/data-policy` con la política de tratamiento, que incluye:<ul><li>la identificación del responsable;</li><li>el tratamiento y sus finalidades;</li><li>el tratamiento de datos de menores y de datos sensibles;</li><li>los derechos del titular;</li><li>el área responsable;</li><li>el procedimiento de consultas y reclamos con sus plazos;</li><li>la transferencia y transmisión internacional (los proveedores de alojamiento están fuera de Colombia);</li><li>las cookies;</li><li>la vigencia y la versión.</li></ul> |
| PD-POL-02 | Los datos del responsable (nombre, identificación, dirección, ciudad, correo y teléfono) salen de la configuración (`NUXT_PUBLIC_DATA_CONTROLLER_*`), no del código. |
| PD-POL-03 | La versión vigente de la política es una constante del backend, que se expone en `GET /privacy/policy` sin autenticación. El registro manda la versión que mostró, y si no coincide con la vigente responde **400**. |
| PD-POL-04 | El registro, el login y la página de privacidad enlazan a la política. |

### Autorizaciones (PD-CONS)

| ID | Criterio |
| --- | --- |
| PD-CONS-01 | `POST /auth/register` exige `acceptedTerms: true` y `policyVersion`. Si hay menores, también exige `acceptedMinorsData: true`. `acceptedSensitiveData` es opcional. |
| PD-CONS-02 | Cada autorización se guarda en `privacy_consents` con:<ul><li>titular, tipo, si se otorgó o no, versión de la política y fecha;</li><li>la IP y el agente de usuario (como prueba de la autorización, artículo 8 del Decreto 1377);</li><li>el menor, cuando aplica.</li></ul>Los registros no se editan: un cambio agrega una fila nueva. |
| PD-CONS-03 | `POST /students` (agregar un menor) exige `acceptedMinorsData: true` y guarda esa autorización para ese menor. |
| PD-CONS-04 | Ingreso con Google para una cuenta nueva: sin `acceptedTerms: true` y `policyVersion` vigente responde **400** y no crea la cuenta. Ya no se marca `accepted_terms` sin que la persona haya aceptado. |
| PD-CONS-05 | `GET /privacy/me/consents` devuelve el estado vigente de cada autorización: la última fila de cada tipo. |

### Datos sensibles (PD-SENS)

| ID | Criterio |
| --- | --- |
| PD-SENS-01 | `POST /assessments` responde **403** (`code: SENSITIVE_CONSENT_REQUIRED`) si la última autorización de datos sensibles del titular no está otorgada. |
| PD-SENS-02 | `POST /assessments/skip` marca la configuración inicial como completa sin guardar ningún dato, para que la persona pueda usar la plataforma sin evaluación. |
| PD-SENS-03 | `POST /privacy/me/consents { type: 'datos_sensibles', granted }` otorga o revoca la autorización. Al revocarla se borran las evaluaciones iniciales que hizo el titular, incluidas las de sus menores (revocatoria del artículo 9 de la ley). |
| PD-SENS-04 | Antes de la evaluación, el frontend informa que las preguntas son sobre datos sensibles y que responderlas es facultativo. Ofrece dos opciones: "Autorizar y continuar" u "Omitir". |

### Derechos del titular (PD-ARCO)

| ID | Criterio |
| --- | --- |
| PD-ARCO-01 | `GET /privacy/me/export` (derecho de acceso) devuelve en JSON:<ul><li>el perfil;</li><li>los menores a cargo;</li><li>las autorizaciones y las solicitudes;</li><li>las evaluaciones;</li><li>el resumen del progreso **de su ecosistema**.</li></ul>No incluye datos de otros tutores ni del colegio. |
| PD-ARCO-02 | `POST /privacy/me/requests { type, studentId?, description }` radica una solicitud.<ul><li>Tipos: `consulta`, `actualizacion`, `rectificacion`, `supresion`, `revocatoria` y `prueba_autorizacion`.</li><li>Si se indica `studentId`, debe ser un menor vinculado al titular; si no, responde 404.</li></ul> |
| PD-ARCO-03 | Plazo (`due_at`) en días hábiles (sin contar sábados ni domingos; los festivos no se descuentan):<ul><li>consulta: **10 días hábiles** (artículo 14);</li><li>todos los demás tipos son reclamos: **15 días hábiles** (artículo 15).</li></ul> |
| PD-ARCO-04 | `GET /privacy/me/requests` lista las solicitudes del titular con su estado y la respuesta. |
| PD-ARCO-05 | Solo hay una solicitud abierta por titular, tipo y menor. Si ya existe una, responde **409**. |

### Gestión por el super administrador (PD-ADM)

| ID | Criterio |
| --- | --- |
| PD-ADM-01 | `GET /admin/data-requests` lista las solicitudes, con filtro por estado. Marca como **vencidas** las abiertas cuyo `due_at` ya pasó. |
| PD-ADM-02 | `PATCH /admin/data-requests/:id { status, response }` las tramita o resuelve. Los estados son `radicada`, `en_tramite`, `resuelta` y `rechazada`. Resolver o rechazar exige una respuesta. |
| PD-ADM-03 | `POST /admin/data-requests/:id/execute-suppression` ejecuta la supresión de una solicitud de tipo `supresion` o `revocatoria`:<ul><li>Con un menor indicado, borra los datos del menor en el ecosistema del titular y el vínculo entre los dos. Si el menor no tiene otro tutor, ni matrícula activa, ni cuenta propia, lo borra.</li><li>Sin menor, aplica lo anterior a todos sus menores, borra los datos propios del titular, **anonimiza** el perfil, lo desactiva y deja inaccesible su usuario de Auth.</li><li>Se ejecuta en una sola transacción (RPC) y deja la solicitud resuelta.</li><li>Las cuentas de profesor, estudiante y admin responden **409** (PD-D5).</li></ul> |
| PD-ADM-04 | Cada acción sobre las solicitudes queda en `admin_audit_log` (spec 0003, SA-ROLE-04). |

## Datos (migración `20261104_data_protection.sql`)

- **`privacy_consents`**
  - Columnas: `id`, `profile_id`, `student_id` (opcional), `consent_type` (`tratamiento_datos`, `datos_menores` o `datos_sensibles`), `granted`, `policy_version`, `ip_address`, `user_agent` y `created_at`.
- **`data_requests`**
  - Columnas: `id`, `profile_id`, `student_id`, `request_type`, `description`, `status`, `due_at`, `response`, `resolved_by`, `resolved_at` y `created_at`.
  - Índice único parcial sobre las solicitudes abiertas.
- **`admin_audit_log`** (spec 0003).
- **`suppress_titular_data(p_profile_id, p_student_id)`**: función `SECURITY DEFINER` con `search_path` fijo, que solo puede ejecutar `service_role`.
- Todas las tablas tienen RLS activo y sin políticas: solo accede el backend.

## Fuera de alcance

- La inscripción en el **Registro Nacional de Bases de Datos** (RNBD) de la SIC. Es un trámite del responsable, obligatorio solo si supera los umbrales de activos.
- El calendario de festivos de Colombia para calcular los plazos.
- La retención automática y el borrado programado de cuentas inactivas.
