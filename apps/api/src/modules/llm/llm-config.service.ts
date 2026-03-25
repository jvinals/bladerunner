import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  getDefaultPreferenceForUsage,
  isValidProviderId,
  isValidUsageKey,
  type LlmPreferenceEntry,
  type LlmProviderId,
  type LlmUsageKey,
  type UserLlmPreferencesPayload,
  LLM_PROVIDER_CATALOG,
  LLM_USAGE_KEYS,
} from './llm-usage-registry';

export type LlmCapabilities = {
  hasGeminiKey: boolean;
  hasOpenAiKey: boolean;
  hasAnthropicKey: boolean;
  hasOpenRouterKey: boolean;
};

@Injectable()
export class LlmConfigService {
  private readonly logger = new Logger(LlmConfigService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * When `user_llm_preferences` has not been migrated yet (P2021), return null so callers use env defaults.
   */
  private async findUserLlmRow(userId: string) {
    try {
      return await this.prisma.userLlmPreferences.findUnique({
        where: { userId },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021') {
        this.logger.warn(
          'Table user_llm_preferences is missing — run `cd apps/api && pnpm exec prisma migrate deploy`. Using env LLM defaults until then.',
        );
        return null;
      }
      throw e;
    }
  }

  getCapabilities(): LlmCapabilities {
    return {
      hasGeminiKey: Boolean(this.config.get<string>('GEMINI_API_KEY')?.trim()),
      hasOpenAiKey: Boolean(this.config.get<string>('OPENAI_API_KEY')?.trim()),
      hasAnthropicKey: Boolean(this.config.get<string>('ANTHROPIC_API_KEY')?.trim()),
      hasOpenRouterKey: Boolean(this.config.get<string>('OPENROUTER_API_KEY')?.trim()),
    };
  }

  getProviderCatalog() {
    return LLM_PROVIDER_CATALOG;
  }

  /** Resolve API key for a provider from env (never persisted). */
  getApiKey(provider: LlmProviderId): string | undefined {
    switch (provider) {
      case 'gemini':
        return this.config.get<string>('GEMINI_API_KEY')?.trim();
      case 'openai':
        return this.config.get<string>('OPENAI_API_KEY')?.trim();
      case 'anthropic':
        return this.config.get<string>('ANTHROPIC_API_KEY')?.trim();
      case 'openrouter':
        return this.config.get<string>('OPENROUTER_API_KEY')?.trim();
      default:
        return undefined;
    }
  }

  /** Raw JSON from DB, or `{}` if missing / unmigrated table. */
  async readUserLlmPreferencesJson(userId: string): Promise<UserLlmPreferencesPayload> {
    const row = await this.findUserLlmRow(userId.trim());
    if (!row?.preferencesJson || typeof row.preferencesJson !== 'object') {
      return {};
    }
    return row.preferencesJson as UserLlmPreferencesPayload;
  }

  geminiInstructionVerifyEnabled(): boolean {
    const v = this.config.get<string>('GEMINI_INSTRUCTION_VERIFY')?.trim().toLowerCase();
    if (v === 'false' || v === '0') return false;
    return true;
  }

  /**
   * Effective provider + model for a usage key. DB overrides env defaults per user.
   */
  async resolve(userId: string | undefined, usage: LlmUsageKey): Promise<LlmPreferenceEntry> {
    const fallback = getDefaultPreferenceForUsage(this.config, usage);
    if (!userId?.trim()) return fallback;

    const row = await this.findUserLlmRow(userId.trim());
    if (!row?.preferencesJson || typeof row.preferencesJson !== 'object') {
      return fallback;
    }
    const payload = row.preferencesJson as UserLlmPreferencesPayload;
    const entry = payload.usage?.[usage];
    if (!entry || !isValidProviderId(entry.provider) || typeof entry.model !== 'string' || !entry.model.trim()) {
      return fallback;
    }
    return { provider: entry.provider, model: entry.model.trim() };
  }

  /** Defaults for every key (for Settings GET when row missing). */
  getAllDefaults(): Record<LlmUsageKey, LlmPreferenceEntry> {
    const out = {} as Record<LlmUsageKey, LlmPreferenceEntry>;
    for (const k of LLM_USAGE_KEYS) {
      out[k] = getDefaultPreferenceForUsage(this.config, k);
    }
    return out;
  }

  async getEffectivePreferencesForUser(userId: string): Promise<{
    usage: Record<LlmUsageKey, LlmPreferenceEntry>;
    userModelPresets: string[];
  }> {
    const defaults = this.getAllDefaults();
    const row = await this.findUserLlmRow(userId.trim());
    const usage = { ...defaults };
    const presets: string[] = [];
    if (row?.preferencesJson && typeof row.preferencesJson === 'object') {
      const payload = row.preferencesJson as UserLlmPreferencesPayload;
      if (Array.isArray(payload.userModelPresets)) {
        for (const p of payload.userModelPresets) {
          if (typeof p === 'string' && p.trim()) presets.push(p.trim().slice(0, 256));
        }
      }
      if (payload.usage) {
        for (const [k, v] of Object.entries(payload.usage)) {
          if (!isValidUsageKey(k)) continue;
          if (!v || typeof v !== 'object') continue;
          const prov = (v as { provider?: unknown }).provider;
          const model = (v as { model?: unknown }).model;
          if (typeof prov !== 'string' || !isValidProviderId(prov)) continue;
          if (typeof model !== 'string' || !model.trim()) continue;
          usage[k as LlmUsageKey] = { provider: prov, model: model.trim() };
        }
      }
    }
    return { usage, userModelPresets: presets };
  }
}
