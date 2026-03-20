import MailSlurp from 'mailslurp-client';
import type { Email } from 'mailslurp-client';

/** Clerk commonly sends a 6-digit code; allow 8 for future-proofing. */
const OTP_REGEX = /\b(\d{6,8})\b/;

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

function mailslurpDebugLog(phase: string, data: Record<string, unknown>): void {
  // #region agent log
  fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5f6bd9' },
    body: JSON.stringify({
      sessionId: '5f6bd9',
      hypothesisId: 'H11',
      location: 'mailslurp-otp.ts',
      message: `MailSlurp: ${phase}`,
      data: { phase, ...data },
      timestamp: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
}

/**
 * Resolve MailSlurp inbox id from env:
 * - `MAILSLURP_INBOX_ID` if set, else
 * - lookup by `MAILSLURP_INBOX_EMAIL` via `getInboxes()`.
 */
export async function resolveMailSlurpInboxId(apiKey: string): Promise<string> {
  const explicit = process.env.MAILSLURP_INBOX_ID?.trim();
  if (explicit) {
    mailslurpDebugLog('resolve_inbox_explicit_id', { inboxIdLen: explicit.length });
    return explicit;
  }

  const needle = process.env.MAILSLURP_INBOX_EMAIL?.trim().toLowerCase();
  if (!needle) {
    throw new Error(
      'Set MAILSLURP_INBOX_ID or MAILSLURP_INBOX_EMAIL. Create an inbox at https://app.mailslurp.com or run `pnpm mailslurp:list-inboxes`.',
    );
  }

  const ms = new MailSlurp({ apiKey });
  mailslurpDebugLog('get_inboxes_before', { lookupEmailTail: needle.slice(-14) });
  let inboxes;
  try {
    inboxes = await ms.getInboxes();
  } catch (e) {
    const err = e as { status?: number; statusCode?: number; message?: string };
    const code = err.statusCode ?? err.status;
    mailslurpDebugLog('get_inboxes_error', {
      statusCode: code,
      messagePrefix: String(err.message ?? e).slice(0, 180),
    });
    throw e;
  }
  mailslurpDebugLog('get_inboxes_ok', { count: inboxes.length });

  for (const inv of inboxes) {
    const addr = (inv.emailAddress ?? '').toLowerCase();
    if (addr === needle) return inv.id;
  }

  throw new Error(
    `No MailSlurp inbox matched MAILSLURP_INBOX_EMAIL="${needle}". Run: pnpm mailslurp:list-inboxes`,
  );
}

/**
 * Poll MailSlurp for a Clerk verification email and return the OTP (after `notBeforeMs`).
 */
export async function waitForClerkOtpFromMailSlurp(options: {
  notBeforeMs: number;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<string> {
  const apiKey = process.env.MAILSLURP_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('MAILSLURP_API_KEY is required for email 2FA (MailSlurp).');
  }

  mailslurpDebugLog('otp_poll_start', {
    hasExplicitInboxId: Boolean(process.env.MAILSLURP_INBOX_ID?.trim()),
    hasInboxEmail: Boolean(process.env.MAILSLURP_INBOX_EMAIL?.trim()),
  });

  const inboxId = await resolveMailSlurpInboxId(apiKey);
  mailslurpDebugLog('otp_poll_inbox_ready', { inboxIdLen: inboxId.length });

  const ms = new MailSlurp({ apiKey });
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  const pollMs = options.pollMs ?? 2_500;
  const notBefore = options.notBeforeMs;

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    if (remaining < 1_500) break;

    let email: Email;
    try {
      email = await ms.waitForLatestEmail(inboxId, Math.min(remaining, 30_000), true);
    } catch {
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }

    if (emailReceivedAtMs(email) < notBefore - 5_000) {
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
