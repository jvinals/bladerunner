import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { RunsModule } from './modules/runs/runs.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { SettingsModule } from './modules/settings/settings.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { AgentsModule } from './modules/agents/agents.module';

@Module({
  imports: [
    HealthModule,
    RunsModule,
    ProjectsModule,
    SettingsModule,
    IntegrationsModule,
    AgentsModule,
  ],
})
export class AppModule {}
