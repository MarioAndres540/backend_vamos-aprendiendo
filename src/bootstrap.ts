import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

type Env = Record<string, string | undefined>;

/**
 * Configuración HTTP común de la aplicación. Vive aparte de main.ts para que las pruebas
 * levanten la API con exactamente la misma configuración que producción (spec 0002).
 */
export function configureApp(
  app: NestExpressApplication,
  env: Env = process.env,
): void {
  const isProduction = env.NODE_ENV === 'production';

  app.setGlobalPrefix('api/v1');

  // Render pone un único proxy delante: solo se confía en él para leer la IP real del cliente.
  // Así el límite de intentos no se aplica a todos a la vez ni se salta inventando X-Forwarded-For
  if (isProduction) {
    app.set('trust proxy', 1);
  }

  // Cabeceras de seguridad (nosniff, HSTS, sin incrustar en iframes) y sin X-Powered-By.
  // CSP solo aplica a respuestas HTML: la API responde JSON, salvo Swagger en desarrollo
  app.use(helmet({ contentSecurityPolicy: isProduction ? undefined : false }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Orígenes del frontend separados por coma. La app de Unity no pasa por CORS
  app.enableCors({
    origin: (env.CORS_ORIGINS ?? 'http://localhost:4242')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  });
}
