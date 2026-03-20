export interface PlaybackSkipStepLike {
  id: string;
  sequence: number;
  metadata: unknown;
}

export interface BuildPlaybackSkipSetInput {
  steps: PlaybackSkipStepLike[];
  /** When true, skip steps tagged with metadata.clerkAuthPhase */
  wantAutoClerkSkip: boolean;
  /** Skip every step with sequence strictly less than this value */
  skipUntilSequence?: number;
  skipStepIds?: string[];
}

/**
 * Step IDs that should not execute playwrightCode during playback (still emit progress as skipped).
 */
export function buildPlaybackSkipSet(input: BuildPlaybackSkipSetInput): Set<string> {
  const out = new Set<string>();
  for (const id of input.skipStepIds ?? []) {
    if (id) out.add(id);
  }
  const until = input.skipUntilSequence;
  if (typeof until === 'number' && Number.isFinite(until)) {
    for (const s of input.steps) {
      if (s.sequence < until) out.add(s.id);
    }
  }
  if (input.wantAutoClerkSkip) {
    for (const s of input.steps) {
      const m = s.metadata as { clerkAuthPhase?: boolean } | null | undefined;
      if (m && m.clerkAuthPhase === true) out.add(s.id);
    }
  }
  return out;
}
