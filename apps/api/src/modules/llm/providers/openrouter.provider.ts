import OpenAI from 'openai';
import { ChatMessage, LlmChatOptions, LlmChatResult, LlmProvider } from './llm-provider.interface';

const OPENROUTER_DEFAULT_BASE = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter exposes an OpenAI-compatible Chat Completions API; model ids are OpenRouter slugs
 * (e.g. minimax/minimax-m2.5, openai/gpt-4o).
 */
export class OpenRouterProvider implements LlmProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string, opts?: { baseURL?: string; httpReferer?: string; appTitle?: string }) {
    const baseURL = (opts?.baseURL ?? OPENROUTER_DEFAULT_BASE).replace(/\/$/, '');
    const defaultHeaders: Record<string, string> = {};
    const referer = opts?.httpReferer?.trim();
    if (referer) defaultHeaders['HTTP-Referer'] = referer;
    defaultHeaders['X-Title'] = (opts?.appTitle ?? 'Bladerunner').slice(0, 128);
    this.client = new OpenAI({
      apiKey,
      baseURL,
      defaultHeaders,
    });
    this.model = model;
  }

  async chat(messages: ChatMessage[], options?: LlmChatOptions): Promise<LlmChatResult> {
    const openAiMessages: OpenAI.ChatCompletionMessageParam[] = messages.map((msg) => {
      if (msg.role === 'user' && options?.imageBase64) {
        return {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: msg.content },
            {
              type: 'image_url' as const,
              image_url: {
                url: `data:image/jpeg;base64,${options.imageBase64}`,
                detail: 'low' as const,
              },
            },
          ],
        };
      }
      return { role: msg.role, content: msg.content };
    });

    const maxCompletionTokens = options?.maxTokens ?? 4096;
    const responseFormat = options?.responseFormat ?? 'text';

    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: openAiMessages,
        temperature: options?.temperature ?? 0.1,
        max_completion_tokens: maxCompletionTokens,
        ...(responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
      },
      { signal: options?.signal },
    );

    const choice = response.choices[0];
    const msg = choice?.message;
    const content = typeof msg?.content === 'string' ? msg.content : '';
    if (!content.trim()) {
      throw new Error(`OpenRouter returned empty assistant message (finish_reason=${String(choice?.finish_reason ?? 'unknown')})`);
    }
    return { content };
  }
}
