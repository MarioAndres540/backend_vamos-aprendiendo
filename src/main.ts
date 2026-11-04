import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { validateEnv } from './config/env.validation';

async function bootstrap() {
  // Sin secretos válidos el backend no arranca (spec 0002)
  validateEnv(process.env);

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  // Swagger solo fuera de producción: no se publica el mapa completo de la API
  const swaggerEnabled = process.env.NODE_ENV !== 'production';
  if (swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Vamos Aprendiendo API')
      .setDescription(
        'Documentación de la API de Vamos Aprendiendo Web (Autenticación, Telemetría y Gestión)',
      )
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
    console.log(
      `📑 Documentación Swagger disponible en http://localhost:${port}/api/docs`,
    );
  }
}
void bootstrap();
