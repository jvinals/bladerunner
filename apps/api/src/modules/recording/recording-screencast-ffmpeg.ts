import type { Logger } from '@nestjs/common';
import { spawn, type ChildProcess } from 'node:child_process';
import type { Writable } from 'node:stream';

function writeStdinChunk(stdin: Writable, buf: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = stdin.write(buf, (err: Error | null | undefined) => {
      if (err) reject(err);
    });
    if (ok) resolve();
    else stdin.once('drain', () => resolve());
  });
}

export type ScreencastWebmEncoder = {
  /** Temp file ffmpeg writes to (API-local). */
  outputPath: string;
  pushFrame: (jpeg: Buffer) => void;
  /** End stdin and wait for ffmpeg to finish writing `outputPath`. */
  finalize: () => Promise<{ ok: boolean; exitCode: number | null; stderrTail: string }>;
  kill: () => void;
};

/**
 * Encodes a live MJPEG stream (CDP screencast JPEGs) to WebM on **this** machine.
 * Use this when Playwright `recordVideo` cannot be read from the API process (e.g. `chromium.connect()` to a remote worker).
 */
export function createScreencastWebmEncoder(outputPath: string, logger: Logger): ScreencastWebmEncoder | null {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'mjpeg',
    '-i',
    'pipe:0',
    '-c:v',
    'libvpx-vp8',
    '-crf',
    '32',
    '-b:v',
    '0',
    '-deadline',
    'realtime',
    '-cpu-used',
    '8',
    '-an',
    outputPath,
  ];

  let proc: ChildProcess;
  try {
    proc = spawn(ffmpeg, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    logger.warn(`ffmpeg spawn failed: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }

  if (!proc.stdin) {
    logger.warn('ffmpeg stdin is not available');
    try {
      proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    return null;
  }

  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
    if (stderr.length > 32_000) stderr = stderr.slice(-16_000);
  });

  /** When true, ffmpeg stdin is broken or process ended — must not write (avoids EPIPE + crash). */
  let pipeBroken = false;

  const exitPromise = new Promise<number | null>((resolve) => {
    proc.once('close', (code) => {
      pipeBroken = true;
      resolve(code);
    });
  });

  const stdin = proc.stdin;
  /** Must handle EPIPE or Node throws unhandled "error" on Socket and crashes the API. */
  stdin.on('error', (err: NodeJS.ErrnoException) => {
    pipeBroken = true;
    if (err.code !== 'EPIPE') {
      logger.warn(`ffmpeg stdin: ${err.message}`);
    }
  });

  let chain: Promise<void> = Promise.resolve();

  const pushFrame = (jpeg: Buffer) => {
    if (pipeBroken) return;
    chain = chain
      .then(() => writeStdinChunk(stdin, jpeg))
      .catch((err: unknown) => {
        pipeBroken = true;
        const e = err as NodeJS.ErrnoException;
        if (e?.code !== 'EPIPE') {
          logger.warn(`ffmpeg stdin write: ${e?.message ?? err}`);
        }
      });
  };

  const finalize = async (): Promise<{ ok: boolean; exitCode: number | null; stderrTail: string }> => {
    await chain.catch(() => {});
    try {
      if (!pipeBroken && stdin.writable) {
        stdin.end();
      }
    } catch {
      /* ignore */
    }
    const exitCode = await exitPromise;
    const ok = exitCode === 0;
    if (!ok) {
      logger.warn(
        `ffmpeg screencast encode exited ${exitCode}; stderr: ${stderr.slice(-1500)}`,
      );
    }
    return { ok, exitCode, stderrTail: stderr };
  };

  const kill = () => {
    pipeBroken = true;
    try {
      proc.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  };

  proc.once('error', (err) => {
    logger.warn(`ffmpeg process error: ${err.message}`);
  });

  return { outputPath, pushFrame, finalize, kill };
}
