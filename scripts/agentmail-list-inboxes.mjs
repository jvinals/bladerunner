#!/usr/bin/env node
/**
 * Lists AgentMail inboxes so you can set E2E_AGENTMAIL_INBOX_ID or E2E_AGENTMAIL_INBOX_EMAIL in .env.
 * Usage: pnpm agentmail:list-inboxes
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

const apiKey = process.env.AGENTMAIL_API_KEY;
if (!apiKey) {
  console.error('Set AGENTMAIL_API_KEY in the repo root .env');
  process.exit(1);
}

const { AgentMailClient } = await import('agentmail');
const client = new AgentMailClient({ apiKey });

const res = await client.inboxes.list();
const top = res && typeof res === 'object' ? res : {};
const data = top.data && typeof top.data === 'object' ? top.data : {};
const rows =
  (Array.isArray(data.inboxes) && data.inboxes) ||
  (Array.isArray(data.items) && data.items) ||
  (Array.isArray(top.inboxes) && top.inboxes) ||
  (Array.isArray(top.items) && top.items) ||
  [];

if (rows.length === 0) {
  console.log('No inboxes found (or unexpected API shape). Raw response:');
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

console.log('Inboxes (use inbox id in E2E_AGENTMAIL_INBOX_ID, or the email in E2E_AGENTMAIL_INBOX_EMAIL):\n');
for (const inv of rows) {
  const o = inv && typeof inv === 'object' ? inv : {};
  const id = o.inboxId ?? o.inbox_id ?? o.id ?? '(unknown id)';
  const email = o.email ?? o.address ?? o.inboxAddress ?? o.inbox_email ?? '(unknown email)';
  console.log(`  id: ${id}`);
  console.log(`  email: ${email}`);
  console.log('');
}
