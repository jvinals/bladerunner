#!/usr/bin/env node
/**
 * Quick API smoke check (no browser). Fails if /health reports database !== ok.
 * Usage: node scripts/verify-api-health.mjs
 *        API_URL=http://127.0.0.1:3001 node scripts/verify-api-health.mjs
 */
const base = process.env.API_URL || 'http://127.0.0.1:3001';
const url = `${base.replace(/\/$/, '')}/health`;

function explainFetchError(err) {
  const cause = err?.cause;
  const code = cause?.code || err?.code;
  const lines = [`Could not reach ${url}`, `  ${err?.message || err}`];
  if (code === 'ECONNREFUSED') {
    lines.push(
      '',
      'Nothing is listening on that host/port (API is probably not running).',
      '  Start it:  pnpm dev:api',
      '  Or both:   pnpm dev',
    );
  } else if (code === 'ENOTFOUND') {
    lines.push('', 'Host could not be resolved — check API_URL.');
  }
  return lines.join('\n');
}

const res = await fetch(url).catch((e) => {
  console.error(explainFetchError(e));
  process.exit(1);
});

const text = await res.text();
let body;
try {
  body = JSON.parse(text);
} catch {
  console.error(`Non-JSON from ${url} (${res.status}):`, text.slice(0, 500));
  process.exit(1);
}

console.log(JSON.stringify(body, null, 2));

if (!res.ok) {
  console.error(`HTTP ${res.status}`);
  process.exit(1);
}

if (body.services?.database !== 'ok') {
  console.error('Database check failed — fix DATABASE_URL / Postgres and migrations, then retry.');
  process.exit(1);
}

process.exit(0);
