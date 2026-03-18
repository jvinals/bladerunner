import { Injectable } from '@nestjs/common';

@Injectable()
export class SettingsService {
  private userSettings: Record<string, any> = {
    'user_2m19m7Zf6X4t5W8K9u0v1x2y3z4': {
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
    },
  };

  private defaultSettings = {
    workspace: {
      id: 'ws_new',
      name: 'New Workspace',
      slug: 'new-workspace',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    defaultPlatform: 'desktop',
    notificationsEnabled: true,
    slackWebhookUrl: undefined,
    retentionDays: 30,
  };

  getSettings(userId: string) {
    if (!this.userSettings[userId]) {
      this.userSettings[userId] = { ...this.defaultSettings };
    }
    return this.userSettings[userId];
  }

  updateSettings(userId: string, data: Partial<typeof this.defaultSettings>) {
    const current = this.getSettings(userId);
    this.userSettings[userId] = { ...current, ...data };
    return this.userSettings[userId];
  }
}
