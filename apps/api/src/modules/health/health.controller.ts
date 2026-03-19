import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Check service health' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'API up but database unreachable' })
  async getHealth(@Res({ passthrough: true }) res: Response) {
    let database: 'ok' | 'error' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'error';
    }

    const body = {
      status: database === 'ok' ? 'ok' : 'degraded',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      services: {
        api: 'ok',
        database,
        storage: 'ok',
      },
    };

    if (database === 'error') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return body;
  }
}
