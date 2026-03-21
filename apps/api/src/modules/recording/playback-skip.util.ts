export interface PlaybackSkipStepLike {
  id: string;
  sequence: number;
  metadata: unknown;
  /** Prisma `StepAction` string, e.g. `NAVIGATE` */
  action?: string;
  value?: string | null;
  /** Prisma `StepOrigin` string */
  origin?: string;
}

export interface BuildPlaybackSkipSetInput {
  steps: PlaybackSkipStepLike[];
  /** When true, skip steps tagged with metadata.clerkAuthPhase and AUTOMATIC-origin steps */
  wantAutoClerkSkip: boolean;
  /** Skip every step with sequence strictly less than this value */
  skipUntilSequence?: number;
  skipStepIds?: string[];
  /**
   * Run start URL — when the first stored step is NAVIGATE to the same URL as this,
   * skip it (redundant with zero-state `page.goto(run.url)` at playback start).
   */
  runUrl?: string;
}

/** Normalize URLs for redundant-first-NAVIGATE detection (origin + path + search; trim trailing slash on path). */
export function normalizePlaybackUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  try {
    const u = new URL(t);
    let path = u.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.slice(0, -1);
    }
    return `${u.origin}${path}${u.search}`;
  } catch {
    return t.replace(/\/$/, '');
  }
}

function urlsMatchForSkip(a: string, b: string): boolean {
  return normalizePlaybackUrl(a) === normalizePlaybackUrl(b);
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
      const origin = (s as { origin?: string }).origin;
      if (origin === 'AUTOMATIC') out.add(s.id);
      const m = s.metadata as { clerkAuthPhase?: boolean } | null | undefined;
      if (m && m.clerkAuthPhase === true) out.add(s.id);
    }
  }

  /** Redundant with startup `page.goto(run.url)` — independent of Clerk auto-skip. */
  const runUrl = input.runUrl?.trim();
  if (runUrl && input.steps.length > 0) {
    const sorted = [...input.steps].sort((a, b) => a.sequence - b.sequence);
    const first = sorted[0];
    const action = String(first.action ?? '').toUpperCase();
    if (action === 'NAVIGATE' && first.value && urlsMatchForSkip(String(first.value), runUrl)) {
      out.add(first.id);
    }
  }

  return out;
}
