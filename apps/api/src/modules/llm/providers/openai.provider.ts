import OpenAI, { APIError } from 'openai';
import { ChatMessage, LlmChatOptions, LlmChatResult, LlmProvider } from './llm-provider.interface';

function enrichOpenAiClientError(err: unknown): Error {
  if (err instanceof APIError) {
    const nested = err.error;
    const body =
      nested && typeof nested === 'object'
        ? JSON.stringify(nested)
        : nested != null
          ? String(nested)
          : '';
    const base = `${err.message}${body ? ` | error_json=${body}` : ''}${err.requestID ? ` | request_id=${err.requestID}` : ''}`;
    /** Nested OpenRouter metadata.raw may contain the real upstream message. */
    const hint = visionBedrockHint(base);
    return new Error(base + hint);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Bedrock often rejects vision for Claude snapshots; message is wrapped as generic "Provider returned error". */
function visionBedrockHint(flatMessage: string): string {
  if (!/does not support image input|image input/i.test(flatMessage)) return '';
  return (
    ' | Hint: This model route does not accept screenshots. OpenRouter may send Claude to Amazon Bedrock, where some Haiku/Sonnet snapshots are text-only. ' +
    'Vision requests from Bladerunner set provider.ignore for amazon-bedrock; you can also prefer Anthropic in OpenRouter presets or use a known vision model (e.g. Sonnet, Gemini).'
  );
}

/**
 * OpenRouter's OpenAI shim + **Anthropic** upstream (e.g. **Claude 3.5 Haiku** at `anthropic/claude-3-5-haiku-…`)
 * rejects some `system` + multimodal `user` shapes with a generic **400 "Provider returned error"**.
 * Folding system text into the first user message matches working clients (e.g. Zed).
 */
function mergeSystemIntoFirstUserForAnthropicOpenRouter(messages: ChatMessage[]): ChatMessage[] {
  const systems = messages.filter((m) => m.role === 'system');
  if (!systems.length) return messages;
  const block = systems.map((s) => s.content.trim()).filter(Boolean).join('\n\n');
  if (!block) return messages.filter((m) => m.role !== 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  const uIdx = rest.findIndex((m) => m.role === 'user');
  if (uIdx < 0) return messages;
  return rest.map((m, i) =>
    i === uIdx && m.role === 'user'
      ? { role: 'user' as const, content: `${block}\n\n---\n\n${m.content}` }
      : m,
  );
}

export class OpenAiProvider implements LlmProvider {
  private client: OpenAI;
  private model: string;
  private readonly openRouterStyle: boolean;

  constructor(
    apiKey: string,
    model = 'gpt-5.4-mini',
    opts?: { baseURL?: string; defaultHeaders?: Record<string, string>; openRouterStyle?: boolean },
  ) {
    this.client = new OpenAI({
      apiKey,
      ...(opts?.baseURL ? { baseURL: opts.baseURL.replace(/\/$/, '') } : {}),
      ...(opts?.defaultHeaders ? { defaultHeaders: opts.defaultHeaders } : {}),
    });
    this.model = model;
    this.openRouterStyle = opts?.openRouterStyle ?? false;
  }

  /** OpenRouter + Anthropic slugs (`anthropic/claude-…`, including Haiku 3.5). */
  private isOpenRouterAnthropicModel(): boolean {
    return this.openRouterStyle && this.model.includes('anthropic/');
  }

  async chat(messages: ChatMessage[], options?: LlmChatOptions): Promise<LlmChatResult> {
    let normalized = messages;
    if (this.isOpenRouterAnthropicModel()) {
      normalized = mergeSystemIntoFirstUserForAnthropicOpenRouter(messages);
    }

    const openAiMessages: OpenAI.ChatCompletionMessageParam[] = normalized.map(
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
                  /** OpenRouter + Claude (Haiku, Sonnet, …): omit `detail`; gateway can 400 when `low` is forwarded oddly. */
                  ...(this.openRouterStyle ? {} : { detail: 'low' as const }),
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

    /** Default `text`: structured routes rely on prompts plus shared JSON extraction; `json_object` is opt-in for strict OpenAI-only callers. */
    const responseFormat = options?.responseFormat ?? 'text';

    /**
     * OpenRouter load-balances `anthropic/claude-*` across hosts; **Amazon Bedrock** may serve a snapshot that
     * rejects **image** input (`'…' does not support image input`), while Anthropic's API accepts vision.
     * Skip Bedrock for multimodal requests so Haiku/Sonnet evaluations receive screenshots.
     * @see https://openrouter.ai/docs/guides/routing/provider-selection#ignoring-providers
     */
    const openRouterVisionRouting =
      this.openRouterStyle && Boolean(options?.imageBase64?.trim())
        ? { provider: { ignore: ['amazon-bedrock'] } }
        : {};

    let response: OpenAI.ChatCompletion;
    try {
      response = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: openAiMessages,
          temperature: options?.temperature ?? 0.1,
          max_completion_tokens: maxCompletionTokens,
          ...(responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
          ...(options?.reasoningEffort != null && supportsReasoningEffort
            ? { reasoning_effort: options.reasoningEffort }
            : {}),
          ...openRouterVisionRouting,
        } as OpenAI.ChatCompletionCreateParamsNonStreaming,
        { signal: options?.signal },
      );
    } catch (e) {
      throw enrichOpenAiClientError(e);
    }

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
