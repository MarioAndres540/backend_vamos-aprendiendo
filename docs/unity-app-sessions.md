# Integración Unity ↔ Backend: sesiones de uso de la app

Guía técnica para que la app de Unity reporte cuándo está en uso. Con estos datos, el dashboard web del tutor (o del adulto) muestra en tiempo real:

- **Conectado** (punto verde): desde qué hora está en la app y cuánto tiempo lleva.
- **Desconectado** (punto rojo): cuándo se desconectó y cuánto duró la última sesión.
- El total de tiempo en la app durante el día.

---

## 1. Conceptos

| Concepto | Descripción |
|---|---|
| **Cuenta** | El niño **no tiene cuenta propia**: la app inicia sesión con la cuenta del tutor (o del adulto). La misma cuenta puede estar abierta en la app y en la web a la vez. |
| **Sesión de app** | Período continuo de uso de la app. Empieza al abrir la app (o al volver a primer plano) y termina al cerrarla, al pasar a segundo plano o por falta de latidos. |
| **Latido (heartbeat)** | Petición periódica que confirma que la app sigue abierta. Intervalo: **15 s** (`heartbeatIntervalSeconds`). |
| **Expiración** | Si pasan **45 s** sin latidos (`timeoutSeconds`), el backend cierra la sesión con motivo `timeout` y toma como hora de fin la del **último latido**. Así, la duración es real aunque la app se cierre a la fuerza, se quede sin batería o sin red. |

### Flujo

```
App abre ──► POST /auth/login (o usa tokens guardados)
         ──► POST /presence/sessions                 → sessionId
         ──► cada 15 s: POST /presence/sessions/{id}/heartbeat
               · 409 SESSION_ENDED → abrir una sesión nueva
               · 401               → POST /auth/refresh y reintentar
App a segundo plano / se cierra ──► POST /presence/sessions/{id}/end   (reason: app_closed)
Usuario cierra sesión          ──► POST /presence/sessions/{id}/end   (reason: logout) ──► POST /auth/logout
App vuelve a primer plano      ──► POST /presence/sessions             (sesión nueva)
```

---

## 2. Conexión y autenticación

- **URL base**: `http://<host>:3000/api/v1` (desarrollo: `http://localhost:3000/api/v1`; en un celular físico usar la IP del equipo, no `localhost`).
- Todas las peticiones de presencia requieren el encabezado `Authorization: Bearer <accessToken>`.
- `Content-Type: application/json`.

### `POST /auth/login`

```json
// Petición
{ "email": "tutor@correo.com", "password": "********" }

// Respuesta 200 (campos relevantes)
{
  "accessToken": "eyJ...",          // vence en 15 min (expiresIn: 900)
  "refreshToken": "eyJ...",         // vence en 7 días; guardarlo de forma segura
  "expiresIn": 900,
  "profileType": "tutor",           // tutor | adulto | tester | profesor | admin
  "user": { "id": "uuid", "email": "tutor@correo.com", "role": "usuario", "hasCompletedSetup": true },
  "profile": { "firstName": "Marisol", "lastName": "Villegas" }
}
```

Errores: `401` credenciales inválidas o cuenta desactivada.

### `POST /auth/refresh`

```json
// Petición
{ "refreshToken": "eyJ..." }
// Respuesta 200: mismo formato de tokens que el login (sin profileType)
```

- **Rotación**: cada refresh devuelve un `refreshToken` **nuevo** y el anterior queda revocado. Guardar siempre el último.
- **No reutilizar** un refresh token ya usado: el backend cierra esa sesión de dispositivo (`401` "Tu sesión en este dispositivo se cerró por seguridad"). Las sesiones de otros dispositivos (ej. la web) no se afectan. Si ocurre, volver a pedir login.
- Evitar dos refresh simultáneos con el mismo token (usar un candado / una sola corrutina de refresh).

### `POST /auth/logout`

