import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AUTH_THROTTLER_OPTIONS } from './auth-throttle';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

// Spec 0002: SEC-RATE-01 a SEC-RATE-03, con la aplicación Nest real (guard, decoradores y módulo)
// Levantan una aplicación Nest real: más lentas que una prueba unitaria
jest.setTimeout(30000);

describe('Límite de intentos en /auth', () => {
  let app: INestApplication;
  const authService = {
    login: jest.fn().mockResolvedValue({ ok: true }),
    register: jest.fn().mockResolvedValue({ ok: true }),
    loginWithOAuth: jest.fn().mockResolvedValue({ ok: true }),
    refreshTokens: jest.fn().mockResolvedValue({ ok: true }),
    logout: jest.fn().mockResolvedValue({ ok: true }),
    getProfile: jest.fn().mockResolvedValue({ ok: true }),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(AUTH_THROTTLER_OPTIONS)],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    })
      .overrideGuard(JwtAuthGuard)
      // Simula una sesión válida: logout lee el usuario autenticado
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<{ user?: unknown }>().user = {
            userId: 'user-1',
          };
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  // El cuerpo no importa: no hay ValidationPipe en esta prueba y el servicio está simulado
  const hit = (path: string) =>
    request(app.getHttpServer()).post(path).send({});

  const statusesFor = async (path: string, times: number) => {
    const statuses: number[] = [];
    for (let i = 0; i < times; i++) {
      statuses.push((await hit(path)).status);
    }
    return statuses;
  };

  it('SEC-RATE-01: login admite 10 intentos por minuto y luego responde 429 en español', async () => {
    const statuses = await statusesFor('/auth/login', 10);
    expect(statuses.every((status) => status === 200)).toBe(true);

    const blocked = await hit('/auth/login');
    expect(blocked.status).toBe(429);
    expect((blocked.body as { message: string }).message).toMatch(/intentos/i);
  });

  it.each([
    ['/auth/register', 5, 201],
    ['/auth/oauth', 10, 200],
    ['/auth/refresh', 30, 200],
  ])('SEC-RATE-02: %s admite %i por minuto', async (path, limit, okStatus) => {
    const statuses = await statusesFor(path, limit);
    expect(statuses.every((status) => status === okStatus)).toBe(true);
    expect((await hit(path)).status).toBe(429);
  });

  it('SEC-RATE-01: cada ruta cuenta por separado', async () => {
    await statusesFor('/auth/login', 10);
    expect((await hit('/auth/refresh')).status).toBe(200);
  });

  it('SEC-RATE-03: cerrar sesión no tiene límite', async () => {
    const statuses = await statusesFor('/auth/logout', 40);
    expect(statuses.every((status) => status === 200)).toBe(true);
  });
});
