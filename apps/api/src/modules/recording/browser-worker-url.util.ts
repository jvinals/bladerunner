import { Logger } from '@nestjs/common';

const DEFAULT_LOCAL = 'ws://127.0.0.1:3002';

/**
 * Fly.io Machines set `FLY_ALLOC_ID`. Local `pnpm dev` does not — so env vars copied from
 * production (`*.internal`, `*.flycast`) will not resolve and `getaddrinfo ENOTFOUND` breaks
 * evaluations. Coerce to loopback when not on Fly so a local browser-worker works.
 */
export function resolveBrowserWorkerWebSocketUrl(
  raw: string | undefined,
  logger: Pick<Logger, 'warn'>,
): string {
  const candidate = raw?.trim() || DEFAULT_LOCAL;
  if (process.env.FLY_ALLOC_ID) {
    return candidate;
  }
  try {
    const u = new URL(candidate);
    const host = u.hostname.toLowerCase();
    if (host.endsWith('.internal') || host.endsWith('.flycast')) {
      const port = u.port || '3002';
      const local = `ws://127.0.0.1:${port}`;
      logger.warn(
        `BROWSER_WORKER_URL (${u.host}) is a Fly.io-only hostname and does not resolve outside Fly. ` +
          `Using ${local} for local development. Remove or override BROWSER_WORKER_URL in .env, or deploy the API on Fly.`,
      );
      return local;
    }
  } catch {
    // invalid URL — return candidate and let WebSocket fail with a normal error
  }
  return candidate;
}
