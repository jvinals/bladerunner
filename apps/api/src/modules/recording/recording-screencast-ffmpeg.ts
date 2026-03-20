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

  const stdin = proc.stdin;
  let chain: Promise<void> = Promise.resolve();

  const pushFrame = (jpeg: Buffer) => {
    chain = chain.then(() => writeStdinChunk(stdin, jpeg));
  };

  const finalize = async (): Promise<{ ok: boolean; exitCode: number | null; stderrTail: string }> => {
    await chain.catch((err) => {
      logger.warn(`ffmpeg stdin write failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    try {
      stdin.end();
    } catch {
      /* ignore */
    }
    const exitCode = await new Promise<number | null>((resolve) => {
      proc.once('close', (code) => resolve(code));
    });
    const ok = exitCode === 0;
    if (!ok) {
      logger.warn(
        `ffmpeg screencast encode exited ${exitCode}; stderr: ${stderr.slice(-1500)}`,
      );
    }
    return { ok, exitCode, stderrTail: stderr };
  };

  const kill = () => {
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
