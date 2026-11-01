# Integración Unity ↔ Backend: ejercicios, XP y progreso por ruta

Guía técnica para que la app de Unity reporte los ejercicios de trazado (letras y números). Con estos datos el dashboard web muestra el **progreso por ruta** (Matemáticas y Escritura), el **puntaje (XP)** y, cuando existan las métricas geométricas, la **precisión**.

> **Estado:** el backend ya está listo. **Unity todavía no envía nada de esto** (no se modificó `TraceChallenge.cs` ni `TraceValidator.cs`); hoy llama a `/progress/mine` y `/progress/sync`, que no existen (ver [§6](#6-migración-desde-progressmine-y-progresssync)). Hasta que Unity migre, el dashboard muestra "Aún no recibimos ejercicios de la app" y "Precisión: No disponible", sin cifras inventadas.

---

## 1. Conceptos

| Concepto | Descripción |
|---|---|
| **Ejercicio** | Una forma concreta que el niño traza: una letra en mayúscula (`up_A`), en minúscula (`lo_a`) o un número (`d_7`). Cada una es un ejercicio distinto. |
| **Id del ejercicio** | `<ruta>.<glyphId>`: `escritura.lo_a`, `escritura.up_E`, `matematicas.d_7`. El `glyphId` es `TraceGlyph.Id` de Unity. No basta el carácter: la misma letra puede aparecer en actividades distintas. |
| **Catálogo** | Tabla `exercise_catalog`: los ejercicios que existen y cuáles están **activos**. Solo los activos cuentan como "disponibles" (pendientes). Hoy: Matemáticas 10 (`d_0`…`d_9`) y Escritura 10 (vocales en mayúscula y minúscula). Las consonantes (44 ejercicios) están cargadas pero **inactivas** mientras la tarjeta siga "Próximamente". |
| **Intento** | Cada vez que se evalúa un trazo (aprobado o no). Se guarda en `trazos`. |
| **Aprobado** | Cobertura ≥ 0,85 **y** exactitud ≥ 0,97 (las mismas reglas de `TraceValidator`, guardadas en `reward_rules`). **Lo decide el backend**: Unity envía los valores, no el veredicto. |
| **XP** | 10 puntos por ejercicio aprobado, **una sola vez por ejercicio y estudiante** (`reward_rules.xp_amount`; se puede fijar otro valor por ejercicio con `exercise_catalog.xp_reward`). Los reintentos de un ejercicio ya aprobado no suman. |

Estados por ruta (calculados por el backend con datos reales):

- **Completadas:** ejercicios aprobados.
- **En progreso:** ejercicios con intentos registrados pero todavía sin aprobar.
- **Pendientes:** ejercicios disponibles sin ningún intento.

> "En progreso" solo existe si Unity envía los intentos **no aprobados**. Por eso conviene enviar todos los intentos, no solo el aprobado.

---

## 2. Registrar un intento — `POST /api/v1/telemetry/exercises`

Encabezado `Authorization: Bearer <accessToken>`, `Content-Type: application/json`. Cuenta con rol `usuario`, `test` o `admin`.

### Petición

```json
{
  "exerciseId": "escritura.lo_a",
  "clientAttemptId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "studentId": "uuid-del-hijo",
  "coverage": 0.91,
  "accuracy": 0.99,

  "durationSeconds": 8.4,
  "precisionPct": 88.5,
  "startPointOk": true,
  "orderOk": true,
  "direction": "arriba_abajo",
  "rotationDegrees": 0,
  "offPathCount": 2,
  "expectedPath": [ { "points": [ { "x": 0.5, "y": 0.1 }, { "x": 0.5, "y": 0.9 } ] } ],
  "userStrokes":  [ { "points": [ { "x": 0.5, "y": 0.1, "t": 0.0 }, { "x": 0.51, "y": 0.5, "t": 0.6 } ] } ],
  "deviations": { "alerta": "Empezó fuera del punto 1", "patronAtipico": false }
}
```

| Campo | Obligatorio | Descripción |
|---|---|---|
| `exerciseId` | Sí | Id del ejercicio (`<ruta>.<glyphId>`). 404 si no existe o está inactivo. |
| `clientAttemptId` | Sí | UUID **nuevo por intento**, generado por Unity. Si la petición se repite (reintento por red, doble toque) no se duplica nada: el backend devuelve el resultado original con `duplicate: true`. **Reusar el mismo id al reintentar el mismo envío; generar uno nuevo para un intento nuevo.** |
| `studentId` | Si la cuenta es de un tutor con hijos | El hijo que juega. El backend verifica que sea de la cuenta autenticada (403 si no). Un adulto o tester no lo envía. |
| `coverage` | Sí | 0 a 1. `TraceValidator.Result.Coverage`. |
| `accuracy` | Sí | 0 a 1. `TraceValidator.Result.Accuracy`. |
| `durationSeconds` | No | Segundos del intento (0 a 3600). |
| `precisionPct` | No | 0 a 100. Precisión del trazo (forma + orden + dirección). **Fórmula por definir** (ver §4). Sin este dato la tarjeta de precisión dice "No disponible". |
| `startPointOk` | No | ¿Empezó en el círculo 1? |
| `orderOk` | No | ¿Respetó el orden de los trazos (1, 2, 3…)? |
| `direction` | No | `arriba_abajo`, `abajo_arriba`, `izq_der`, `der_izq`, `mixto_atipico`. |
| `rotationDegrees` | No | Giro detectado (−360 a 360). |
| `offPathCount` | No | Veces que el dedo se salió de la línea (0 a 1000). |
| `expectedPath` / `userStrokes` | No | Listas de trazos con puntos `{x, y, t?}` en el cuadrado normalizado de la letra. Máximo **12 trazos** y **400 puntos por trazo**; submuestrear si hace falta (el cuerpo JSON admite ~100 KB). |
| `deviations` | No | `alerta` (texto para el tutor, máx. 200) y `patronAtipico`. |

Cualquier campo que no esté en la tabla (por ejemplo `passed` o `xp`) se rechaza con 400.

### Respuesta `200`

```json
{
  "studentId": "uuid-del-hijo",
  "attemptId": "…",
  "exerciseId": "escritura.lo_a",
  "passed": true,
  "attemptNumber": 3,
  "duplicate": false,
  "alreadyCompleted": false,
  "awarded": true,
  "xpAwarded": 10,
  "totalXp": 120
}
```

| Campo | Significado |
|---|---|
| `passed` | El backend consideró el intento aprobado (cobertura y exactitud mínimas). |
| `awarded` / `xpAwarded` | Si este intento entregó XP y cuántos puntos. |
| `alreadyCompleted` | Aprobó, pero el ejercicio ya estaba aprobado antes: no hay XP nuevo. |
| `totalXp` | XP acumulado del estudiante (para mostrarlo en el juego). |
| `duplicate` | Era un reenvío de un intento ya guardado: es la misma respuesta de la primera vez. No sumar el XP otra vez en pantalla. |
| `attemptNumber` | Número de intento de ese ejercicio para ese estudiante. |

| Código | Acción en Unity |
|---|---|
| 200 | Mostrar el resultado. |
| 400 | Datos inválidos, o falta `studentId` en una cuenta de tutor con hijos. No reintentar igual. |
| 401 | Refrescar el token (`POST /auth/refresh`) y reintentar **con el mismo `clientAttemptId`**. |
| 403 | El estudiante no es de la cuenta (o la cuenta/prueba está inactiva). |
| 404 | El ejercicio no existe o no está habilitado. |
| Sin red / 5xx | Guardar el intento en cola local y reenviarlo con el **mismo** `clientAttemptId`. |

### Garantías del backend

- **Atomicidad:** el intento, el ejercicio aprobado y el XP se guardan en una sola transacción (función SQL `record_exercise_attempt`). No puede quedar un aprobado sin su XP.
- **Sin duplicados ni carreras:** un candado por (estudiante, ejercicio) y dos índices únicos (`exercise_completions`, `xp_ledger`) impiden XP doble aunque la misma petición llegue varias veces o en paralelo. Probado con 20 peticiones simultáneas: 1 intento guardado y 10 XP.
- **Seguridad:** el `studentId` se valida contra el tutor autenticado; el cliente nunca decide si aprobó ni cuántos XP recibe.

---

## 3. Consultas

| Endpoint | Para qué |
|---|---|
| `GET /telemetry/route-progress?studentId=` | Por ruta: `total`, `completed`, `inProgress`, `pending`, `percentCompleted` y `completedExerciseIds` (ej. `escritura.lo_a`; quitar el prefijo `<ruta>.` para obtener el `glyphId` de Unity). `hasData` es `false` mientras no haya ningún intento ni aprobado del estudiante. |
| `GET /telemetry/xp?studentId=&limit=20` | `totalXp`, `rewardsCount` e historial de recompensas. |
| `GET /presence/monthly-usage?studentId=` | Tiempo de la app este mes frente al mismo tramo del mes anterior (hora de `America/Bogota`). |

Todas verifican que `studentId` esté vinculado a la cuenta (403 si no).

---

## 4. Lo que Unity tendrá que instrumentar (etapa pendiente)

El backend **ya acepta y valida** estos datos; hoy Unity no los produce. Es una etapa independiente (modificar `TraceChallenge.cs` / `TraceValidator.cs`).

| Dato | Qué hay hoy en Unity | Qué falta |
|---|---|---|
| Trayectoria esperada | `glyph.Strokes` (plantilla) | Enviarla (`expectedPath`) o confiar en el catálogo. |
| Puntos recorridos | `_userStrokes` (se descartan al salir de la línea) | Enviarlos en orden con tiempo (`userStrokes`). |
| Desviaciones | **No se miden:** al salirse de la línea el trazo se descarta y se repite (`RejectStroke`) | **Cambiar ese comportamiento de medición:** contar cada salida (`offPathCount`) y su magnitud antes de descartar, para tener estadística real. |
| Punto de inicio | Los círculos 1, 2, 3 son solo guía visual | Validar que el trazo empiece en el círculo 1 (`startPointOk`). |
| Orden de los trazos | No se valida | Validar la secuencia 1 → 2 → 3 (`orderOk`). |
| Dirección | No se detecta | Detectar la dirección y el giro (`direction`, `rotationDegrees`). |
| Cobertura y exactitud | Se calculan en `TraceValidator.Evaluate` | Enviarlas en cada intento. |
| Intentos | Solo se guarda "completado" | Enviar **todos** los intentos (también los no aprobados), cada uno con su `clientAttemptId`. |
| Resultado | `Passed` local | Solo informativo: el veredicto lo da el backend. |
| Precisión (`precisionPct`) | No existe | Definir la fórmula (forma + orden + dirección) y calcularla. **Decisión pendiente del equipo**; el backend no inventa un porcentaje: sin `precisionPct` el dashboard muestra "No disponible". |

Para el dashboard, la tarjeta **Precisión promedio** promedia los `precisionPct` reales de los últimos 30 días (ponderando números y letras por cantidad de ejercicios) y muestra "No disponible" mientras no haya ninguno.

---

## 5. Tiempo de juego (para quien lea el dashboard)

`GET /presence/monthly-usage` usa `app_sessions` (ver `unity-app-sessions.md`). **Mide tiempo con la app abierta, no tiempo de juego activo**: mientras la app esté abierta (aunque en pausa o sin tocar) sigue enviando latidos. Para no contar de más:

- Las sesiones que se solapan (dos dispositivos) se unen: el mismo minuto cuenta una vez.
- Una sesión sin latidos recientes cuenta hasta su **último latido**, no hasta ahora.
- Una sesión que cruza la medianoche del cambio de mes se reparte entre ambos meses.
- La comparación usa el **mismo tramo** del mes anterior (si hoy es el 17 a las 3 p. m., del 1 al 17 a las 3 p. m. de cada mes); si el mes anterior es más corto, se compara con todo ese mes (`previous.capped`).
- Si el mes anterior no tiene tiempo, `percentChange` es `null` (no hay base).
- Con `studentId` solo cuenta las sesiones que la app abrió con ese hijo (`POST /presence/sessions` con `studentId`); las que no lo indican no se atribuyen a ningún hijo.

---

## 6. Migración desde `/progress/mine` y `/progress/sync`

Unity (`ProgressSyncService.cs`, líneas `FetchEndpoint` y `PushEndpoint`) llama a rutas que **no existen** en el backend; hoy esas llamadas responden 404 y el progreso queda solo en el dispositivo. En la web no hay ninguna referencia. Migración para la etapa de Unity:

| Hoy en Unity | Reemplazo |
|---|---|
| `GET /progress/mine` → `{ "completed": ["lo_a", "d_7"] }` | `GET /telemetry/route-progress` → por ruta, `completedExerciseIds` (`"escritura.lo_a"`, `"matematicas.d_7"`). Unir las listas y quitar el prefijo `<ruta>.` para volver a los ids locales. |
| `POST /progress/sync` con todo el conjunto | **No hay equivalente en lote.** Enviar un `POST /telemetry/exercises` por cada intento. |

### Progreso anterior a la migración — `POST /telemetry/exercises/import`

Los ejercicios que los niños ya completaron solo existían como "completado" en `PlayerPrefs`, sin cobertura ni exactitud, así que no pueden pasar por `POST /telemetry/exercises`. Se declaran **una vez** con este endpoint (migración `20261101_import_completed_exercises.sql`):

```json
{ "studentId": "uuid-del-hijo", "exerciseIds": ["escritura.lo_a", "escritura.up_A", "matematicas.d_0"] }
```

```json
{ "studentId": "…", "imported": 2, "skipped": 1, "unknown": 0, "xpAwarded": 20, "totalXp": 30 }
```

- Hasta 100 ejercicios por petición; `studentId` con las mismas reglas que `/telemetry/exercises`.
- Quedan en `trazos` con `source = 'import'`, **sin** cobertura, exactitud ni precisión (NULL, no se inventan), así que no afectan al promedio de precisión.
- Dan el XP de la regla propia `exercise_imported` (10 por defecto). Apagarlo: `UPDATE reward_rules SET is_active = FALSE WHERE rule_key = 'exercise_imported';`
- Idempotente: lo que ya está aprobado (por intento real o por una importación previa) se devuelve en `skipped` y no da XP. `unknown` son ejercicios no habilitados (ej. consonantes).
- **Es una declaración de la app:** el backend no puede comprobarla, igual que no comprueba que la cobertura y la exactitud enviadas sean ciertas.
- Unity (`ProgressSyncService.Fetch`) la llama sola tras bajar el progreso: envía lo que el dispositivo tiene completado y el servidor no.

---

## 7. Cambios en la base de datos

Migración `database/migrations/20261031_exercise_attempts_and_xp.sql` (idempotente; **ejecutarla en Supabase**):

- Nuevas: `learning_routes`, `exercise_catalog`, `reward_rules`, `exercise_completions`, `xp_ledger` y la función `record_exercise_attempt` (solo `service_role`).
- `trazos` (existente) se reutiliza como registro de intentos: columnas nuevas (`exercise_id`, `client_attempt_id`, `coverage_pct`, `accuracy_pct`, `start_point_ok`, `order_ok`, `expected_path`, `off_path_count`) y se quitaron los `NOT NULL`/valores por defecto de `session_id`, `puntos_trazo`, `direccion_detectada`, `rotacion_detectada`, `precision_pct` y `tiempo_trazo_seg`. Así una métrica que Unity no envía queda `NULL` y **no cuenta como 0** (`GET /telemetry/performance` ya ignora los nulos).

Cambiar reglas sin tocar código:

```sql
-- XP por ejercicio aprobado, y umbrales de aprobación
UPDATE reward_rules SET xp_amount = 15, min_coverage = 0.80, min_accuracy = 0.95 WHERE rule_key = 'exercise_approved';
-- XP propio de un ejercicio
UPDATE exercise_catalog SET xp_reward = 20 WHERE id = 'matematicas.d_9';
-- Habilitar las consonantes cuando Unity las libere
UPDATE exercise_catalog SET is_active = TRUE WHERE route_id = 'escritura' AND sort_order >= 100;
```

El XP ya entregado no cambia si cambia la regla (queda en `xp_ledger`). Los **niveles** no están implementados: se calcularán después a partir de `SUM(xp_ledger.xp_amount)`.
