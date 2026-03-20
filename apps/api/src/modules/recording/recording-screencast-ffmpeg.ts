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

export type ScreencastVideoEncoder = {
  /** Temp file ffmpeg writes to (API-local), usually `.mp4`. */
  outputPath: string;
  pushFrame: (jpeg: Buffer) => void;
  finalize: () => Promise<{ ok: boolean; exitCode: number | null; stderrTail: string }>;
  kill: () => void;
};

/**
 * Encodes CDP screencast JPEGs to **H.264 MP4** on this machine (broad ffmpeg support; VP8 WebM often
 * missing on stock macOS/Homebrew builds, which yielded thumbnails-only runs).
 */
export function createScreencastVideoEncoder(outputPath: string, logger: Logger): ScreencastVideoEncoder | null {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  /** CDP screencast is ~5–15 fps; default MJPEG demux assumes ~25 fps → sped-up output without this hint. */
  const raw = Number.parseFloat(process.env.RECORDING_SCREENCAST_INPUT_FPS || '8');
  const inputFps = Number.isFinite(raw) && raw > 0 && raw <= 60 ? raw : 8;
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    String(inputFps),
    '-f',
    'mjpeg',
    '-i',
    'pipe:0',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-tune',
    'zerolatency',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
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

  let pipeBroken = false;

  const exitPromise = new Promise<number | null>((resolve) => {
    proc.once('close', (code) => {
      pipeBroken = true;
      resolve(code);
    });
  });

  const stdin = proc.stdin;
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
      logger.warn(`ffmpeg screencast encode exited ${exitCode}; stderr: ${stderr.slice(-1500)}`);
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

/** @deprecated Use {@link createScreencastVideoEncoder} */
export const createScreencastWebmEncoder = createScreencastVideoEncoder;
/** @deprecated Use {@link ScreencastVideoEncoder} */
export type ScreencastWebmEncoder = ScreencastVideoEncoder;
