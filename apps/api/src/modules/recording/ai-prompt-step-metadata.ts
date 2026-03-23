/** `RunStep.metadata.kind` for prompt-driven steps (vision + LLM at playback, not stored codegen). */
export const AI_PROMPT_STEP_KIND = 'ai_prompt_step' as const;

export const AI_PROMPT_STEP_SCHEMA_VERSION = 1;

export type AiPromptStepMetadata = {
  kind: typeof AI_PROMPT_STEP_KIND;
  schemaVersion: typeof AI_PROMPT_STEP_SCHEMA_VERSION;
  /** Optional: last Test Step run (UX only). */
  lastTestAt?: string;
  lastTestOk?: boolean;
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
