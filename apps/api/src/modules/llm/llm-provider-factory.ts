import { ConfigService } from '@nestjs/config';
import { OpenAiProvider } from './providers/openai.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenRouterProvider } from './providers/openrouter.provider';
import type { LlmProvider } from './providers/llm-provider.interface';
import type { LlmProviderId } from './llm-usage-registry';

export function createChatLlmProvider(
  config: ConfigService,
  provider: Exclude<LlmProviderId, 'gemini'>,
  model: string,
): LlmProvider {
  switch (provider) {
    case 'openai': {
      const key = config.get<string>('OPENAI_API_KEY')?.trim();
      if (!key) throw new Error('OPENAI_API_KEY is not set');
      return new OpenAiProvider(key, model);
    }
    case 'anthropic': {
      const key = config.get<string>('ANTHROPIC_API_KEY')?.trim();
      if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
      return new AnthropicProvider(key, model);
    }
    case 'openrouter': {
      const key = config.get<string>('OPENROUTER_API_KEY')?.trim();
      if (!key) throw new Error('OPENROUTER_API_KEY is not set');
      return new OpenRouterProvider(key, model, {
        baseURL: config.get<string>('OPENROUTER_BASE_URL')?.trim(),
        httpReferer: config.get<string>('OPENROUTER_HTTP_REFERER')?.trim(),
      });
    }
    default:
      throw new Error(`createChatLlmProvider: unsupported provider ${String(provider)}`);
  }
}
