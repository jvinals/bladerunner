import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  // #region agent log
  fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5f6bd9'},body:JSON.stringify({sessionId:'5f6bd9',location:'main.ts:bootstrap-start',message:'NestJS bootstrap starting',data:{},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
  // #endregion
  let app;
  try {
    app = await NestFactory.create(AppModule);
  } catch (err) {
    // #region agent log
    fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5f6bd9'},body:JSON.stringify({sessionId:'5f6bd9',location:'main.ts:bootstrap-create-error',message:'NestFactory.create FAILED',data:{error:String(err),stack:(err as any)?.stack?.slice(0,800)},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    console.error('Failed to create NestJS app:', err);
    throw err;
  }

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
