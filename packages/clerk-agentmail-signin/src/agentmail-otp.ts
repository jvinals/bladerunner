import { AgentMailClient } from 'agentmail';

/** Clerk commonly sends a 6-digit code; allow 8 for future-proofing. */
const OTP_REGEX = /\b(\d{6,8})\b/;

function extractOtpFromText(text: string): string | null {
  const m = text.match(OTP_REGEX);
  return m?.[1] ?? null;
}

function messageTimestampMs(msg: Record<string, unknown>): number {
  const raw =
    (msg.updatedAt as string | undefined) ??
    (msg.updated_at as string | undefined) ??
    (msg.createdAt as string | undefined) ??
    (msg.created_at as string | undefined) ??
    (msg.timestamp as string | undefined);
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

function inboxEmail(inv: Record<string, unknown>): string {
  const v =
    inv.email ??
    inv.address ??
    inv.inboxAddress ??
    inv.inbox_email ??
    inv.username;
  return String(v ?? '').trim().toLowerCase();
}

function inboxIdField(inv: Record<string, unknown>): string | undefined {
  const id = inv.inboxId ?? inv.inbox_id ?? inv.id;
  return id != null && String(id).length > 0 ? String(id) : undefined;
}

/**
 * Resolve the AgentMail inbox id from env:
 * - `E2E_AGENTMAIL_INBOX_ID` if set, else
 * - lookup by `E2E_AGENTMAIL_INBOX_EMAIL` via `inboxes.list()`.
 */
export async function resolveAgentMailInboxId(apiKey: string): Promise<string> {
  const explicit = process.env.E2E_AGENTMAIL_INBOX_ID?.trim();
  if (explicit) return explicit;

  const needle = process.env.E2E_AGENTMAIL_INBOX_EMAIL?.trim().toLowerCase();
  if (!needle) {
    throw new Error(
      'Set E2E_AGENTMAIL_INBOX_ID or E2E_AGENTMAIL_INBOX_EMAIL (your inbox address). Run: pnpm agentmail:list-inboxes',
    );
  }

  const client = new AgentMailClient({ apiKey });
  const res = await client.inboxes.list();
  const top = asRecord(res) ?? {};
  const data = asRecord(top.data);
  const rows = (data?.inboxes ?? data?.items ?? top.inboxes ?? top.items) as unknown;
  if (!Array.isArray(rows)) {
    throw new Error(
      'AgentMail inboxes.list() returned an unexpected shape. Run: pnpm agentmail:list-inboxes',
    );
  }

  for (const row of rows) {
    const inv = asRecord(row as unknown) ?? {};
    if (inboxEmail(inv) === needle) {
      const id = inboxIdField(inv);
      if (id) return id;
    }
  }

  throw new Error(
    `No AgentMail inbox matched E2E_AGENTMAIL_INBOX_EMAIL="${needle}". Run: pnpm agentmail:list-inboxes`,
  );
}

async function listMessageSummaries(
  client: AgentMailClient,
  inboxId: string,
): Promise<Record<string, unknown>[]> {
  const res = await client.inboxes.messages.list(inboxId, {
    limit: 25,
    ascending: false,
  });
  const top = asRecord(res) ?? {};
  const data = asRecord(top.data);
  const inner = (data?.messages ?? data?.items ?? top.messages ?? top.items) as unknown;
  if (Array.isArray(inner)) return inner as Record<string, unknown>[];
  return [];
}

async function getFullMessage(
  client: AgentMailClient,
  inboxId: string,
  messageId: string,
): Promise<Record<string, unknown>> {
  const res = await client.inboxes.messages.get(inboxId, messageId);
  const top = asRecord(res) ?? {};
  const data = asRecord(top.data);
  return (data ?? top) as Record<string, unknown>;
}

/**
 * Poll AgentMail for a verification email and return the OTP (after `notBeforeMs`).
 */
export async function waitForClerkOtpFromAgentMail(options: {
  notBeforeMs: number;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<string> {
  const apiKey = process.env.AGENTMAIL_API_KEY;
  if (!apiKey) {
    throw new Error('AGENTMAIL_API_KEY is required for email 2FA.');
  }

  const inboxId = await resolveAgentMailInboxId(apiKey);
  const client = new AgentMailClient({ apiKey });
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  const pollMs = options.pollMs ?? 2_500;
  const notBefore = options.notBeforeMs;

  while (Date.now() < deadline) {
    const messages = await listMessageSummaries(client, inboxId);

    for (const summary of messages) {
      if (messageTimestampMs(summary) < notBefore - 5_000) continue;

      const id =
        (summary.messageId as string) ??
        (summary.message_id as string) ??
        (summary.id as string);
      if (!id) continue;

      const msg = await getFullMessage(client, inboxId, id);

      const subject = String(msg.subject ?? '');
      const text = String(msg.text ?? msg.preview ?? '');
      const html = String(msg.html ?? '');
      const blob = `${subject}\n${text}\n${html}`;

      const fromJoined = JSON.stringify(msg.from_ ?? msg.from ?? '');
      const looksLikeClerk =
        /clerk/i.test(blob) ||
        /clerk/i.test(fromJoined) ||
        /verification/i.test(subject) ||
        /verification code/i.test(blob) ||
        /one-time/i.test(blob) ||
        /sign-?in/i.test(subject);

      if (!looksLikeClerk) continue;

      const otp = extractOtpFromText(blob);
      if (otp) return otp;
    }

    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error('Timed out waiting for Clerk verification email in AgentMail inbox.');
}
