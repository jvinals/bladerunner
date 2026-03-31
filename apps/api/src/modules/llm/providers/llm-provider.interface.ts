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
  /** Optional real-time trace for evaluation UI (never log secrets; prefer lengths and labels). */
  onDebugLog?: (message: string, detail?: Record<string, unknown>) => void;
  /**
   * OpenAI-compatible only: `json_object` forces JSON output (default for legacy chat paths).
   * Use `text` for Playwright vision codegen (plain JavaScript, not JSON).
   */
  responseFormat?: 'json_object' | 'text';
}

/** Assistant text plus optional hidden reasoning when the provider exposes it (e.g. OpenAI reasoning models). */
export interface LlmChatResult {
  content: string;
  thinking?: string;
}

export interface LlmProvider {
  chat(messages: ChatMessage[], options?: LlmChatOptions): Promise<LlmChatResult>;
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
  /** Set-of-Marks lines `[n] …` aligned with badges on the viewport JPEG. */
  somManifest: string;
  /** Playwright CDP accessibility snapshot JSON (+ enrichment), captured before SOM overlay. */
  accessibilitySnapshot: string;
  screenshotBase64?: string;
  /** Optional: active snippet that just failed on the live page and needs repair. */
  failedPlaywrightCode?: string;
  /** Optional: immutable record-time baseline for the step. */
  recordedPlaywrightCode?: string;
  /** Optional: failure details for regeneration / repair passes. */
  priorFailureKind?: string;
  priorFailureMessage?: string;
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
  /** Pass 1 (vision) user prompt text sent to Gemini. */
  userPrompt: string;
  /** Final Playwright JavaScript after optional DOM verify pass (same as executed output). */
  rawResponse: string;
  /** Pass 1 codegen only, before `verifyGeminiPlaywrightAgainstDom`. */
  draftPlaywrightCode?: string;
  /** Pass 2 (text-only verify) user prompt. */
  verifyUserPrompt?: string;
  /** Pass 2 raw model output. */
  verifyRawResponse?: string;
  /** User message included a vision attachment (JPEG) when calling the provider. */
  visionAttached: boolean;
  /**
   * Same base64 JPEG passed to the vision API (optional persistence for Run step metadata / modal).
   */
  screenshotBase64?: string;
  /** Model chain-of-thought / reasoning summary when returned by the provider (not the JSON Playwright output). */
  thinking?: string;
}

export interface InstructionToActionResult {
  output: InstructionToActionOutput;
  transcript: InstructionToActionLlmTranscript;
}
