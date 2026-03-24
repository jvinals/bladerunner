import type { InstructionToActionLlmTranscript } from '../llm/providers/llm-provider.interface';

/** `RunStep.metadata.kind` for prompt-driven steps (vision + LLM at playback, not stored codegen). */
export const AI_PROMPT_STEP_KIND = 'ai_prompt_step' as const;

export const AI_PROMPT_STEP_SCHEMA_VERSION = 1;

/** Last LLM request/response persisted for the AI prompt modal (exact strings + optional JPEG base64 for the modal). */
export type AiPromptLlmTranscriptStored = InstructionToActionLlmTranscript & {
  capturedAt: string;
  source: 'test' | 'playback';
};

export type AiPromptStepMetadata = {
  kind: typeof AI_PROMPT_STEP_KIND;
  schemaVersion: typeof AI_PROMPT_STEP_SCHEMA_VERSION;
  /** Optional: last Test Step run (UX only). */
  lastTestAt?: string;
  lastTestOk?: boolean;
  /** Last successful vision+codegen for the instruction (split Test flow). */
  lastAiPromptCodegenOk?: boolean;
  /** Instruction trimmed that last successful codegen used (must match to Run or Done). */
  lastAiPromptCodegenInstruction?: string;
  /** Last successful execute of generated Playwright on the live page. */
  lastAiPromptRunOk?: boolean;
  lastAiPromptRunInstruction?: string;
  /** Last successful LLM round-trip (updated before Playwright runs; includes failed-PW cases when LLM succeeded). */
  lastLlmTranscript?: AiPromptLlmTranscriptStored;
};

export function isAiPromptStepMetadata(m: unknown): m is AiPromptStepMetadata {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  if (o.kind !== AI_PROMPT_STEP_KIND) return false;
  return o.schemaVersion === AI_PROMPT_STEP_SCHEMA_VERSION;
}

/** Sentinel stored in `playwright_code` when execution is always LLM-driven at playback. */
export function aiPromptStepSentinelPlaywrightCode(): string {
  return '/* ai_prompt_step: execution uses LLM + screenshot at playback; do not replay as fixed codegen */';
}
