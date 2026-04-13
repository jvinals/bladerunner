#!/usr/bin/env node
/**
 * Verifies self-hosted Skyvern returns `signed_url: null` for local artifacts so
 * the UI can rewrite `file://` URIs via the artifact server (:9090).
 *
 * Usage (after Skyvern is up and you have a real artifact id):
 *   node scripts/verify-skyvern-artifact-signed-url.mjs <artifact_id>
 *
 * Loads SKYVERN_API_BASE_URL + SKYVERN_API_KEY from `.env` in repo root.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadEnv() {
  try {
    const raw = readFileSync(join(root, '.env'), 'utf8');
    const out = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const artifactId = process.argv[2];
const env = { ...process.env, ...loadEnv() };
const base = (env.SKYVERN_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
const key = env.SKYVERN_API_KEY || '';

async function main() {
  if (!artifactId) {
    console.error('Usage: node scripts/verify-skyvern-artifact-signed-url.mjs <artifact_id>');
    console.error('Get an id from Skyvern UI → task diagnostics, or GET /api/v1/runs/{id}/artifacts');
    process.exit(2);
  }
  if (!key) {
    console.error('Missing SKYVERN_API_KEY in environment or .env');
    process.exit(2);
  }

  const url = `${base}/api/v1/artifacts/${encodeURIComponent(artifactId)}`;
  const res = await fetch(url, { headers: { 'x-api-key': key } });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error('Non-JSON response', res.status, text.slice(0, 300));
    process.exit(1);
  }

  const signed = data?.signed_url ?? data?.signedUrl;
  const uri = data?.uri ?? '';

  if (!res.ok) {
    console.error('Request failed', res.status, data);
    process.exit(1);
  }

  if (signed != null && typeof signed === 'string' && signed.startsWith('file:')) {
    console.error('FAIL: signed_url is still file:// — Skyvern UI will not rewrite; rebuild skyvern image with apps/skyvern patch.');
    process.exit(1);
  }

  if (typeof uri === 'string' && uri.startsWith('file:')) {
    console.log('OK: uri is file:// (expected for local storage); signed_url is not file://');
  } else {
    console.log('OK: artifact response usable for UI', { signed_url: signed, uriPrefix: String(uri).slice(0, 32) });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
