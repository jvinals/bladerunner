import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  NotFoundException,
  ConflictException,
  BadRequestException,
  HttpException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser, Page, CDPSession } from 'playwright-core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { RunStep, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { EventEmitter } from 'events';
import {
  clerkSignInUrlLooksLike,
  detectClerkSignInUi,
  detectClerkOtpInputVisible,
  fillClerkOtpFromClerkTestEmail,
  fillClerkOtpFromMailSlurp,
  performClerkPasswordEmail2FA,
  type ClerkOtpMode,
} from '@bladerunner/clerk-agentmail-signin';
import { buildPlaybackSkipSet, shouldSkipStoredPlaywrightForClerk } from './playback-skip.util';
import { escapeLocatorCssInPlaywrightSnippet } from './playback-css-escape.util';
import { CLERK_CANONICAL_SIGN_IN_STEPS } from './recording-clerk-canonical-steps';
import { preferRecordedCssSelectorForBarePageLocator } from './recording-playwright-merge.util';
import {
  adjustRecordingVideoDurationToWallClock,
  copyRecordingVideoToArtifacts,
  getRecordingsBaseDir,
  getRunArtifactDir,
  removePathIfExists,
  writeJpegThumbnailFromVideo,
} from './recording-storage';
import { createScreencastVideoEncoder, type ScreencastVideoEncoder } from './recording-screencast-ffmpeg';

export type StartPlaybackServiceOpts = {
  delayMs?: number;
  autoClerkSignIn?: boolean;
  /**
   * How to obtain the email OTP during Clerk auto sign-in.
   * When omitted, server uses `PLAYBACK_CLERK_OTP_MODE` or defaults to `mailslurp` (requires MAILSLURP_* env).
   */
  clerkOtpMode?: ClerkOtpMode;
  skipUntilSequence?: number;
  skipStepIds?: string[];
  /** Stop playback after this step sequence completes (inclusive). Omit = run all steps. */
  playThroughSequence?: number;
};

export interface RecordingSession {
  runId: string;
  userId: string;
  browser: Browser;
  page: Page;
  cdpSession: CDPSession;
  stepSequence: number;
  latestFrame: Buffer | null;
  /**
   * After server Clerk+MailSlurp sign-in completes, the next in-app verification OTP type (if any) is labeled AUTOMATIC for UI.
   * Does not set `clerkAuthPhase` (playback must still execute that step).
   */
  pendingPostClerkVerificationAutomaticUi: boolean;
  /**
   * Encodes CDP screencast JPEGs to WebM on the API host (required when the browser is remote — Playwright
   * `recordVideo` files are not readable from this process).
   */
  screencastVideo: ScreencastVideoEncoder | null;
}

/** Live replay session — keyed by playbackSessionId (socket room), not source run id */
export interface PlaybackSession {
  playbackSessionId: string;
  sourceRunId: string;
  userId: string;
  browser: Browser;
  page: Page;
  cdpSession: CDPSession;
  latestFrame: Buffer | null;
  paused: boolean;
  /** Resolvers waiting in `waitUntilPlaybackNotPaused` */
  playbackResumeWaiters: Array<() => void>;
}

@Injectable()
export class RecordingService extends EventEmitter {
  private readonly logger = new Logger(RecordingService.name);
  private sessions = new Map<string, RecordingSession>();
  private playbackSessions = new Map<string, PlaybackSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  getSession(runId: string): RecordingSession | undefined {
    return this.sessions.get(runId);
  }

  getLatestFrame(runId: string): Buffer | null {
    return this.sessions.get(runId)?.latestFrame ?? null;
  }

