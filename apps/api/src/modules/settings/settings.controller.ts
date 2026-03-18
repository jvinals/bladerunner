import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get workspace settings' })
  @ApiResponse({ status: 200, description: 'Current workspace settings' })
  getSettings() {
    return this.settingsService.getSettings();
  }

  @Patch()
  @ApiOperation({ summary: 'Update workspace settings' })
  @ApiResponse({ status: 200, description: 'Updated workspace settings' })
  updateSettings(@Body() data: Record<string, unknown>) {
    return this.settingsService.updateSettings(data as never);
  }
}
