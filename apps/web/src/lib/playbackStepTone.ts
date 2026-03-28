import type { PlaybackAiPromptStatus, PlaybackHighlight } from '@/components/ui/StepCard';
import type { PlaybackProgressPayload } from '@/hooks/usePlayback';
import type { AiPromptTestProgressPayload } from '@/hooks/useRecording';

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

/**
 * Largest completed step sequence strictly before the effective "next" step, or `null` if there is
 * no prior completed step to rewind to (e.g. still at the first step).
 */
export function previousPlayThroughTarget(completed: Set<number>, nextSequence: number): number | null {
  const lower = [...completed].filter((s) => s < nextSequence);
  if (lower.length === 0) return null;
  return Math.max(...lower);
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

export function isAiPromptStepRow(origin: string, metadata?: unknown): boolean {
  void metadata;
  return origin === 'AI_PROMPT';
}

/**
 * Per-step LLM vs Playwright icon state during live playback (AI prompt steps only).
 */
export function derivePlaybackAiPromptStatus(
  step: { id: string; sequence: number; origin: string; metadata?: unknown },
  opts: {
    playbackActive: boolean;
    playbackSourceRunId: string | null;
    effectiveRunId: string | null;
    tone: PlaybackHighlight | undefined;
    lastAiPromptProgress: AiPromptTestProgressPayload | null;
    lastPlaybackProgress: PlaybackProgressPayload | null;
  },
): PlaybackAiPromptStatus | undefined {
  if (
    !opts.playbackActive ||
    !opts.playbackSourceRunId ||
    !opts.effectiveRunId ||
    opts.playbackSourceRunId !== opts.effectiveRunId
  ) {
    return undefined;
  }
  if (!isAiPromptStepRow(step.origin, step.metadata)) return undefined;

  const tone = opts.tone;
  if (tone === 'past') return { ai: 'done', playwright: 'done' };
  if (tone === 'future') return { ai: 'idle', playwright: 'idle' };
  if (tone !== 'current') return undefined;

  const sid = step.id;
  const lp = opts.lastPlaybackProgress;
  const la = opts.lastAiPromptProgress;

  if (lp?.step.id === sid && lp.phase === 'transcript') {
    return { ai: 'done', playwright: 'idle' };
  }

  if (la?.stepId === sid && la.phase === 'llm') {
    return { ai: 'busy', playwright: 'idle' };
  }

  if (la?.stepId === sid && la.phase === 'executing') {
    return { ai: 'done', playwright: 'busy' };
  }

  if (la?.stepId === sid && la.phase === 'capturing') {
    return { ai: 'idle', playwright: 'idle' };
  }

  return { ai: 'idle', playwright: 'idle' };
}
