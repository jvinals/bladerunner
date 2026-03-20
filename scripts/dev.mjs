#!/usr/bin/env node
/**
 * Runs the same stack as the previous `pnpm dev` concurrently line, but wraps the
 * concurrently process so Ctrl+C / SIGTERM cannot leave orphan Node/Vite/Nest/tsx
 * processes: if the tree is still alive after DEV_KILL_GRACE_MS, we SIGKILL it via tree-kill.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import treeKill from 'tree-kill';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const require = createRequire(import.meta.url);
const concurrentlyPkg = dirname(require.resolve('concurrently/package.json'));
const concurrentlyBin = join(concurrentlyPkg, 'dist/bin/concurrently.js');

const args = [
  '-n',
  'api,worker,web',
  '-c',
  'auto',
  '--kill-others-on-fail',
  'pnpm run dev:api',
  'pnpm --filter @bladerunner/browser-worker dev',
  'pnpm run dev:web:delayed',
];

const child = spawn(process.execPath, [concurrentlyBin, ...args], {
  stdio: 'inherit',
  cwd: repoRoot,
  env: process.env,
});

let forceKillTimer = null;

function clearForceKill() {
  if (forceKillTimer) {
    clearTimeout(forceKillTimer);
    forceKillTimer = null;
  }
}

child.on('exit', (code, signal) => {
  clearForceKill();
  if (signal) {
    process.exit(0);
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error('[dev]', err);
  process.exit(1);
});

const graceMs = Number(process.env.DEV_KILL_GRACE_MS || 5000);

function shutdown(signal) {
  if (!child.pid) {
    process.exit(0);
    return;
  }
  clearForceKill();
  try {
    treeKill(child.pid, signal, (err) => {
      if (err) console.warn('[dev] tree-kill:', err.message);
    });
  } catch (e) {
    console.warn('[dev]', e);
  }
  forceKillTimer = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    console.warn(
      `[dev] Some dev processes did not exit within ${graceMs}ms; sending SIGKILL to the dev tree.`,
    );
    try {
      treeKill(child.pid, 'SIGKILL', () => process.exit(1));
    } catch {
      process.exit(1);
    }
  }, graceMs);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
