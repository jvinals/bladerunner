import { Controller, Get, Patch, Body, UseGuards, Req } from '@nestjs/common';
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
}
