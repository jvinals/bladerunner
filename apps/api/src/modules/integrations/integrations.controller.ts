import { Controller, Get, Param, NotFoundException, UseGuards, Req } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { IntegrationsService } from './integrations.service';

@ApiTags('integrations')
@Controller('integrations')
@UseGuards(ClerkAuthGuard)
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  @ApiOperation({ summary: 'List all integrations' })
  @ApiResponse({ status: 200, description: 'List of integrations' })
  findAll(@Req() req: any) {
    const userId = req.user.sub;
    return this.integrationsService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an integration by ID' })
  @ApiResponse({ status: 200, description: 'Integration details' })
  @ApiResponse({ status: 404, description: 'Integration not found' })
  findOne(@Param('id') id: string, @Req() req: any) {
    const userId = req.user.sub;
    const integration = this.integrationsService.findOne(id, userId);
    if (!integration) {
      throw new NotFoundException(`Integration ${id} not found`);
    }
    return integration;
  }
}
