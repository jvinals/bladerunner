export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmChatOptions {
  imageBase64?: string;
  temperature?: number;
  maxTokens?: number;
  /** OpenAI reasoning models only: lowers internal reasoning so visible JSON still fits in the completion budget. */
  reasoningEffort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | null;
  /** When aborted, the provider request should reject (best-effort). */
  signal?: AbortSignal;
}

export interface LlmProvider {
  chat(messages: ChatMessage[], options?: LlmChatOptions): Promise<string>;
}

export interface ActionToInstructionInput {
  action: string;
  selector: string;
  elementHtml: string;
  /** `innerText` from the clicked element (trimmed); not stripped unlike cloneNode(false) HTML. */
  elementVisibleText?: string;
  /** `aria-label` when present (e.g. icon-only controls). */
  ariaLabel?: string;
  value?: string;
  pageAccessibilityTree: string;
}

export interface ActionToInstructionOutput {
  instruction: string;
  playwrightCode: string;
}

export interface InstructionToActionInput {
  instruction: string;
  pageUrl: string;
  pageAccessibilityTree: string;
  screenshotBase64?: string;
}

export interface InstructionToActionOutput {
  playwrightCode: string;
  action: string;
  selector?: string;
  value?: string;
}

/** Exact strings sent to the LLM for debugging / UI (AI prompt modal). */
export interface InstructionToActionLlmTranscript {
  systemPrompt: string;
  userPrompt: string;
  rawResponse: string;
  /** User message included a vision attachment (JPEG) when calling the provider. */
  visionAttached: boolean;
  /**
   * Same base64 JPEG passed to the vision API (optional persistence for Run step metadata / modal).
   */
  screenshotBase64?: string;
}

export interface InstructionToActionResult {
  output: InstructionToActionOutput;
  transcript: InstructionToActionLlmTranscript;
}
