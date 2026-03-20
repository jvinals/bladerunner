import MailSlurp from 'mailslurp-client';
import type { Email } from 'mailslurp-client';

/** Clerk commonly sends a 6-digit code; allow 8 for future-proofing. */
const OTP_REGEX = /\b(\d{6,8})\b/;

/** Allow a few seconds of clock skew between MailSlurp timestamps and `Date.now()`. */
const CLOCK_SKEW_MS = 5_000;

function extractOtpFromText(text: string): string | null {
  const m = text.match(OTP_REGEX);
  return m?.[1] ?? null;
}

function emailReceivedAtMs(email: Email): number {
  const raw = email.createdAt;
  const t = raw instanceof Date ? raw.getTime() : Date.parse(String(raw));
  return Number.isFinite(t) ? t : 0;
}

function looksLikeClerkMail(blob: string): boolean {
  return (
    /clerk/i.test(blob) ||
    /verification/i.test(blob) ||
    /verification code/i.test(blob) ||
    /one-time/i.test(blob) ||
    /sign-?in/i.test(blob)
  );
}

/**
 * Resolve MailSlurp inbox id from env:
 * - `MAILSLURP_INBOX_ID` if set, else
 * - lookup by `MAILSLURP_INBOX_EMAIL` via `getInboxes()`.
 */
export async function resolveMailSlurpInboxId(apiKey: string): Promise<string> {
  const explicit = process.env.MAILSLURP_INBOX_ID?.trim();
  if (explicit) {
    return explicit;
  }

  const needle = process.env.MAILSLURP_INBOX_EMAIL?.trim().toLowerCase();
  if (!needle) {
    throw new Error(
      'Set MAILSLURP_INBOX_ID or MAILSLURP_INBOX_EMAIL. Create an inbox at https://app.mailslurp.com or run `pnpm mailslurp:list-inboxes`.',
    );
  }

  const ms = new MailSlurp({ apiKey });
  const inboxes = await ms.getInboxes();

  for (const inv of inboxes) {
    const addr = (inv.emailAddress ?? '').toLowerCase();
    if (addr === needle) return inv.id;
  }

  throw new Error(
    `No MailSlurp inbox matched MAILSLURP_INBOX_EMAIL="${needle}". Run: pnpm mailslurp:list-inboxes`,
  );
}

/**
 * Wait for a **new** Clerk verification email after `notBeforeMs` (typically set right after
 * submitting the password). Uses MailSlurp `since` on `waitForLatestEmail` so we never read the
 * inbox’s previous “latest” OTP from an earlier sign-in attempt.
 */
export async function waitForClerkOtpFromMailSlurp(options: {
  /** Only accept emails received at or after this time (minus {@link CLOCK_SKEW_MS}). */
  notBeforeMs: number;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<string> {
  const apiKey = process.env.MAILSLURP_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('MAILSLURP_API_KEY is required for email 2FA (MailSlurp).');
  }

  const inboxId = await resolveMailSlurpInboxId(apiKey);

  const ms = new MailSlurp({ apiKey });
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  const pollMs = options.pollMs ?? 2_500;
  const notBefore = options.notBeforeMs;
  const sinceDate = new Date(notBefore - CLOCK_SKEW_MS);

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining < 1_500) break;

    let email: Email;
    try {
      email = await ms.waitController.waitForLatestEmail({
        inboxId,
        timeout: Math.min(remaining, 30_000),
        since: sinceDate,
      });
    } catch {
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }

    if (emailReceivedAtMs(email) < notBefore - CLOCK_SKEW_MS) {
      try {
        await ms.deleteEmail(email.id);
      } catch {
        /* ignore */
      }
      continue;
    }

    const subject = String(email.subject ?? '');
    const body = String(email.body ?? email.bodyExcerpt ?? email.textExcerpt ?? '');
    const blob = `${subject}\n${body}`;

    if (!looksLikeClerkMail(blob)) {
      try {
        await ms.deleteEmail(email.id);
      } catch {
        /* ignore */
      }
      continue;
    }

    const otp = extractOtpFromText(blob);
    if (otp) return otp;

    try {
      await ms.deleteEmail(email.id);
    } catch {
      /* ignore */
    }
  }

  throw new Error('Timed out waiting for Clerk verification email in MailSlurp inbox.');
}
