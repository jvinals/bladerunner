export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmChatOptions {
  imageBase64?: string;
  temperature?: number;
  maxTokens?: number;
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
