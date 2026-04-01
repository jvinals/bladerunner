import { Module } from '@nestjs/common';
import { RecordingService } from './recording.service';
import { RecordingGateway } from './recording.gateway';
import { LlmModule } from '../llm/llm.module';
import { AgentContextModule } from '../agent-context/agent-context.module';

@Module({
  imports: [LlmModule, AgentContextModule],
  providers: [RecordingService, RecordingGateway],
  exports: [RecordingService],
})
export class RecordingModule {}
