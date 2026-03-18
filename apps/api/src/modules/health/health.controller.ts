import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Check service health' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  getHealth() {
    return {
      status: 'ok',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
      services: {
        api: 'ok',
        database: 'ok',
        storage: 'ok',
      },
    };
  }
}
