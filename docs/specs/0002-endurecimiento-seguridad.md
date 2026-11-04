# Spec 0002 — Endurecimiento de seguridad antes de producción

- **Estado:** aprobado para implementar
- **Fecha:** 2026-11-03
- **Relacionado:** revisión de seguridad previa al despliegue (Render + Vercel), `render.yaml`

## Contexto

La plataforma guarda datos de menores de edad (nombre, documento, fecha de nacimiento, progreso). Antes de publicarla hay que cerrar los riesgos que permitirían suplantar usuarios, adivinar contraseñas o explotar fallas conocidas de las dependencias.

## Historias de usuario

- **HU-1.** Como tutor, quiero que nadie pueda hacerse pasar por mí ni por un administrador, para que los datos de mi hijo no queden expuestos.
- **HU-2.** Como responsable de la plataforma, quiero que los intentos masivos de inicio de sesión se frenen, para que no se puedan adivinar contraseñas.
- **HU-3.** Como responsable de la plataforma, quiero que el navegador aplique las protecciones estándar (HTTPS estricto, sin incrustar la página, sin adivinar tipos), para reducir el impacto de un ataque.

## Criterios de aceptación

### Secretos de sesión (SEC-SECRET)

| ID | Criterio |
| --- | --- |
| SEC-SECRET-01 | El código no tiene valores por defecto para `JWT_SECRET` ni `JWT_REFRESH_SECRET`: si falta alguno, el backend no arranca. |
| SEC-SECRET-02 | En producción (`NODE_ENV=production`), un secreto de menos de 32 caracteres, o igual al otro, impide arrancar. |
| SEC-SECRET-03 | Los secretos de producción los genera Render (`generateValue`) y son distintos de los de desarrollo. Es un paso manual del despliegue. |

### Límite de intentos (SEC-RATE)

| ID | Criterio |
| --- | --- |
| SEC-RATE-01 | Desde una misma IP, `POST /auth/login` admite 10 intentos por minuto; el siguiente responde **429** con un mensaje en español. |
| SEC-RATE-02 | `POST /auth/register` admite 5 por minuto; `POST /auth/oauth`, 10 por minuto; `POST /auth/refresh`, 30 por minuto. |
| SEC-RATE-03 | El resto de la API no tiene este límite (la app de Unity envía telemetría con frecuencia). |
| SEC-RATE-04 | En producción la IP del cliente se toma de `X-Forwarded-For` confiando en un solo proxy (el de Render), para que el límite no se aplique a todos a la vez ni se pueda saltar falseando la cabecera. |

### Cabeceras de seguridad (SEC-HEAD)

| ID | Criterio |
| --- | --- |
| SEC-HEAD-01 | Las respuestas de la API incluyen `X-Content-Type-Options: nosniff`, `X-Frame-Options` y `Strict-Transport-Security`, y no incluyen `X-Powered-By`. |
| SEC-HEAD-02 | Las páginas del frontend incluyen `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` y, en producción, `Strict-Transport-Security`. |

### Cookies de sesión (SEC-COOKIE)

| ID | Criterio |
| --- | --- |
| SEC-COOKIE-01 | En producción las cookies de sesión del frontend llevan la marca `Secure` (solo viajan por HTTPS). En desarrollo no, para que funcione `http://localhost`. |

### Dependencias (SEC-DEPS)

| ID | Criterio |
| --- | --- |
| SEC-DEPS-01 | `npm audit --omit=dev --audit-level=high` del backend termina sin hallazgos altos ni críticos. |
| SEC-DEPS-02 | Lo mismo para el frontend. |

## Fuera de alcance

- Mover los tokens a cookies `HttpOnly` emitidas por el backend (cambia el flujo de sesión de la web y de Unity).
- Política de contraseñas más estricta (hoy mínimo 6 caracteres).
- Ocultar los mensajes de error internos de Supabase que el backend reenvía.
- Fijar `search_path` en las funciones de la base y activar la protección de contraseñas filtradas de Supabase.

## Pruebas

| Criterio | Prueba |
| --- | --- |
| SEC-SECRET-01, 02 | `src/config/env.validation.spec.ts` |
| SEC-RATE-01 a 03 | `src/modules/auth/auth-rate-limit.spec.ts` (aplicación Nest real con supertest) |
| SEC-RATE-04, SEC-HEAD-01 | `src/bootstrap.spec.ts` |
| SEC-HEAD-02, SEC-COOKIE-01 | Verificación manual: el frontend no tiene herramientas de pruebas |
| SEC-DEPS-01, 02 | `npm audit` |
