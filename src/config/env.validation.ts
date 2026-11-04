// Variables sin las que el backend no debe arrancar: sin ellas usaría valores conocidos por cualquiera
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
] as const;
const JWT_SECRETS = ['JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;

// Un secreto corto se puede adivinar por fuerza bruta y permitiría fabricar sesiones de cualquier usuario
export const MIN_PRODUCTION_SECRET_LENGTH = 32;

type Env = Record<string, string | undefined>;

/**
 * Valida la configuración al arrancar (spec 0002, SEC-SECRET-01 y 02).
 * Lanza un error con todos los problemas juntos para corregirlos de una vez.
 */
export function validateEnv(env: Env): void {
  const problems: string[] = [];

  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    problems.push(`Faltan variables de entorno: ${missing.join(', ')}`);
  }

  if (env.NODE_ENV === 'production') {
    for (const name of JWT_SECRETS) {
      const value = env[name]?.trim();
      if (value && value.length < MIN_PRODUCTION_SECRET_LENGTH) {
        problems.push(
          `${name} debe tener al menos ${MIN_PRODUCTION_SECRET_LENGTH} caracteres en producción`,
        );
      }
    }

    if (env.JWT_SECRET?.trim() && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
      problems.push('JWT_SECRET y JWT_REFRESH_SECRET deben ser distintos');
    }
  }

  if (problems.length > 0) {
    throw new Error(problems.join('. '));
  }
}
