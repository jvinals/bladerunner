import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, type Browser, type Page, type CDPSession } from 'playwright-core';
import WebSocket from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { resolveBrowserWorkerWebSocketUrl } from '../recording/browser-worker-url.util';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata extracted from the remote DOM via `elementFromPoint` + interactive-parent traversal. */
export interface ElementMetadata {
  tag: string;
  id: string | null;
  type: string | null;
  name: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  textContent: string | null;
  isInput: boolean;
}

/** A single recorded user action (accumulated in-memory, persisted on stop). */
export interface RecordedNavigationAction {
  sequence: number;
  actionType: 'click' | 'type' | 'navigate' | 'variable_input';
  x: number | null;
  y: number | null;
  elementTag: string | null;
  elementId: string | null;
  elementText: string | null;
  ariaLabel: string | null;
  inputValue: string | null;
  inputMode: 'static' | 'variable' | null;
  pageUrl: string | null;
}

/** Result of `inspectAndClick`: either an action was recorded or an input was detected. */
export type InspectClickResult =
  | { outcome: 'clicked'; action: RecordedNavigationAction }
  | { outcome: 'inputDetected'; x: number; y: number; elementMeta: ElementMetadata };

/** In-memory live session state. */
interface NavigationLiveSession {
  navigationId: string;
  userId: string;
  browser: Browser;
  page: Page;
  cdpSession: CDPSession;
  latestFrame: Buffer | null;
  screencastClosing?: boolean;
  actions: RecordedNavigationAction[];
  sequence: number;
  /** Stashed coordinates for the pending input that triggered the variable modal. */
  pendingInputCoords: { x: number; y: number } | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 720;
const STREAM_JPEG_QUALITY = 70;
const STREAM_MAX_WIDTH = 1280;
const STREAM_MAX_HEIGHT = 720;

/** Browser-worker control WS: max attempts and per-attempt timeout. */
const WORKER_WS_ATTEMPTS = 10;
const WORKER_WS_ATTEMPT_MS = 60_000;

// ---------------------------------------------------------------------------
// Element extraction script (interactive-parent traversal)
// ---------------------------------------------------------------------------

function buildElementInspectScript(x: number, y: number): string {
  return `(() => {
  let el = document.elementFromPoint(${x}, ${y});
  if (!el) return null;
  const interactiveEl = el.closest(
    'button, a, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [tabindex]'
  ) || el;
  const tag = interactiveEl.tagName.toLowerCase();
  const isInput = ['input', 'textarea', 'select'].includes(tag) || interactiveEl.isContentEditable;
  return {
    tag,
    id: interactiveEl.id || null,
    type: interactiveEl.getAttribute('type') || null,
    name: interactiveEl.getAttribute('name') || null,
    placeholder: interactiveEl.getAttribute('placeholder') || null,
    ariaLabel: interactiveEl.getAttribute('aria-label') || null,
    textContent: interactiveEl.textContent?.trim()?.slice(0, 200) || null,
    isInput,
  };
})()`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Manages interactive navigation recording sessions.
 *
 * Lifecycle: startSession -> user interactions (inspectAndClick / resolveInput /
 * typeText / scrollPage) -> stopSession.
 *
 * Frames are relayed through the existing RecordingService EventEmitter so the
 * RecordingGateway broadcasts them to Socket.IO rooms with zero extra wiring.
 */
@Injectable()
export class NavigationRecordingService {
  private readonly logger = new Logger(NavigationRecordingService.name);
  private readonly sessions = new Map<string, NavigationLiveSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly recordingService: RecordingService,
  ) {}

  // -----------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------

  /**
   * Launch a remote browser, navigate to the Navigation's URL, start
   * screencast, and begin recording user interactions.
   */
  async startSession(navId: string, userId: string): Promise<void> {
    if (this.sessions.has(navId)) {
      throw new ConflictException('Navigation recording session already active');
    }

    const nav = await this.prisma.navigation.findFirst({
      where: { id: navId, userId },
      select: { url: true },
    });
    if (!nav) throw new NotFoundException(`Navigation ${navId} not found`);

    const workerUrl = resolveBrowserWorkerWebSocketUrl(
      this.configService.get<string>('BROWSER_WORKER_URL'),
      this.logger,
    );
    const wsEndpoint = await this.requestBrowserFromWorker(workerUrl);
    const browser = await chromium.connect(wsEndpoint);

    try {
      const context = await browser.newContext({
        viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15_000);
      page.setDefaultNavigationTimeout(30_000);
      const cdpSession = await context.newCDPSession(page);

      const session: NavigationLiveSession = {
        navigationId: navId,
        userId,
        browser,
        page,
        cdpSession,
        latestFrame: null,
        actions: [],
        sequence: 0,
        pendingInputCoords: null,
      };
      this.sessions.set(navId, session);

      await this.attachScreencast(session);
      this.logger.log(`Navigation session started: ${navId}`);

      const initialAction = this.pushAction(session, {
        actionType: 'navigate',
        x: null,
        y: null,
        elementTag: null,
        elementId: null,
        elementText: null,
        ariaLabel: null,
        inputValue: nav.url,
        inputMode: null,
        pageUrl: nav.url,
      });

      await page.goto(nav.url, { waitUntil: 'domcontentloaded' });

      await this.prisma.navigation.update({
        where: { id: navId, userId },
        data: { status: 'RUNNING', startedAt: new Date() },
      });

      this.recordingService.emit('status', navId, {
        status: 'navigation',
        navigationId: navId,
        phase: 'browser_ready',
      });

      this.recordingService.emit('nav:actionRecorded', navId, initialAction);
    } catch (err) {
      this.sessions.delete(navId);
      try { await browser.close(); } catch { /* ignore */ }
      throw err;
    }
  }

  /**
   * Stop screencast, close browser, persist recorded actions to the database,
   * and return the accumulated action list.
   */
  async stopSession(navId: string, userId: string): Promise<RecordedNavigationAction[]> {
    const session = this.getSession(navId, userId);
    session.screencastClosing = true;

    try {
      await session.cdpSession.send('Page.stopScreencast').catch(() => {});
    } catch { /* ignore */ }

    const actions = [...session.actions];

    if (actions.length > 0) {
      await this.prisma.navigationAction.createMany({
        data: actions.map((a) => ({
          navigationId: navId,
          userId,
          sequence: a.sequence,
          actionType: a.actionType,
          x: a.x,
          y: a.y,
          elementTag: a.elementTag,
          elementId: a.elementId,
          elementText: a.elementText,
          ariaLabel: a.ariaLabel,
          inputValue: a.inputValue,
          inputMode: a.inputMode,
          pageUrl: a.pageUrl,
        })),
      });
    }

    await this.prisma.navigation.update({
      where: { id: navId, userId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    try { await session.browser.close(); } catch { /* ignore */ }
    this.sessions.delete(navId);
    this.logger.log(`Navigation session stopped: ${navId} (${actions.length} actions persisted)`);
    return actions;
  }

  // -----------------------------------------------------------------------
  // User interactions
  // -----------------------------------------------------------------------

  /**
   * Inspect the element at (x, y) in the remote browser.
   *
   * - If the element is an input/textarea/select/contenteditable, return
   *   `inputDetected` so the frontend can show the variable injection modal.
   *   The click is NOT executed yet (deferred until `resolveInput`).
   * - Otherwise, execute `page.mouse.click(x, y)` and record a `click` action.
   */
  async inspectAndClick(navId: string, userId: string, x: number, y: number): Promise<InspectClickResult> {
    const session = this.getSession(navId, userId);
    const meta = await session.page.evaluate(buildElementInspectScript(x, y)) as ElementMetadata | null;

    if (meta?.isInput) {
      session.pendingInputCoords = { x, y };
      return { outcome: 'inputDetected', x, y, elementMeta: meta };
    }

    await session.page.mouse.click(x, y);

    const action = this.pushAction(session, {
      actionType: 'click',
      x,
      y,
      elementTag: meta?.tag ?? null,
      elementId: meta?.id ?? null,
      elementText: meta?.textContent ?? null,
      ariaLabel: meta?.ariaLabel ?? null,
      inputValue: null,
      inputMode: null,
      pageUrl: session.page.url(),
    });

    return { outcome: 'clicked', action };
  }

  /**
   * Resolve a pending input field interaction after the user chose
   * static text or a dynamic variable in the frontend modal.
   */
  async resolveInput(
    navId: string,
    userId: string,
    mode: 'static' | 'variable',
    value: string,
  ): Promise<RecordedNavigationAction> {
    const session = this.getSession(navId, userId);
    const coords = session.pendingInputCoords;
    if (!coords) {
      throw new NotFoundException('No pending input interaction to resolve');
    }
    session.pendingInputCoords = null;

    const meta = await session.page.evaluate(
      buildElementInspectScript(coords.x, coords.y),
    ) as ElementMetadata | null;

    await session.page.mouse.click(coords.x, coords.y);

    if (mode === 'static') {
      await session.page.keyboard.type(value, { delay: 30 });
    }

    const storedValue = mode === 'variable' ? `{{${value}}}` : value;

    const action = this.pushAction(session, {
      actionType: mode === 'variable' ? 'variable_input' : 'type',
      x: coords.x,
      y: coords.y,
      elementTag: meta?.tag ?? null,
      elementId: meta?.id ?? null,
      elementText: meta?.textContent ?? null,
      ariaLabel: meta?.ariaLabel ?? meta?.placeholder ?? null,
      inputValue: storedValue,
      inputMode: mode,
      pageUrl: session.page.url(),
    });

    return action;
  }

  /** Type literal text into the currently focused element. */
  async typeText(navId: string, userId: string, text: string): Promise<void> {
    const session = this.getSession(navId, userId);
    await session.page.keyboard.type(text, { delay: 30 });
  }

  /**
   * Ephemeral scroll: updates the remote browser viewport but is NOT
   * persisted as a NavigationAction and NOT compiled into the Skyvern workflow.
   */
  async scrollPage(navId: string, userId: string, deltaX: number, deltaY: number): Promise<void> {
    const session = this.getSession(navId, userId);
    await session.page.mouse.wheel(deltaX, deltaY);
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** Latest JPEG frame buffer for Socket.IO join catch-up. */
  getLatestFrame(navId: string): Buffer | null {
    return this.sessions.get(navId)?.latestFrame ?? null;
  }

  /** Current action list for the active session (for UI timeline sync). */
  getActions(navId: string): RecordedNavigationAction[] {
    return this.sessions.get(navId)?.actions ?? [];
  }

  /** Whether a live session exists for this navigation id. */
  hasSession(navId: string): boolean {
    return this.sessions.has(navId);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private getSession(navId: string, userId: string): NavigationLiveSession {
    const session = this.sessions.get(navId);
    if (!session || session.userId !== userId) {
      throw new NotFoundException(`No active navigation session for ${navId}`);
    }
    return session;
  }

  private pushAction(
    session: NavigationLiveSession,
    fields: Omit<RecordedNavigationAction, 'sequence'>,
  ): RecordedNavigationAction {
    session.sequence += 1;
    const action: RecordedNavigationAction = { sequence: session.sequence, ...fields };
    session.actions.push(action);
    return action;
  }

  /**
   * Start CDP screencast and relay frames through RecordingService so the
   * existing RecordingGateway broadcasts them to `run:{navId}` rooms.
   */
  private async attachScreencast(session: NavigationLiveSession): Promise<void> {
    await session.cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: STREAM_JPEG_QUALITY,
      maxWidth: STREAM_MAX_WIDTH,
      maxHeight: STREAM_MAX_HEIGHT,
      everyNthFrame: 1,
    });

    session.cdpSession.on('Page.screencastFrame', async (params: any) => {
      const buf = Buffer.from(params.data, 'base64');
      session.latestFrame = buf;

      try {
        await session.cdpSession.send('Page.screencastFrameAck', {
          sessionId: params.sessionId,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          session.screencastClosing === true ||
          session.page?.isClosed?.() === true ||
          session.browser?.isConnected?.() === false
        ) {
          if (/Target page, context or browser has been closed/i.test(msg)) return;
        }
        throw err;
      }

      this.recordingService.emit('frame', session.navigationId, params.data);
    });
  }

  // -----------------------------------------------------------------------
  // Browser-worker control plane (mirrors RecordingService pattern)
  // -----------------------------------------------------------------------

  private async requestBrowserFromWorker(workerUrl: string): Promise<string> {
    let lastErr: Error = new Error('Browser worker connection failed');
    for (let i = 1; i <= WORKER_WS_ATTEMPTS; i++) {
      try {
        return await this.connectBrowserWorkerOnce(workerUrl, WORKER_WS_ATTEMPT_MS);
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (!this.isTransientWorkerError(lastErr) || i === WORKER_WS_ATTEMPTS) {
          throw lastErr;
        }
        const backoff = Math.min(2000 * 2 ** (i - 1), 20_000);
        this.logger.warn(
          `Browser worker WS failed (${lastErr.message}); retry ${i}/${WORKER_WS_ATTEMPTS} in ${backoff}ms`,
        );
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastErr;
  }

  private connectBrowserWorkerOnce(workerUrl: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(workerUrl);
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(new Error('Browser worker connection timeout'));
      }, timeoutMs);

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        fn();
      };

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'launch' }));
      });

      ws.on('message', (data) => {
        let msg: { type?: string; wsEndpoint?: string; error?: string };
        try {
          msg = JSON.parse(data.toString()) as { type?: string; wsEndpoint?: string; error?: string };
        } catch { return; }
        if (msg.type === 'launch:result' && msg.wsEndpoint) {
          finish(() => { ws.close(); resolve(msg.wsEndpoint!); });
        } else if (msg.type === 'error') {
          finish(() => { ws.close(); reject(new Error(msg.error ?? 'Browser worker error')); });
        }
      });

      ws.on('error', (err) => finish(() => reject(err)));

      ws.on('close', (code, reason) => {
        if (settled) return;
        const r = reason?.toString?.() ?? '';
        finish(() =>
          reject(new Error(`Browser worker WS closed before launch: code=${code}${r ? ` ${r}` : ''}`)),
        );
      });
    });
  }

  private isTransientWorkerError(err: Error): boolean {
    const msg = err.message.toLowerCase();
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') {
      return true;
    }
    return (
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('socket hang up') ||
      msg.includes('eai_again') ||
      msg.includes('closed before launch')
    );
  }
}
