import './bootstrap-env';
import { appendFileSync } from 'node:fs';
// #region agent log
const __DBG_8E7_PATH = '/Users/jvinals/code/bladerunner/.cursor/debug-8e7bf9.log';
function __dbg8e7Post(line: Record<string, unknown>): void {
  const payload = { sessionId: '8e7bf9', timestamp: Date.now(), ...line };
  const j = JSON.stringify(payload);
  try {
    appendFileSync(__DBG_8E7_PATH, `${j}\n`);
  } catch {
    /* ignore */
  }
  fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '8e7bf9' },
    body: j,
  }).catch(() => {});
}
process.on('unhandledRejection', (reason) => {
  __dbg8e7Post({
    location: 'main.ts:unhandledRejection',
    hypothesisId: 'H1',
    message: 'unhandledRejection',
    data: {
      name: reason instanceof Error ? reason.name : typeof reason,
      msg: reason instanceof Error ? reason.message.slice(0, 2500) : String(reason).slice(0, 2500),
      stack: reason instanceof Error ? reason.stack?.slice(0, 4000) : undefined,
    },
  });
});
process.on('uncaughtException', (err) => {
  __dbg8e7Post({
    location: 'main.ts:uncaughtException',
    hypothesisId: 'H5',
    message: 'uncaughtException',
    data: {
      name: err.name,
      msg: err.message.slice(0, 2500),
      stack: err.stack?.slice(0, 4000),
    },
  });
});
// #endregion
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

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
