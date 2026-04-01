import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectDiscoveryService } from './project-discovery.service';
import { RecordingModule } from '../recording/recording.module';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [RecordingModule, LlmModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectDiscoveryService],
})
export class ProjectsModule {}
