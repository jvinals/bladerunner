export type PlaybackRepairMetadataInput = {
  failureAt: string;
  failureKind: string;
  failureMessage: string;
  failedPlaywrightCode?: string | null;
  generatedPlaywrightCode?: string | null;
  recordedPlaywrightCode?: string | null;
  promotedAt?: string | null;
};

const AI_PROMPT_SENTINEL_FRAGMENT = 'ai_prompt_step: execution uses LLM + screenshot at playback';

function trimCode(code?: string | null): string | undefined {
  const value = code?.trim();
  return value ? value : undefined;
}

export function isAiPromptSentinelPlaywrightCode(code?: string | null): boolean {
  const value = trimCode(code);
  return !!value && value.includes(AI_PROMPT_SENTINEL_FRAGMENT);
}

export function isExecutableStoredPlaywrightCode(code?: string | null): boolean {
  const value = trimCode(code);
  return !!value && !isAiPromptSentinelPlaywrightCode(value);
}

export function resolveRecordedPlaywrightCode(
  existingRecordedCode?: string | null,
  priorActiveCode?: string | null,
  nextActiveCode?: string | null,
): string | null {
  const existing = trimCode(existingRecordedCode);
  if (existing && !isAiPromptSentinelPlaywrightCode(existing)) {
    return existing;
  }

  const priorActive = trimCode(priorActiveCode);
  if (priorActive && !isAiPromptSentinelPlaywrightCode(priorActive)) {
    return priorActive;
  }

  const nextActive = trimCode(nextActiveCode);
  return nextActive ?? null;
}

export function buildPlaybackRepairMetadataPatch(
  baseMetadata: Record<string, unknown>,
  input: PlaybackRepairMetadataInput,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    ...baseMetadata,
    lastPlaybackRepairAt: input.failureAt,
    lastPlaybackRepairFailureKind: input.failureKind,
    lastPlaybackRepairFailureMessage: input.failureMessage,
  };

  if (trimCode(input.failedPlaywrightCode)) {
    patch.lastPlaybackRepairFailedPlaywrightCode = trimCode(input.failedPlaywrightCode);
  }
  if (trimCode(input.generatedPlaywrightCode)) {
    patch.lastPlaybackRepairGeneratedPlaywrightCode = trimCode(input.generatedPlaywrightCode);
  }
  if (trimCode(input.recordedPlaywrightCode)) {
    patch.lastPlaybackRepairRecordedPlaywrightCode = trimCode(input.recordedPlaywrightCode);
  }
  if (trimCode(input.promotedAt)) {
    patch.lastPlaybackRepairPromotedAt = trimCode(input.promotedAt);
  }

  return patch;
}
