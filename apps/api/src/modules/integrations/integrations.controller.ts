import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IntegrationsService } from './integrations.service';

@ApiTags('integrations')
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  @ApiOperation({ summary: 'List all integrations' })
  @ApiResponse({ status: 200, description: 'List of integrations' })
  findAll() {
    return this.integrationsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an integration by ID' })
  @ApiResponse({ status: 200, description: 'Integration details' })
  @ApiResponse({ status: 404, description: 'Integration not found' })
  findOne(@Param('id') id: string) {
    const integration = this.integrationsService.findOne(id);
    if (!integration) {
      throw new NotFoundException(`Integration ${id} not found`);
    }
    return integration;
  }
}
