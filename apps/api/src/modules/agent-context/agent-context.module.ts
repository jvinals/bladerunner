import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentContextService } from './agent-context.service';

@Module({
  imports: [PrismaModule],
  providers: [AgentContextService],
  exports: [AgentContextService],
})
export class AgentContextModule {}
