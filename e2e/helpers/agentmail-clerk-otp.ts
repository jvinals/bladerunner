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
  const inboxId = process.env.E2E_AGENTMAIL_INBOX_ID;
  if (!apiKey || !inboxId) {
    throw new Error('AGENTMAIL_API_KEY and E2E_AGENTMAIL_INBOX_ID are required for email 2FA.');
  }

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
