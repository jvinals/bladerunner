import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  getDefaultPreferenceForUsage,
  LLM_PROVIDER_CATALOG,
  isValidProviderId,
  isValidUsageKey,
  type LlmPreferenceEntry,
  type LlmProviderId,
  type LlmUsageKey,
  type UserLlmPreferencesPayload,
  LLM_USAGE_KEYS,
} from './llm-usage-registry';
import { LlmCredentialsCryptoService } from './llm-credentials-crypto.service';
import { LLM_PROVIDER_REGISTRY, getProviderDefinition } from './llm-provider-registry';

export type LlmProviderCredential = {
  apiKey?: string;
  baseUrl?: string;
};

export type UserLlmCredentialsPayload = Record<string, LlmProviderCredential>;

export type LlmProviderCapability = {
  configured: boolean;
  source: 'env' | 'db' | 'mixed' | 'none';
  hasApiKey: boolean;
  hasBaseUrl: boolean;
  envApiKey?: string;
  envBaseUrl?: string;
  docsUrl?: string;
};

export type LlmCapabilities = {
  encryptionConfigured: boolean;
  providers: Record<string, LlmProviderCapability>;
};

@Injectable()
export class LlmConfigService {
  private readonly logger = new Logger(LlmConfigService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly crypto: LlmCredentialsCryptoService,
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

  private async findUserLlmCredentialsRow(userId: string) {
    try {
      return await this.prisma.userLlmCredentials.findUnique({
        where: { userId },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021') {
        this.logger.warn(
          'Table user_llm_credentials is missing — run `cd apps/api && pnpm exec prisma migrate deploy`. Using env credentials until then.',
        );
        return null;
      }
      throw e;
    }
  }

  getProviderDefinitions() {
    return LLM_PROVIDER_REGISTRY;
  }

  /** Raw JSON from DB, or `{}` if missing / unmigrated table. */
  async readUserLlmPreferencesJson(userId: string): Promise<UserLlmPreferencesPayload> {
    const row = await this.findUserLlmRow(userId.trim());
    if (!row?.preferencesJson || typeof row.preferencesJson !== 'object') {
      return {};
    }
    return row.preferencesJson as UserLlmPreferencesPayload;
  }

  async readUserLlmCredentialsJson(userId: string): Promise<UserLlmCredentialsPayload> {
    const row = await this.findUserLlmCredentialsRow(userId.trim());
    const decoded = this.crypto.tryDecryptJson(row?.payloadEncrypted ?? null);
    return decoded ? (decoded as UserLlmCredentialsPayload) : {};
  }

  private envCredentialsForProvider(providerId: string): LlmProviderCredential {
    const def = getProviderDefinition(providerId);
    if (!def) return {};
    const apiKey = def.envApiKey ? this.config.get<string>(def.envApiKey)?.trim() : undefined;
    const baseUrl =
      def.envBaseUrl != null
        ? this.config.get<string>(def.envBaseUrl)?.trim() || def.defaultBaseUrl
        : def.defaultBaseUrl;
    return {
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
    };
  }

  private redactApiKey(raw: string | undefined): string | undefined {
    const t = raw?.trim();
    if (!t) return undefined;
    if (t.length <= 8) return `${t.slice(0, 2)}***`;
    return `${t.slice(0, 4)}...${t.slice(-4)}`;
  }

  async resolveProviderCredentials(
    userId: string | undefined,
    providerId: string,
  ): Promise<LlmProviderCredential & { source: 'env' | 'db' | 'mixed' | 'none' }> {
    const env = this.envCredentialsForProvider(providerId);
    const dbPayload = userId?.trim() ? await this.readUserLlmCredentialsJson(userId.trim()) : {};
    const db = dbPayload?.[providerId] ?? {};
    const apiKey = db.apiKey?.trim() || env.apiKey;
    const baseUrl = db.baseUrl?.trim() || env.baseUrl;
    const hasDb = Boolean(db.apiKey?.trim() || db.baseUrl?.trim());
    const hasEnv = Boolean(env.apiKey?.trim() || env.baseUrl?.trim());
    const source: 'env' | 'db' | 'mixed' | 'none' = hasDb && hasEnv ? 'mixed' : hasDb ? 'db' : hasEnv ? 'env' : 'none';
    return {
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      source,
    };
  }

  async getCapabilities(userId?: string): Promise<LlmCapabilities> {
    const providers = await Promise.all(
      this.getProviderDefinitions().map(async (provider) => {
        const resolved = await this.resolveProviderCredentials(userId, provider.id);
        const hasApiKey = Boolean(resolved.apiKey?.trim()) || provider.id === 'ollama';
        const hasBaseUrl = Boolean(resolved.baseUrl?.trim());
        return [
          provider.id,
          {
            configured: hasApiKey || provider.id === 'ollama',
            source: resolved.source,
            hasApiKey,
            hasBaseUrl,
            ...(provider.envApiKey ? { envApiKey: provider.envApiKey } : {}),
            ...(provider.envBaseUrl ? { envBaseUrl: provider.envBaseUrl } : {}),
            ...(provider.docsUrl ? { docsUrl: provider.docsUrl } : {}),
          } satisfies LlmProviderCapability,
        ] as const;
      }),
    );
    return {
      encryptionConfigured: this.crypto.isConfigured(),
      providers: Object.fromEntries(providers),
    };
  }

  async getMaskedProviderCredentials(userId: string): Promise<Record<string, { apiKeyMasked?: string; baseUrl?: string }>> {
    const dbPayload = await this.readUserLlmCredentialsJson(userId);
    return Object.fromEntries(
      this.getProviderDefinitions().map((provider) => {
        const entry = dbPayload[provider.id];
        return [
          provider.id,
          {
            ...(entry?.apiKey?.trim() ? { apiKeyMasked: this.redactApiKey(entry.apiKey) } : {}),
            ...(entry?.baseUrl?.trim() ? { baseUrl: entry.baseUrl.trim() } : {}),
          },
        ];
      }),
    );
  }

  async updateUserLlmCredentials(
    userId: string,
    patch: Record<string, { apiKey?: string | null; baseUrl?: string | null }>,
  ): Promise<void> {
    if (!this.crypto.isConfigured()) {
      throw new ServiceUnavailableException(
        'LLM_CREDENTIALS_ENCRYPTION_KEY is not set on the API. Add a base64-encoded 32-byte key to apps/api/.env or the repo root .env (API loads both), then restart: openssl rand -base64 32',
      );
    }
    const existing = await this.readUserLlmCredentialsJson(userId);
    const next: UserLlmCredentialsPayload = { ...existing };
    for (const [providerId, entry] of Object.entries(patch)) {
      if (!isValidProviderId(providerId)) continue;
      const current = { ...(next[providerId] ?? {}) };
      const apiKey = entry.apiKey == null ? current.apiKey : entry.apiKey.trim();
      const baseUrl = entry.baseUrl == null ? current.baseUrl : entry.baseUrl.trim();
      if (apiKey) current.apiKey = apiKey;
      else delete current.apiKey;
      if (baseUrl) current.baseUrl = baseUrl;
      else delete current.baseUrl;
      if (current.apiKey || current.baseUrl) next[providerId] = current;
      else delete next[providerId];
    }
    try {
      await this.prisma.userLlmCredentials.upsert({
        where: { userId },
        create: {
          userId,
          payloadEncrypted: Buffer.from(this.crypto.encryptJson(next)),
        },
        update: {
          payloadEncrypted: Buffer.from(this.crypto.encryptJson(next)),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021') {
        throw new ServiceUnavailableException(
          'LLM credentials table is missing. Run: cd apps/api && pnpm exec prisma migrate deploy',
        );
      }
      throw e;
    }
  }

  getApiKey(provider: LlmProviderId): string | undefined {
    return this.envCredentialsForProvider(provider).apiKey;
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

  getProviderCatalog() {
    return LLM_PROVIDER_CATALOG;
  }
}
