/**
 * Runs before AppModule / Prisma load. Railway Postgres expects TLS; without
 * `sslmode=require` some clients fail the handshake (often reported as P1001).
 */
const raw = process.env.DATABASE_URL;
if (raw && !/sslmode=/i.test(raw) && !/\bssl=true\b/i.test(raw)) {
  try {
    const normalized = raw.replace(/^postgresql(\+\w+)?:/i, 'http:');
    const hostname = new URL(normalized).hostname;
    const railwayHost =
      hostname.endsWith('.rlwy.net') || hostname.endsWith('.railway.app');
    if (railwayHost) {
      const sep = raw.includes('?') ? '&' : '?';
      process.env.DATABASE_URL = `${raw}${sep}sslmode=require`;
    }
  } catch {
    /* leave DATABASE_URL unchanged */
  }
}
