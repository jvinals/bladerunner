import { Logger } from '@nestjs/common';

const DEFAULT_LOCAL = 'ws://127.0.0.1:3002';

const ON_FLY = Boolean(process.env.FLY_ALLOC_ID);

/**
 * Normalize `BROWSER_WORKER_URL` so browser-worker control connections work:
 *
 * - **Local dev**: Fly-only hostnames (`*.internal`, `*.flycast`) do not resolve on the host → use loopback.
 * - **On Fly**: legacy **`*.internal`** DNS often fails when worker Machines are stopped; Fly Proxy uses **`*.flycast`**.
 *   Rewrite **`app.internal[:3002]`** → **`app.flycast`** (Flycast routes via Fly Proxy on port 80; do not keep :3002).
 */
export function resolveBrowserWorkerWebSocketUrl(
  raw: string | undefined,
  logger: Pick<Logger, 'warn'>,
): string {
  const candidate = raw?.trim() || DEFAULT_LOCAL;
  try {
    const u = new URL(candidate);
    const host = u.hostname.toLowerCase();
    const port = u.port || '3002';

    if (host.endsWith('.internal')) {
      if (ON_FLY) {
        const base = host.slice(0, -'.internal'.length);
        const flycastHost = `${base}.flycast`;
        u.hostname = flycastHost;
        // Flycast uses Fly Proxy (port 80). If env was `*.internal:3002`, dropping the port is critical.
        if (u.port === port) u.port = '';
        const rewritten = u.href.replace(/\/$/, '');
        logger.warn(
          `BROWSER_WORKER_URL used legacy .internal host (${host}). Rewrote to ${flycastHost} (Flycast via port 80) — ` +
            `stopped Machines do not resolve on .internal; prefer .flycast (or unset BROWSER_WORKER_URL to use fly.toml).`,
        );
        return rewritten;
      }
      const local = `ws://127.0.0.1:${port}`;
      logger.warn(
        `BROWSER_WORKER_URL (${u.host}) is a Fly.io-only hostname and does not resolve outside Fly. ` +
          `Using ${local} for local development. Remove or override BROWSER_WORKER_URL in .env, or deploy the API on Fly.`,
      );
      return local;
    }

    if (host.endsWith('.flycast') && !ON_FLY) {
      const local = `ws://127.0.0.1:${port}`;
      logger.warn(
        `BROWSER_WORKER_URL (${u.host}) is a Fly.io-only hostname and does not resolve outside Fly. ` +
          `Using ${local} for local development.`,
      );
      return local;
    }
  } catch {
    // invalid URL — return candidate and let WebSocket fail with a normal error
  }
  return candidate;
}
