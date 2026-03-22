import type { PlaybackHighlight } from '@/components/ui/StepCard';

/**
 * Socket `highlightSequence` tracks `before`/`error` (step in progress) or, after `after`/`skipped`,
 * the step that just finished — so raw value can lag the visual "cursor". When that step is already
 * in `completed`, advance along the ordered step list to the next sequence so the list matches the
 * preview (e.g. after step 3 completes, highlight step 4).
 */
export function effectivePlaybackHighlightSequence(
  highlightSequence: number | null,
  completed: Set<number>,
  steps: { sequence: number }[],
): number | null {
  if (highlightSequence == null || steps.length === 0) return highlightSequence;
  const sorted = [...steps].sort((a, b) => a.sequence - b.sequence);
  const lastSeq = sorted[sorted.length - 1]!.sequence;

  let seq = highlightSequence;
  while (completed.has(seq) && seq < lastSeq) {
    const idx = sorted.findIndex((s) => s.sequence === seq);
    if (idx < 0 || idx >= sorted.length - 1) break;
    seq = sorted[idx + 1]!.sequence;
  }
  return seq;
}

/** Map playback progress to per-step highlight for StepCard. */
export function playbackToneForStep(
  sequence: number,
  showReplayChrome: boolean,
  highlightSequence: number | null,
  completed: Set<number>,
): PlaybackHighlight | undefined {
  if (!showReplayChrome) return undefined;
  if (highlightSequence !== null && sequence === highlightSequence) return 'current';
  if (completed.has(sequence)) return 'past';
  return 'future';
}
