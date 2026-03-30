import { Module } from '@nestjs/common';
import { EvaluationsController } from './evaluations.controller';
import { EvaluationsService } from './evaluations.service';
import { EvaluationOrchestratorService } from './evaluation-orchestrator.service';
import { RecordingModule } from '../recording/recording.module';
import { LlmModule } from '../llm/llm.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, RecordingModule, LlmModule],
  controllers: [EvaluationsController],
  providers: [EvaluationsService, EvaluationOrchestratorService],
  exports: [EvaluationsService],
})
export class EvaluationsModule {}
