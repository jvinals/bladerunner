import { Injectable } from '@nestjs/common';

@Injectable()
export class SettingsService {
  private settings = {
    workspace: {
      id: 'ws_edgehealth',
      name: 'Edgehealth',
      slug: 'edgehealth',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-03-18T00:00:00Z',
    },
    defaultPlatform: 'desktop',
    notificationsEnabled: true,
    slackWebhookUrl: undefined,
    retentionDays: 90,
  };

  getSettings() {
    return this.settings;
  }

  updateSettings(data: Partial<typeof this.settings>) {
    this.settings = { ...this.settings, ...data };
    return this.settings;
  }
}
