import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmConfigService } from '../llm/llm-config.service';
import {
  isValidProviderId,
  isValidUsageKey,
  sanitizeModelId,
  type LlmPreferenceEntry,
  type LlmProviderId,
  type LlmUsageKey,
  type UserLlmPreferencesPayload,
} from '../llm/llm-usage-registry';

const defaultWorkspace = {
  workspace: {
    id: 'ws_new',
    name: 'New Workspace',
    slug: 'new-workspace',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  defaultPlatform: 'desktop',
  notificationsEnabled: true,
  slackWebhookUrl: undefined as string | undefined,
  retentionDays: 30,
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmConfig: LlmConfigService,
  ) {}

  async getSettings(userId: string) {
    const { usage, userModelPresets } = await this.llmConfig.getEffectivePreferencesForUser(userId);
    return {
      ...defaultWorkspace,
      llm: {
        usage,
        userModelPresets,
        capabilities: this.llmConfig.getCapabilities(),
        providerCatalog: this.llmConfig.getProviderCatalog(),
      },
    };
  }

  async updateSettings(userId: string, data: Record<string, unknown>) {
    if (data.llm != null && typeof data.llm !== 'object') {
      throw new BadRequestException('Invalid llm payload');
    }

    if (data.llm && typeof data.llm === 'object') {
      await this.applyLlmPatch(userId, data.llm as Record<string, unknown>);
    }

    return this.getSettings(userId);
  }

  private async applyLlmPatch(userId: string, llm: Record<string, unknown>): Promise<void> {
    const existing = await this.loadRawPayload(userId);
    const next: UserLlmPreferencesPayload = { ...existing };

    if (llm.usage != null && typeof llm.usage === 'object') {
      const usage: Partial<Record<LlmUsageKey, LlmPreferenceEntry>> = { ...existing.usage };
      for (const [k, v] of Object.entries(llm.usage as Record<string, unknown>)) {
        if (!isValidUsageKey(k)) continue;
        if (!v || typeof v !== 'object') continue;
        const prov = (v as { provider?: unknown }).provider;
        const model = (v as { model?: unknown }).model;
        if (typeof prov !== 'string' || !isValidProviderId(prov)) {
          throw new BadRequestException(`Invalid provider for ${k}`);
        }
        if (typeof model !== 'string' || !sanitizeModelId(model)) {
          throw new BadRequestException(`Invalid model for ${k}`);
        }
        usage[k as LlmUsageKey] = { provider: prov as LlmProviderId, model: sanitizeModelId(model) };
      }
      next.usage = usage;
    }

    if (Array.isArray(llm.userModelPresets)) {
      const presets: string[] = [];
      for (const p of llm.userModelPresets) {
        if (typeof p === 'string' && sanitizeModelId(p)) presets.push(sanitizeModelId(p));
      }
      next.userModelPresets = presets;
    }

    await this.prisma.userLlmPreferences.upsert({
      where: { userId },
      create: {
        userId,
        preferencesJson: next as object,
      },
      update: {
        preferencesJson: next as object,
      },
    });
  }

  private async loadRawPayload(userId: string): Promise<UserLlmPreferencesPayload> {
    const row = await this.prisma.userLlmPreferences.findUnique({ where: { userId } });
    if (!row?.preferencesJson || typeof row.preferencesJson !== 'object') {
      return {};
    }
    return row.preferencesJson as UserLlmPreferencesPayload;
  }
}