```json
// Encabezado Authorization: Bearer <accessToken>
{ "refreshToken": "eyJ..." }
```

---

## 3. Endpoints de sesión de app

### 3.1 Abrir sesión — `POST /presence/sessions`

```json
// Petición (todos los campos son opcionales)
{
  "client": "unity",                          // por defecto "unity"
  "studentId": "uuid-del-hijo",               // hijo que juega (debe estar vinculado al tutor)
  "deviceInfo": "Android 14 · Samsung SM-A546",  // máx. 255 caracteres
  "appVersion": "1.0.3"                       // máx. 50 caracteres
}

// Respuesta 201
{
  "sessionId": "8b6f0c5e-2f1d-4b7a-9a43-0d5d2f3c9e10",
  "startedAt": "2026-10-08T14:03:12.481Z",
  "heartbeatIntervalSeconds": 15,
  "timeoutSeconds": 45
}
```

| Código | Significado | Acción en Unity |
|---|---|---|
| 201 | Sesión creada | Guardar `sessionId` e iniciar los latidos con `heartbeatIntervalSeconds`. |
| 400 | `studentId` no vinculado a la cuenta o datos inválidos | Revisar el hijo seleccionado. |
| 401 | Token vencido o inválido | Refrescar el token y reintentar. |

> Usar los valores `heartbeatIntervalSeconds` y `timeoutSeconds` de la respuesta en lugar de fijarlos en el código.

### 3.2 Latido — `POST /presence/sessions/{sessionId}/heartbeat`

Sin cuerpo. Enviar cada `heartbeatIntervalSeconds` mientras la app esté en primer plano.

```json
// Respuesta 200
{ "sessionId": "8b6f0c5e-...", "lastHeartbeatAt": "2026-10-08T14:03:27.502Z" }
```

| Código | `code` | Significado | Acción en Unity |
|---|---|---|---|
| 200 | — | Sesión activa | Continuar. |
| 409 | `SESSION_ENDED` | La sesión terminó o expiró (ej. la app estuvo suspendida más de 45 s) | Abrir una sesión nueva (`POST /presence/sessions`). |
| 404 | `SESSION_NOT_FOUND` | La sesión no existe o es de otra cuenta | Abrir una sesión nueva. |
| 401 | — | Token vencido | Refrescar y reintentar. |
| Sin red / timeout | — | Error de conexión | Reintentar en el siguiente ciclo; si el backend no recibe latidos en 45 s cerrará la sesión, y al volver la red llegará un 409 → abrir una nueva. |

Formato de los errores con `code`:

```json
{ "statusCode": 409, "error": "Conflict", "code": "SESSION_ENDED", "message": "La sesión de la app ya terminó. Inicia una nueva sesión." }
```

### 3.3 Cerrar sesión — `POST /presence/sessions/{sessionId}/end`

```json
// Petición (opcional)
{ "reason": "app_closed" }   // "app_closed" (por defecto) o "logout"

// Respuesta 200
{
  "sessionId": "8b6f0c5e-...",
  "startedAt": "2026-10-08T14:03:12.481Z",
  "endedAt": "2026-10-08T14:41:55.019Z",
  "durationSeconds": 2322,
  "endReason": "app_closed"
}
```

Es **idempotente**: si la sesión ya estaba cerrada responde 200 con los datos existentes. Si la petición no alcanza a salir (cierre forzado), no hay problema: el backend la cerrará por `timeout`.

### 3.4 Consultar estado — `GET /presence/me`

La usa el dashboard web; Unity puede usarla para depurar.

