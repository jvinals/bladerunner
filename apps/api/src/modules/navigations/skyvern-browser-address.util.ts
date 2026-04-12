import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Skyvern calls `connect_over_cdp(browser_address)` from *its* process. A URL like
 * `ws://127.0.0.1:3003/...` is loopback on **Skyvern's** machine (e.g. Docker, remote worker), not the
 * host where browser-worker bound Playwright. Set **`SKYVERN_BROWSER_CDP_HOST`** to a hostname/IP
 * reachable from Skyvern (`host.docker.internal`, LAN IP, Fly private hostname, etc.).
 */
export function resolveBrowserAddressForSkyvern(
  wsEndpoint: string,
  config: ConfigService,
  logger: Pick<Logger, 'log' | 'warn'>,
): string {
  const host = config.get<string>('SKYVERN_BROWSER_CDP_HOST')?.trim();
  if (!host) return wsEndpoint;
  try {
    const url = new URL(wsEndpoint);
    const prevHost = url.hostname;
    const prevPort = url.port || '';
    url.hostname = host;
    const portOverride = config.get<string>('SKYVERN_BROWSER_CDP_PORT')?.trim();
    if (portOverride) url.port = portOverride;
    const next = url.toString().replace(/\/$/, '');
    logger.log(
      `Navigation Play: browser_address host for Skyvern ${prevHost}${prevPort ? `:${prevPort}` : ''} → ${host}` +
        (portOverride ? `:${portOverride}` : ''),
    );
    return next;
  } catch {
    logger.warn('Navigation Play: could not parse wsEndpoint for SKYVERN_BROWSER_CDP_HOST rewrite; passing through');
    return wsEndpoint;
  }
}

/** Skyvern Cloud cannot attach to a CDP server on the operator's localhost. */
export function assertSkyvernCloudCannotUseLocalhostCdp(wsEndpoint: string, config: ConfigService): void {
  const base = config.get<string>('SKYVERN_API_BASE_URL')?.trim() || 'https://api.skyvern.com';
  const isSkyvernCloud = /^https:\/\/api\.skyvern\.com\b/i.test(base);
  if (!isSkyvernCloud) return;
  if (!/127\.0\.0\.1|\[::1\]|localhost/i.test(wsEndpoint)) return;
  throw new BadRequestException(
    'Skyvern Cloud cannot connect to browser CDP at 127.0.0.1 or localhost. Use self-hosted Skyvern ' +
      'with network access to your browser-worker, or set SKYVERN_BROWSER_CDP_HOST to a host Skyvern can reach.',
  );
}
