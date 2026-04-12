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
  skyvernPersistentWorkflowId,
  type SkyvernWorkflowRunResponse,
  type SkyvernWorkflowRunStatus,
} from './skyvern-client.service';
import {
  assertSkyvernCloudCannotUseLocalhostCdp,
  navigationPlayUsesSkyvernHostedBrowser,
  resolveBrowserAddressForSkyvern,
} from './skyvern-browser-address.util';
import { buildSkyvernWorkflowApiPayload } from './skyvern-workflow-api.mapper';
import type { RecordedNavigationAction } from './navigation-recording.service';
import { NavigationRecordingService } from './navigation-recording.service';

const WORKER_WS_ATTEMPTS = 10;
const WORKER_WS_ATTEMPT_MS = 60_000;
const POLL_MS = 1_800;

const SKYVERN_SCREENSHOT_ARTIFACT_TYPES = new Set([
  'screenshot',
  'screenshot_action',
  'screenshot_final',
]);

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
  latestFrameMime: string | null;
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

  getLatestFrameMime(navId: string): string | null {
    return this.sessions.get(navId)?.latestFrameMime ?? null;
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
   * Sync workflow to Skyvern, start run. **Skyvern Cloud:** hosted browser (no `browser_address`).
   * **Self-hosted:** acquire CDP from browser-worker and pass `browser_address`.
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
      const wfId = skyvernPersistentWorkflowId(created);
      await persistWorkflowId(wfId);
      return wfId;
    };

    let workflowId = nav.skyvernWorkflowId?.trim() || '';
    if (workflowId) {
      try {
        const updated = await this.skyvern.updateWorkflow(workflowId, jsonDefinition as Record<string, unknown>);
        const canonical = skyvernPersistentWorkflowId(updated);
        if (canonical !== workflowId) {
          await persistWorkflowId(canonical);
        }
        workflowId = canonical;
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

    const useHostedBrowser = navigationPlayUsesSkyvernHostedBrowser(this.config);
    let browserAddressForSkyvern: string | undefined;
    if (useHostedBrowser) {
      browserAddressForSkyvern = undefined;
      this.logger.log('Navigation Play: Skyvern Cloud — using hosted browser (no browser-worker CDP)');
    } else {
      const workerUrl = resolveBrowserWorkerWebSocketUrl(
        this.config.get<string>('BROWSER_WORKER_URL'),
        this.logger,
      );
      const wsEndpoint = await this.requestBrowserFromWorker(workerUrl);
      const addr = resolveBrowserAddressForSkyvern(wsEndpoint, this.config, this.logger);
      assertSkyvernCloudCannotUseLocalhostCdp(addr, this.config);
      browserAddressForSkyvern = addr;
    }

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
        browser_address: browserAddressForSkyvern,
        title: `Play ${nav.name}`.slice(0, 200),
      });
    } catch (err) {
      if (!isStaleSkyvernWorkflowError(err)) throw err;
      this.logger.warn(
        `Skyvern run rejected workflow id ${workflowId} (404); recreating workflow and retrying once.`,
      );
      await clearStoredWorkflowId();
      workflowId = await createWorkflowAndPersist();
      try {
        run = await this.skyvern.runWorkflow({
          workflow_id: workflowId,
          parameters: paramObj,
          browser_address: browserAddressForSkyvern,
          title: `Play ${nav.name}`.slice(0, 200),
        });
      } catch (err2) {
        throw err2;
      }
    }

    const room = this.playRoomId(navId);
    const session: NavigationPlaySession = {
      navigationId: navId,
      userId,
      skyvernRunId: run.run_id,
      wsEndpoint: browserAddressForSkyvern ?? '',
      pollTimer: null,
      stopped: false,
      latestFrame: null,
      latestFrameMime: null,
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

    return {
      skyvernRunId: run.run_id,
      workflowId,
      browserAddress: browserAddressForSkyvern ?? '',
    };
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

      const fromRun = this.pickScreenshotUrlFromRun(run);
      if (fromRun) {
        const fetched = await this.fetchScreenshotAsBase64(fromRun, 'run_screenshot_urls');
        if (fetched) {
          this.pushPlayFrame(navId, session, fetched, 'run_urls');
          return;
        }
      }

      const shots = await this.listScreenshotArtifactsSorted(session.skyvernRunId);
      // #region agent log
      fetch('http://127.0.0.1:7445/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd7957e' },
        body: JSON.stringify({
          sessionId: 'd7957e',
          location: 'navigation-play.service.ts:pollOnce',
          message: 'artifact fallback candidates',
          data: { shotCount: shots.length, navTail: navId.slice(-8) },
          timestamp: Date.now(),
          hypothesisId: 'H3',
        }),
      }).catch(() => {});
      // #endregion
      for (let i = 0; i < Math.min(shots.length, 10); i++) {
        const shot = shots[i]!;
        const imageUrl = await this.resolveArtifactDownloadUrl(shot);
        // #region agent log
        fetch('http://127.0.0.1:7445/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd7957e' },
          body: JSON.stringify({
            sessionId: 'd7957e',
            location: 'navigation-play.service.ts:pollOnce',
            message: 'resolveArtifactDownloadUrl',
            data: {
              tryIndex: i,
              hasUrl: !!imageUrl,
              hadListSignedUrl: !!(shot.signed_url && String(shot.signed_url).startsWith('http')),
            },
            timestamp: Date.now(),
            hypothesisId: 'H2',
          }),
        }).catch(() => {});
        // #endregion
        if (!imageUrl) continue;
        const fetched = await this.fetchScreenshotAsBase64(imageUrl, `artifact_try_${i}`);
        if (fetched) {
          this.pushPlayFrame(navId, session, fetched, 'artifact', { tryIndex: i });
          return;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Play poll error nav=${navId}: ${msg}`);
    }
  }

  private pickScreenshotUrlFromRun(run: SkyvernWorkflowRunResponse): string | null {
    const urls = run.screenshot_urls;
    if (!Array.isArray(urls) || urls.length === 0) return null;
    const u = urls[0];
    return typeof u === 'string' && u.startsWith('http') ? u : null;
  }

  private pushPlayFrame(
    navId: string,
    session: NavigationPlaySession,
    fetched: { base64: string; mime: string },
    frameSource: 'run_urls' | 'artifact',
    meta?: { tryIndex?: number },
  ): void {
    // #region agent log
    fetch('http://127.0.0.1:7445/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd7957e' },
      body: JSON.stringify({
        sessionId: 'd7957e',
        location: 'navigation-play.service.ts:pushPlayFrame',
        message: 'play frame emitted',
        data: { frameSource, tryIndex: meta?.tryIndex ?? null, navTail: navId.slice(-8), mime: fetched.mime },
        timestamp: Date.now(),
        hypothesisId: 'H2',
      }),
    }).catch(() => {});
    // #endregion
    session.latestFrame = Buffer.from(fetched.base64, 'base64');
    session.latestFrameMime = fetched.mime;
    this.recordingService.emit('frame', this.playRoomId(navId), fetched.base64, fetched.mime);
  }

  /** Newest-first screenshot artifacts (may omit `signed_url`; use `getArtifact` to refresh). */
  private async listScreenshotArtifactsSorted(runId: string) {
    const arts = await this.skyvern.listRunArtifacts(runId);
    const shots = arts.filter((a) => {
      if (!a.artifact_id) return false;
      const t = (a.artifact_type ?? '').toLowerCase();
      return SKYVERN_SCREENSHOT_ARTIFACT_TYPES.has(a.artifact_type) || t.includes('screenshot');
    });
    shots.sort((a, b) =>
      (b.modified_at ?? b.created_at ?? '').localeCompare(a.modified_at ?? a.created_at ?? ''),
    );
    return shots;
  }

  private async resolveArtifactDownloadUrl(shot: {
    artifact_id: string;
    signed_url?: string | null;
  }): Promise<string | null> {
    const fresh = await this.skyvern.getArtifact(shot.artifact_id);
    const u = fresh?.signed_url ?? shot.signed_url;
    if (u && typeof u === 'string' && u.startsWith('http')) return u;
    return null;
  }

  private skyvernApiHostname(): string {
    try {
      return new URL(
        this.config.get<string>('SKYVERN_API_BASE_URL')?.trim() || 'https://api.skyvern.com',
      ).hostname.toLowerCase();
    } catch {
      return 'api.skyvern.com';
    }
  }

  /** Presigned S3 URLs break if we add `x-api-key`; only send it for same-host Skyvern API fetches. */
  private buildScreenshotFetchHeaders(imageUrl: string): Record<string, string> {
    const key = this.config.get<string>('SKYVERN_API_KEY')?.trim();
    if (!key) return {};
    let host: string;
    try {
      host = new URL(imageUrl).hostname.toLowerCase();
    } catch {
      return {};
    }
    if (host === this.skyvernApiHostname()) {
      return { 'x-api-key': key };
    }
    return {};
  }

  private async fetchScreenshotAsBase64(
    imageUrl: string,
    debugPhase?: string,
  ): Promise<{ base64: string; mime: string } | null> {
    try {
      const headers = this.buildScreenshotFetchHeaders(imageUrl);
      const res = await fetch(imageUrl, { headers });
      if (!res.ok) {
        this.logger.warn(`Play screenshot HTTP ${res.status} for ${imageUrl.slice(0, 96)}…`);
        let host = '';
        try {
          host = new URL(imageUrl).hostname;
        } catch {
          host = 'invalid-url';
        }
        // #region agent log
        fetch('http://127.0.0.1:7445/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd7957e' },
          body: JSON.stringify({
            sessionId: 'd7957e',
            location: 'navigation-play.service.ts:fetchScreenshotAsBase64',
            message: 'screenshot GET not ok',
            data: { status: res.status, host, phase: debugPhase ?? null },
            timestamp: Date.now(),
            hypothesisId: 'H1',
          }),
        }).catch(() => {});
        // #endregion
        return null;
      }
      const rawCt = res.headers.get('content-type')?.split(';')[0]?.trim();
      const mime =
        rawCt && rawCt.startsWith('image/') ? rawCt : imageUrl.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg';
      const buf = Buffer.from(await res.arrayBuffer());
      return { base64: buf.toString('base64'), mime };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Play screenshot fetch failed: ${msg}`);
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