```json
{
  "client": "unity",
  "isOnline": true,
  "serverTime": "2026-10-08T14:20:00.000Z",
  "heartbeatIntervalSeconds": 15,
  "timeoutSeconds": 45,
  "current": {
    "sessionId": "8b6f0c5e-...",
    "startedAt": "2026-10-08T14:03:12.481Z",
    "lastHeartbeatAt": "2026-10-08T14:19:57.100Z",
    "durationSeconds": 1007,
    "deviceInfo": "Android 14 · Samsung SM-A546",
    "student": { "id": "uuid", "firstName": "Matías", "lastName": "Villegas" }
  },
  "lastSession": {
    "sessionId": "...",
    "startedAt": "2026-10-08T09:10:00.000Z",
    "endedAt": "2026-10-08T09:42:30.000Z",
    "durationSeconds": 1950,
    "endReason": "timeout",
    "deviceInfo": null,
    "student": null
  },
  "today": { "sessionsCount": 2, "totalSeconds": 2957 }
}
```

`current` es `null` cuando no hay sesión activa; `lastSession` es `null` si nunca se ha cerrado una sesión. El "hoy" se calcula con la hora de Colombia (UTC-5).

---

## 4. Ciclo de vida en Unity

| Evento de Unity | Acción |
|---|---|
| Inicio de la app (tras login válido) | `POST /presence/sessions` y arrancar la corrutina de latidos. |
| `OnApplicationPause(true)` **solo en móvil** (`Application.isMobilePlatform`): la app pasó a segundo plano | Detener latidos y `POST .../end` con `app_closed`. |
| `OnApplicationPause(false)` **solo en móvil**: vuelve a primer plano | `POST /presence/sessions` (sesión nueva). |
| `OnApplicationQuit()` | `POST .../end` con `app_closed` (puede no alcanzar a enviarse; el timeout lo cubre). |
| Cerrar sesión en la app | `POST .../end` con `logout`, luego `POST /auth/logout` y borrar tokens. |
| Cambio de hijo | `POST .../end` de la sesión actual y `POST /presence/sessions` con el nuevo `studentId`. |

> ⚠️ **Escritorio y Editor (corrección del 2026-10-08)**: con *Run In Background* desactivado, Unity **pausa la app al perder el foco** y llama a `OnApplicationPause(true)`; por ejemplo, al pasar del Editor o del juego al navegador. Perder el foco **no** es salir de la app, así que:
> - **No** cerrar la sesión por `OnApplicationPause` ni por `OnApplicationFocus` fuera de móvil.
> - Activar `Application.runInBackground = true` en escritorio y en el Editor (o *Player Settings → Resolution and Presentation → Run In Background*), para que los latidos sigan con la ventana sin foco. Si no, el juego se congela, los latidos se detienen y el backend cierra la sesión por `timeout` a los 45 s.
>
> Síntoma observado antes de la corrección: en el dashboard la app aparecía **desconectada** mientras se jugaba, porque cada cambio a la ventana del navegador cerraba la sesión (`end_reason = app_closed` a los pocos segundos de abrirla).

---

## 5. Implementación de referencia (C#)

Servicio de ejemplo con `UnityWebRequest` y `JsonUtility`. Adaptar el almacenamiento de tokens (`PlayerPrefs` solo como ejemplo; en producción usar almacenamiento seguro).

