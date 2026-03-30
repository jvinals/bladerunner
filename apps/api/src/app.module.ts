import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './modules/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { RunsModule } from './modules/runs/runs.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { SettingsModule } from './modules/settings/settings.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { AgentsModule } from './modules/agents/agents.module';
import { AuthModule } from './modules/auth/auth.module';
import { RecordingModule } from './modules/recording/recording.module';
import { LlmModule } from './modules/llm/llm.module';
import { EvaluationsModule } from './modules/evaluations/evaluations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // cwd varies (repo root vs apps/api); anchor to compiled output in dist/
      // First file wins for duplicate keys — api-local .env overrides monorepo root
      envFilePath: [
        join(__dirname, '..', '.env'), // apps/api/.env
        join(__dirname, '..', '..', '..', '.env'), // repo root .env
      ],
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    RunsModule,
    ProjectsModule,
    SettingsModule,
    IntegrationsModule,
    AgentsModule,
    RecordingModule,
    LlmModule,
    EvaluationsModule,
  ],
})
export class AppModule {}
