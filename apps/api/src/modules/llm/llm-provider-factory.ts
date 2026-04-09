import { ConfigService } from '@nestjs/config';
import { OpenAiProvider } from './providers/openai.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import type { LlmProvider } from './providers/llm-provider.interface';
import type { LlmProviderId } from './llm-usage-registry';
import { getProviderDefinition, isAnthropicNative, isOpenAiCompatible } from './llm-provider-registry';
import type { LlmProviderCredential } from './llm-config.service';

export function createChatLlmProvider(
  config: ConfigService,
  provider: Exclude<LlmProviderId, 'gemini'>,
  model: string,
  credentials: LlmProviderCredential,
): LlmProvider {
  const def = getProviderDefinition(provider);
  if (!def) {
    throw new Error(`createChatLlmProvider: unsupported provider ${String(provider)}`);
  }
  if (isAnthropicNative(provider)) {
    const key = credentials.apiKey?.trim();
    if (!key) throw new Error(`${provider} API key is not set`);
    return new AnthropicProvider(key, model);
  }
  if (isOpenAiCompatible(provider)) {
    const key = credentials.apiKey?.trim() || (provider === 'ollama' ? 'ollama' : '');
    if (!key) throw new Error(`${provider} API key is not set`);
    const defaultHeaders: Record<string, string> = {};
    if (def.openRouterStyle) {
      const referer = config.get<string>('OPENROUTER_HTTP_REFERER')?.trim();
      if (referer) defaultHeaders['HTTP-Referer'] = referer;
      defaultHeaders['X-Title'] = (config.get<string>('OPENROUTER_APP_TITLE')?.trim() || 'Bladerunner').slice(
        0,
        128,
      );
    }
    return new OpenAiProvider(key, model, {
      ...(credentials.baseUrl?.trim() ? { baseURL: credentials.baseUrl.trim() } : {}),
      ...(Object.keys(defaultHeaders).length ? { defaultHeaders } : {}),
      openRouterStyle: Boolean(def.openRouterStyle),
    });
  }
  throw new Error(`createChatLlmProvider: unsupported protocol for ${provider}`);
}