```csharp
using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;

[Serializable] public class StartSessionRequest { public string client = "unity"; public string studentId; public string deviceInfo; public string appVersion; }
[Serializable] public class StartSessionResponse { public string sessionId; public string startedAt; public int heartbeatIntervalSeconds; public int timeoutSeconds; }
[Serializable] public class EndSessionRequest { public string reason = "app_closed"; }
[Serializable] public class ApiError { public int statusCode; public string code; public string message; }
[Serializable] public class RefreshRequest { public string refreshToken; }
[Serializable] public class TokenResponse { public string accessToken; public string refreshToken; public int expiresIn; }

/// <summary>
/// Reporta al backend el uso de la app (sesión + latidos) para el dashboard del tutor.
/// Colocar en un GameObject persistente (DontDestroyOnLoad) e invocar StartAppSession() tras el login.
/// </summary>
public class AppSessionService : MonoBehaviour
{
    [SerializeField] private string baseUrl = "http://localhost:3000/api/v1";

    public string AccessToken { get; set; }
    public string RefreshToken { get; set; }
    public string CurrentStudentId { get; set; }   // hijo que juega (opcional)

    private string _sessionId;
    private float _heartbeatInterval = 15f;
    private Coroutine _heartbeatLoop;
    private bool _refreshing;

    private void Awake()
    {
        DontDestroyOnLoad(gameObject);
        // Escritorio / Editor: seguir corriendo (y enviando latidos) aunque la ventana pierda el foco
        if (!Application.isMobilePlatform) Application.runInBackground = true;
    }

    // ---------- API pública ----------

    public void StartAppSession() => StartCoroutine(StartSessionRoutine());

    public void EndAppSession(string reason = "app_closed") => StartCoroutine(EndSessionRoutine(reason));

    // ---------- Ciclo de vida ----------

    private void OnApplicationPause(bool paused)
    {
        // Solo en móvil la pausa es "pasar a segundo plano"; en escritorio/Editor es perder el foco
        if (string.IsNullOrEmpty(AccessToken) || !Application.isMobilePlatform) return;
        if (paused) EndAppSession("app_closed");
        else StartAppSession();
    }

    private void OnApplicationQuit()
    {
        // Mejor esfuerzo: si no alcanza a enviarse, el backend cerrará la sesión por timeout (45 s)
        if (!string.IsNullOrEmpty(_sessionId)) EndAppSession("app_closed");
    }

    // ---------- Corrutinas ----------

    private IEnumerator StartSessionRoutine()
    {
        StopHeartbeat();
        var body = new StartSessionRequest
        {
            studentId = string.IsNullOrEmpty(CurrentStudentId) ? null : CurrentStudentId,
            deviceInfo = $"{SystemInfo.operatingSystem} · {SystemInfo.deviceModel}",
            appVersion = Application.version,
        };

        UnityWebRequest req = null;
        yield return SendWithAuth("POST", "/presence/sessions", JsonUtility.ToJson(body), r => req = r);
        if (req == null || req.result != UnityWebRequest.Result.Success) { Debug.LogWarning($"No se pudo abrir la sesión: {req?.error}"); yield break; }

        var res = JsonUtility.FromJson<StartSessionResponse>(req.downloadHandler.text);
        _sessionId = res.sessionId;
        _heartbeatInterval = Mathf.Max(5, res.heartbeatIntervalSeconds);
        _heartbeatLoop = StartCoroutine(HeartbeatLoop());
    }

    private IEnumerator HeartbeatLoop()
    {
        var wait = new WaitForSecondsRealtime(_heartbeatInterval);
        while (!string.IsNullOrEmpty(_sessionId))
        {
            yield return wait;
            UnityWebRequest req = null;
            yield return SendWithAuth("POST", $"/presence/sessions/{_sessionId}/heartbeat", null, r => req = r);
            if (req == null) continue; // sin red: se reintenta en el siguiente ciclo

            if (req.responseCode == 409 || req.responseCode == 404)
            {
                // La sesión terminó (ej. la app estuvo suspendida): abrir una nueva
                _sessionId = null;
                StartCoroutine(StartSessionRoutine());
                yield break;
            }
        }
    }

    private IEnumerator EndSessionRoutine(string reason)
    {
        if (string.IsNullOrEmpty(_sessionId)) yield break;
        var id = _sessionId;
        StopHeartbeat();
        _sessionId = null;
        yield return SendWithAuth("POST", $"/presence/sessions/{id}/end", JsonUtility.ToJson(new EndSessionRequest { reason = reason }), _ => { });
    }

    private void StopHeartbeat()
    {
        if (_heartbeatLoop != null) StopCoroutine(_heartbeatLoop);
        _heartbeatLoop = null;
    }

    // ---------- HTTP con refresco automático del token ----------

    private IEnumerator SendWithAuth(string method, string path, string json, Action<UnityWebRequest> onDone)
    {
        var req = BuildRequest(method, path, json);
        yield return req.SendWebRequest();

        if (req.responseCode == 401 && !string.IsNullOrEmpty(RefreshToken))
        {
            req.Dispose();
            yield return RefreshTokens();
            req = BuildRequest(method, path, json);
            yield return req.SendWebRequest();
        }

        if (req.result == UnityWebRequest.Result.ConnectionError) { onDone(null); req.Dispose(); yield break; }
        onDone(req);
    }

    private IEnumerator RefreshTokens()
    {
        // Un solo refresh a la vez: reutilizar un refresh token cierra la sesión del dispositivo
        while (_refreshing) yield return null;
        _refreshing = true;
        var req = BuildRequest("POST", "/auth/refresh", JsonUtility.ToJson(new RefreshRequest { refreshToken = RefreshToken }), withAuth: false);
        yield return req.SendWebRequest();
        if (req.result == UnityWebRequest.Result.Success)
        {
            var tokens = JsonUtility.FromJson<TokenResponse>(req.downloadHandler.text);
            AccessToken = tokens.accessToken;
            RefreshToken = tokens.refreshToken; // guardar siempre el último
        }
        else
        {
            Debug.LogWarning("La sesión expiró: pedir login de nuevo.");
            AccessToken = null; RefreshToken = null; _sessionId = null;
        }
        req.Dispose();
        _refreshing = false;
    }

    private UnityWebRequest BuildRequest(string method, string path, string json, bool withAuth = true)
    {
        var req = new UnityWebRequest(baseUrl + path, method)
        {
            downloadHandler = new DownloadHandlerBuffer(),
            uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(string.IsNullOrEmpty(json) ? "{}" : json)),
            timeout = 10,
        };
        req.SetRequestHeader("Content-Type", "application/json");
        if (withAuth && !string.IsNullOrEmpty(AccessToken)) req.SetRequestHeader("Authorization", $"Bearer {AccessToken}");
        return req;
    }
}
```

