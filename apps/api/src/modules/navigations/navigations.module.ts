import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RecordingModule } from '../recording/recording.module';
import { LlmModule } from '../llm/llm.module';
import { NavigationsController } from './navigations.controller';
import { NavigationsService } from './navigations.service';
import { NavigationRecordingService } from './navigation-recording.service';

@Module({
  imports: [PrismaModule, LlmModule, forwardRef(() => RecordingModule)],
  controllers: [NavigationsController],
  providers: [NavigationsService, NavigationRecordingService],
  exports: [NavigationsService, NavigationRecordingService],
})
export class NavigationsModule {}
