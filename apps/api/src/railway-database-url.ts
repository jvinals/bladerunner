/**
 * Railway Postgres expects TLS. Append sslmode=require when missing.
 * Must run after env is loaded (e.g. Nest ConfigModule) — not at process start,
 * when DATABASE_URL may still be unset.
 */
export function applyRailwaySslToDatabaseUrl(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw || /sslmode=/i.test(raw) || /\bssl=true\b/i.test(raw)) return;

  try {
    const normalized = raw.replace(/^postgresql(\+\w+)?:/i, 'http:');
    const hostname = new URL(normalized).hostname;
    const railwayHost =
      hostname.endsWith('.rlwy.net') || hostname.endsWith('.railway.app');
    if (!railwayHost) return;

    const sep = raw.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${raw}${sep}sslmode=require`;
  } catch {
    /* leave DATABASE_URL unchanged */
  }
}
