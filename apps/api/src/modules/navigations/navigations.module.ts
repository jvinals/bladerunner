import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NavigationsController } from './navigations.controller';
import { NavigationsService } from './navigations.service';

@Module({
  imports: [PrismaModule],
  controllers: [NavigationsController],
  providers: [NavigationsService],
  exports: [NavigationsService],
})
export class NavigationsModule {}
