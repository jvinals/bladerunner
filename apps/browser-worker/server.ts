import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { chromium, BrowserServer } from 'playwright-core';

const PORT = parseInt(process.env.WORKER_PORT || '3002', 10);
const CDP_PORT = parseInt(process.env.CDP_PORT || '3003', 10);
const EXTERNAL_HOST = process.env.WORKER_EXTERNAL_HOST || '';

/** Host the API uses in wsEndpoint for chromium.connect (never use bare :: / 0.0.0.0 — invalid or wrong for clients). */
const LOCAL_CONNECT_HOST = '127.0.0.1';

let browserServer: BrowserServer | null = null;
let launchInProgress: Promise<BrowserServer> | null = null;

function shouldRewriteToLoopback(hostname: string): boolean {
  if (!hostname) return true;
  if (hostname === '0.0.0.0') return true;
  if (hostname === '::' || hostname === '::1') return true;
  return false;
}

/**
 * Playwright may return CDP URLs with IPv6 / all-interfaces hosts that Node rejects
 * (e.g. ws://:::3003/...) or that are not valid connect targets. Normalize for clients.
 */
function rewriteWsEndpoint(wsEndpoint: string): string {
  if (EXTERNAL_HOST) {
    try {
      const url = new URL(wsEndpoint);
      url.hostname = EXTERNAL_HOST;
      url.port = String(CDP_PORT);
      return url.toString().replace(/\/$/, '');
    } catch {
      return wsEndpoint.replace(/ws:\/\/[^/]+/, `ws://${EXTERNAL_HOST}:${CDP_PORT}`);
    }
  }

  try {
    const url = new URL(wsEndpoint);
    if (shouldRewriteToLoopback(url.hostname)) {
      url.hostname = LOCAL_CONNECT_HOST;
    }
    if (!url.port) {
      url.port = String(CDP_PORT);
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    // Malformed authority e.g. ws://:::3003/<token> from broken IPv6 serialization
    const rest = wsEndpoint.replace(/^ws:\/\//, '');
    const slash = rest.indexOf('/');
    const authority = slash >= 0 ? rest.slice(0, slash) : rest;
    const path = slash >= 0 ? rest.slice(slash) : '';
    const portMatch = authority.match(/:(\d+)$/);
    const port = portMatch ? portMatch[1] : String(CDP_PORT);
    return `ws://${LOCAL_CONNECT_HOST}:${port}${path}`;
  }
}

// Bind **0.0.0.0** explicitly — Fly Proxy / Flycast often connects over IPv4; default `listen(port)` can
// be dual-stack in ways that drop connections with **ECONNRESET** from the proxy.
const httpServer = http.createServer((_req, res) => {
  res.writeHead(404);
  res.end();
});
const wss = new WebSocketServer({ server: httpServer });

function send(ws: WebSocket, data: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

wss.on('connection', (ws) => {
  console.log('[browser-worker] Client connected');

  ws.on('message', async (raw) => {
    let msg: { type: string; payload?: Record<string, unknown> };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'error', error: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'launch': {
        if (browserServer) {
          send(ws, {
            type: 'launch:result',
            wsEndpoint: rewriteWsEndpoint(browserServer.wsEndpoint()),
          });
          return;
        }

        if (launchInProgress) {
          try {
            const existing = await launchInProgress;
            send(ws, { type: 'launch:result', wsEndpoint: rewriteWsEndpoint(existing.wsEndpoint()) });
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            send(ws, { type: 'error', error });
          }
          return;
        }

        try {
          const launching = chromium.launchServer({
            headless: true,
            channel: 'chromium',
            port: CDP_PORT,
            // Bind IPv4 all-interfaces; `::` can yield invalid ws:// URLs on some hosts (e.g. ws://:::port/...).
            host: '0.0.0.0',
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
            ],
          });
          launchInProgress = launching;
          browserServer = await launching;
          launchInProgress = null;

          const wsEndpoint = browserServer.wsEndpoint();
          const externalEndpoint = rewriteWsEndpoint(wsEndpoint);
          console.log(`[browser-worker] Browser launched: ${wsEndpoint}`);
          if (externalEndpoint !== wsEndpoint) {
            console.log(`[browser-worker] External endpoint: ${externalEndpoint}`);
          }

          browserServer.on('close', () => {
            console.log('[browser-worker] Browser server closed');
            browserServer = null;
          });

          send(ws, { type: 'launch:result', wsEndpoint: externalEndpoint });
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          console.error('[browser-worker] Launch failed:', error);
          send(ws, { type: 'error', error });
        }
        break;
      }

      case 'health': {
        send(ws, {
          type: 'health:result',
          status: 'ok',
          browserRunning: browserServer !== null,
          uptime: process.uptime(),
        });
        break;
      }

      case 'shutdown': {
        console.log('[browser-worker] Shutdown requested');
        if (browserServer) {
          await browserServer.close();
          browserServer = null;
        }
        send(ws, { type: 'shutdown:result', status: 'ok' });
        break;
      }

      default:
        send(ws, { type: 'error', error: `Unknown message type: ${msg.type}` });
    }
  });

  ws.on('close', () => {
    console.log(
      '[browser-worker] Control client disconnected (normal: API closes this socket after launch; browser server keeps running until shutdown)',
    );
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[browser-worker] Listening on ws://0.0.0.0:${PORT}`);
});

async function gracefulShutdown() {
  console.log('[browser-worker] Shutting down...');
  const deadline = setTimeout(() => {
    console.warn('[browser-worker] Shutdown timed out; exiting.');
    process.exit(0);
  }, 4000);
  try {
    if (browserServer) {
      await Promise.race([
        browserServer.close(),
        new Promise<void>((_, rej) =>
          setTimeout(() => rej(new Error('browser close timeout')), 3500),
        ),
      ]).catch(() => {});
    }
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  } finally {
    clearTimeout(deadline);
  }
  process.exit(0);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
