import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { chromium, type Browser, type Page, type CDPSession, type Frame } from 'playwright-core';
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
  /** Current field value for inputs (edit in variable modal). */
  currentValue: string | null;
}

/** A single recorded user action (accumulated in-memory, persisted on stop). */
export interface RecordedNavigationAction {
  sequence: number;
  actionType: 'click' | 'type' | 'navigate' | 'variable_input' | 'prompt' | 'prompt_type';
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
  /** When true, clicks/scroll/input-resolve are ignored (browser stays open). */
  paused: boolean;
  /** Last screencast frame layout size (CDP metadata); falls back to viewport. */
  lastStreamWidth: number;
  lastStreamHeight: number;
}

/**
 * Merge timeline refinements from the client into the server session list before persist.
 * Requires identical length and per-index `sequence` values; otherwise returns a copy of `server`.
 */
function mergeRecordedActionsWithClient(
  server: RecordedNavigationAction[],
  client: RecordedNavigationAction[] | undefined,
): RecordedNavigationAction[] {
  if (!client?.length) {
    return [...server];
  }
  if (client.length !== server.length) {
    return [...server];
  }
  const bySeq = new Map<number, RecordedNavigationAction>();
  for (const c of client) {
    if (bySeq.has(c.sequence)) {
      return [...server];
    }
    bySeq.set(c.sequence, c);
  }
  if (bySeq.size !== server.length) {
    return [...server];
  }
  return server.map((base) => {
    const cl = bySeq.get(base.sequence);
    if (!cl) {
      return base;
    }
    return mergeOneRecordedAction(base, cl);
  });
}

const SWAPPABLE_TEXT_ACTIONS = new Set<string>(['type', 'variable_input', 'prompt_type']);

function mergeOneRecordedAction(
  base: RecordedNavigationAction,
  client: RecordedNavigationAction,
): RecordedNavigationAction {
  const out: RecordedNavigationAction = { ...base };
  if (client.inputValue !== undefined) {
    out.inputValue = client.inputValue;
  }
  if (client.inputMode !== undefined) {
    out.inputMode = client.inputMode;
  }
  if (client.elementText !== undefined) {
    out.elementText = client.elementText;
  }
  if (client.ariaLabel !== undefined) {
    out.ariaLabel = client.ariaLabel;
  }

  const b = base.actionType;
  const c = client.actionType;
  if (SWAPPABLE_TEXT_ACTIONS.has(b) && SWAPPABLE_TEXT_ACTIONS.has(c)) {
    out.actionType = c;
    if (c === 'type') {
      out.inputMode = client.inputMode ?? 'static';
    }
    if (c === 'variable_input' || c === 'prompt_type') {
      out.inputMode = 'variable';
    }
  } else if (b === 'prompt' && c === 'prompt') {
    out.actionType = 'prompt';
  } else if (b === c) {
    /* keep */
  }

  return out;
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

/** Live prompt injection: scan up to this many matching nodes per frame (perf cap). */
const PROMPT_TARGET_MAX_PER_FRAME = 120;

const PROMPT_CANDIDATE_SELECTOR =
  'button, a[href], input:not([type="hidden"]):not([type="file"]), textarea, select, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"]';

const PROMPT_STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'at',
  'by',
  'from',
  'as',
  'is',
  'it',
  'be',
  'this',
  'that',
  'these',
  'those',
  'i',
  'me',
  'my',
  'we',
  'you',
  'your',
  'click',
  'tap',
  'press',
  'select',
  'choose',
  'pick',
  'open',
  'go',
  'navigate',
  'button',
  'link',
  'field',
  'input',
  'enter',
  'type',
  'into',
  'here',
  'there',
  'please',
  'just',
  'want',
  'need',
  'should',
  'will',
  'can',
  'page',
  'screen',
]);

function tokenizePromptForTarget(promptText: string): string[] {
  const norm = promptText
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '');
  return norm
    .split(/[^a-z0-9@._+-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !PROMPT_STOP_WORDS.has(t));
}

/**
 * Score how well `haystack` (element labels / text) matches the user prompt.
 */
