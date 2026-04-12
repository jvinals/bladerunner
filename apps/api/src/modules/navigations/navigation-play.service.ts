import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { resolveBrowserWorkerWebSocketUrl } from '../recording/browser-worker-url.util';
import {
  SkyvernClientService,
  isStaleSkyvernWorkflowError,
  type SkyvernWorkflowRunResponse,
  type SkyvernWorkflowRunStatus,
} from './skyvern-client.service';
import { buildSkyvernWorkflowApiPayload } from './skyvern-workflow-api.mapper';
import type { RecordedNavigationAction } from './navigation-recording.service';
import { NavigationRecordingService } from './navigation-recording.service';

const WORKER_WS_ATTEMPTS = 10;
const WORKER_WS_ATTEMPT_MS = 60_000;
const POLL_MS = 1_800;

function prismaActionToRecorded(row: {
  sequence: number;
  actionType: string;
  x: number | null;
  y: number | null;
  elementTag: string | null;
  elementId: string | null;
  elementText: string | null;
  ariaLabel: string | null;
  inputValue: string | null;
  inputMode: string | null;
  pageUrl: string | null;
}): RecordedNavigationAction {
  const at = row.actionType as RecordedNavigationAction['actionType'];
  return {
    sequence: row.sequence,
    actionType: at,
    x: row.x,
    y: row.y,
    elementTag: row.elementTag,
    elementId: row.elementId,
    elementText: row.elementText,
    ariaLabel: row.ariaLabel,
    inputValue: row.inputValue,
    inputMode: (row.inputMode as RecordedNavigationAction['inputMode']) ?? null,
    pageUrl: row.pageUrl,
  };
}

interface NavigationPlaySession {
  navigationId: string;
  userId: string;
  skyvernRunId: string;
  wsEndpoint: string;
  pollTimer: ReturnType<typeof setInterval> | null;
  stopped: boolean;
  latestFrame: Buffer | null;
  lastStatus: SkyvernWorkflowRunStatus | null;
}

