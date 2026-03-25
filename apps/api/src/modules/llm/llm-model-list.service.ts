import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmConfigService } from './llm-config.service';
import { LLM_PROVIDER_CATALOG } from './llm-usage-registry';
import { getProviderDefinition, isAnthropicNative, isOpenAiCompatible } from './llm-provider-registry';

function mergeUniqueSorted(primary: string[], ...extras: string[][]): string[] {
  const set = new Set<string>();
  for (const s of primary) {
    const t = s.trim();
    if (t) set.add(t);
  }
  for (const list of extras) {
    for (const s of list) {
      const t = s.trim();
      if (t) set.add(t);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function isLikelyOpenAiChatModel(id: string): boolean {
  const x = id.toLowerCase();
  if (x.includes('embedding')) return false;
  if (x.includes('tts')) return false;
  if (x.includes('whisper')) return false;
  if (x.includes('dall-e') || x.includes('dall·e')) return false;
  if (x.includes('moderation')) return false;
  if (x.includes('davinci') || x.includes('babbage') || x.includes('ada') || x.includes('curie')) {
    return false;
  }
  if (x.includes('realtime')) return false;
  if (x.includes('audio')) return false;
  if (x.includes('transcribe')) return false;
  if (/(^gpt-|^chatgpt-|^o1|^o3|^o4)/i.test(id)) return true;
  return false;
}

export type ResolvedProviderCatalog = Record<
  string,
  { label: string; suggestedModels: string[]; models: string[] }
>;

export type LlmProviderModelOption = {
  id: string;
  launchDate: string | null;
};

export type LlmModelDetail = {
  providerId: string;
  modelId: string;
  title: string;
  description: string;
  thinkingType: string;
  capabilities: string[];
  supportsVision: boolean;
  contextWindow?: number;
  pricingSummary?: string;
  accuracySummary: string;
  metadataSource: 'openrouter' | 'provider_api' | 'static' | 'fallback';
};

type OpenRouterModel = {
  id?: string;
  name?: string;
  created?: number;
  description?: string;
  context_length?: number;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  pricing?: {
    prompt?: string;
    completion?: string;
  };
};

const ANTHROPIC_CHAT_MODEL_IDS: string[] = [
  'claude-opus-4-20250514',
  'claude-sonnet-4-20250514',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-sonnet-20241022',
  'claude-3-5-haiku-20241022',
  'claude-3-opus-20240229',
  'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307',
  'claude-2.1',
  'claude-2.0',
  'claude-instant-1.2',
];

@Injectable()
export class LlmModelListService implements OnModuleInit {
  private readonly logger = new Logger(LlmModelListService.name);
  private cache: { at: number; catalog: ResolvedProviderCatalog } | null = null;
  private openRouterMeta = new Map<string, OpenRouterModel>();

  constructor(
    private readonly config: ConfigService,
    private readonly llmConfig: LlmConfigService,
  ) {}

  onModuleInit(): void {
    void this.getResolvedProviderCatalog().catch((e: unknown) => {
      this.logger.warn(
        `LLM model catalog prefetch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
  }

  private ttlMs(): number {
    const raw = this.config.get<string>('LLM_MODEL_CATALOG_TTL_MS')?.trim();
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(n) && n >= 60_000) return n;
    return 15 * 60 * 1000;
  }

  async getResolvedProviderCatalog(userId?: string): Promise<ResolvedProviderCatalog> {
    const ttl = this.ttlMs();
    if (!userId && this.cache && Date.now() - this.cache.at < ttl) {
      return this.cache.catalog;
    }
    const entries = await Promise.all(
      this.llmConfig.getProviderDefinitions().map(async (provider) => {
        const base = LLM_PROVIDER_CATALOG[provider.id] ?? { label: provider.label, suggestedModels: [] };
        const fetched = await this.fetchModelsForProvider(userId, provider.id);
        return [
          provider.id,
          {
            label: base.label,
            suggestedModels: base.suggestedModels,
            models: mergeUniqueSorted(fetched, base.suggestedModels),
          },
        ] as const;
      }),
    );
    const catalog = Object.fromEntries(entries);
    if (!userId) this.cache = { at: Date.now(), catalog };
    return catalog;
  }

  async getProviderModels(userId: string | undefined, providerId: string): Promise<LlmProviderModelOption[]> {
    const base = (LLM_PROVIDER_CATALOG[providerId]?.suggestedModels ?? []).map((id) => ({ id, launchDate: null }));
    const fetched = await this.fetchModelOptionsForProvider(userId, providerId);
    const map = new Map<string, LlmProviderModelOption>();
    for (const item of [...fetched, ...base]) {
      if (!map.has(item.id)) map.set(item.id, item);
    }
    return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async getModelDetail(
    userId: string | undefined,
    providerId: string,
    modelId: string,
  ): Promise<LlmModelDetail> {
    const provider = getProviderDefinition(providerId);
    const title = this.openRouterMeta.get(modelId)?.name?.trim() || modelId;
    const meta = this.openRouterMeta.get(modelId);
    if (!meta && providerId === 'openrouter') {
      await this.fetchOpenRouterModelIds();
    }
    const openRouter = this.openRouterMeta.get(modelId);
    if (openRouter) {
      const caps = [
        ...(openRouter.architecture?.input_modalities?.map((x) => `Input: ${x}`) ?? []),
        ...(openRouter.architecture?.output_modalities?.map((x) => `Output: ${x}`) ?? []),
      ];
      return {
        providerId,
        modelId,
        title: openRouter.name?.trim() || modelId,
        description: openRouter.description?.trim() || 'Provider metadata available from OpenRouter.',
        thinkingType: /reason|thinking|o1|o3|o4|opus|sonnet|deepseek-reasoner/i.test(modelId)
          ? 'Reasoning-capable'
          : 'General chat / generation',
        capabilities: caps.length ? caps : ['Chat completion'],
        supportsVision: (openRouter.architecture?.input_modalities ?? []).includes('image'),
        ...(openRouter.context_length ? { contextWindow: openRouter.context_length } : {}),
        ...(openRouter.pricing
          ? {
              pricingSummary: `Prompt $${openRouter.pricing.prompt ?? '?'} / token, completion $${openRouter.pricing.completion ?? '?'} / token`,
            }
          : {}),
        accuracySummary:
          'Accuracy varies by benchmark and prompt design. Use provider docs plus your own task evaluations before promoting a model.',
        metadataSource: 'openrouter',
      };
    }
    const models = await this.getProviderModels(userId, providerId);
    const supportsVision = /vision|omni|vl|llava|gemini|gpt-4o|pixtral/i.test(modelId);
    const thinkingType = /reason|o1|o3|o4|thinking|opus|sonnet/i.test(modelId)
      ? 'Reasoning / higher-latency'
      : /mini|flash|haiku|instant/i.test(modelId)
        ? 'Fast / lower-latency'
        : 'General-purpose';
    return {
      providerId,
      modelId,
      title,
      description:
        `${provider?.label ?? providerId} model metadata is limited from the provider API for this model. Review the provider documentation for benchmark-specific accuracy and pricing details.`,
      thinkingType,
      capabilities: [
        supportsVision ? 'Vision input' : 'Text input',
        models.some((m) => m.id === modelId) ? 'Selectable in current provider catalog' : 'Custom model id',
      ],
      supportsVision,
      accuracySummary:
        'No standardized live “accuracy” score is available here. Treat this panel as descriptive metadata, then validate on your own QA prompts and flows.',
      metadataSource: 'fallback',
    };
  }

  private async fetchModelOptionsForProvider(
    userId: string | undefined,
    providerId: string,
  ): Promise<LlmProviderModelOption[]> {
    if (providerId === 'openrouter') {
      const ids = await this.fetchOpenRouterModelIds();
      return ids.map((id) => ({
        id,
        launchDate: this.openRouterMeta.get(id)?.created
          ? new Date((this.openRouterMeta.get(id)?.created ?? 0) * 1000).toISOString().slice(0, 10)
          : null,
      }));
    }
    return (await this.fetchModelsForProvider(userId, providerId)).map((id) => ({ id, launchDate: null }));
  }

  private async fetchModelsForProvider(userId: string | undefined, providerId: string): Promise<string[]> {
    if (providerId === 'openrouter') return this.fetchOpenRouterModelIds();
    if (providerId === 'gemini') return this.fetchGeminiModelIds(userId);
    if (isAnthropicNative(providerId)) return [...ANTHROPIC_CHAT_MODEL_IDS];
    if (providerId === 'ollama') return this.fetchOllamaModelIds(userId);
    if (isOpenAiCompatible(providerId)) return this.fetchOpenAiCompatibleModelIds(userId, providerId);
    return [];
  }

  private async fetchOpenRouterModelIds(): Promise<string[]> {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        this.logger.warn(`OpenRouter models HTTP ${res.status}`);
        return [];
      }
      const j = (await res.json()) as { data?: OpenRouterModel[] };
      const ids = (j.data ?? [])
        .map((x) => {
          const id = x.id?.trim();
          if (id) this.openRouterMeta.set(id, x);
          return id;
        })
        .filter((id): id is string => Boolean(id));
      return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
    } catch (e) {
      this.logger.warn(`OpenRouter models fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  private async fetchOpenAiCompatibleModelIds(userId: string | undefined, providerId: string): Promise<string[]> {
    const credentials = await this.llmConfig.resolveProviderCredentials(userId, providerId);
    const baseUrl = credentials.baseUrl?.trim();
    const apiKey = credentials.apiKey?.trim() || (providerId === 'ollama' ? 'ollama' : '');
    if (!baseUrl || !apiKey) return [];
    try {
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        this.logger.warn(`${providerId} models HTTP ${res.status}`);
        return [];
      }
      const j = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (j.data ?? [])
        .map((x) => x.id?.trim())
        .filter(
          (id): id is string => typeof id === 'string' && id.length > 0 && isLikelyOpenAiChatModel(id),
        );
      return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
    } catch (e) {
      this.logger.warn(`${providerId} models fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  private async fetchOllamaModelIds(userId: string | undefined): Promise<string[]> {
    const credentials = await this.llmConfig.resolveProviderCredentials(userId, 'ollama');
    const baseUrl = credentials.baseUrl?.replace(/\/v1\/?$/, '').replace(/\/$/, '');
    if (!baseUrl) return [];
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        this.logger.warn(`ollama tags HTTP ${res.status}`);
        return [];
      }
      const j = (await res.json()) as { models?: Array<{ name?: string }> };
      const ids = (j.models ?? [])
        .map((x) => x.name?.trim())
        .filter((id): id is string => Boolean(id));
      return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
    } catch (e) {
      this.logger.warn(`ollama tags fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  private async fetchGeminiModelIds(userId: string | undefined): Promise<string[]> {
    const key = (await this.llmConfig.resolveProviderCredentials(userId, 'gemini')).apiKey?.trim();
    if (!key) return [];
    const out: string[] = [];
    let pageToken: string | undefined;
    try {
      // Paginate (Gemini may return nextPageToken).
      for (let page = 0; page < 50; page++) {
        const url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
        url.searchParams.set('key', key);
        url.searchParams.set('pageSize', '100');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const res = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
        if (!res.ok) {
          this.logger.warn(`Gemini models HTTP ${res.status}`);
          break;
        }
        const j = (await res.json()) as {
          models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
          nextPageToken?: string;
        };
        for (const m of j.models ?? []) {
          const methods = m.supportedGenerationMethods ?? [];
          if (methods.length > 0 && !methods.includes('generateContent')) continue;
          const raw = m.name?.trim();
          if (!raw) continue;
          const id = raw.replace(/^models\//, '');
          if (id && !id.includes('embedding')) out.push(id);
        }
        pageToken = j.nextPageToken;
        if (!pageToken) break;
      }
      return [...new Set(out)].sort((a, b) => a.localeCompare(b));
    } catch (e) {
      this.logger.warn(`Gemini models fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }
}