> `JsonUtility` serializa los `string` nulos como `""`. El backend trata `studentId: ""` como inválido, por eso el ejemplo solo lo asigna si hay un hijo seleccionado. Si se envían campos vacíos, usar una librería como Newtonsoft.Json con `NullValueHandling.Ignore`.

---

## 6. Pruebas rápidas (sin Unity)

```bash
# 1. Login
curl -s -X POST http://localhost:3000/api/v1/auth/login -H "Content-Type: application/json" \
  -d '{"email":"tutor@correo.com","password":"********"}'

# 2. Abrir sesión (reemplazar TOKEN)
curl -s -X POST http://localhost:3000/api/v1/presence/sessions -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" -d '{"client":"unity","deviceInfo":"Prueba curl"}'

# 3. Latido (reemplazar SESSION_ID)
curl -s -X POST http://localhost:3000/api/v1/presence/sessions/SESSION_ID/heartbeat -H "Authorization: Bearer TOKEN"

# 4. Estado (lo que ve el dashboard)
curl -s http://localhost:3000/api/v1/presence/me -H "Authorization: Bearer TOKEN"

# 5. Cerrar
curl -s -X POST http://localhost:3000/api/v1/presence/sessions/SESSION_ID/end -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" -d '{"reason":"app_closed"}'
```

Con el dashboard del tutor abierto, el punto pasa a **verde** tras el paso 2 (en máximo 10 s) y a **rojo** tras el paso 5 o 45 s después del último latido.

---

## 7. Pendientes relacionados

- **Selección del hijo**: todavía no existe un endpoint para que la app liste los hijos del tutor (para enviar `studentId`). Mientras tanto, `studentId` es opcional.
- **Telemetría de juego** (sesiones de juego, trazos, operaciones): módulo pendiente; se relacionará con `sessionId` y `studentId`.
- Requiere la migración `database/migrations/20261008_app_sessions.sql` aplicada en Supabase.
