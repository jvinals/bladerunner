import { Module } from '@nestjs/common';
import { RecordingService } from './recording.service';
import { RecordingGateway } from './recording.gateway';
import { LlmModule } from '../llm/llm.module';

@Module({
  imports: [LlmModule],
  providers: [RecordingService, RecordingGateway],
  exports: [RecordingService],
})
export class RecordingModule {}
