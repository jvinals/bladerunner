/**
 * Railway-hosted Postgres: TLS + longer connect timeout (cold start / proxy).
 * Must run after env is loaded (e.g. Nest ConfigModule).
 */
export function applyRailwayPostgresUrlDefaults(): void {
  const raw = process.env.DATABASE_URL;
  if (!raw) return;

  try {
    const normalized = raw.replace(/^postgresql(\+\w+)?:/i, 'http:');
    const hostname = new URL(normalized).hostname;
    const railwayHost =
      hostname.endsWith('.rlwy.net') || hostname.endsWith('.railway.app');
    if (!railwayHost) return;

    let next = raw;
    if (!/sslmode=/i.test(next) && !/\bssl=true\b/i.test(next)) {
      const sep = next.includes('?') ? '&' : '?';
      next = `${next}${sep}sslmode=require`;
    }
    if (!/connect_timeout=/i.test(next)) {
      const sep = next.includes('?') ? '&' : '?';
      next = `${next}${sep}connect_timeout=60`;
    }
    process.env.DATABASE_URL = next;
  } catch {
    /* leave DATABASE_URL unchanged */
  }
}

/** @deprecated use applyRailwayPostgresUrlDefaults */
export const applyRailwaySslToDatabaseUrl = applyRailwayPostgresUrlDefaults;
