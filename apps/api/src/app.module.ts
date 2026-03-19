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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
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
  ],
})
export class AppModule {}