  async startRecording(userId: string, name: string, url: string, projectId?: string) {
    const pid = projectId?.trim();
    if (pid) {
      const proj = await this.prisma.project.findFirst({ where: { id: pid, userId } });
      if (!proj) {
        throw new BadRequestException('Project not found');
      }
    }

    const run = await this.prisma.run.create({
      data: {
        userId,
        name,
        url,
        projectId: pid || null,
        status: 'RECORDING',
        platform: 'DESKTOP',
        startedAt: new Date(),
      },
    });

    const workerUrl = this.configService.get<string>('BROWSER_WORKER_URL', 'ws://localhost:3002');

    let screencastVideo: ScreencastVideoEncoder | null = null;
    const ffmpegStagingPath = path.join(os.tmpdir(), `br-screencast-${run.id}-${randomUUID()}.mp4`);
    try {
      const wsEndpoint = await this.requestBrowserFromWorker(workerUrl);
      const browser = await chromium.connect(wsEndpoint);
      const viewport = { width: 1280, height: 720 };
      screencastVideo = createScreencastVideoEncoder(ffmpegStagingPath, this.logger);
      const context = await browser.newContext({
        viewport,
      });
      const page = await context.newPage();
      const cdpSession = await context.newCDPSession(page);

      const session: RecordingSession = {
        runId: run.id,
        userId,
        browser,
        page,
        cdpSession,
        stepSequence: 0,
        latestFrame: null,
        pendingPostClerkVerificationAutomaticUi: false,
        screencastVideo,
      };

      this.sessions.set(run.id, session);

      await this.attachScreencast(session.cdpSession, session, session.runId, {
        onJpegFrame: (jpeg) => screencastVideo?.pushFrame(jpeg),
      });
      await this.setupEventCapture(session);

      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const navStep = await this.recordStep(session, {
        action: 'NAVIGATE',
        selector: null,
        value: url,
        instruction: `Navigate to ${url}`,
        playwrightCode: `await page.goto('${url}');`,
        origin: 'MANUAL',
      });

      this.emit('step', run.id, navStep);
      this.emit('status', run.id, { status: 'recording', runId: run.id });

      this.logger.log(`Recording started: ${run.id} -> ${url}`);
      return run;
    } catch (err) {
      if (screencastVideo) {
        screencastVideo.kill();
        await removePathIfExists(ffmpegStagingPath).catch(() => {});
      }
      await this.prisma.run.update({
        where: { id: run.id },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      const detail = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(
        `Recording could not start (browser worker / Playwright). ${detail}`,
      );
    }
  }

  async stopRecording(runId: string, userId: string) {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      return null;
    }

    const latestFrame = session.latestFrame;
    const screencastVideo = session.screencastVideo;

    try {
      await session.cdpSession.send('Page.stopScreencast');
    } catch (err) {
      this.logger.warn('stopScreencast', err);
    }

    if (screencastVideo) {
      try {
        await screencastVideo.finalize();
      } catch (err) {
        this.logger.warn(`screencast video finalize failed for ${runId}:`, err);
      }
    }

    try {
      await session.browser.close();
    } catch (err) {
      this.logger.warn('Error closing browser', err);
    }

    this.sessions.delete(runId);

    /** Staging file written by ffmpeg on the API host (same process as this service). */
    let rawVideoPath: string | null = null;
    if (screencastVideo) {
      try {
        const st = await fs.stat(screencastVideo.outputPath);
        if (st.size > 0) {
          rawVideoPath = screencastVideo.outputPath;
        } else {
          this.logger.warn(`screencast video is empty for ${runId}, skipping copy`);
        }
      } catch {
        this.logger.warn(`screencast video not found or unreadable for ${runId}`);
      }
    }

    const base = getRecordingsBaseDir(this.configService);
    const artifactDir = getRunArtifactDir(base, userId, runId);
    let thumbnailUrl: string | null = null;
    let recordingUrl: string | null = null;
    let sizeBytes: number | null = null;

    const runRow = await this.prisma.run.findUnique({ where: { id: runId } });
    const wallClockSec =
      runRow?.startedAt != null
        ? Math.max(0.5, (Date.now() - runRow.startedAt.getTime()) / 1000)
        : 0;

    try {
      if (rawVideoPath) {
        const { videoPath, sizeBytes: sz } = await copyRecordingVideoToArtifacts(rawVideoPath, artifactDir);
        sizeBytes = sz;
        await adjustRecordingVideoDurationToWallClock(videoPath, wallClockSec, this.logger);
        const stAfterTiming = await fs.stat(videoPath);
        sizeBytes = stAfterTiming.size;
        const thumbPath = path.join(artifactDir, 'thumbnail.jpg');
        const ffmpegOk = await writeJpegThumbnailFromVideo(videoPath, thumbPath, this.logger);
        if (!ffmpegOk && latestFrame) {
          await fs.writeFile(thumbPath, latestFrame);
        }
        thumbnailUrl = `/api/runs/${runId}/recording/thumbnail`;
        recordingUrl = `/api/runs/${runId}/recording/video`;
      } else if (latestFrame) {
        await fs.mkdir(artifactDir, { recursive: true });
        const thumbPath = path.join(artifactDir, 'thumbnail.jpg');
        await fs.writeFile(thumbPath, latestFrame);
        thumbnailUrl = `/api/runs/${runId}/recording/thumbnail`;
      }
    } catch (err) {
      this.logger.warn(`persist recording artifacts failed for ${runId}:`, err);
    }

    if (screencastVideo) {
      await removePathIfExists(screencastVideo.outputPath).catch(() => {});
    }

    const started = runRow?.startedAt;
    if (!started) {
      this.logger.warn(`stopRecording: run ${runId} missing startedAt; duration may be wrong`);
    }
    const run = await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        durationMs: started ? Math.round(Date.now() - started.getTime()) : 0,
        thumbnailUrl,
      },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });

    if (recordingUrl && sizeBytes != null) {
      await this.prisma.runRecording.create({
        data: {
          runId,
          userId,
          format: 'mp4',
          url: recordingUrl,
          sizeBytes,
        },
      });
    }

    this.emit('status', runId, { status: 'completed', runId });
    this.logger.log(`Recording stopped: ${runId}`);
    return run;
  }

  /**
   * Closes browser + session without marking the run completed (used when deleting a RECORDING run).
   */
  async abortRecordingForDeletion(runId: string, userId: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session) {
      return;
    }
    if (session.userId !== userId) {
      throw new ForbiddenException('Not allowed to end this recording session');
    }
    try {
      await session.cdpSession.send('Page.stopScreencast');
    } catch (err) {
      this.logger.warn(`abortRecordingForDeletion ${runId} stopScreencast:`, err);
    }
    if (session.screencastVideo) {
      session.screencastVideo.kill();
      await removePathIfExists(session.screencastVideo.outputPath).catch(() => {});
    }
    try {
      await session.browser.close();
    } catch (err) {
      this.logger.warn(`abortRecordingForDeletion ${runId} browser.close:`, err);
    }
    this.sessions.delete(runId);
    this.emit('status', runId, { status: 'cancelled', runId });
    this.logger.log(`Recording session aborted for delete: ${runId}`);
  }

  getRunArtifactFilePaths(runId: string, userId: string): {
    artifactDir: string;
    /** Preferred: H.264 MP4 (current encoder). */
    recordingVideoMp4: string;
    /** Legacy VP8 WebM from older runs. */
    recordingVideoWebm: string;
    thumbnailPath: string;
  } {
    const base = getRecordingsBaseDir(this.configService);
    const artifactDir = getRunArtifactDir(base, userId, runId);
    return {
      artifactDir,
      recordingVideoMp4: path.join(artifactDir, 'recording.mp4'),
      recordingVideoWebm: path.join(artifactDir, 'recording.webm'),
      thumbnailPath: path.join(artifactDir, 'thumbnail.jpg'),
    };
  }

  async deleteRunArtifactsFromDisk(runId: string, userId: string): Promise<void> {
    const { artifactDir } = this.getRunArtifactFilePaths(runId, userId);
    await removePathIfExists(artifactDir);
  }

  /**
   * One-shot Clerk + MailSlurp sign-in on the recording browser (server env credentials).
   * Appends **six** canonical TYPE/CLICK steps (labeled like the real flow) for playback skip
   * (`clerkAuthPhase` + `clerkAutoOneShot`); playback still runs one `performClerkPasswordEmail2FA`.
   */
  async clerkAutoSignInDuringRecording(
    runId: string,
    userId: string,
    opts?: { clerkOtpMode?: ClerkOtpMode },
  ) {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('No active recording session for this run');
    }
    const otpMode = opts?.clerkOtpMode ?? this.resolveClerkOtpMode(undefined);
    if (!this.playbackClerkAssistAvailable(otpMode)) {
      if (!this.playbackClerkCoreEnvReady()) {
        throw new BadRequestException(
          'Clerk test credentials are not fully configured on the API. Set E2E_CLERK_USER_PASSWORD, E2E_CLERK_USER_EMAIL or E2E_CLERK_USER_USERNAME (use +clerk_test in the email for test-email OTP mode), CLERK_SECRET_KEY (or PLAYBACK_CLERK_SECRET_KEY / E2E_CLERK_SECRET_KEY), and CLERK_PUBLISHABLE_KEY or VITE_CLERK_PUBLISHABLE_KEY.',
        );
      }
      throw new BadRequestException(
        'MailSlurp OTP mode requires MAILSLURP_API_KEY and MAILSLURP_INBOX_ID or MAILSLURP_INBOX_EMAIL.',
      );
    }
    const run = await this.prisma.run.findFirst({ where: { id: runId, userId } });
    if (!run) {
      throw new NotFoundException('Run not found');
    }
    const password = this.configService.get<string>('E2E_CLERK_USER_PASSWORD')!.trim();
    const identifier =
      this.configService.get<string>('E2E_CLERK_USER_USERNAME')?.trim() ||
      this.configService.get<string>('E2E_CLERK_USER_EMAIL')!.trim();
    const baseURL = this.playbackClerkBaseUrl(run.url);
    try {
      await performClerkPasswordEmail2FA(session.page, {
        baseURL,
        identifier,
        password,
        skipInitialNavigate: true,
        otpMode,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`clerkAutoSignInDuringRecording failed: ${msg}`);
      throw new ServiceUnavailableException(`Clerk automatic sign-in failed: ${msg}`);
    }
    let lastStep: RunStep | undefined;
    for (const row of CLERK_CANONICAL_SIGN_IN_STEPS) {
      const step = await this.recordStep(
        session,
        {
          action: row.action,
          selector: null,
          value: null,
          instruction: row.instruction,
          playwrightCode: row.playwrightCode,
          origin: 'MANUAL',
        },
        { syntheticClerkAutoSignIn: true },
      );
      this.emit('step', runId, step);
      lastStep = step;
    }
    /** Next TYPE step is often in-app email verification — tag as AUTOMATIC + clerkAuthPhase. */
    session.pendingPostClerkVerificationAutomaticUi = true;
    const seqLo = lastStep!.sequence - CLERK_CANONICAL_SIGN_IN_STEPS.length + 1;
    this.logger.log(
      `Recording ${runId}: clerk auto sign-in completed, canonical steps ${seqLo}–${lastStep!.sequence}`,
    );
    return { ok: true as const, step: lastStep! };
  }

  async executeInstruction(runId: string, userId: string, instruction: string) {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      throw new Error('No active recording session found');
    }

    const pageUrl = session.page.url();
    let accessibilityTree = '';
    try {
      const snapshot = await (session.page as any).accessibility?.snapshot();
      accessibilityTree = snapshot ? JSON.stringify(snapshot, null, 2) : await session.page.title();
    } catch {
      accessibilityTree = 'Unable to capture accessibility tree';
    }

    let screenshotBase64: string | undefined;
    try {
      const buf = await session.page.screenshot({ type: 'jpeg', quality: 60 });
      screenshotBase64 = buf.toString('base64');
    } catch {
      // Continue without screenshot
    }

    const llmResult = await this.llmService.instructionToAction({
      instruction,
      pageUrl,
      pageAccessibilityTree: accessibilityTree,
      screenshotBase64,
    });

    try {
      await this.executePwCode(session.page, llmResult.playwrightCode);
    } catch (err) {
      this.logger.error(`Playwright execution failed: ${err}`);
      throw new Error(`Failed to execute action: ${err}`);
    }

    await session.page.waitForLoadState('domcontentloaded').catch(() => {});

    const step = await this.recordStep(session, {
      action: (llmResult.action?.toUpperCase() || 'CUSTOM') as any,
      selector: llmResult.selector || null,
      value: llmResult.value || null,
      instruction,
      playwrightCode: llmResult.playwrightCode,
      origin: 'AI_DRIVEN',
    });

    this.emit('step', runId, step);
    return step;
  }

  /**
   * Re-capture a single step by natural-language instruction while recording (replaces row in place).
   * Origin/metadata follow the same Clerk/MailSlurp rules as new steps.
   */
  async reRecordStep(runId: string, userId: string, stepId: string, instruction: string) {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('No active recording session for this run');
    }
    const trimmed = instruction?.trim();
    if (!trimmed) {
      throw new BadRequestException('instruction is required');
    }

    const existing = await this.prisma.runStep.findFirst({
      where: { id: stepId, runId, userId },
    });
    if (!existing) {
      throw new NotFoundException('Step not found');
    }

    const pageUrl = session.page.url();
    let accessibilityTree = '';
    try {
      const snapshot = await (session.page as any).accessibility?.snapshot();
      accessibilityTree = snapshot ? JSON.stringify(snapshot, null, 2) : await session.page.title();
    } catch {
      accessibilityTree = 'Unable to capture accessibility tree';
    }

    let screenshotBase64: string | undefined;
    try {
      const buf = await session.page.screenshot({ type: 'jpeg', quality: 60 });
      screenshotBase64 = buf.toString('base64');
    } catch {
      /* continue */
    }

    const llmResult = await this.llmService.instructionToAction({
      instruction: trimmed,
      pageUrl,
      pageAccessibilityTree: accessibilityTree,
      screenshotBase64,
    });

    try {
      await this.executePwCode(session.page, llmResult.playwrightCode);
    } catch (err) {
      this.logger.error(`reRecordStep Playwright execution failed: ${err}`);
      throw new BadRequestException(`Failed to execute action: ${err}`);
    }

    await session.page.waitForLoadState('domcontentloaded').catch(() => {});

    const data = {
      action: (llmResult.action?.toUpperCase() || 'CUSTOM') as string,
      selector: llmResult.selector || null,
      value: llmResult.value || null,
      instruction: trimmed,
      playwrightCode: llmResult.playwrightCode,
      origin: 'AI_DRIVEN' as const,
    };

    const { metadata, origin, instruction: finalInstruction } = await this.buildStepPersistence(session, data, {
      stepSequenceHint: existing.sequence,
    });

    const step = await this.prisma.runStep.update({
      where: { id: stepId },
      data: {
        action: data.action as any,
        selector: data.selector,
        value: data.value,
        instruction: finalInstruction,
        playwrightCode: data.playwrightCode,
        origin: origin as any,
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        timestamp: new Date(),
      },
    });

    void this.persistCheckpointAfterStep(session, step).catch((err) => {
      this.logger.warn(`Checkpoint after re-record step ${step.sequence}: ${err}`);
    });

    this.emit('step', runId, step);
    this.logger.log(`Recording ${runId}: re-recorded step ${step.sequence} (${stepId})`);
    return step;
  }

  /** Forward pointer from the UI preview (canvas) into the Playwright page viewport. */
  async dispatchRemotePointer(
    runId: string,
    userId: string,
    payload: {
      kind: 'move' | 'down' | 'up' | 'wheel' | 'dblclick';
      x?: number;
      y?: number;
      button?: 'left' | 'right' | 'middle';
      deltaX?: number;
      deltaY?: number;
    },
  ): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      return;
    }

    const { page } = session;
    const vp = page.viewportSize() ?? { width: 1280, height: 720 };
    const rawX = payload.x ?? 0;
    const rawY = payload.y ?? 0;
    const x = Math.max(0, Math.min(rawX, vp.width - 1));
    const y = Math.max(0, Math.min(rawY, vp.height - 1));
    const button = payload.button ?? 'left';

    try {
      switch (payload.kind) {
        case 'move':
          await page.mouse.move(x, y);
          break;
        case 'down':
          await page.mouse.move(x, y);
          await page.mouse.down({ button });
          break;
        case 'up':
          await page.mouse.move(x, y);
          await page.mouse.up({ button });
          break;
        case 'wheel':
          await page.mouse.move(x, y);
          await page.mouse.wheel(payload.deltaX ?? 0, payload.deltaY ?? 0);
          break;
        case 'dblclick':
          await page.mouse.move(x, y);
          await page.mouse.click(x, y, { button, clickCount: 2, delay: 50 });
          break;
        default:
          break;
      }
    } catch (err) {
      this.logger.debug(`dispatchRemotePointer ${payload.kind}: ${err}`);
    }
  }

  /**
   * Real touch / swipe / pinch via CDP (mobile sites ignore mouse-only events).
   * touchPoints = active contacts still on screen after this event (Chrome CDP contract).
   */
  async dispatchRemoteTouch(
    runId: string,
    userId: string,
    payload: {
      type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';
      touchPoints: Array<{ id: number; x: number; y: number; force?: number }>;
    },
  ): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      return;
    }

    const vp = session.page.viewportSize() ?? { width: 1280, height: 720 };
    const points = payload.touchPoints.map((t) => {
      const x = Math.round(Math.max(0, Math.min(t.x, vp.width - 1)));
      const y = Math.round(Math.max(0, Math.min(t.y, vp.height - 1)));
      const force = Math.min(1, Math.max(0, t.force ?? 1));
      return {
        x,
        y,
        radiusX: 6,
        radiusY: 6,
        rotationAngle: 0,
        force,
        id: Math.floor(Math.abs(t.id)) % 0xffff,
      };
    });

    try {
      await session.cdpSession.send('Input.dispatchTouchEvent' as any, {
        type: payload.type,
        touchPoints: points,
        modifiers: 0,
      });
    } catch (err) {
      this.logger.debug(`dispatchRemoteTouch ${payload.type}: ${err}`);
    }
  }

  /** Insert text from the operator clipboard into the focused element in the remote page. */
  async insertRemoteClipboardText(runId: string, userId: string, text: string): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId || !text) {
      return;
    }
    try {
      await session.page.keyboard.insertText(text);
    } catch (err) {
      this.logger.debug(`insertRemoteClipboardText: ${err}`);
    }
  }

  /** Read selected text in the remote page (for copy to operator clipboard). */
  async getRemoteSelectionText(runId: string, userId: string): Promise<string> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      return '';
    }
    try {
      return await session.page.evaluate(
        "() => (typeof window !== 'undefined' && window.getSelection?.()?.toString()) || ''",
      );
    } catch {
      return '';
    }
  }

  /** Cut: return selected text and remove it in the remote DOM (operator clipboard). */
  async cutRemoteSelection(runId: string, userId: string): Promise<string> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      return '';
    }
    try {
      return await session.page.evaluate(`() => {
        const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
        if (!sel || sel.rangeCount === 0) return '';
        const t = sel.toString();
        if (!t) return '';
        sel.deleteFromDocument();
        return t;
      }`);
    } catch {
      return '';
    }
  }

  /** Forward keyboard from the focused preview into Playwright. */
  async dispatchRemoteKey(
    runId: string,
    userId: string,
    payload: { type: 'down' | 'up'; key: string },
  ): Promise<void> {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      return;
    }

    const pk = this.normalizePlaywrightKey(payload.key);
    if (!pk) {
      return;
    }

    try {
      if (payload.type === 'down') {
        await session.page.keyboard.down(pk);
      } else {
        await session.page.keyboard.up(pk);
      }
    } catch (err) {
      this.logger.debug(`dispatchRemoteKey ${payload.type} ${pk}: ${err}`);
    }
  }

  private normalizePlaywrightKey(key: string): string | null {
    if (!key || key === 'Unidentified' || key === 'Dead') {
      return null;
    }
    if (key === ' ') {
      return ' ';
    }
    return key;
  }

  private static readonly MAILSLURP_INSTRUCTION_PREFIX = '[MailSlurp automation] ';

  /** Prefix human-readable copy for Clerk/MailSlurp-tagged steps (idempotent). */
  private applyMailSlurpInstructionPrefix(instruction: string): string {
    const t = instruction.trim();
    if (!t) return instruction;
    if (/^\[MailSlurp automation\]/i.test(t)) return instruction;
    if (/MailSlurp automation/i.test(t)) return instruction;
    return `${RecordingService.MAILSLURP_INSTRUCTION_PREFIX}${instruction}`;
  }

  /**
   * Computes metadata (clerkAuthPhase), final origin (AUTOMATIC vs caller), and instruction copy.
   * Playback skip uses metadata.clerkAuthPhase; AUTOMATIC is for UI labeling only.
   */
  private async buildStepPersistence(
    session: RecordingSession,
    data: {
      action: string;
      selector: string | null;
      value: string | null;
      instruction: string;
      playwrightCode: string;
      origin: 'MANUAL' | 'AI_DRIVEN';
    },
    opts?: {
      syntheticClerkAutoSignIn?: boolean;
      /** Re-record path: use the DB step’s sequence (session.stepSequence may not match). */
      stepSequenceHint?: number;
    },
  ): Promise<{
    metadata: Record<string, unknown> | undefined;
    origin: 'MANUAL' | 'AI_DRIVEN' | 'AUTOMATIC';
    instruction: string;
  }> {
    let metadata: Record<string, unknown> | undefined;
    if (opts?.syntheticClerkAutoSignIn) {
      metadata = { clerkAuthPhase: true, clerkAutoOneShot: true };
    } else {
      const clerkAuthPhase = await this.computeClerkAuthPhaseForRecording(session, data);
      metadata = clerkAuthPhase ? { clerkAuthPhase: true } : undefined;
    }
    /** After server Clerk+MailSlurp, the next captured TYPE is usually email/OTP verification. */
    if (
      session.pendingPostClerkVerificationAutomaticUi &&
      data.action === 'TYPE' &&
      !opts?.syntheticClerkAutoSignIn
    ) {
      metadata = { ...metadata, clerkAuthPhase: true };
      session.pendingPostClerkVerificationAutomaticUi = false;
    }
    const isAutomatic = !!(
      opts?.syntheticClerkAutoSignIn ||
      (metadata && (metadata as { clerkAuthPhase?: boolean }).clerkAuthPhase === true)
    );
    const sequenceForOrigin = opts?.stepSequenceHint ?? session.stepSequence;
    /** First step “load the app” — always AUTOMATIC for UI; does not set clerkAuthPhase (playback unchanged). */
    const isInitialAppNavigate = sequenceForOrigin === 1 && data.action === 'NAVIGATE';
    const originAutomatic = isAutomatic || isInitialAppNavigate;
    const finalOrigin: 'MANUAL' | 'AI_DRIVEN' | 'AUTOMATIC' = originAutomatic ? 'AUTOMATIC' : data.origin;
    const finalInstruction = isAutomatic
      ? this.applyMailSlurpInstructionPrefix(data.instruction)
      : data.instruction;
    return { metadata, origin: finalOrigin, instruction: finalInstruction };
  }

  private async recordStep(
    session: RecordingSession,
    data: {
      action: string;
      selector: string | null;
      value: string | null;
      instruction: string;
      playwrightCode: string;
      origin: 'MANUAL' | 'AI_DRIVEN';
    },
    opts?: {
      syntheticClerkAutoSignIn?: boolean;
      stepSequenceHint?: number;
    },
  ) {
    session.stepSequence += 1;

    const { metadata, origin, instruction } = await this.buildStepPersistence(session, data, opts);

    const step = await this.prisma.runStep.create({
      data: {
        runId: session.runId,
        userId: session.userId,
        sequence: session.stepSequence,
        action: data.action as any,
        selector: data.selector,
        value: data.value,
        instruction,
        playwrightCode: data.playwrightCode,
        origin: origin as any,
        timestamp: new Date(),
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    void this.persistCheckpointAfterStep(session, step).catch((err) => {
      this.logger.warn(`Checkpoint after step ${step.sequence}: ${err}`);
    });

    return step;
  }

  /**
   * Saves Playwright `storageState` + DB row for “app state” labels (best-effort; prefix replay is still authoritative).
   * Disabled when `RECORDING_CHECKPOINTS=false`.
   */
  private async persistCheckpointAfterStep(session: RecordingSession, step: RunStep): Promise<void> {
    const raw = this.configService.get<string>('RECORDING_CHECKPOINTS', 'true').toLowerCase();
    if (raw === 'false' || raw === '0' || raw === 'no') return;

    const base = getRecordingsBaseDir(this.configService);
    const artifactDir = getRunArtifactDir(base, session.userId, session.runId);
    await fs.mkdir(artifactDir, { recursive: true });

    const fileName = `checkpoint-${step.sequence}.json`;
    const absPath = path.join(artifactDir, fileName);
    try {
      await session.page.context().storageState({ path: absPath });
    } catch (err) {
      this.logger.warn(`storageState failed for step ${step.sequence}: ${err}`);
      return;
    }

    let pageUrl: string | undefined;
    try {
      pageUrl = session.page.url();
    } catch {
      /* ignore */
    }

    let thumbName: string | undefined;
    try {
      const thumbFile = `checkpoint-${step.sequence}.jpg`;
      const thumbPath = path.join(artifactDir, thumbFile);
      const buf = await session.page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
      await fs.writeFile(thumbPath, buf);
      thumbName = thumbFile;
    } catch {
      /* best-effort */
    }

    try {
      await this.prisma.runCheckpoint.deleteMany({
        where: { runId: session.runId, afterStepSequence: step.sequence },
      });
      await this.prisma.runCheckpoint.create({
        data: {
          runId: session.runId,
          userId: session.userId,
          afterStepSequence: step.sequence,
          label: `After step ${step.sequence}`,
          pageUrl: pageUrl ?? null,
          storageStatePath: fileName,
          thumbnailPath: thumbName ?? null,
        },
      });
    } catch (dbErr) {
      this.logger.warn(`Checkpoint DB write failed for step ${step.sequence}: ${dbErr}`);
    }
  }

  /** True while URL or visible UI looks like Clerk sign-in (tags step for playback skip + auto auth). */
  private async computeClerkAuthPhaseForRecording(
    session: RecordingSession,
    data: { action: string; value: string | null },
  ): Promise<boolean> {
    if (data.action === 'NAVIGATE' && data.value && clerkSignInUrlLooksLike(String(data.value))) {
      return true;
    }
    try {
      if (clerkSignInUrlLooksLike(session.page.url())) {
        return true;
      }
    } catch {
      /* ignore */
    }
    try {
      return await detectClerkSignInUi(session.page);
    } catch {
      return false;
    }
  }

  /** CDP screencast → `emit('frame', frameChannelId, base64Jpeg)` */
  private async attachScreencast(
    cdpSession: CDPSession,
    latestFrameHolder: { latestFrame: Buffer | null },
    frameChannelId: string,
    opts?: { onJpegFrame?: (jpeg: Buffer) => void },
  ) {
    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: 1280,
      maxHeight: 720,
      /** 1 = every frame — static pages still get regular preview updates (was 3, felt “stuck” until input). */
      everyNthFrame: 1,
    });

    cdpSession.on('Page.screencastFrame', async (params: any) => {
      const buf = Buffer.from(params.data, 'base64');
      latestFrameHolder.latestFrame = buf;
      opts?.onJpegFrame?.(buf);

      await cdpSession.send('Page.screencastFrameAck', {
        sessionId: params.sessionId,
      });

      this.emit('frame', frameChannelId, params.data);
    });
  }

  /**
   * Replay stored steps in a new browser session; returns immediately while playback runs async.
   * Clients join socket room `run:<playbackSessionId>`.
   */
  async startPlayback(
    userId: string,
    sourceRunId: string,
    opts?: StartPlaybackServiceOpts,
  ): Promise<{ playbackSessionId: string; sourceRunId: string }> {
    const run = await this.prisma.run.findFirst({
      where: { id: sourceRunId, userId },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });

    if (!run) {
      throw new NotFoundException(`Run ${sourceRunId} not found`);
    }
    if (run.status === 'RECORDING') {
      throw new ConflictException('Run is still recording; wait until it completes before playback');
    }
    if (!run.steps.length) {
      throw new BadRequestException('This run has no recorded steps to play back');
    }

    const playbackSessionId = randomUUID();
    const delayMs = Math.min(5000, Math.max(0, opts?.delayMs ?? 600));
    const envAutoRaw = this.configService.get<string>('PLAYBACK_AUTO_CLERK_SIGNIN', '').trim().toLowerCase();
    const envAutoOn = envAutoRaw === 'true' || envAutoRaw === '1' || envAutoRaw === 'yes';
    const envExplicitlyOff =
      envAutoRaw === 'false' || envAutoRaw === '0' || envAutoRaw === 'no';
    /** When env is unset and the client omits `autoClerkSignIn`, default ON (matches UI "Server default" + MailSlurp parity). */
    const wantAutoClerkSignIn =
      opts?.autoClerkSignIn !== undefined
        ? opts.autoClerkSignIn
        : envExplicitlyOff
          ? false
          : envAutoOn || envAutoRaw === '';
    const skipSet = buildPlaybackSkipSet({
      steps: run.steps.map((s) => ({
        id: s.id,
        sequence: s.sequence,
        metadata: s.metadata,
        action: s.action,
        value: s.value,
        origin: s.origin,
        instruction: s.instruction,
        playwrightCode: s.playwrightCode,
      })),
      wantAutoClerkSkip: wantAutoClerkSignIn,
      skipUntilSequence: opts?.skipUntilSequence,
      skipStepIds: opts?.skipStepIds,
      runUrl: run.url,
    });
    const workerUrl = this.configService.get<string>('BROWSER_WORKER_URL', 'ws://localhost:3002');

    let wsEndpoint: string;
    let browser: Browser;
    try {
      wsEndpoint = await this.requestBrowserFromWorker(workerUrl);
      browser = await chromium.connect(wsEndpoint);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(
        `Playback could not start (browser worker / Playwright). ${detail}`,
      );
    }

    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
      });
      const page = await context.newPage();
      const cdpSession = await context.newCDPSession(page);

      const session: PlaybackSession = {
        playbackSessionId,
        sourceRunId,
        userId,
        browser,
        page,
        cdpSession,
        latestFrame: null,
        paused: false,
        playbackResumeWaiters: [],
      };

      this.playbackSessions.set(playbackSessionId, session);
      await this.attachScreencast(cdpSession, session, playbackSessionId);

      const steps = run.steps;
      /** Zero-state load — aligns with recording; redundant first NAVIGATE is skipped via `skipSet`. */
      await page.goto(run.url, { waitUntil: 'domcontentloaded' });

      const clerkOtpMode = this.resolveClerkOtpMode(opts);
      void this.runPlaybackLoop(playbackSessionId, session, steps, delayMs, sourceRunId, run.url, {
        wantAutoClerkSignIn,
        clerkOtpMode,
        skipSet,
        playThroughSequence: opts?.playThroughSequence,
      });

      this.logger.log(`Playback started: ${playbackSessionId} (source ${sourceRunId})`);
      return { playbackSessionId, sourceRunId };
    } catch (err) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
      this.playbackSessions.delete(playbackSessionId);
      if (err instanceof HttpException) {
        throw err;
      }
      const detail = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(`Playback setup failed. ${detail}`);
    }
  }

  async pausePlayback(playbackSessionId: string, userId: string): Promise<boolean> {
    const session = this.playbackSessions.get(playbackSessionId);
    if (!session || session.userId !== userId) {
      return false;
    }
    session.paused = true;
    this.emit('status', playbackSessionId, {
      status: 'playback_paused',
      runId: playbackSessionId,
      sourceRunId: session.sourceRunId,
    });
    return true;
  }

  async resumePlayback(playbackSessionId: string, userId: string): Promise<boolean> {
    const session = this.playbackSessions.get(playbackSessionId);
    if (!session || session.userId !== userId) {
      return false;
    }
    session.paused = false;
    const waiters = session.playbackResumeWaiters.splice(0);
    for (const w of waiters) {
      try {
        w();
      } catch {
        /* ignore */
      }
    }
    this.emit('status', playbackSessionId, {
      status: 'playback',
      runId: playbackSessionId,
      sourceRunId: session.sourceRunId,
    });
    return true;
  }

  async stopPlayback(playbackSessionId: string, userId: string): Promise<boolean> {
    const session = this.playbackSessions.get(playbackSessionId);
    if (!session || session.userId !== userId) {
      return false;
    }
    await this.cleanupPlaybackSession(playbackSessionId, session);
    this.emit('status', playbackSessionId, {
      status: 'stopped',
      runId: playbackSessionId,
      sourceRunId: session.sourceRunId,
    });
    return true;
  }

  private async runPlaybackLoop(
    playbackSessionId: string,
    session: PlaybackSession,
    steps: RunStep[],
    delayMs: number,
    sourceRunId: string,
    runUrl: string,
    ctx: {
      wantAutoClerkSignIn: boolean;
      clerkOtpMode: ClerkOtpMode;
      skipSet: Set<string>;
      playThroughSequence?: number;
    },
  ) {
    const clerkPlaybackState = { clerkFullSignInDone: false };

    try {
      this.emit('status', playbackSessionId, {
        status: 'playback',
        runId: playbackSessionId,
        sourceRunId,
      });

      await this.maybePlaybackClerkAuthAssist(
        session,
        runUrl,
        ctx.wantAutoClerkSignIn,
        ctx.clerkOtpMode,
        clerkPlaybackState,
      );

      for (const step of steps) {
        if (ctx.playThroughSequence != null && step.sequence > ctx.playThroughSequence) {
          break;
        }

        await this.waitUntilPlaybackNotPaused(session);

        const stepPayload = {
          id: step.id,
          sequence: step.sequence,
          action: step.action,
          instruction: step.instruction,
        };

        const skipped =
          ctx.skipSet.has(step.id) ||
          shouldSkipStoredPlaywrightForClerk(
            {
              id: step.id,
              sequence: step.sequence,
              metadata: step.metadata,
              action: step.action,
              value: step.value,
              origin: step.origin,
              instruction: step.instruction,
              playwrightCode: step.playwrightCode,
            },
            ctx.wantAutoClerkSignIn,
          );

        this.emit('playbackProgress', playbackSessionId, {
          playbackSessionId,
          sourceRunId,
          step: stepPayload,
          phase: 'before',
        });

        if (skipped) {
          this.emit('playbackProgress', playbackSessionId, {
            playbackSessionId,
            sourceRunId,
            step: stepPayload,
            phase: 'skipped',
          });
          await this.maybePlaybackClerkAuthAssist(
            session,
            runUrl,
            ctx.wantAutoClerkSignIn,
            ctx.clerkOtpMode,
            clerkPlaybackState,
          );
          await this.sleepWithPause(session, delayMs);
          continue;
        }

        try {
          await this.executePwCode(session.page, step.playwrightCode);
        } catch (execErr) {
          const msg = execErr instanceof Error ? execErr.message : String(execErr);
          this.logger.warn(`Playback step ${step.sequence} failed: ${msg}`);
          this.emit('playbackProgress', playbackSessionId, {
            playbackSessionId,
            sourceRunId,
            step: stepPayload,
            phase: 'error',
            error: msg,
          });
          this.emit('status', playbackSessionId, {
            status: 'failed',
            runId: playbackSessionId,
            sourceRunId,
            error: msg,
          });
          await this.cleanupPlaybackSession(playbackSessionId, session);
          return;
        }

        await this.maybePlaybackClerkAuthAssist(
          session,
          runUrl,
          ctx.wantAutoClerkSignIn,
          ctx.clerkOtpMode,
          clerkPlaybackState,
        );

        await session.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.sleepWithPause(session, delayMs);
        this.emit('playbackProgress', playbackSessionId, {
          playbackSessionId,
          sourceRunId,
          step: stepPayload,
          phase: 'after',
        });
      }

      this.emit('status', playbackSessionId, {
        status: 'completed',
        runId: playbackSessionId,
        sourceRunId,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Playback loop error: ${msg}`);
      this.emit('status', playbackSessionId, {
        status: 'failed',
        runId: playbackSessionId,
        sourceRunId,
        error: msg,
      });
    } finally {
      const still = this.playbackSessions.get(playbackSessionId);
      if (still) {
        await this.cleanupPlaybackSession(playbackSessionId, still);
      }
    }
  }

  private async cleanupPlaybackSession(playbackSessionId: string, session: PlaybackSession) {
    session.paused = false;
    const waiters = session.playbackResumeWaiters.splice(0);
    for (const w of waiters) {
      try {
        w();
      } catch {
        /* ignore */
      }
    }
    this.playbackSessions.delete(playbackSessionId);
    try {
      await session.cdpSession.send('Page.stopScreencast').catch(() => {});
    } catch {
      /* ignore */
    }
    try {
      await session.browser.close();
    } catch (err) {
      this.logger.warn('Error closing playback browser', err);
    }
  }

  private sleep(ms: number): Promise<void> {
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  private async waitUntilPlaybackNotPaused(session: PlaybackSession): Promise<void> {
    while (session.paused) {
      await new Promise<void>((resolve) => {
        session.playbackResumeWaiters.push(resolve);
      });
    }
  }

  /** Like `sleep` but respects pause (and can resume mid-wait). */
  private async sleepWithPause(session: PlaybackSession, ms: number): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      await this.waitUntilPlaybackNotPaused(session);
      const remaining = end - Date.now();
      if (remaining <= 0) break;
      await this.sleep(Math.min(100, remaining));
    }
  }

  /** Clerk user + keys (no MailSlurp). */
  private playbackClerkCoreEnvReady(): boolean {
    const password = this.configService.get<string>('E2E_CLERK_USER_PASSWORD')?.trim();
    const identifier =
      this.configService.get<string>('E2E_CLERK_USER_USERNAME')?.trim() ||
      this.configService.get<string>('E2E_CLERK_USER_EMAIL')?.trim();
    const secret =
      this.configService.get<string>('PLAYBACK_CLERK_SECRET_KEY')?.trim() ||
      this.configService.get<string>('E2E_CLERK_SECRET_KEY')?.trim() ||
      this.configService.get<string>('CLERK_SECRET_KEY')?.trim();
    const pub =
      this.configService.get<string>('CLERK_PUBLISHABLE_KEY')?.trim() ||
      this.configService.get<string>('VITE_CLERK_PUBLISHABLE_KEY')?.trim();
    return !!(password && identifier && secret && pub);
  }

  private playbackClerkMailSlurpEnvReady(): boolean {
    const mailslurp = this.configService.get<string>('MAILSLURP_API_KEY')?.trim();
    const inbox =
      this.configService.get<string>('MAILSLURP_INBOX_ID')?.trim() ||
      this.configService.get<string>('MAILSLURP_INBOX_EMAIL')?.trim();
    return !!(mailslurp && inbox);
  }

  private playbackClerkAssistAvailable(mode: ClerkOtpMode): boolean {
    if (!this.playbackClerkCoreEnvReady()) return false;
    if (mode === 'mailslurp') return this.playbackClerkMailSlurpEnvReady();
    return true;
  }

  private resolveClerkOtpMode(opts?: StartPlaybackServiceOpts): ClerkOtpMode {
    if (opts?.clerkOtpMode) return opts.clerkOtpMode;
    const raw = this.configService.get<string>('PLAYBACK_CLERK_OTP_MODE', '').trim().toLowerCase();
    if (raw === 'clerk_test_email' || raw === 'test_email') return 'clerk_test_email';
    if (raw === 'mailslurp' || raw === 'mail_slurp') return 'mailslurp';
    return 'mailslurp';
  }

  private playbackClerkBaseUrl(runUrl: string): string {
    try {
      return new URL(runUrl).origin;
    } catch {
      return runUrl.replace(/\/$/, '');
    }
  }

  private async runPlaybackClerkAutoSignIn(
    page: Page,
    runUrl: string,
    otpMode: ClerkOtpMode,
  ): Promise<void> {
    const password = this.configService.get<string>('E2E_CLERK_USER_PASSWORD')!.trim();
    const identifier =
      this.configService.get<string>('E2E_CLERK_USER_USERNAME')?.trim() ||
      this.configService.get<string>('E2E_CLERK_USER_EMAIL')!.trim();
    const baseURL = this.playbackClerkBaseUrl(runUrl);
    await performClerkPasswordEmail2FA(page, {
      baseURL,
      identifier,
      password,
      skipInitialNavigate: true,
      otpMode,
    });
    this.logger.log(`Playback: Clerk auto sign-in completed (otpMode=${otpMode})`);
  }

  /**
   * Clerk sign-in assist: test email (+clerk_test, code 424242) or MailSlurp inbox, when UI shows sign-in or OTP-only.
   */
  private async maybePlaybackClerkAuthAssist(
    session: PlaybackSession,
    runUrl: string,
    wantAuto: boolean,
    otpMode: ClerkOtpMode,
    state: { clerkFullSignInDone: boolean },
  ): Promise<void> {
    const assistOk = this.playbackClerkAssistAvailable(otpMode);
    if (!wantAuto || !assistOk) {
      return;
    }
    try {
      const page = session.page;
      const identifier = page.locator('input[name="identifier"], #identifier-field').first();
      const idVisible = await identifier.isVisible().catch(() => false);
      const otpVisible = await detectClerkOtpInputVisible(page);

      /**
       * OTP locator matches any `input[inputmode="numeric"]` etc. — common on post-login UIs.
       * Only run MailSlurp / test-email OTP assist when the page URL looks like Clerk or /login.
       */
      if (otpVisible && !idVisible) {
        if (state.clerkFullSignInDone) {
          return;
        }
        let pageUrl = '';
        try {
          pageUrl = page.url();
        } catch {
          return;
        }
        if (!clerkSignInUrlLooksLike(pageUrl)) {
          this.logger.debug(
            `Playback: skip OTP-only Clerk assist (URL does not look like sign-in: ${pageUrl})`,
          );
          return;
        }
        if (otpMode === 'mailslurp') {
          await fillClerkOtpFromMailSlurp(page, {
            runUrl,
            notBeforeMs: Date.now() - 5_000,
          });
        } else {
          await fillClerkOtpFromClerkTestEmail(page, { runUrl });
        }
        return;
      }

      if (!state.clerkFullSignInDone && (await detectClerkSignInUi(page))) {
        let pageUrl = '';
        try {
          pageUrl = page.url();
        } catch {
          return;
        }
        /**
         * detectClerkSignInUi falls back to OTP-visible-only; that matches non-Clerk numeric fields.
         * Require sign-in-like URL unless the email identifier field is visible (strong Clerk signal).
         */
        if (!idVisible && !clerkSignInUrlLooksLike(pageUrl)) {
          this.logger.debug(
            `Playback: skip full Clerk sign-in assist (URL not sign-in-like: ${pageUrl})`,
          );
          return;
        }
        await this.runPlaybackClerkAutoSignIn(page, runUrl, otpMode);
        state.clerkFullSignInDone = true;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Playback Clerk auth assist failed: ${msg}`);
    }
  }

  private async setupEventCapture(session: RecordingSession) {
    await session.page.exposeFunction(
      '__bladerunnerRecordAction',
      async (actionData: string) => {
        try {
          const data = JSON.parse(actionData);
          let accessibilityTree = '';
          try {
            const snapshot = await (session.page as any).accessibility?.snapshot();
            accessibilityTree = snapshot ? JSON.stringify(snapshot, null, 2) : '';
          } catch {}

          const translated = await this.llmService.actionToInstruction({
            action: data.type,
            selector: data.selector || '',
            elementHtml: data.elementHtml || '',
            value: data.value,
            pageAccessibilityTree: accessibilityTree,
          });

          const playwrightCode = preferRecordedCssSelectorForBarePageLocator(
            data.selector,
            translated.playwrightCode,
          );

          const step = await this.recordStep(session, {
            action: (data.type?.toUpperCase() || 'CUSTOM') as any,
            selector: data.selector,
            value: data.value,
            instruction: translated.instruction,
            playwrightCode,
            origin: 'MANUAL',
          });

          this.emit('step', session.runId, step);
        } catch (err) {
          this.logger.error('Event capture failed', err);
        }
      },
    );

    await session.page.addInitScript(`
      (function() {
        function getSelector(el) {
          if (el.id) return '#' + el.id;
          if (el.getAttribute && el.getAttribute('data-testid'))
            return '[data-testid="' + el.getAttribute('data-testid') + '"]';
          var tag = el.tagName ? el.tagName.toLowerCase() : 'unknown';
          var cls = el.className
            ? '.' + el.className.toString().trim().split(/\\s+/).join('.')
            : '';
          return tag + cls;
        }

        function getElementHtml(el) {
          var clone = el.cloneNode(false);
          return clone.outerHTML ? clone.outerHTML.slice(0, 200) : '';
        }

        document.addEventListener('click', function(e) {
          var target = e.target;
          if (!target || !window.__bladerunnerRecordAction) return;
          window.__bladerunnerRecordAction(
            JSON.stringify({
              type: 'click',
              selector: getSelector(target),
              elementHtml: getElementHtml(target),
              value: null
            })
          );
        }, true);

        document.addEventListener('input', function(e) {
          var target = e.target;
          if (!target || !window.__bladerunnerRecordAction) return;
          clearTimeout(target.__brDebounce);
          target.__brDebounce = setTimeout(function() {
            window.__bladerunnerRecordAction(
              JSON.stringify({
                type: 'type',
                selector: getSelector(target),
                elementHtml: getElementHtml(target),
                value: target.value
              })
            );
          }, 500);
        }, true);
      })();
    `);
  }

  /**
   * LLM-generated steps sometimes use `page.locator('span')` etc., which matches many nodes and
   * throws strict mode violation on click/fill. Append `.first()` when the chain does not already
   * narrow (first/nth/filter/locator/getBy).
   */
  private relaxPlaywrightCodegenForPlayback(code: string): string {
    const alreadyNarrowed = String.raw`(?!\s*\.(?:first|nth|filter|locator|last|getBy))`;
    const pattern = String.raw`\bpage\.locator\s*\(\s*(['"\`])(span|div|p|a|button|input)\1\s*\)${alreadyNarrowed}`;
    const re = new RegExp(pattern, 'gi');
    return code.replace(re, (_full, quote: string, tag: string) => `page.locator(${quote}${tag}${quote}).first()`);
  }

  private async executePwCode(page: Page, code: string): Promise<void> {
    const forbidden = ['require(', 'import ', 'process.', 'fs.', 'child_process', 'eval('];
    for (const f of forbidden) {
      if (code.includes(f)) {
        throw new Error(`Forbidden operation in generated code: ${f}`);
      }
    }

    const safeCode = escapeLocatorCssInPlaywrightSnippet(this.relaxPlaywrightCodegenForPlayback(code));
    const fn = new Function('page', `return (async () => { ${safeCode} })();`);
    await fn(page);
  }

  private requestBrowserFromWorker(workerUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(workerUrl);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('Browser worker connection timeout'));
      }, 15000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'launch' }));
      });

      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'launch:result' && msg.wsEndpoint) {
          clearTimeout(timeout);
          ws.close();
          resolve(msg.wsEndpoint);
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          ws.close();
          reject(new Error(msg.error));
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }
}
