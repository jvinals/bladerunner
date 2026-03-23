import { isClerkAutoSignInMetadata } from './clerk-auto-sign-in-step-metadata';
import { isAiPromptStepMetadata } from './ai-prompt-step-metadata';

export interface PlaybackSkipStepLike {
  id: string;
  sequence: number;
  metadata: unknown;
  /** Prisma `StepAction` string, e.g. `NAVIGATE` */
  action?: string;
  value?: string | null;
  /** Prisma `StepOrigin` string */
  origin?: string;
  /** Step instruction (used to detect MailSlurp-tagged rows when metadata/origin are missing). */
  instruction?: string;
  /** Stored codegen — detect Clerk OTP locators when instruction lacks MailSlurp prefix. */
  playwrightCode?: string;
}

/** LLM instructions for email/Clerk OTP entry often omit `[MailSlurp automation]`. */
function instructionLooksLikeVerificationCodeTyping(instr: string): boolean {
  const t = instr.trim().replace(/\s+/g, ' ');
  if (!t) return false;
  if (/\[MailSlurp automation\]/i.test(t)) return true;
  const lower = t.toLowerCase();
  if (lower.includes('verification') && lower.includes('code')) return true;
  if (
    /type\s+['"]?\d{4,8}['"]?\s+into/i.test(t) &&
    /(verification|otp|one[-\s]?time|2\s*fa)/i.test(t)
  ) {
    return true;
  }
  return /verification\s+code|verification\s+code\s+input|email\s+(verification\s+)?code|one[-\s]?time\s+code|\botp\b|2\s*fa|two[-\s]?factor/i.test(
    t,
  );
}

/** Fragile generated locators that MailSlurp automation replaces during playback. */
function playwrightCodeLooksLikeClerkOtpFill(pw: string): boolean {
  if (!pw) return false;
  const compact = pw.replace(/\s+/g, ' ');
  if (/getByLabel\s*\(\s*[`'"]Enter verification code[`'"]\s*\)/i.test(compact)) return true;
  if (/getByLabel\s*\(\s*['"]Enter verification code['"]\s*\)/i.test(compact)) return true;
  if (/getByLabel\s*\([^)]*verification[^)]*code/i.test(compact)) return true;
  if (/getByPlaceholder\s*\([^)]*verification[^)]*code/i.test(compact)) return true;
  if (
    /\.getByLabel\s*\(/i.test(compact) &&
    /verification/i.test(compact) &&
    /code/i.test(compact) &&
    /\.fill\s*\(/i.test(compact)
  ) {
    return true;
  }
  return false;
}

/**
 * When Clerk auto-playback is on, skip executing stored Playwright for steps that are driven by
 * server MailSlurp/Clerk automation instead of replaying brittle LLM-generated locators.
 */
export function shouldSkipStoredPlaywrightForClerk(
  step: PlaybackSkipStepLike,
  wantAutoClerk: boolean,
): boolean {
  /** AI prompt steps use LLM at playback — never treat as Clerk-skipped OTP rows. */
  if (isAiPromptStepMetadata(step.metadata) || step.origin === 'AI_PROMPT') return false;
  if (!wantAutoClerk) return false;
  /** Single-step `clerk_auto_sign_in` is executed explicitly in the playback loop — never skip via heuristic. */
  if (isClerkAutoSignInMetadata(step.metadata)) return false;
  if (step.origin === 'AUTOMATIC') return true;
  const m = step.metadata as { clerkAuthPhase?: boolean } | null | undefined;
  if (m && m.clerkAuthPhase === true) return true;
  const instr = step.instruction ?? '';
  if (/\[MailSlurp automation\]/i.test(instr)) return true;
  if (instructionLooksLikeVerificationCodeTyping(instr)) return true;
  const pw = step.playwrightCode ?? '';
  if (playwrightCodeLooksLikeClerkOtpFill(pw)) return true;
  return false;
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
      if (isAiPromptStepMetadata(s.metadata) || s.origin === 'AI_PROMPT') continue;
      if (shouldSkipStoredPlaywrightForClerk(s, true)) out.add(s.id);
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
