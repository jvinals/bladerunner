import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LLM_PROVIDER_CATALOG,
  type LlmProviderId,
} from './llm-usage-registry';

/** Known Anthropic API model ids (no public list-models endpoint). */
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
  LlmProviderId,
  { label: string; suggestedModels: string[]; models: string[] }
>;

@Injectable()
export class LlmModelListService implements OnModuleInit {
  private readonly logger = new Logger(LlmModelListService.name);
  private cache: { at: number; catalog: ResolvedProviderCatalog } | null = null;

  constructor(private readonly config: ConfigService) {}

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

  async getResolvedProviderCatalog(): Promise<ResolvedProviderCatalog> {
    const ttl = this.ttlMs();
    if (this.cache && Date.now() - this.cache.at < ttl) {
      return this.cache.catalog;
    }
    const [openrouter, openai, gemini] = await Promise.all([
      this.fetchOpenRouterModelIds(),
      this.fetchOpenAiModelIds(),
      this.fetchGeminiModelIds(),
    ]);
    const base = LLM_PROVIDER_CATALOG;
    const catalog: ResolvedProviderCatalog = {
      gemini: {
        label: base.gemini.label,
        suggestedModels: base.gemini.suggestedModels,
        models: mergeUniqueSorted(gemini, base.gemini.suggestedModels),
      },
      openai: {
        label: base.openai.label,
        suggestedModels: base.openai.suggestedModels,
        models: mergeUniqueSorted(openai, base.openai.suggestedModels),
      },
      anthropic: {
        label: base.anthropic.label,
        suggestedModels: base.anthropic.suggestedModels,
        models: mergeUniqueSorted(ANTHROPIC_CHAT_MODEL_IDS, base.anthropic.suggestedModels),
      },
      openrouter: {
        label: base.openrouter.label,
        suggestedModels: base.openrouter.suggestedModels,
        models: mergeUniqueSorted(openrouter, base.openrouter.suggestedModels),
      },
    };
    this.cache = { at: Date.now(), catalog };
    return catalog;
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
      const j = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (j.data ?? [])
        .map((x) => x.id?.trim())
        .filter((id): id is string => Boolean(id));
      return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
    } catch (e) {
      this.logger.warn(`OpenRouter models fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  private async fetchOpenAiModelIds(): Promise<string[]> {
    const key = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!key) return [];
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      });
      if (!res.ok) {
        this.logger.warn(`OpenAI models HTTP ${res.status}`);
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
      this.logger.warn(`OpenAI models fetch failed: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }

  private async fetchGeminiModelIds(): Promise<string[]> {
    const key = this.config.get<string>('GEMINI_API_KEY')?.trim();
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
