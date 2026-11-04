import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApp } from './bootstrap';

@Controller('probe')
class ProbeController {
  @Get()
  probe(@Req() req: { ip: string }) {
    return { ip: req.ip };
  }
}

// Spec 0002: SEC-HEAD-01 y SEC-RATE-04
// Levantan una aplicación Nest real: más lentas que una prueba unitaria
jest.setTimeout(30000);

describe('configureApp', () => {
  let app: INestApplication;

  const start = async (env: Record<string, string | undefined>) => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication, env);
    await app.init();
    return app;
  };

  afterEach(async () => {
    await app?.close();
  });

  it('usa el prefijo /api/v1', async () => {
    await start({});
    await request(app.getHttpServer()).get('/api/v1/probe').expect(200);
  });

  it('SEC-HEAD-01: envía cabeceras de seguridad y oculta X-Powered-By', async () => {
    await start({ NODE_ENV: 'production' });
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe')
      .expect(200);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toContain('max-age=');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('SEC-RATE-04: en producción toma la IP del cliente que agregó el proxy de Render', async () => {
    await start({ NODE_ENV: 'production' });
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe')
      .set('X-Forwarded-For', '203.0.113.7')
      .expect(200);

    expect((res.body as { ip: string }).ip).toBe('203.0.113.7');
  });

  it('SEC-RATE-04: una IP falsa puesta por el cliente antes del proxy no se toma', async () => {
    await start({ NODE_ENV: 'production' });
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe')
      // El cliente inventa 1.1.1.1; el proxy de Render agrega la IP real al final
      .set('X-Forwarded-For', '1.1.1.1, 203.0.113.7')
      .expect(200);

    expect((res.body as { ip: string }).ip).toBe('203.0.113.7');
  });

  it('SEC-RATE-04: fuera de producción no confía en X-Forwarded-For', async () => {
    await start({ NODE_ENV: 'development' });
    const res = await request(app.getHttpServer())
      .get('/api/v1/probe')
      .set('X-Forwarded-For', '203.0.113.7')
      .expect(200);

    expect((res.body as { ip: string }).ip).not.toBe('203.0.113.7');
  });

  it('CORS: solo responde a los orígenes configurados', async () => {
    await start({ CORS_ORIGINS: 'https://app.example.com' });
    const allowed = await request(app.getHttpServer())
      .get('/api/v1/probe')
      .set('Origin', 'https://app.example.com');
    const denied = await request(app.getHttpServer())
      .get('/api/v1/probe')
      .set('Origin', 'https://evil.example');

    expect(allowed.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