function scorePromptAgainstHaystack(
  rawPrompt: string,
  haystack: string,
  tokens: string[],
): number {
  if (!haystack.trim()) return 0;
  const h = haystack.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (t.length < 2 || !h.includes(t)) continue;
    score += 8 + Math.min(t.length, 14);
    const i = h.indexOf(t);
    if (i >= 0) {
      const before = i > 0 ? h[i - 1] : ' ';
      const after = i + t.length < h.length ? h[i + t.length] : ' ';
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) {
        score += 10;
      }
    }
  }
  if (tokens.length >= 2) {
    const phrase = tokens.slice(0, 10).join(' ');
    if (phrase.length >= 4 && h.includes(phrase)) {
      score += 28;
    }
  }
  const compactH = h.replace(/[^a-z0-9]/g, '');
  const compactT = tokens.join('');
  if (compactT.length >= 4 && compactH.includes(compactT)) {
    score += 18;
  }
  const rawLow = rawPrompt.toLowerCase().trim();
  if (rawLow.length >= 4 && h.includes(rawLow.slice(0, Math.min(60, rawLow.length)))) {
    score += 22;
  }
  return score;
}

function clampPromptTargetBox(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.round(Math.max(0, Math.min(VIEWPORT_WIDTH - 8, box.x))),
    y: Math.round(Math.max(0, Math.min(VIEWPORT_HEIGHT - 8, box.y))),
    width: Math.round(Math.max(24, Math.min(VIEWPORT_WIDTH, box.width))),
    height: Math.round(Math.max(24, Math.min(VIEWPORT_HEIGHT, box.height))),
  };
}

const INSPECT_VALUE_MAX_LEN = 8000;

