import type { ClerkOtpMode } from '@bladerunner/clerk-agentmail-signin';
import type { AutoSignInAuthKind } from './project-auto-sign-in';

/** `RunStep.metadata.kind` for single-step automatic Clerk sign-in (record + playback). */
export const CLERK_AUTO_SIGN_IN_KIND = 'clerk_auto_sign_in' as const;

/** Bump when adding required metadata fields or changing semantics. */
export const CLERK_AUTO_SIGN_IN_SCHEMA_VERSION = 1;

export type ClerkAutoSignInStepMetadata = {
  kind: typeof CLERK_AUTO_SIGN_IN_KIND;
  schemaVersion: typeof CLERK_AUTO_SIGN_IN_SCHEMA_VERSION;
  /** Clerk is the legacy/default path; generic uses project-stored test credentials. */
  authKind?: AutoSignInAuthKind;
  /** How OTP was obtained during recording — playback uses this (not UI default) for this step. */
  otpMode: ClerkOtpMode;
  /** `page.url()` immediately after `performClerkPasswordEmail2FA` (normalized comparison helpers below). */
  postAuthPageUrl: string;
};

export function isClerkAutoSignInMetadata(
  m: unknown,
): m is ClerkAutoSignInStepMetadata {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  if (o.kind !== CLERK_AUTO_SIGN_IN_KIND) return false;
  if (o.schemaVersion !== CLERK_AUTO_SIGN_IN_SCHEMA_VERSION) return false;
  if (o.authKind !== undefined && o.authKind !== 'clerk' && o.authKind !== 'generic') return false;
  if (o.otpMode !== 'mailslurp' && o.otpMode !== 'clerk_test_email') return false;
  if (typeof o.postAuthPageUrl !== 'string' || !o.postAuthPageUrl.trim()) return false;
  return true;
}

export function buildClerkAutoSignInInstruction(
  otpMode: ClerkOtpMode,
  authKind: AutoSignInAuthKind = 'clerk',
): string {
  if (authKind === 'generic') {
    if (otpMode === 'mailslurp') {
      return 'Automatic sign-in (MailSlurp OTP)';
    }
    return 'Automatic sign-in';
  }
  if (otpMode === 'mailslurp') {
    return 'Automatic Clerk sign-in (MailSlurp OTP)';
  }
  return 'Automatic Clerk sign-in (Clerk test email OTP)';
}

export function clerkAutoSignInSentinelPlaywrightCode(): string {
  return '/* clerk_auto_sign_in: executed server-side during playback; not run as Playwright codegen */';
}

function normalizeUrlForCompare(raw: string): string {
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

/**
 * Soft check: same normalized URL after playback vs recording (query/order may differ in edge cases).
 */
export function postAuthUrlsRoughlyMatch(recorded: string, current: string): boolean {
  return normalizeUrlForCompare(recorded) === normalizeUrlForCompare(current);
}