@Injectable()
export class NavigationPlayService {
  private readonly logger = new Logger(NavigationPlayService.name);
  private readonly sessions = new Map<string, NavigationPlaySession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly recordingService: RecordingService,
    private readonly skyvern: SkyvernClientService,
    private readonly moduleRef: ModuleRef,
  ) {}

  playRoomId(navId: string): string {
    return `play:${navId}`;
  }

  assertNoPlaySession(navId: string): void {
    if (this.sessions.has(navId)) {
      throw new ConflictException('A play session is already active for this navigation');
    }
  }

  hasPlaySession(navId: string): boolean {
    return this.sessions.has(navId);
  }

  getLatestFrame(navId: string): Buffer | null {
    return this.sessions.get(navId)?.latestFrame ?? null;
  }

  getSessionSummary(navId: string, userId: string): {
    active: boolean;
    skyvernRunId: string | null;
    lastStatus: SkyvernWorkflowRunStatus | null;
  } {
    const s = this.sessions.get(navId);
    if (!s || s.userId !== userId) {
      return { active: false, skyvernRunId: null, lastStatus: null };
    }
    return { active: true, skyvernRunId: s.skyvernRunId, lastStatus: s.lastStatus };
  }

  /**
   * Launch browser worker (CDP), sync workflow to Skyvern, start workflow run with `browser_address`,
   * poll run status and push screenshot frames to Socket.IO room `run:play:{navId}`.
   */
  async startPlay(navId: string, userId: string, parameters?: Record<string, string>): Promise<{
    skyvernRunId: string;
    workflowId: string;
    browserAddress: string;
  }> {
    this.skyvern.assertConfigured();
    if (this.moduleRef.get(NavigationRecordingService, { strict: false }).hasSession(navId)) {
      throw new ConflictException('Stop recording before starting Play');
    }
    this.assertNoPlaySession(navId);

    const nav = await this.prisma.navigation.findFirst({
      where: { id: navId, userId },
      include: { actions: { orderBy: { sequence: 'asc' } } },
    });
    if (!nav) throw new NotFoundException(`Navigation ${navId} not found`);
    if (nav.actions.length === 0) {
      throw new BadRequestException('No recorded actions — record a navigation first');
    }

    const recorded = nav.actions.map(prismaActionToRecorded);
    const { title, workflow_definition } = buildSkyvernWorkflowApiPayload(
      { id: nav.id, name: nav.name, url: nav.url },
      recorded,
    );

    const jsonDefinition = {
      title,
      workflow_definition,
      status: 'published',
    };

    const persistWorkflowId = async (wfId: string) => {
      await this.prisma.navigation.update({
        where: { id: navId, userId },
        data: { skyvernWorkflowId: wfId },
      });
    };

    const clearStoredWorkflowId = async () => {
      await this.prisma.navigation.update({
        where: { id: navId, userId },
        data: { skyvernWorkflowId: null },
      });
    };

    const createWorkflowAndPersist = async (): Promise<string> => {
      const created = await this.skyvern.createWorkflow(jsonDefinition as Record<string, unknown>);
      const wfId = created.workflow_id;
      await persistWorkflowId(wfId);
      return wfId;
    };

    let workflowId = nav.skyvernWorkflowId?.trim() || '';
    if (workflowId) {
      try {
        const updated = await this.skyvern.updateWorkflow(workflowId, jsonDefinition as Record<string, unknown>);
        if (updated.workflow_id && updated.workflow_id !== workflowId) {
          workflowId = updated.workflow_id;
          await persistWorkflowId(workflowId);
        }
      } catch (err) {
        if (!isStaleSkyvernWorkflowError(err)) throw err;
        this.logger.warn(
          `Skyvern workflow id ${workflowId} is stale or missing (update404); clearing and will create a new workflow.`,
        );
        await clearStoredWorkflowId();
        workflowId = '';
      }
    }
    if (!workflowId) {
      workflowId = await createWorkflowAndPersist();
    }

    const workerUrl = resolveBrowserWorkerWebSocketUrl(
      this.config.get<string>('BROWSER_WORKER_URL'),
      this.logger,
    );
    const wsEndpoint = await this.requestBrowserFromWorker(workerUrl);

    const paramObj: Record<string, unknown> = {};
    if (parameters) {
      for (const [k, v] of Object.entries(parameters)) {
        paramObj[k] = v;
      }
    }

    let run: SkyvernWorkflowRunResponse;
    try {
      run = await this.skyvern.runWorkflow({
        workflow_id: workflowId,
        parameters: paramObj,
        browser_address: wsEndpoint,
        title: `Play ${nav.name}`.slice(0, 200),
      });
    } catch (err) {
      if (!isStaleSkyvernWorkflowError(err)) throw err;
      this.logger.warn(
        `Skyvern run rejected workflow id ${workflowId} (404); recreating workflow and retrying once.`,
      );
      await clearStoredWorkflowId();
      workflowId = await createWorkflowAndPersist();
      run = await this.skyvern.runWorkflow({
        workflow_id: workflowId,
        parameters: paramObj,
        browser_address: wsEndpoint,
        title: `Play ${nav.name}`.slice(0, 200),
      });
    }

    const room = this.playRoomId(navId);
    const session: NavigationPlaySession = {
      navigationId: navId,
      userId,
      skyvernRunId: run.run_id,
      wsEndpoint,
      pollTimer: null,
      stopped: false,
      latestFrame: null,
      lastStatus: run.status,
    };
    this.sessions.set(navId, session);

    this.recordingService.emit('navPlay:started', navId, {
      navId,
      skyvernRunId: run.run_id,
      workflowId,
    });

    session.pollTimer = setInterval(() => {
      void this.pollOnce(navId, userId);
    }, POLL_MS);
    void this.pollOnce(navId, userId);

    return { skyvernRunId: run.run_id, workflowId, browserAddress: wsEndpoint };
  }

  private async pollOnce(navId: string, userId: string): Promise<void> {
    const session = this.sessions.get(navId);
    if (!session || session.userId !== userId || session.stopped) return;

    try {
      const run = await this.skyvern.getRun(session.skyvernRunId);
      session.lastStatus = run.status;

      this.recordingService.emit('navPlay:runUpdate', navId, {
        navId,
        status: run.status,
        failureReason: run.failure_reason ?? null,
        runId: run.run_id,
      });

      const terminal: SkyvernWorkflowRunStatus[] = [
        'completed',
        'failed',
        'terminated',
        'timed_out',
        'canceled',
      ];
      if (terminal.includes(run.status)) {
        await this.cleanupSession(navId, false);
        return;
      }

      const urls = run.screenshot_urls;
      const url = Array.isArray(urls) && urls.length > 0 ? urls[0] : null;
      if (typeof url === 'string' && url.startsWith('http')) {
        const b64 = await this.fetchImageBase64(url);
        if (b64) {
          session.latestFrame = Buffer.from(b64, 'base64');
          this.recordingService.emit('frame', this.playRoomId(navId), b64);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Play poll error nav=${navId}: ${msg}`);
    }
  }

  private async fetchImageBase64(imageUrl: string): Promise<string | null> {
    try {
      const key = this.config.get<string>('SKYVERN_API_KEY')?.trim();
      const headers: Record<string, string> = {};
      if (key) headers['x-api-key'] = key;
      const res = await fetch(imageUrl, { headers });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.toString('base64');
    } catch {
      return null;
    }
  }

  async stopPlay(navId: string, userId: string): Promise<void> {
    const session = this.sessions.get(navId);
    if (!session || session.userId !== userId) {
      return;
    }
    await this.skyvern.cancelRun(session.skyvernRunId).catch(() => {});
    await this.cleanupSession(navId, true);
  }

  private async cleanupSession(navId: string, cancelled: boolean): Promise<void> {
    const session = this.sessions.get(navId);
    if (!session) return;
    session.stopped = true;
    if (session.pollTimer) {
      clearInterval(session.pollTimer);
      session.pollTimer = null;
    }
    this.sessions.delete(navId);
    this.recordingService.emit('navPlay:ended', navId, {
      navId,
      cancelled,
      lastStatus: session.lastStatus,
    });
  }

  private async requestBrowserFromWorker(workerUrl: string): Promise<string> {
    let lastErr: Error = new Error('Browser worker connection failed');
    for (let i = 1; i <= WORKER_WS_ATTEMPTS; i++) {
      try {
        return await this.connectBrowserWorkerOnce(workerUrl, WORKER_WS_ATTEMPT_MS);
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        if (i === WORKER_WS_ATTEMPTS) throw lastErr;
        const backoff = Math.min(2000 * 2 ** (i - 1), 20_000);
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
        } catch {
          return;
        }
        if (msg.type === 'launch:result' && msg.wsEndpoint) {
          finish(() => {
            ws.close();
            resolve(msg.wsEndpoint!);
          });
        } else if (msg.type === 'error') {
          finish(() => {
            ws.close();
            reject(new Error(msg.error ?? 'Browser worker error'));
          });
        }
      });

      ws.on('error', (err) => {
        finish(() => reject(err));
      });

      ws.on('close', (code, reason) => {
        if (settled) return;
        const r = reason?.toString?.() ?? '';
        finish(() =>
          reject(new Error(`Browser worker WebSocket closed before launch: code=${code}${r ? ` ${r}` : ''}`)),
        );
      });
    });
  }
}