/** Domain in prompts like `@mailslurp.biz`, `at mailslurp.biz`, `domain mailslurp.biz`. */
function extractEmailDomainHint(raw: string): string | null {
  const mAt = raw.match(
    /@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/i,
  );
  if (mAt?.[1]) return mAt[1].toLowerCase();
  const mAtWord = raw.match(
    /\bat\s+([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)\b/i,
  );
  if (mAtWord?.[1]) return mAtWord[1].toLowerCase();
  const mDom = raw.match(
    /\bdomain\s+@?\s*([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)/i,
  );
  if (mDom?.[1]) return mDom[1].toLowerCase();
  return null;
}

/**
 * User asked for a placeholder / unconstrained email (not a full literal address).
 * Example: "Type any email of the domain @mailslurp.biz"
 */
function shouldSynthesizePlaceholderEmail(raw: string): boolean {
  const low = raw.toLowerCase();
  if (!/\b(e-?mail)\b/.test(low)) return false;
  if (
    /\b(any|some|arbitrary|random|whatever|fake|dummy|example|valid)\b/.test(low) ||
    /e-?mail\s+of\s+the\s+domain/.test(low) ||
    /e-?mail\s+.*@\w/.test(low)
  ) {
    return true;
  }
  if (/\btype\b[\s\S]*\be-?mail\b[\s\S]*@/.test(low)) return true;
  return false;
}

function synthesizeEmailForDomain(domain: string): string {
  const local = `recording-${randomBytes(3).toString('hex')}`;
  return `${local}@${domain}`;
}

/**
 * Pull a literal string to type into the focused field from a natural-language prompt.
 * Examples: `Type email: a@b.co` → `a@b.co`; quoted strings; trailing `label: value`;
 * "any email @domain" → synthesized `recording-hex@domain`.
 */
function extractTextToTypeFromPrompt(promptText: string): string | null {
  const raw = promptText.trim();
  if (!raw) return null;

  const doubleQ = raw.match(/"([^"]*)"/);
  if (doubleQ && doubleQ[1] != null && doubleQ[1].trim().length > 0) {
    return doubleQ[1].trim();
  }
  const singleQ = raw.match(/'([^']*)'/);
  if (singleQ && singleQ[1] != null && singleQ[1].trim().length > 0) {
    return singleQ[1].trim();
  }

  const fullEmailRe = /[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}/;
  const fullEmail = raw.match(fullEmailRe);
  if (fullEmail?.[0]) {
    return fullEmail[0].trim();
  }

  if (shouldSynthesizePlaceholderEmail(raw)) {
    const domain = extractEmailDomainHint(raw);
    if (domain) {
      return synthesizeEmailForDomain(domain);
    }
  }

  const colon = raw.lastIndexOf(':');
  if (colon >= 0) {
    const after = raw.slice(colon + 1).trim();
    if (
      after.length > 0 &&
      after.length <= INSPECT_VALUE_MAX_LEN &&
      !/^(email|password|text|value|here)$/i.test(after)
    ) {
      return after;
    }
  }

  const enter = raw.match(/\b(?:enter|type|input|fill)\s+(.+)$/i);
  if (enter?.[1]?.trim()) {
    const rest = enter[1].trim();
    if (rest.length > 0 && rest.length <= INSPECT_VALUE_MAX_LEN) return rest;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Element extraction script (interactive-parent traversal)
// ---------------------------------------------------------------------------

function buildElementInspectScript(x: number, y: number): string {
  return `(() => {
  let el = document.elementFromPoint(${x}, ${y});
  if (!el) return null;
  const labelAncestor = el.closest && el.closest('label');
  if (labelAncestor && labelAncestor.control && labelAncestor.control instanceof HTMLElement) {
    el = labelAncestor.control;
  }
  let interactiveEl = el.closest(
    'button, a, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [tabindex]'
  ) || el;
  let tag = interactiveEl.tagName.toLowerCase();
  if (!['input', 'textarea', 'select'].includes(tag)) {
    const nested =
      interactiveEl.querySelector &&
      interactiveEl.querySelector(
        'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select'
      );
    if (nested) {
      interactiveEl = nested;
      tag = interactiveEl.tagName.toLowerCase();
    }
  }
  const role = interactiveEl.getAttribute && interactiveEl.getAttribute('role');
  const isTextboxRole = role === 'textbox';
  const isInput =
    ['input', 'textarea', 'select'].includes(tag) ||
    !!interactiveEl.isContentEditable ||
    !!isTextboxRole;
  let currentValue = null;
  if (tag === 'input' || tag === 'textarea') {
    let v = interactiveEl.value != null ? String(interactiveEl.value) : '';
    if (tag === 'input' && v === '') {
      const av = interactiveEl.getAttribute('value');
      if (av != null && av !== '') v = String(av);
    }
    currentValue = v;
  } else if (tag === 'select') {
    const sel = interactiveEl;
    if (sel.selectedIndex >= 0 && sel.options[sel.selectedIndex]) {
      const opt = sel.options[sel.selectedIndex];
      currentValue = String(opt.value != null && opt.value !== '' ? opt.value : opt.text || '');
    } else {
      currentValue = '';
    }
  } else if (interactiveEl.isContentEditable || isTextboxRole) {
    const avt = interactiveEl.getAttribute && interactiveEl.getAttribute('aria-valuetext');
    currentValue = (
      interactiveEl.innerText ||
      interactiveEl.textContent ||
      avt ||
      ''
    ).replace(/\\n$/, '');
  }
  if (currentValue != null && currentValue.length > ${INSPECT_VALUE_MAX_LEN}) {
    currentValue = currentValue.slice(0, ${INSPECT_VALUE_MAX_LEN});
  }
  return {
    tag,
    id: interactiveEl.id || null,
    type: interactiveEl.getAttribute('type') || null,
    name: interactiveEl.getAttribute('name') || null,
    placeholder: interactiveEl.getAttribute('placeholder') || null,
    ariaLabel: interactiveEl.getAttribute('aria-label') || null,
    textContent: interactiveEl.textContent?.trim()?.slice(0, 200) || null,
    isInput,
    currentValue,
  };
})()`;
}

type ApplyEditableResult = { ok: boolean; reason?: string; tag?: string };

/**
 * Find the same control as `buildElementFromPoint` inspection and **replace** its value
 * (not append). Uses the native `value` setter so React-controlled inputs update; clears
 * when `newValue` is empty.
 */
async function applyEditableValueAtFramePoint(
  frame: Frame,
  lx: number,
  ly: number,
  newValue: string,
): Promise<ApplyEditableResult> {
  let v =
    newValue.length > INSPECT_VALUE_MAX_LEN
      ? newValue.slice(0, INSPECT_VALUE_MAX_LEN)
      : newValue;
  return (await frame.evaluate(
    ({ x, y, val }) => {
      let el: Element | null = document.elementFromPoint(x, y);
      if (!el) return { ok: false as const, reason: 'no-hit' };
      const labelAncestor = el.closest && el.closest('label');
      if (
        labelAncestor &&
        (labelAncestor as HTMLLabelElement).control instanceof HTMLElement
      ) {
        el = (labelAncestor as HTMLLabelElement).control;
      }
      if (!el) return { ok: false as const, reason: 'no-target' };
      let interactiveEl = (el.closest(
        'button, a, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [tabindex]',
      ) || el) as HTMLElement;
      let tag = interactiveEl.tagName.toLowerCase();
      if (!['input', 'textarea', 'select'].includes(tag)) {
        const nested = interactiveEl.querySelector?.(
          'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select',
        );
        if (nested) {
          interactiveEl = nested as HTMLElement;
          tag = interactiveEl.tagName.toLowerCase();
        }
      }
      const role = interactiveEl.getAttribute && interactiveEl.getAttribute('role');
      const isTextboxRole = role === 'textbox';

      if (tag === 'select') {
        (interactiveEl as HTMLSelectElement).value = val;
        interactiveEl.dispatchEvent(new Event('input', { bubbles: true }));
        interactiveEl.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true as const, tag: 'select' };
      }

      if (tag === 'input' || tag === 'textarea') {
        const field = interactiveEl as HTMLInputElement | HTMLTextAreaElement;
        const proto = tag === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc?.set) {
          desc.set.call(field, val);
        } else {
          field.value = val;
        }
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        return { ok: true as const, tag };
      }

      if (interactiveEl.isContentEditable || isTextboxRole) {
        interactiveEl.textContent = val;
        interactiveEl.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true as const, tag: 'contenteditable' };
      }

      return { ok: false as const, reason: 'not-editable', tag };
    },
    { x: lx, y: ly, val: v },
  )) as ApplyEditableResult;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Manages interactive navigation recording sessions.
 *
 * Lifecycle: startSession -> user interactions (inspectAndClick / resolveInput /
 * typeText / scrollPage) -> stopSession or cancelSession.
 * setPaused freezes interaction without closing the browser.
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
        paused: false,
        lastStreamWidth: VIEWPORT_WIDTH,
        lastStreamHeight: VIEWPORT_HEIGHT,
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
  async stopSession(
    navId: string,
    userId: string,
    clientActions?: RecordedNavigationAction[],
  ): Promise<RecordedNavigationAction[]> {
    const session = this.getSession(navId, userId);
    session.screencastClosing = true;

    try {
      await session.cdpSession.send('Page.stopScreencast').catch(() => {});
    } catch { /* ignore */ }

    const actions = mergeRecordedActionsWithClient(session.actions, clientActions);

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

  /**
   * Close the browser, discard in-memory actions (do not persist), mark navigation CANCELLED.
   */
  async cancelSession(navId: string, userId: string): Promise<void> {
    const session = this.getSession(navId, userId);
    session.screencastClosing = true;

    try {
      await session.cdpSession.send('Page.stopScreencast').catch(() => {});
    } catch {
      /* ignore */
    }

    try {
      await session.browser.close();
    } catch {
      /* ignore */
    }
    this.sessions.delete(navId);

    await this.prisma.navigation.update({
      where: { id: navId, userId },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
        failureMessage: 'Recording cancelled by user',
      },
    });

    this.logger.log(`Navigation session cancelled: ${navId}`);
  }

  /** Pause or resume interaction; clears pending input coordinates when pausing. */
  setPaused(navId: string, userId: string, paused: boolean): void {
    const session = this.getSession(navId, userId);
    session.paused = paused;
    if (paused) {
      session.pendingInputCoords = null;
    }
  }

  isPausedForUser(navId: string, userId: string): boolean {
    const session = this.sessions.get(navId);
    return !!session && session.userId === userId && session.paused;
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
  async inspectAndClick(
    navId: string,
    userId: string,
    x: number,
    y: number,
    streamWidth?: number,
    streamHeight?: number,
  ): Promise<InspectClickResult> {
    const session = this.getSession(navId, userId);
    const { px, py } = this.streamToViewportCss(session, x, y, streamWidth, streamHeight);
    const meta = await this.inspectDomAtViewport(session.page, px, py);

    if (meta?.isInput) {
      session.pendingInputCoords = { x: px, y: py };
      return { outcome: 'inputDetected', x, y, elementMeta: meta };
    }

    await session.page.mouse.click(px, py);

    const action = this.pushAction(session, {
      actionType: 'click',
      x: px,
      y: py,
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

    const { frame, lx, ly } = await this.frameAndLocalForViewportPoint(session.page, coords.x, coords.y);
    const meta = (await frame.evaluate(buildElementInspectScript(lx, ly))) as ElementMetadata | null;

    await session.page.mouse.click(coords.x, coords.y);

    const cleanVar = value.trim().replace(/^\{+|\}+$/g, '');
    const textToApply =
      mode === 'variable'
        ? cleanVar.length > INSPECT_VALUE_MAX_LEN
          ? cleanVar.slice(0, INSPECT_VALUE_MAX_LEN)
          : cleanVar
        : value.length > INSPECT_VALUE_MAX_LEN
          ? value.slice(0, INSPECT_VALUE_MAX_LEN)
          : value;

    const applied = await applyEditableValueAtFramePoint(frame, lx, ly, textToApply);
    if (!applied.ok) {
      this.logger.warn(
        `resolveInput: applyEditableValueAtFramePoint failed reason=${applied.reason} tag=${applied.tag ?? '?'}`,
      );
    }

    const action = this.pushAction(session, {
      actionType: mode === 'variable' ? 'variable_input' : 'type',
      x: coords.x,
      y: coords.y,
      elementTag: meta?.tag ?? null,
      elementId: meta?.id ?? null,
      elementText: meta?.textContent ?? null,
      ariaLabel: meta?.ariaLabel ?? meta?.placeholder ?? null,
      inputValue: textToApply,
      inputMode: mode,
      pageUrl: session.page.url(),
    });

    return action;
  }

  /**
   * Heuristic target for live prompt injection: scan visible interactives in all frames,
   * score labels/text against prompt keywords, return best viewport `boundingBox` (Playwright).
   * Falls back to a centered mock only when nothing scores.
   */
  async analyzeCustomPrompt(
    navId: string,
    userId: string,
    promptText: string,
  ): Promise<{
    targetBox: { x: number; y: number; width: number; height: number };
    semanticLabel: string;
  }> {
    const session = this.getSession(navId, userId);
    if (session.paused) {
      throw new ConflictException('Navigation recording is paused');
    }
    const page = session.page;
    const raw = promptText.trim();
    const preview = raw.length > 80 ? `${raw.slice(0, 80)}…` : raw;
    this.logger.log(
      `analyzeCustomPrompt nav=${navId} len=${raw.length} preview=${JSON.stringify(preview)}`,
    );

    const tokens = tokenizePromptForTarget(raw);
    let best: {
      score: number;
      box: { x: number; y: number; width: number; height: number };
      label: string;
    } | null = null;

    const frames = page.frames().filter((f) => !f.isDetached());
    for (const frame of frames) {
      let count = 0;
      try {
        count = await frame.locator(PROMPT_CANDIDATE_SELECTOR).count();
      } catch {
        continue;
      }
      const limit = Math.min(count, PROMPT_TARGET_MAX_PER_FRAME);
      const list = frame.locator(PROMPT_CANDIDATE_SELECTOR);
      for (let i = 0; i < limit; i++) {
        try {
          const el = list.nth(i);
          const visible = await el.isVisible().catch(() => false);
          if (!visible) continue;
          const box = await el.boundingBox().catch(() => null);
          if (!box || box.width < 2 || box.height < 2) continue;
          if (box.x + box.width < 0 || box.y + box.height < 0) continue;
          if (box.x > VIEWPORT_WIDTH + 50 || box.y > VIEWPORT_HEIGHT + 50) continue;

          const label = await el
            .evaluate((node: Element) => {
              const e = node as HTMLElement;
              const bits: string[] = [];
              const push = (s: string | null | undefined) => {
                if (s && String(s).trim()) bits.push(String(s).trim());
              };
              push(e.getAttribute('aria-label'));
              push(e.getAttribute('title'));
              push(e.getAttribute('placeholder'));
              push(e.getAttribute('name'));
              push(e.getAttribute('data-testid'));
              push(e.id);
              push(e.getAttribute('alt'));
              push(e.getAttribute('value'));
              if (e instanceof HTMLInputElement && e.type === 'submit' && e.value) {
                push(e.value);
              }
              let tx = (e.innerText || e.textContent || '').trim().replace(/\s+/g, ' ');
              if (tx) bits.push(tx.slice(0, 320));
              return bits.filter(Boolean).join(' | ');
            })
            .catch(() => '');

          const score = scorePromptAgainstHaystack(raw, label, tokens);
          if (score <= 0) continue;
          const area = box.width * box.height;
          const bestArea = best ? best.box.width * best.box.height : 0;
          const better =
            best == null ||
            score > best.score ||
            (score === best.score && area < bestArea);
          if (better) {
            best = {
              score,
              box: { x: box.x, y: box.y, width: box.width, height: box.height },
              label: label.slice(0, 200) || 'element',
            };
          }
        } catch {
          continue;
        }
      }
    }

    const MOCK_BOX = clampPromptTargetBox({ x: 590, y: 335, width: 100, height: 50 });

    if (!best || best.score < 6) {
      this.logger.log(
        `analyzeCustomPrompt: weak or no match bestScore=${best?.score ?? 0} label=${JSON.stringify((best?.label ?? '').slice(0, 80))}`,
      );
      if (best && best.score > 0) {
        return {
          targetBox: clampPromptTargetBox(best.box),
          semanticLabel: `Best guess (${best.score}): ${best.label.slice(0, 100)}`,
        };
      }
      return {
        targetBox: MOCK_BOX,
        semanticLabel: `No element matched — try naming the control (e.g. button text). Mock: ${preview}`,
      };
    }

    this.logger.log(
      `analyzeCustomPrompt: picked score=${best.score} label=${JSON.stringify(best.label.slice(0, 100))}`,
    );
    return {
      targetBox: clampPromptTargetBox(best.box),
      semanticLabel: `${best.label.slice(0, 100)} · match ${best.score}`,
    };
  }

  /**
   * Execute the confirmed intent: click at viewport (x,y), optionally type extracted text
   * into the field at that point (same frame-aware path as `resolveInput`), then record.
   */
  async confirmAndExecuteIntent(
    navId: string,
    userId: string,
    x: number,
    y: number,
    promptText: string,
  ): Promise<RecordedNavigationAction[]> {
    const session = this.getSession(navId, userId);
    if (session.paused) {
      throw new ConflictException('Navigation recording is paused');
    }
    await session.page.mouse.click(x, y);

    const toTypeRaw = extractTextToTypeFromPrompt(promptText);
    let metaAfterType: ElementMetadata | null = null;
    if (toTypeRaw) {
      const toType =
        toTypeRaw.length > INSPECT_VALUE_MAX_LEN
          ? toTypeRaw.slice(0, INSPECT_VALUE_MAX_LEN)
          : toTypeRaw;
      const { frame, lx, ly } = await this.frameAndLocalForViewportPoint(session.page, x, y);
      const applied = await applyEditableValueAtFramePoint(frame, lx, ly, toType);
      if (!applied.ok) {
        this.logger.warn(
          `confirmAndExecuteIntent: could not apply typed value reason=${applied.reason} tag=${applied.tag ?? '?'}`,
        );
      }
      metaAfterType = (await frame.evaluate(buildElementInspectScript(lx, ly))) as ElementMetadata | null;
    }

    const capped =
      promptText.length > INSPECT_VALUE_MAX_LEN
        ? promptText.slice(0, INSPECT_VALUE_MAX_LEN)
        : promptText;
    const promptAction = this.pushAction(session, {
      actionType: 'prompt',
      x,
      y,
      elementTag: null,
      elementId: null,
      elementText: null,
      ariaLabel: null,
      inputValue: capped,
      inputMode: null,
      pageUrl: session.page.url(),
    });

    if (!toTypeRaw) {
      return [promptAction];
    }

    const toType =
      toTypeRaw.length > INSPECT_VALUE_MAX_LEN
        ? toTypeRaw.slice(0, INSPECT_VALUE_MAX_LEN)
        : toTypeRaw;

    const typeAction = this.pushAction(session, {
      actionType: 'type',
      x,
      y,
      elementTag: metaAfterType?.tag ?? null,
      elementId: metaAfterType?.id ?? null,
      elementText: metaAfterType?.textContent ?? null,
      ariaLabel: metaAfterType?.ariaLabel ?? metaAfterType?.placeholder ?? null,
      inputValue: toType,
      inputMode: 'static',
      pageUrl: session.page.url(),
    });

    return [promptAction, typeAction];
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
    if (session.paused) {
      return;
    }
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

  /**
   * Map click coordinates from the JPEG/screencast bitmap (what the canvas uses) to
   * Playwright viewport CSS pixels (context viewport is VIEWPORT_WIDTH x VIEWPORT_HEIGHT).
   */
  /**
   * Map page viewport (top-level) coordinates to the frame that contains the point
   * and coordinates local to that frame for document.elementFromPoint.
   */
  private async frameAndLocalForViewportPoint(
    page: Page,
    vx: number,
    vy: number,
  ): Promise<{ frame: Frame; lx: number; ly: number }> {
    const walk = async (f: Frame, x: number, y: number): Promise<{ frame: Frame; lx: number; ly: number }> => {
      for (const child of f.childFrames()) {
        try {
          if (child.isDetached()) continue;
          const fe = await child.frameElement();
          if (!fe) continue;
          const box = await fe.boundingBox();
          if (!box) continue;
          if (x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height) {
            return walk(child, x - box.x, y - box.y);
          }
        } catch {
          /* cross-origin or transient */
        }
      }
      return { frame: f, lx: x, ly: y };
    };
    return walk(page.mainFrame(), vx, vy);
  }

  private async inspectDomAtViewport(page: Page, vx: number, vy: number): Promise<ElementMetadata | null> {
    const { frame, lx, ly } = await this.frameAndLocalForViewportPoint(page, vx, vy);
    return (await frame.evaluate(buildElementInspectScript(lx, ly))) as ElementMetadata | null;
  }

  private streamToViewportCss(
    session: NavigationLiveSession,
    streamX: number,
    streamY: number,
    clientStreamW?: number,
    clientStreamH?: number,
  ): { px: number; py: number } {
    const fw =
      clientStreamW && clientStreamW > 0
        ? clientStreamW
        : session.lastStreamWidth > 0
          ? session.lastStreamWidth
          : VIEWPORT_WIDTH;
    const fh =
      clientStreamH && clientStreamH > 0
        ? clientStreamH
        : session.lastStreamHeight > 0
          ? session.lastStreamHeight
          : VIEWPORT_HEIGHT;
    const px = Math.round((streamX * VIEWPORT_WIDTH) / fw);
    const py = Math.round((streamY * VIEWPORT_HEIGHT) / fh);
    return {
      px: Math.max(0, Math.min(VIEWPORT_WIDTH - 1, px)),
      py: Math.max(0, Math.min(VIEWPORT_HEIGHT - 1, py)),
    };
  }

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
      const sm = params.metadata as { deviceWidth?: number; deviceHeight?: number } | undefined;
      if (
        sm &&
        typeof sm.deviceWidth === 'number' &&
        typeof sm.deviceHeight === 'number' &&
        sm.deviceWidth > 0 &&
        sm.deviceHeight > 0
      ) {
        session.lastStreamWidth = sm.deviceWidth;
        session.lastStreamHeight = sm.deviceHeight;
      }

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
