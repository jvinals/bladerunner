import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  NotFoundException,
  ConflictException,
  BadRequestException,
  HttpException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser, Page, CDPSession } from 'playwright-core';
import type { RunStep, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { EventEmitter } from 'events';
import {
  clerkSignInUrlLooksLike,
  detectClerkSignInUi,
  performClerkPasswordEmail2FA,
} from '@bladerunner/clerk-agentmail-signin';
import { buildPlaybackSkipSet } from './playback-skip.util';

export type StartPlaybackServiceOpts = {
  delayMs?: number;
  autoClerkSignIn?: boolean;
  skipUntilSequence?: number;
  skipStepIds?: string[];
};

export interface RecordingSession {
  runId: string;
  userId: string;
  browser: Browser;
  page: Page;
  cdpSession: CDPSession;
  stepSequence: number;
  latestFrame: Buffer | null;
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

  async startRecording(userId: string, name: string, url: string) {
    const run = await this.prisma.run.create({
      data: {
        userId,
        name,
        url,
        status: 'RECORDING',
        platform: 'DESKTOP',
        startedAt: new Date(),
      },
    });

    const workerUrl = this.configService.get<string>('BROWSER_WORKER_URL', 'ws://localhost:3002');

    try {
      const wsEndpoint = await this.requestBrowserFromWorker(workerUrl);
      const browser = await chromium.connect(wsEndpoint);
      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
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
      };

      this.sessions.set(run.id, session);

      await this.attachScreencast(session.cdpSession, session, session.runId);
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

    try {
      await session.cdpSession.send('Page.stopScreencast');
      await session.browser.close();
    } catch (err) {
      this.logger.warn('Error closing browser', err);
    }

    this.sessions.delete(runId);

    const run = await this.prisma.run.update({
      where: { id: runId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        durationMs: Math.round(
          Date.now() - (await this.prisma.run.findUnique({ where: { id: runId } }))!.startedAt!.getTime(),
        ),
      },
      include: { steps: { orderBy: { sequence: 'asc' } } },
    });

    this.emit('status', runId, { status: 'completed', runId });
    this.logger.log(`Recording stopped: ${runId}`);
    return run;
  }

  /**
   * One-shot Clerk + AgentMail sign-in on the recording browser (server env credentials).
   * Appends a CUSTOM step tagged for playback skip (`clerkAuthPhase` + `clerkAutoOneShot`).
   */
  async clerkAutoSignInDuringRecording(runId: string, userId: string) {
    const session = this.sessions.get(runId);
    if (!session || session.userId !== userId) {
      throw new NotFoundException('No active recording session for this run');
    }
    if (!this.playbackClerkEnvReady()) {
      throw new BadRequestException(
        'Clerk + AgentMail is not fully configured on the API. Set E2E_CLERK_USER_PASSWORD, E2E_CLERK_USER_EMAIL or E2E_CLERK_USER_USERNAME, CLERK_SECRET_KEY (or PLAYBACK_CLERK_SECRET_KEY / E2E_CLERK_SECRET_KEY for a different target Clerk app), CLERK_PUBLISHABLE_KEY or VITE_CLERK_PUBLISHABLE_KEY, AGENTMAIL_API_KEY, and E2E_AGENTMAIL_INBOX_ID or E2E_AGENTMAIL_INBOX_EMAIL (same as E2E).',
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
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`clerkAutoSignInDuringRecording failed: ${msg}`);
      throw new ServiceUnavailableException(`Clerk automatic sign-in failed: ${msg}`);
    }
    const step = await this.recordStep(
      session,
      {
        action: 'CUSTOM',
        selector: null,
        value: null,
        instruction: 'Clerk sign-in (automatic — server used test credentials + AgentMail OTP)',
        playwrightCode: `await page.waitForLoadState('domcontentloaded').catch(() => {});`,
        origin: 'MANUAL',
      },
      { syntheticClerkAutoSignIn: true },
    );
    this.emit('step', runId, step);
    this.logger.log(`Recording ${runId}: clerk auto sign-in completed, step ${step.sequence}`);
    return { ok: true as const, step };
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
    opts?: { syntheticClerkAutoSignIn?: boolean },
  ) {
    session.stepSequence += 1;

    let metadata: Record<string, unknown> | undefined;
    if (opts?.syntheticClerkAutoSignIn) {
      metadata = { clerkAuthPhase: true, clerkAutoOneShot: true };
    } else {
      const clerkAuthPhase = await this.computeClerkAuthPhaseForRecording(session, data);
      metadata = clerkAuthPhase ? { clerkAuthPhase: true } : undefined;
    }

    const step = await this.prisma.runStep.create({
      data: {
        runId: session.runId,
        userId: session.userId,
        sequence: session.stepSequence,
        action: data.action as any,
        selector: data.selector,
        value: data.value,
        instruction: data.instruction,
        playwrightCode: data.playwrightCode,
        origin: data.origin as any,
        timestamp: new Date(),
        metadata: (metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    return step;
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
  ) {
    await cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: 1280,
      maxHeight: 720,
      everyNthFrame: 3,
    });

    cdpSession.on('Page.screencastFrame', async (params: any) => {
      latestFrameHolder.latestFrame = Buffer.from(params.data, 'base64');

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
    const envAutoRaw = this.configService.get<string>('PLAYBACK_AUTO_CLERK_SIGNIN', '').toLowerCase();
    const envAutoOn = envAutoRaw === 'true' || envAutoRaw === '1' || envAutoRaw === 'yes';
    const wantAutoClerkSignIn =
      opts?.autoClerkSignIn !== undefined ? opts.autoClerkSignIn : envAutoOn;
    const skipSet = buildPlaybackSkipSet({
      steps: run.steps.map((s) => ({ id: s.id, sequence: s.sequence, metadata: s.metadata })),
      wantAutoClerkSkip: wantAutoClerkSignIn,
      skipUntilSequence: opts?.skipUntilSequence,
      skipStepIds: opts?.skipStepIds,
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
      };

      this.playbackSessions.set(playbackSessionId, session);
      await this.attachScreencast(cdpSession, session, playbackSessionId);

      const steps = run.steps;
      const first = steps[0];
      const firstLooksLikeNavigate =
        first.action === 'NAVIGATE' ||
        new RegExp('page\\.goto\\s*\\(', 'i').test(first.playwrightCode || '');
      if (!firstLooksLikeNavigate) {
        await page.goto(run.url, { waitUntil: 'domcontentloaded' });
      }

      void this.runPlaybackLoop(playbackSessionId, session, steps, delayMs, sourceRunId, run.url, {
        wantAutoClerkSignIn,
        skipSet,
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
    ctx: { wantAutoClerkSignIn: boolean; skipSet: Set<string> },
  ) {
    let clerkAutoSignInDone = false;

    try {
      this.emit('status', playbackSessionId, {
        status: 'playback',
        runId: playbackSessionId,
        sourceRunId,
      });

      if (ctx.wantAutoClerkSignIn && this.playbackClerkEnvReady()) {
        try {
          if (await detectClerkSignInUi(session.page)) {
            await this.runPlaybackClerkAutoSignIn(session.page, runUrl);
            clerkAutoSignInDone = true;
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          this.logger.warn(`Playback Clerk auto sign-in (pre-loop) failed: ${msg}`);
        }
      }

      for (const step of steps) {
        const stepPayload = {
          id: step.id,
          sequence: step.sequence,
          action: step.action,
          instruction: step.instruction,
        };

        const skipped = ctx.skipSet.has(step.id);

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
          await this.sleep(delayMs);
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

        if (ctx.wantAutoClerkSignIn && !clerkAutoSignInDone && this.playbackClerkEnvReady()) {
          try {
            if (await detectClerkSignInUi(session.page)) {
              await this.runPlaybackClerkAutoSignIn(session.page, runUrl);
              clerkAutoSignInDone = true;
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.logger.warn(`Playback Clerk auto sign-in (post-step) failed: ${msg}`);
          }
        }

        await session.page.waitForLoadState('domcontentloaded').catch(() => {});
        await this.sleep(delayMs);
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

  private playbackClerkEnvReady(): boolean {
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
    const agentmail = this.configService.get<string>('AGENTMAIL_API_KEY')?.trim();
    const inbox =
      this.configService.get<string>('E2E_AGENTMAIL_INBOX_ID')?.trim() ||
      this.configService.get<string>('E2E_AGENTMAIL_INBOX_EMAIL')?.trim();
    return !!(password && identifier && secret && pub && agentmail && inbox);
  }

  private playbackClerkBaseUrl(runUrl: string): string {
    try {
      return new URL(runUrl).origin;
    } catch {
      return runUrl.replace(/\/$/, '');
    }
  }

  private async runPlaybackClerkAutoSignIn(page: Page, runUrl: string): Promise<void> {
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
    });
    this.logger.log('Playback: Clerk + AgentMail auto sign-in completed');
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

          const step = await this.recordStep(session, {
            action: (data.type?.toUpperCase() || 'CUSTOM') as any,
            selector: data.selector,
            value: data.value,
            instruction: translated.instruction,
            playwrightCode: translated.playwrightCode,
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

  private async executePwCode(page: Page, code: string): Promise<void> {
    const forbidden = ['require(', 'import ', 'process.', 'fs.', 'child_process', 'eval('];
    for (const f of forbidden) {
      if (code.includes(f)) {
        throw new Error(`Forbidden operation in generated code: ${f}`);
      }
    }

    const fn = new Function('page', `return (async () => { ${code} })();`);
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
