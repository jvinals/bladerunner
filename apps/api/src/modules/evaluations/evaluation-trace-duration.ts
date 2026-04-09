/** Bracket suffix for evaluation trace lines when an operation completes, e.g. `[1.23s]`. */
export function formatTraceDurationSeconds(ms: number): string {
  const n = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  return `[${(n / 1000).toFixed(2)}s]`;
}

/**
 * Second line is wall time for this evaluation step: from this step's init timestamp to either
 * the next step's init (boundary) or run end / pause (no following step).
 */
export function formatStepWallDurationMessage(
  sequence: number,
  ms: number,
  kind: 'to_next_step' | 'run_end',
): string {
  const sec = ((Number.isFinite(ms) ? Math.max(0, ms) : 0) / 1000).toFixed(2);
  const tail =
    kind === 'to_next_step'
      ? 'wall time (this step start -> next step start)'
      : 'wall time (this step start -> run end or pause)';
  return `[Step ${sequence}]\n  ${sec} s ${tail}`;
}
