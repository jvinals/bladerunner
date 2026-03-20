import type { PlaybackHighlight } from '@/components/ui/StepCard';

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
