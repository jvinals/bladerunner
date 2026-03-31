import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmConfigService } from '../llm/llm-config.service';
import { LlmModelListService } from '../llm/llm-model-list.service';
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
    private readonly llmModelList: LlmModelListService,
  ) {}

  async getSettings(userId: string) {
    const [{ usage, userModelPresets }, providerCatalog, capabilities, providerCredentials] = await Promise.all([
      this.llmConfig.getEffectivePreferencesForUser(userId),
      this.llmModelList.getResolvedProviderCatalog(userId),
      this.llmConfig.getCapabilities(userId),
      this.llmConfig.getMaskedProviderCredentials(userId),
    ]);
    return {
      ...defaultWorkspace,
      llm: {
        usage,
        userModelPresets,
        capabilities,
        providerCatalog,
        providerDefinitions: this.llmConfig.getProviderDefinitions(),
        providerCredentials,
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
    const existing = await this.llmConfig.readUserLlmPreferencesJson(userId);
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

    if (llm.providerCredentials != null) {
      if (typeof llm.providerCredentials !== 'object') {
        throw new BadRequestException('Invalid providerCredentials payload');
      }
      const patch: Record<string, { apiKey?: string | null; baseUrl?: string | null }> = {};
      for (const [providerId, raw] of Object.entries(llm.providerCredentials as Record<string, unknown>)) {
        if (!isValidProviderId(providerId)) continue;
        if (!raw || typeof raw !== 'object') continue;
        const apiKey = (raw as { apiKey?: unknown }).apiKey;
        const baseUrl = (raw as { baseUrl?: unknown }).baseUrl;
        const nextEntry = {
          ...(typeof apiKey === 'string' || apiKey === null ? { apiKey } : {}),
          ...(typeof baseUrl === 'string'
            ? baseUrl.trim()
              ? { baseUrl }
              : {}
            : baseUrl === null
              ? { baseUrl }
              : {}),
        };
        if (Object.keys(nextEntry).length > 0) {
          patch[providerId] = nextEntry;
        }
      }
      if (Object.keys(patch).length > 0) {
        await this.llmConfig.updateUserLlmCredentials(userId, patch);
      }
    }

    try {
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
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021') {
        throw new ServiceUnavailableException(
          'LLM preferences table is missing. Run: cd apps/api && pnpm exec prisma migrate deploy',
        );
      }
      throw e;
    }
  }

  async getProviderModels(userId: string, providerId: string) {
    if (!isValidProviderId(providerId)) {
      throw new BadRequestException('Invalid providerId');
    }
    return {
      providerId,
      models: await this.llmModelList.getProviderModels(userId, providerId),
    };
  }

  async getModelDetail(userId: string, providerId: string, modelId: string) {
    if (!isValidProviderId(providerId)) {
      throw new BadRequestException('Invalid providerId');
    }
    const model = sanitizeModelId(modelId);
    if (!model) throw new BadRequestException('Invalid modelId');
    return this.llmModelList.getModelDetail(userId, providerId, model);
  }

  async testProviderConnection(
    userId: string,
    payload: { providerId?: unknown; model?: unknown },
  ): Promise<{ ok: boolean; latencyMs: number; source: string; error?: string }> {
    const providerId = typeof payload.providerId === 'string' ? payload.providerId : '';
    if (!isValidProviderId(providerId)) {
      throw new BadRequestException('Invalid providerId');
    }
    const resolved = await this.llmConfig.resolveProviderCredentials(userId, providerId);
    const started = Date.now();
    try {
      if (providerId === 'gemini') {
        const key = resolved.apiKey?.trim();
        if (!key) throw new Error('Gemini API key missing');
        const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
        url.searchParams.set('key', key);
        url.searchParams.set('pageSize', '1');
        const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
      } else if (providerId === 'anthropic') {
        const key = resolved.apiKey?.trim();
        if (!key) throw new Error('Anthropic API key missing');
        const model =
          typeof payload.model === 'string' && sanitizeModelId(payload.model)
            ? sanitizeModelId(payload.model)
            : 'claude-3-5-haiku-20241022';
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Reply with OK' }],
          }),
        });
        if (!res.ok) throw new Error(`Anthropic HTTP ${res.status}`);
      } else {
        const apiKey = resolved.apiKey?.trim() || (providerId === 'ollama' ? 'ollama' : '');
        const baseUrl = resolved.baseUrl?.trim();
        if (!baseUrl) throw new Error('Provider base URL missing');
        if (!apiKey) throw new Error('Provider API key missing');
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
        });
        if (!res.ok) throw new Error(`${providerId} HTTP ${res.status}`);
      }
      return { ok: true, latencyMs: Date.now() - started, source: resolved.source };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        source: resolved.source,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
