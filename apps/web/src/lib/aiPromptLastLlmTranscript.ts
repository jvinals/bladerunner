/** Parsed from `RunStep.metadata.lastLlmTranscript` (AI prompt steps). */
export type AiPromptLastLlmTranscript = {
  systemPrompt: string;
  userPrompt: string;
  rawResponse: string;
  visionAttached?: boolean;
  screenshotBase64?: string;
  capturedAt?: string;
  source?: string;
};

export function parseAiPromptLastLlmTranscript(metadata: unknown): AiPromptLastLlmTranscript | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const t = (metadata as Record<string, unknown>).lastLlmTranscript;
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  if (
    typeof o.systemPrompt !== 'string' ||
    typeof o.userPrompt !== 'string' ||
    typeof o.rawResponse !== 'string'
  ) {
    return null;
  }
  return {
    systemPrompt: o.systemPrompt,
    userPrompt: o.userPrompt,
    rawResponse: o.rawResponse,
    visionAttached: typeof o.visionAttached === 'boolean' ? o.visionAttached : undefined,
    screenshotBase64: typeof o.screenshotBase64 === 'string' && o.screenshotBase64.trim() ? o.screenshotBase64 : undefined,
    capturedAt: typeof o.capturedAt === 'string' ? o.capturedAt : undefined,
    source: typeof o.source === 'string' ? o.source : undefined,
  };
}
