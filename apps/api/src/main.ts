import './bootstrap-env';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { classifyRecordingAutomationFailure } from './modules/recording/recording-timeout.util';

process.on('unhandledRejection', (reason) => {
  const failure = classifyRecordingAutomationFailure(reason);
  if (!failure.isKnownNonFatal) {
    throw reason instanceof Error ? reason : new Error(String(reason));
  }
  console.warn(
    `[recording] swallowed non-fatal unhandled rejection (${failure.kind}): ${failure.message || failure.name || 'unknown error'}`,
  );
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Close HTTP + WS cleanly on SIGINT/SIGTERM so `pnpm dev` does not leave a stuck Node on the port.
  app.enableShutdownHooks();

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS — allow both localhost and 127.0.0.1 (Vite dev) when using `VITE_API_URL` to hit the API directly
  const corsFromEnv = process.env.CORS_ORIGIN?.trim();
  const corsOrigin = corsFromEnv
    ? corsFromEnv.includes(',')
      ? corsFromEnv.split(',').map((s) => s.trim())
      : corsFromEnv
    : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  app.enableCors({
    origin: corsOrigin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Swagger / OpenAPI
  const config = new DocumentBuilder()
    .setTitle('Bladerunner API')
    .setDescription('Operational control surface for validating application experiences')
    .setVersion('0.1.0')
    .addTag('health', 'Service health endpoints')
    .addTag('runs', 'Run management endpoints')
    .addTag('projects', 'Project management endpoints')
    .addTag('settings', 'Workspace settings endpoints')
    .addTag('integrations', 'Integration management endpoints')
    .addTag('agents', 'Agent management endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = parseInt(process.env.API_PORT ?? '3001', 10);
  const host = process.env.API_HOST?.trim() || '0.0.0.0';
  // Fly deploy health checks connect to 0.0.0.0:<internal_port>; binding only IPv6/loopback fails PM05.
  await app.listen(port, host);

  console.log(`🚀 Bladerunner API listening on http://${host}:${port}`);
  console.log(`📄 Swagger docs at http://${host}:${port}/api/docs`);
}
bootstrap();
