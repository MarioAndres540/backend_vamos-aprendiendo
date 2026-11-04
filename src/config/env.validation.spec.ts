import { validateEnv } from './env.validation';

// Spec 0002: SEC-SECRET-01 y SEC-SECRET-02
describe('validateEnv', () => {
  const strong = (seed: string) => seed.repeat(40).slice(0, 40);
  const base = {
    SUPABASE_URL: 'https://example.supabase.co',
    JWT_SECRET: strong('a'),
    JWT_REFRESH_SECRET: strong('b'),
  };

  it('acepta una configuración completa', () => {
    expect(() =>
      validateEnv({ ...base, NODE_ENV: 'production' }),
    ).not.toThrow();
  });

  it.each(['SUPABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'])(
    'SEC-SECRET-01: sin %s no arranca',
    (name) => {
      const env: Record<string, string | undefined> = { ...base };
      delete env[name];
      expect(() => validateEnv(env)).toThrow(name);
    },
  );

  it('SEC-SECRET-01: un secreto vacío cuenta como faltante', () => {
    expect(() => validateEnv({ ...base, JWT_SECRET: '   ' })).toThrow(
      'JWT_SECRET',
    );
  });

  it('SEC-SECRET-02: en producción rechaza secretos de menos de 32 caracteres', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET: 'corto',
      }),
    ).toThrow('JWT_REFRESH_SECRET');
  });

  it('SEC-SECRET-02: en producción rechaza usar el mismo secreto para acceso y renovación', () => {
    expect(() =>
      validateEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_REFRESH_SECRET: base.JWT_SECRET,
      }),
    ).toThrow(/distint/);
  });

  it('SEC-SECRET-02: en desarrollo permite secretos cortos', () => {
    expect(() =>
      validateEnv({ ...base, JWT_SECRET: 'dev', JWT_REFRESH_SECRET: 'dev2' }),
    ).not.toThrow();
  });
});
