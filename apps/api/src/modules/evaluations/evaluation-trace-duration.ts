/** Bracket suffix for evaluation trace lines when an operation completes, e.g. `[1.23s]`. */
export function formatTraceDurationSeconds(ms: number): string {
  const n = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  return `[${(n / 1000).toFixed(2)}s]`;
}
