import type { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function getRecordingsBaseDir(config: ConfigService): string {
  return config.get<string>('RECORDINGS_DIR')?.trim() || path.join(os.tmpdir(), 'bladerunner-recordings');
}

export function getRunArtifactDir(base: string, userId: string, runId: string): string {
  return path.join(base, userId, runId);
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function copyWebmToArtifacts(sourcePath: string, destDir: string): Promise<{ webmPath: string; sizeBytes: number }> {
  await ensureDir(destDir);
  const webmPath = path.join(destDir, 'recording.webm');
  await fs.copyFile(sourcePath, webmPath);
  const stat = await fs.stat(webmPath);
  return { webmPath, sizeBytes: stat.size };
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
