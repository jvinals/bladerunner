#!/usr/bin/env node
/**
 * Tests raw TCP reachability to DATABASE_URL host:port (no DB auth, no secrets logged).
 * Run from repo root so .env is found:
 *   node --env-file=.env scripts/check-db-tcp.mjs
 */
import net from 'node:net';

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error(
    'DATABASE_URL is not set.\n  From repo root: node --env-file=.env scripts/check-db-tcp.mjs',
  );
  process.exit(1);
}

let url;
try {
  url = new URL(raw);
} catch {
  console.error('DATABASE_URL is not a valid URL.');
  process.exit(1);
}

const host = url.hostname;
const port = url.port ? parseInt(url.port, 10) : 5432;

console.log(`Testing TCP to ${host}:${port} (password not shown)…`);

const socket = net.createConnection({ host, port });
socket.setTimeout(15000);

socket.on('connect', () => {
  console.log('OK: TCP connection succeeded — host/port reachable from this machine.');
  console.log(
    'If Prisma still fails, check SSL params on DATABASE_URL (e.g. ?sslmode=require for Railway).',
  );
  socket.destroy();
  process.exit(0);
});

socket.on('timeout', () => {
  console.error('FAIL: TCP timeout (firewall, sleeping DB, or wrong host/port).');
  socket.destroy();
  process.exit(1);
});

socket.on('error', (err) => {
  const code = err.code || 'UNKNOWN';
  console.error(`FAIL: ${code} — ${err.message}`);
  if (code === 'ECONNREFUSED') {
    console.error(
      'Nothing accepted the connection. Railway: ensure Postgres is running and **public TCP / proxy** is enabled for this database.',
    );
  }
  if (code === 'ENOTFOUND') {
    console.error('Hostname did not resolve — wrong DATABASE_URL host or DNS issue.');
  }
  if (code === 'ETIMEDOUT') {
    console.error('Timed out — VPN/corporate firewall blocking outbound DB ports, or target is down.');
  }
  process.exit(1);
});
