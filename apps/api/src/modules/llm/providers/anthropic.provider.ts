import Anthropic from '@anthropic-ai/sdk';
import { ChatMessage, LlmChatOptions, LlmProvider } from './llm-provider.interface';

export class AnthropicProvider implements LlmProvider {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async chat(messages: ChatMessage[], options?: LlmChatOptions): Promise<string> {
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

    const anthropicMessages: Anthropic.MessageParam[] = nonSystemMsgs.map(
      (msg) => {
        if (msg.role === 'user' && options?.imageBase64) {
          return {
            role: 'user' as const,
            content: [
              {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'image/jpeg' as const,
                  data: options.imageBase64,
                },
              },
              { type: 'text' as const, text: msg.content },
            ],
          };
        }
        return { role: msg.role as 'user' | 'assistant', content: msg.content };
      },
    );

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 1024,
      system: systemMsg?.content,
      messages: anthropicMessages,
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    const text = textBlock && 'text' in textBlock ? textBlock.text : '';
    const stopReason = response.stop_reason;

    if (!text.trim()) {
      throw new Error(`Anthropic returned empty text (stop_reason=${String(stopReason ?? 'unknown')})`);
    }
    return text;
  }
}
