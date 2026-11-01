import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

// Sin estas variables el código usaría valores por defecto conocidos: mejor no arrancar
const REQUIRED_ENV = ['SUPABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];

async function bootstrap() {
  const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
  if (missingEnv.length > 0) {
    throw new Error(`Faltan variables de entorno: ${missingEnv.join(', ')}`);
  }

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Orígenes del frontend separados por coma. La app de Unity no pasa por CORS
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:4242')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
  });

  // Swagger solo fuera de producción: no se publica el mapa completo de la API
  const swaggerEnabled = process.env.NODE_ENV !== 'production';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Vamos Aprendiendo API')
      .setDescription('Documentación de la API de Vamos Aprendiendo Web (Autenticación, Telemetría y Gestión)')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Ingresa tu token JWT',
          in: 'header',
        },
        'bearer',
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`🚀 Servidor backend corriendo en el puerto ${port} (/api/v1)`);
  if (swaggerEnabled) {
    console.log(`📑 Documentación Swagger disponible en http://localhost:${port}/api/docs`);
  }
}
bootstrap();
