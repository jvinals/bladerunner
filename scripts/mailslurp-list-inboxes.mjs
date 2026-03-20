#!/usr/bin/env node
/**
 * Lists MailSlurp inboxes so you can set MAILSLURP_INBOX_ID or MAILSLURP_INBOX_EMAIL in .env.
 * Usage: pnpm mailslurp:list-inboxes  OR  npm run mailslurp:list-inboxes
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import MailSlurp from 'mailslurp-client';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envRoot = path.join(root, '.env');
const envApi = path.join(root, 'apps', 'api', '.env');
dotenv.config({ path: envRoot, quiet: true });
dotenv.config({ path: envApi, override: true, quiet: true });

const apiKey = process.env.MAILSLURP_API_KEY?.trim();
if (!apiKey) {
  console.error(
    'Set MAILSLURP_API_KEY in repo root .env and/or apps/api/.env (this script loads both; API overrides root).',
  );
  process.exit(1);
}

const ms = new MailSlurp({ apiKey });

let inboxes;
try {
  inboxes = await ms.getInboxes();
} catch (e) {
  console.error(e?.message ?? e);
  console.error(
    '\nMailSlurp API error. Verify MAILSLURP_API_KEY at https://app.mailslurp.com → API Keys.\n',
  );
  process.exit(1);
}

if (!Array.isArray(inboxes) || inboxes.length === 0) {
  console.log('No inboxes found. Create one in the MailSlurp dashboard.');
  process.exit(0);
}

console.log('Inboxes (use id in MAILSLURP_INBOX_ID, or email in MAILSLURP_INBOX_EMAIL):\n');
for (const inv of inboxes) {
  console.log(`  id: ${inv.id}`);
  console.log(`  email: ${inv.emailAddress}`);
  console.log('');
}
