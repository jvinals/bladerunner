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

  // CORS
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
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

  const port = process.env.API_PORT || 3001;
  await app.listen(port);

  console.log(`🚀 Bladerunner API running on http://localhost:${port}`);
  console.log(`📄 Swagger docs at http://localhost:${port}/api/docs`);
}
bootstrap();
