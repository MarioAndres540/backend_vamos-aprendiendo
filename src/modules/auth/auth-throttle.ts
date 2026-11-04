import { minutes, ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Límite de intentos de las rutas públicas de autenticación (spec 0002, SEC-RATE).
 * Solo se aplica donde el controlador usa ThrottlerGuard: el resto de la API (telemetría de Unity) no tiene límite.
 * El conteo vive en memoria: con una sola instancia en Render es suficiente.
 */
export const AUTH_THROTTLER_OPTIONS: ThrottlerModuleOptions = {
  throttlers: [{ ttl: minutes(1), limit: 10 }],
  errorMessage: 'Demasiados intentos. Espera un minuto e intenta de nuevo.',
};

// Límites por ruta (por IP y por minuto)
export const LOGIN_LIMIT = { default: { limit: 10 } };
export const REGISTER_LIMIT = { default: { limit: 5 } };
export const OAUTH_LIMIT = { default: { limit: 10 } };
export const REFRESH_LIMIT = { default: { limit: 30 } };
