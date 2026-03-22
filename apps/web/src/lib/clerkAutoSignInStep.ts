/** Matches API `CLERK_AUTO_SIGN_IN_KIND` — single-step Automatic Clerk sign-in row. */
export function getClerkAutoSignInStepSequence(
  steps: { sequence: number; metadata?: unknown }[],
): number | null {
  for (const s of steps) {
    const k = (s.metadata as { kind?: string } | null | undefined)?.kind;
    if (k === 'clerk_auto_sign_in') return s.sequence;
  }
  return null;
}

/**
 * Pause / stop are allowed once the automatic sign-in step has finished (`playbackProgress` `after` / `skipped`),
 * or when this run has no such step.
 */
export function canPauseOrStopPlaybackDuringClerkStep(
  clerkAutoSignInSequence: number | null,
  completedSequences: Set<number>,
): boolean {
  if (clerkAutoSignInSequence == null) return true;
  return completedSequences.has(clerkAutoSignInSequence);
}
