import { Module, forwardRef } from '@nestjs/common';
import { RecordingService } from './recording.service';
import { RecordingGateway } from './recording.gateway';
import { LlmModule } from '../llm/llm.module';
import { AgentContextModule } from '../agent-context/agent-context.module';
import { NavigationsModule } from '../navigations/navigations.module';

@Module({
  imports: [LlmModule, AgentContextModule, forwardRef(() => NavigationsModule)],
  providers: [RecordingService, RecordingGateway],
  exports: [RecordingService],
})
export class RecordingModule {}
