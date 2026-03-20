import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Prefer `FFPROBE_PATH`; else sibling of `FFMPEG_PATH`; else `ffprobe` on PATH. */
export function resolveFfprobePath(): string {
  const explicit = process.env.FFPROBE_PATH?.trim();
  if (explicit) return explicit;
  const ffmpeg = process.env.FFMPEG_PATH?.trim();
  if (ffmpeg) {
    if (/ffmpeg\.exe$/i.test(ffmpeg)) return ffmpeg.replace(/ffmpeg\.exe$/i, 'ffprobe.exe');
    if (/[/\\]ffmpeg$/i.test(ffmpeg)) return ffmpeg.replace(/ffmpeg$/i, 'ffprobe');
  }
  return 'ffprobe';
}

export async function ffprobeDurationSeconds(videoPath: string): Promise<number | null> {
  const ffprobe = resolveFfprobePath();
  try {
    const { stdout } = await execFileAsync(
      ffprobe,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ],
      { maxBuffer: 2 * 1024 * 1024 },
    );
    const s = parseFloat(String(stdout).trim());
    return Number.isFinite(s) && s > 0 ? s : null;
  } catch {
    return null;
  }
}

/**
 * CDP screencast frame timestamps are not passed through the MJPEG pipe, so ffmpeg assumes a default
 * input FPS and the file duration is shorter than wall-clock → playback looks 2–3× fast. Stretch/compress
 * timestamps so container duration matches the real recording length.
 */
export async function adjustRecordingVideoDurationToWallClock(
  videoPath: string,
  wallClockSeconds: number,
  logger: Logger,
): Promise<void> {
  if (wallClockSeconds < 0.5) return;
  const probe = await ffprobeDurationSeconds(videoPath);
  if (probe == null || probe <= 0) return;
  const ratio = wallClockSeconds / probe;
  if (ratio >= 0.92 && ratio <= 1.08) return;
  if (ratio < 0.5 || ratio > 5) {
    logger.warn(
      `recording duration sync skipped: wall=${wallClockSeconds.toFixed(2)}s probe=${probe.toFixed(2)}s ratio=${ratio.toFixed(3)}`,
    );
    return;
  }
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  const tmp = `${videoPath}.ptsfix.mp4`;
  const ratioStr = ratio.toFixed(6);
  try {
    await execFileAsync(
      ffmpeg,
      [
        '-y',
        '-i',
        videoPath,
        '-vf',
        `setpts=PTS*${ratioStr}`,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-an',
        tmp,
      ],
      { maxBuffer: 50 * 1024 * 1024 },
    );
    await fs.rename(tmp, videoPath);
    logger.log(
      `Adjusted session video timing: wall=${wallClockSeconds.toFixed(2)}s was=${probe.toFixed(2)}s (setpts×${ratioStr})`,
    );
  } catch (e) {
    await removePathIfExists(tmp).catch(() => {});
    logger.warn(`recording duration sync failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function getRecordingsBaseDir(config: ConfigService): string {
  return config.get<string>('RECORDINGS_DIR')?.trim() || path.join(os.tmpdir(), 'bladerunner-recordings');
}

export function getRunArtifactDir(base: string, userId: string, runId: string): string {
  return path.join(base, userId, runId);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

/** Persists the staged session video as `recording.mp4` (H.264). */
export async function copyRecordingVideoToArtifacts(
  sourcePath: string,
  destDir: string,
): Promise<{ videoPath: string; sizeBytes: number }> {
  await ensureDir(destDir);
  const videoPath = path.join(destDir, 'recording.mp4');
  await fs.copyFile(sourcePath, videoPath);
  const stat = await fs.stat(videoPath);
  return { videoPath, sizeBytes: stat.size };
}

export async function writeJpegThumbnailFromVideo(
  videoPath: string,
  outJpgPath: string,
  logger: Logger,
): Promise<boolean> {
  const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
  try {
    await execFileAsync(
      ffmpeg,
      ['-y', '-ss', '1', '-i', videoPath, '-vframes', '1', '-q:v', '3', outJpgPath],
      { maxBuffer: 20 * 1024 * 1024 },
    );
    return true;
  } catch (e) {
    logger.warn(`ffmpeg thumbnail failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}

export async function removePathIfExists(target: string): Promise<void> {
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
