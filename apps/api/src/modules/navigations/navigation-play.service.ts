import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { appendFileSync } from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { resolveBrowserWorkerWebSocketUrl } from '../recording/browser-worker-url.util';
import {
  SkyvernClientService,
  isStaleSkyvernWorkflowError,
  skyvernPersistentWorkflowId,
  type SkyvernArtifact,
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

// #region agent log
const _agentNavPlayLogPath = path.join(__dirname, '../../../../..', '.cursor', 'debug-d7957e.log');
function _agentNavPlayLog(payload: Record<string, unknown>): void {
  try {
    appendFileSync(
      _agentNavPlayLogPath,
      `${JSON.stringify({ sessionId: 'd7957e', timestamp: Date.now(), ...payload })}\n`,
    );
  } catch {
    /* debug ingest file may be unavailable */
  }
}
// #endregion

function isTimelineBlockFinished(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return (
    s === 'completed' ||
    s === 'skipped' ||
    s === 'complete' ||
    s === 'succeeded' ||
    s === 'success' ||
    s === 'done' ||
    s === 'failed' ||
    s === 'terminated' ||
    s === 'timed_out' ||
    s === 'canceled' ||
    s === 'cancelled'
  );
}

/**
 * Collect block rows from `GET /v1/runs/{id}/timeline` by **deep-walking** the JSON.
 * Runtime logs showed only `s1_*` when following `children` only — later blocks live under other keys.
 */
function collectSkyvernTimelineBlockRows(root: unknown): Array<{ label: string | null; status: string | null }> {
  const out: Array<{ label: string | null; status: string | null }> = [];

  const pushIfBlockLike = (o: Record<string, unknown>): void => {
    if (String(o.type).toLowerCase() === 'block' && o.block && typeof o.block === 'object') {
      const b = o.block as Record<string, unknown>;
      out.push({
        label: typeof b.label === 'string' ? b.label : null,
        status: typeof b.status === 'string' ? b.status : null,
      });
      return;
    }
    if (
      typeof o.label === 'string' &&
      (typeof o.workflow_run_block_id === 'string' ||
        typeof o.block_workflow_run_id === 'string' ||
        typeof o.block_type === 'string')
    ) {
      out.push({
        label: o.label,
        status: typeof o.status === 'string' ? o.status : null,
      });
    }
  };

  const walk = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    if (typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    pushIfBlockLike(o);
    for (const v of Object.values(o)) {
      if (v !== null && typeof v === 'object') walk(v);
    }
  };

  walk(root);
  return out;
}

/**
 * Apply one poll’s timeline rows. API often emits **duplicate `s1_*` labels** for two rows (`unlabeledRowCount` = 0 but
 * `timelineBlockCount` &gt; 1); merging by label alone collapses to one map entry. After sorting by label index, row **k**
 * always updates **`skyvernBlockLabels[k]`** (status from that row).
 */
function mergeTimelinePollIntoLabelStatus(
  session: NavigationPlaySession,
  timelineBlocks: Array<{ label: string | null; status: string | null }>,
): void {
  const nLabels = Math.min(session.skyvernBlockLabels.length, session.playActionSequences.length);
  if (nLabels === 0 || timelineBlocks.length === 0) return;

  const scored = timelineBlocks.map((e, j) => {
    const t = e.label?.trim();
    let ord = 10_000 + j;
    if (t) {
      const ix = session.skyvernBlockLabels.indexOf(t);
      if (ix >= 0) ord = ix;
    }
    return { e, ord, j };
  });
  scored.sort((a, b) => (a.ord === b.ord ? a.j - b.j : a.ord - b.ord));

  const limit = Math.min(scored.length, nLabels);
  for (let k = 0; k < limit; k++) {
    const e = scored[k]!.e;
    const lab = session.skyvernBlockLabels[k]!;
    session.timelineLabelStatus.set(lab, e.status ?? '');
  }
}

/**
 * Merge **`label → status`** across polls. Timeline often omits `completed` for earlier blocks while a **later** block
 * is `running`; a naive “first non-finished” scan then sticks on **`s1_*` forever** (logs: `s1_nav:running` + later rows).
 * Use the **last** workflow index that is still non-terminal.
 */
function deriveActiveFromMergedTimeline(
  blockLabels: string[],
  actionSequences: number[],
  labelStatus: Map<string, string>,
): number | null {
  const n = Math.min(blockLabels.length, actionSequences.length);
  if (n === 0) return null;

  let maxLiveIdx = -1;
  for (let i = 0; i < n; i++) {
    const st = labelStatus.get(blockLabels[i]!);
    if (st === undefined) continue;
    if (!isTimelineBlockFinished(st)) maxLiveIdx = i;
  }
  if (maxLiveIdx >= 0) {
    return actionSequences[maxLiveIdx]!;
  }

  for (let i = 0; i < n; i++) {
    const st = labelStatus.get(blockLabels[i]!);
    if (st === undefined) return actionSequences[i]!;
  }
  return actionSequences[n - 1] ?? null;
}

/**
 * Prefer merged **`/timeline`** `label→status`; then **`run.output`** `{label}_output` keys; else first/last sequence.
 */
function deriveActivePlaySequence(
  run: SkyvernWorkflowRunResponse,
  blockLabels: string[],
  actionSequences: number[],
  labelStatus: Map<string, string>,
): number | null {
  if (blockLabels.length === 0 || actionSequences.length === 0) return null;
  const n = Math.min(blockLabels.length, actionSequences.length);
  const labels = blockLabels.slice(0, n);
  const seqs = actionSequences.slice(0, n);

  if (labelStatus.size > 0) {
    const fromT = deriveActiveFromMergedTimeline(blockLabels, actionSequences, labelStatus);
    if (fromT != null) return fromT;
  }

  const out = run.output;
  if (!out || typeof out !== 'object' || Array.isArray(out)) {
    if (run.status === 'running' || run.status === 'queued' || run.status === 'created') {
      return seqs[0] ?? null;
    }
    return seqs[n - 1] ?? null;
  }

  const completed = new Set<string>();
  for (const key of Object.keys(out as Record<string, unknown>)) {
    if (key.endsWith('_output')) {
      completed.add(key.slice(0, -'_output'.length));
    }
  }

  for (let i = 0; i < labels.length; i++) {
    const lab = labels[i]!;
    if (!completed.has(lab)) {
      return seqs[i] ?? null;
    }
  }
  return seqs[n - 1] ?? null;
}

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
  /** Skyvern block `label` values (same order as recorded actions → blocks). */
  skyvernBlockLabels: string[];
  playActionSequences: number[];
  lastActiveSequence: number | null;
  /** Latest known status per workflow block label (timeline may only return the active block each poll). */
  timelineLabelStatus: Map<string, string>;
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
    playActiveSequence: number | null;
  } {
    const s = this.sessions.get(navId);
    if (!s || s.userId !== userId) {
      return { active: false, skyvernRunId: null, lastStatus: null, playActiveSequence: null };
    }
    return {
      active: true,
      skyvernRunId: s.skyvernRunId,
      lastStatus: s.lastStatus,
      playActiveSequence: s.lastActiveSequence,
    };
  }

  /**
   * Sync workflow to Skyvern, start run. **Skyvern Cloud:** hosted browser (no `browser_address`).
   * **Self-hosted:** acquire CDP from browser-worker and pass `browser_address`.
   */
  async startPlay(navId: string, userId: string, parameters?: Record<string, string>): Promise<{
    skyvernRunId: string;
    workflowId: string;
    browserAddress: string;
    /** Initial highlighted workflow step; same as first `navPlay:runUpdate` when timeline is empty. */
    activeSequence: number | null;
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

    const skyvernBlockLabels = workflow_definition.blocks.map((b) => b.label);
    const playActionSequences = recorded.map((a) => a.sequence);

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
      skyvernBlockLabels,
      playActionSequences,
      lastActiveSequence: playActionSequences[0] ?? null,
      timelineLabelStatus: new Map(),
    };
    this.sessions.set(navId, session);

    this.recordingService.emit('navPlay:started', navId, {
      navId,
      skyvernRunId: run.run_id,
      workflowId,
      activeSequence: session.lastActiveSequence,
    });
    // #region agent log
    _agentNavPlayLog({
      hypothesisId: 'H2',
      location: 'NavigationPlayService.startPlay',
      message: 'navPlay started emitted',
      data: {
        navTail: navId.slice(-8),
        activeSequence: session.lastActiveSequence,
        blockCount: skyvernBlockLabels.length,
        seqSample: playActionSequences.slice(0, 8),
      },
    });
    // #endregion

    session.pollTimer = setInterval(() => {
      void this.pollOnce(navId, userId);
    }, POLL_MS);
    void this.pollOnce(navId, userId);

    return {
      skyvernRunId: run.run_id,
      workflowId,
      browserAddress: browserAddressForSkyvern ?? '',
      activeSequence: session.lastActiveSequence,
    };
  }

  private async pollOnce(navId: string, userId: string): Promise<void> {
    const session = this.sessions.get(navId);
    if (!session || session.userId !== userId || session.stopped) return;

    try {
      const [run, timelineRaw] = await Promise.all([
        this.skyvern.getRun(session.skyvernRunId),
        this.skyvern.getRunTimeline(session.skyvernRunId),
      ]);
      session.lastStatus = run.status;

      const timelineBlocks = collectSkyvernTimelineBlockRows(timelineRaw);
      if (timelineBlocks.length > 0) {
        mergeTimelinePollIntoLabelStatus(session, timelineBlocks);
      }
      const activeSequence = deriveActivePlaySequence(
        run,
        session.skyvernBlockLabels,
        session.playActionSequences,
        session.timelineLabelStatus,
      );
      session.lastActiveSequence = activeSequence;

      this.recordingService.emit('navPlay:runUpdate', navId, {
        navId,
        status: run.status,
        failureReason: run.failure_reason ?? null,
        runId: run.run_id,
        activeSequence,
        stepCount: run.step_count ?? null,
      });

      const terminal: SkyvernWorkflowRunStatus[] = [
        'completed',
        'failed',
        'terminated',
        'timed_out',
        'canceled',
      ];
      if (terminal.includes(run.status)) {
        // #region agent log
        _agentNavPlayLog({
          hypothesisId: 'H2',
          location: 'NavigationPlayService.pollOnce',
          message: 'pollOnce terminal',
          data: {
            navTail: navId.slice(-8),
            runStatus: run.status,
            activeSequence,
            timelineBlockCount: timelineBlocks.length,
            mergedSize: session.timelineLabelStatus.size,
            rowSample: timelineBlocks.slice(0, 6).map((r) => `${r.label ?? '?'}:${r.status ?? '?'}`),
            mergedPairs: [...session.timelineLabelStatus.entries()]
              .slice(0, 8)
              .map(([k, v]) => `${k}=${(v ?? '').slice(0, 32)}`),
            seqSample: session.playActionSequences.slice(0, 8),
            didPushFrame: false,
          },
        });
        // #endregion
        await this.cleanupSession(navId, false);
        return;
      }

      let didPushFrame = false;
      let artifactTotal = 0;
      let artifactCandidates = 0;
      const runUrls = this.collectRunScreenshotUrls(run);
      for (const imageUrl of runUrls) {
        const fetched = await this.fetchScreenshotAsBase64(imageUrl);
        if (fetched) {
          this.pushPlayFrame(navId, session, fetched, 'run_urls');
          didPushFrame = true;
          break;
        }
      }

      if (!didPushFrame) {
        const { shots, artsTotal } = await this.listScreenshotArtifactsSorted(session.skyvernRunId);
        artifactTotal = artsTotal;
        artifactCandidates = shots.length;
        for (let i = 0; i < Math.min(shots.length, 15); i++) {
          const shot = shots[i]!;
          const imageUrl = await this.resolveArtifactDownloadUrl(shot);
          if (!imageUrl) continue;
          const fetched = await this.fetchScreenshotAsBase64(imageUrl);
          if (fetched) {
            this.pushPlayFrame(navId, session, fetched, 'artifact', { tryIndex: i });
            didPushFrame = true;
            break;
          }
        }
      }

      // #region agent log
      _agentNavPlayLog({
        hypothesisId: didPushFrame ? 'H2' : 'H5',
        location: 'NavigationPlayService.pollOnce',
        message: didPushFrame ? 'pollOnce ok' : 'pollOnce no frame',
        data: {
          navTail: navId.slice(-8),
          runStatus: run.status,
          activeSequence,
          timelineBlockCount: timelineBlocks.length,
          mergedSize: session.timelineLabelStatus.size,
          rowSample: timelineBlocks.slice(0, 6).map((r) => `${r.label ?? '?'}:${r.status ?? '?'}`),
          mergedPairs: [...session.timelineLabelStatus.entries()]
            .slice(0, 8)
            .map(([k, v]) => `${k}=${(v ?? '').slice(0, 32)}`),
          seqSample: session.playActionSequences.slice(0, 8),
          didPushFrame,
          runScreenshotUrlTried: runUrls.length,
          artifactTotal,
          artifactCandidates,
        },
      });
      // #endregion
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Play poll error nav=${navId}: ${msg}`);
      // #region agent log
      _agentNavPlayLog({
        hypothesisId: 'H3',
        location: 'NavigationPlayService.pollOnce',
        message: 'poll error',
        data: { navTail: navId.slice(-8), err: msg.slice(0, 400) },
      });
      // #endregion
    }
  }

  /** Newest run-level screenshots last — Skyvern often appends; `[0]` can be stale or already-expired. */
  private collectRunScreenshotUrls(run: SkyvernWorkflowRunResponse): string[] {
    const urls = run.screenshot_urls;
    if (!Array.isArray(urls) || urls.length === 0) return [];
    const out = urls.filter((u): u is string => typeof u === 'string' && u.startsWith('http'));
    return out.slice().reverse();
  }

  private pushPlayFrame(
    navId: string,
    session: NavigationPlaySession,
    fetched: { base64: string; mime: string },
    frameSource: 'run_urls' | 'artifact',
    meta?: { tryIndex?: number },
  ): void {
    session.latestFrame = Buffer.from(fetched.base64, 'base64');
    session.latestFrameMime = fetched.mime;
    this.recordingService.emit('frame', this.playRoomId(navId), fetched.base64, fetched.mime);
    // #region agent log
    _agentNavPlayLog({
      hypothesisId: 'H5',
      location: 'NavigationPlayService.pushPlayFrame',
      message: 'frame emitted',
      data: { navTail: navId.slice(-8), frameSource, tryIndex: meta?.tryIndex ?? null },
    });
    // #endregion
  }

  /**
   * Newest-first screenshot artifacts (may omit `signed_url`; use `getArtifact` to refresh).
   * If strict types match nothing but the run has artifacts, fall back to **all** artifact rows so
   * live Play still gets frames when Skyvern uses nonstandard `artifact_type` strings.
   */
  private async listScreenshotArtifactsSorted(runId: string): Promise<{
    shots: SkyvernArtifact[];
    artsTotal: number;
  }> {
    const arts = await this.skyvern.listRunArtifacts(runId);
    const shotish = (a: SkyvernArtifact): boolean => {
      if (!a.artifact_id) return false;
      const t = (a.artifact_type ?? '').toLowerCase();
      if (SKYVERN_SCREENSHOT_ARTIFACT_TYPES.has(a.artifact_type)) return true;
      if (t.includes('screenshot')) return true;
      if (/image|png|jpe?g|webp|viewport|frame|display|browser|page/i.test(t)) return true;
      const u = `${a.signed_url ?? ''} ${a.uri ?? ''}`.toLowerCase();
      if (/\.(png|jpe?g|webp)(\?|$)/.test(u)) return true;
      return false;
    };
    let shots = arts.filter(shotish);
    if (shots.length === 0) {
      shots = arts.filter((a) => !!a.artifact_id);
    }
    shots.sort((a, b) =>
      (b.modified_at ?? b.created_at ?? '').localeCompare(a.modified_at ?? a.created_at ?? ''),
    );
    return { shots, artsTotal: arts.length };
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

  private async fetchScreenshotAsBase64(imageUrl: string): Promise<{ base64: string; mime: string } | null> {
    try {
      const headers = this.buildScreenshotFetchHeaders(imageUrl);
      const res = await fetch(imageUrl, { headers });
      if (!res.ok) {
        this.logger.warn(`Play screenshot HTTP ${res.status} for ${imageUrl.slice(0, 96)}…`);
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
