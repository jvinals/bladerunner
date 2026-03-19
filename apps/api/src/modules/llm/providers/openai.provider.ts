import OpenAI from 'openai';
import { ChatMessage, LlmChatOptions, LlmProvider } from './llm-provider.interface';

export class OpenAiProvider implements LlmProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = 'gpt-4o') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async chat(messages: ChatMessage[], options?: LlmChatOptions): Promise<string> {
    const openAiMessages: OpenAI.ChatCompletionMessageParam[] = messages.map(
      (msg) => {
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
      },
    );

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: openAiMessages,
      temperature: options?.temperature ?? 0.1,
      max_tokens: options?.maxTokens ?? 1024,
      response_format: { type: 'json_object' },
    });

    return response.choices[0]?.message?.content || '';
  }
}
