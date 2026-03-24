import OpenAI from 'openai';
import { ChatMessage, LlmChatOptions, LlmChatResult, LlmProvider } from './llm-provider.interface';

export class OpenAiProvider implements LlmProvider {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = 'gpt-5.4-mini') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async chat(messages: ChatMessage[], options?: LlmChatOptions): Promise<LlmChatResult> {
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

    /** `max_tokens` is deprecated; GPT-5.x / reasoning models use `max_completion_tokens` (includes reasoning + visible text). */
    const maxCompletionTokens = options?.maxTokens ?? 1024;

    const supportsReasoningEffort =
      this.model.includes('gpt-5') || /^o[0-9]/i.test(this.model);

    const responseFormat = options?.responseFormat ?? 'json_object';

    const response = await this.client.chat.completions.create(
      {
        model: this.model,
        messages: openAiMessages,
        temperature: options?.temperature ?? 0.1,
        max_completion_tokens: maxCompletionTokens,
        ...(responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
        ...(options?.reasoningEffort != null && supportsReasoningEffort
          ? { reasoning_effort: options.reasoningEffort }
          : {}),
      },
      { signal: options?.signal },
    );

    const choice = response.choices[0];
    const msg = choice?.message;
    const msgExt = msg ? (msg as unknown as Record<string, unknown>) : undefined;
    const thinkingRaw =
      typeof msgExt?.reasoning === 'string'
        ? msgExt.reasoning
        : typeof msgExt?.thinking === 'string'
          ? msgExt.thinking
          : undefined;
    const thinking = thinkingRaw?.trim() ? thinkingRaw.trim() : undefined;
    const content = typeof msg?.content === 'string' ? msg.content : '';
    const refusal = typeof msg?.refusal === 'string' ? msg.refusal : '';
    const finishReason = choice?.finish_reason;
    const usage = response.usage;
    const reasoningTok = usage?.completion_tokens_details?.reasoning_tokens;

    if (!content.trim()) {
      const bits = [
        `OpenAI returned empty assistant message (finish_reason=${String(finishReason ?? 'unknown')})`,
        refusal.trim() ? `refusal=${refusal}` : null,
        reasoningTok != null ? `reasoning_tokens=${reasoningTok}` : null,
        usage != null ? `completion_tokens=${usage.completion_tokens}` : null,
      ].filter(Boolean);
      const hint = refusal.trim()
        ? ' — Model refused (policy). Rephrase the step as neutral UI test actions or shorten fixture text; ensure OPENAI model stack emphasizes QA automation.'
        : (reasoningTok ?? 0) > 0 && (usage?.completion_tokens ?? 0) < 50
          ? ' — Likely completion budget used by reasoning; lower reasoning_effort or raise max_completion_tokens.'
          : '';
      throw new Error(bits.join(' | ') + hint);
    }
    return { content, thinking };
  }
}
