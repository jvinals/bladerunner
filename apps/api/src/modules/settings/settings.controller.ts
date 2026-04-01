import { Controller, Get, Patch, Post, Body, Query, UseGuards, Req } from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
@UseGuards(ClerkAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get workspace settings' })
  @ApiResponse({ status: 200, description: 'Current workspace settings' })
  getSettings(@Req() req: any) {
    const userId = req.user.sub;
    return this.settingsService.getSettings(userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Update workspace settings' })
  @ApiResponse({ status: 200, description: 'Updated workspace settings' })
  updateSettings(@Req() req: any, @Body() data: Record<string, unknown>) {
    const userId = req.user.sub;
    return this.settingsService.updateSettings(userId, data as never);
  }

  @Get('llm/models')
  @ApiOperation({ summary: 'List models for a provider' })
  getProviderModels(@Req() req: any, @Query('providerId') providerId: string) {
    return this.settingsService.getProviderModels(req.user.sub, providerId);
  }

  @Get('llm/model-detail')
  @ApiOperation({ summary: 'Get detailed metadata for a provider model' })
  getModelDetail(@Req() req: any, @Query('providerId') providerId: string, @Query('modelId') modelId: string) {
    return this.settingsService.getModelDetail(req.user.sub, providerId, modelId);
  }

  @Post('llm/test-connection')
  @ApiOperation({ summary: 'Test provider credentials / connectivity' })
  testProviderConnection(@Req() req: any, @Body() data: { providerId?: unknown; model?: unknown }) {
    return this.settingsService.testProviderConnection(req.user.sub, data);
  }

  @Get('agent-context')
  @ApiOperation({ summary: 'General agent instructions (user workspace)' })
  getAgentContext(@Req() req: { user: { sub: string } }) {
    return this.settingsService.getAgentContext(req.user.sub);
  }

  @Patch('agent-context')
  @ApiOperation({ summary: 'Update general agent instructions' })
  patchAgentContext(@Req() req: { user: { sub: string } }, @Body() body: { generalInstructions?: string }) {
    return this.settingsService.updateAgentContext(req.user.sub, body);
  }
}
