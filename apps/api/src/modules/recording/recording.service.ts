import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { chromium, Browser, Page, CDPSession } from 'playwright-core';
import WebSocket from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { EventEmitter } from 'events';

export interface RecordingSession {
  runId: string;
  userId: string;
  browser: Browser;
  page: Page;
  cdpSession: CDPSession;
  stepSequence: number;
  latestFrame: Buffer | null;
}

@Injectable()
export class RecordingService extends EventEmitter {
  private readonly logger = new Logger(RecordingService.name);
  private sessions = new Map<string, RecordingSession>();

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

      await this.setupScreencast(session);
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
      throw err;
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
  ) {
    session.stepSequence += 1;

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
      },
    });

    return step;
  }

  private async setupScreencast(session: RecordingSession) {
    await session.cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 60,
      maxWidth: 1280,
      maxHeight: 720,
      everyNthFrame: 3,
    });

    session.cdpSession.on('Page.screencastFrame', async (params: any) => {
      const frameBuffer = Buffer.from(params.data, 'base64');
      session.latestFrame = frameBuffer;

      await session.cdpSession.send('Page.screencastFrameAck', {
        sessionId: params.sessionId,
      });

      this.emit('frame', session.runId, params.data);
    });
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
