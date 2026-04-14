import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import type { Prisma } from '../../generated/prisma/client';
import { SkyvernWorkflowRunLifecycleStatus } from '../../generated/prisma/enums';
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
import {
  buildSkyvernWorkflowApiPayload,
  defaultLocalhostRewriteHostForSkyvern,
} from './skyvern-workflow-api.mapper';
import type { RecordedNavigationAction } from './navigation-recording.service';
import { NavigationRecordingService } from './navigation-recording.service';
import { collectTimelineScreenshotUrls } from './_timeline-screenshots';
import {
  alignEnrichedBlocksToLabels,
  collectSkyvernTimelineEnrichedBlocks,
  durationMsExclusive,
} from './skyvern-timeline-metrics';

const WORKER_WS_ATTEMPTS = 10;
const WORKER_WS_ATTEMPT_MS = 60_000;
/** Steady poll after the first live frame (or after burst window). */
const POLL_MS = 1_800;
/** Poll faster while waiting for Skyvern’s first screenshot/artifact (`queued` often has none). */
const POLL_MS_UNTIL_FIRST_FRAME = 900;
const POLL_BURST_FOR_FIRST_FRAME_MS = 120_000;

const SKYVERN_SCREENSHOT_ARTIFACT_TYPES = new Set([
  'screenshot',
  'screenshot_action',
  'screenshot_final',
]);

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

function skyvernApiStatusToPrisma(
  status: SkyvernWorkflowRunStatus,
): (typeof SkyvernWorkflowRunLifecycleStatus)[keyof typeof SkyvernWorkflowRunLifecycleStatus] {
  switch (status) {
    case 'created':
      return SkyvernWorkflowRunLifecycleStatus.created;
    case 'queued':
      return SkyvernWorkflowRunLifecycleStatus.queued;
    case 'running':
      return SkyvernWorkflowRunLifecycleStatus.running;
    case 'timed_out':
      return SkyvernWorkflowRunLifecycleStatus.timed_out;
    case 'failed':
      return SkyvernWorkflowRunLifecycleStatus.failed;
    case 'terminated':
      return SkyvernWorkflowRunLifecycleStatus.terminated;
    case 'completed':
      return SkyvernWorkflowRunLifecycleStatus.completed;
    case 'canceled':
      return SkyvernWorkflowRunLifecycleStatus.canceled;
    default:
      return SkyvernWorkflowRunLifecycleStatus.running;
  }
}

function parseSkyvernRunStartedAt(run: SkyvernWorkflowRunResponse, fallback: Date): Date {
  const raw = run.created_at?.trim();
  if (raw) {
    const t = Date.parse(raw);
    if (!Number.isNaN(t)) return new Date(t);
  }
  return fallback;
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
  actionInstruction: string | null;
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
    actionInstruction: row.actionInstruction ?? null,
  };
}

interface NavigationPlaySession {
  navigationId: string;
  userId: string;
  skyvernRunId: string;
  /** Persisted `NavigationSkyvernWorkflowRun.id` (null if DB insert failed). */
  dbRunId: string | null;
  /** `wpid_…` used when this run was started. */
  workflowPermanentIdForRun: string;
  wsEndpoint: string;
  pollTimer: ReturnType<typeof setTimeout> | null;
  /** Monotonic clock at session start — used for burst polling until first frame. */
  playStartedAt: number;
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

  private buildSkyvernBlockMetricRows(
    runId: string,
    userId: string,
    skyvernBlockLabels: string[],
    playActionSequences: number[],
    timelineRaw: unknown,
  ): Prisma.NavigationSkyvernWorkflowRunBlockCreateManyInput[] {
    const enriched = collectSkyvernTimelineEnrichedBlocks(timelineRaw);
    const aligned = alignEnrichedBlocksToLabels(skyvernBlockLabels, enriched);
    const rows: Prisma.NavigationSkyvernWorkflowRunBlockCreateManyInput[] = [];
    for (let i = 0; i < skyvernBlockLabels.length; i++) {
      const lab = skyvernBlockLabels[i]!;
      const seq = i < playActionSequences.length ? playActionSequences[i]! : null;
      const e = aligned[i] ?? { label: lab, status: null, startedAt: null, completedAt: null };
      const orchMs = durationMsExclusive(e.startedAt, e.completedAt);
      const metricsJson: Prisma.InputJsonValue | undefined =
        orchMs != null ? { orchestratorBlockDurationMs: orchMs } : undefined;
      rows.push({
        id: randomUUID(),
        runId,
        userId,
        blockIndex: i,
        skyvernBlockLabel: lab,
        navigationActionSequence: seq,
        skyvernTimelineStatus: e.status,
        skyvernBlockStartedAt: e.startedAt,
        skyvernBlockCompletedAt: e.completedAt,
        exclusiveAppDurationMs: null,
        ...(metricsJson !== undefined ? { metricsJson } : {}),
      });
    }
    return rows;
  }

  private async persistSkyvernRunStart(params: {
    navigationId: string;
    userId: string;
    skyvernRunId: string;
    workflowPermanentId: string;
    run: SkyvernWorkflowRunResponse;
    receiptTime: Date;
    browserMode: 'hosted' | 'browser_worker';
  }): Promise<string | null> {
    const runStartedAt = parseSkyvernRunStartedAt(params.run, params.receiptTime);
    const status = skyvernApiStatusToPrisma(params.run.status);
    try {
      const row = await this.prisma.navigationSkyvernWorkflowRun.create({
        data: {
          navigationId: params.navigationId,
          userId: params.userId,
          skyvernRunId: params.skyvernRunId,
          skyvernWorkflowPermanentId: params.workflowPermanentId,
          runStartedAt,
          lastStatus: status,
          browserMode: params.browserMode,
          skyvernRunSnapshotJson: params.run as unknown as Prisma.InputJsonValue,
        },
      });
      return row.id;
    } catch (err) {
      this.logger.warn(
        `Failed to persist Skyvern workflow run: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async persistSkyvernRunPoll(
    session: NavigationPlaySession,
    run: SkyvernWorkflowRunResponse,
    timelineRaw: unknown,
  ): Promise<void> {
    if (!session.dbRunId) return;
    const status = skyvernApiStatusToPrisma(run.status);
    const terminal: SkyvernWorkflowRunStatus[] = [
      'completed',
      'failed',
      'terminated',
      'timed_out',
      'canceled',
    ];
    const isTerminal = terminal.includes(run.status);
    let finishedAt: Date | null = null;
    if (isTerminal) {
      const raw = run.finished_at?.trim();
      if (raw) {
        const t = Date.parse(raw);
        finishedAt = Number.isNaN(t) ? new Date() : new Date(t);
      } else {
        finishedAt = new Date();
      }
    }
    const blockRows = this.buildSkyvernBlockMetricRows(
      session.dbRunId,
      session.userId,
      session.skyvernBlockLabels,
      session.playActionSequences,
      timelineRaw,
    );
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.navigationSkyvernWorkflowRun.update({
          where: { id: session.dbRunId! },
          data: {
            lastStatus: status,
            failureReason: run.failure_reason ?? null,
            skyvernRunSnapshotJson: run as unknown as Prisma.InputJsonValue,
            skyvernTimelineJson: timelineRaw as Prisma.InputJsonValue,
            ...(finishedAt ? { finishedAt } : {}),
          },
        });
        await tx.navigationSkyvernWorkflowRunBlock.deleteMany({ where: { runId: session.dbRunId! } });
        if (blockRows.length > 0) {
          await tx.navigationSkyvernWorkflowRunBlock.createMany({ data: blockRows });
        }
      });
    } catch (err) {
      this.logger.warn(
        `Skyvern run metrics persist failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * When Skyvern runs in Docker, workflow URLs must not use `localhost` (that is the container).
   * Optional **`SKYVERN_PLAY_LOCALHOST_REWRITE_HOST`** (e.g. `host.docker.internal`).
   * If unset and **`SKYVERN_API_BASE_URL`** points at loopback, defaults to `host.docker.internal`.
   * Set **`SKYVERN_PLAY_DISABLE_LOCALHOST_REWRITE=true`** to skip rewriting.
   */
  private skyvernLocalhostRewriteHost(): string | undefined {
    if (this.config.get<string>('SKYVERN_PLAY_DISABLE_LOCALHOST_REWRITE')?.trim() === 'true') {
      return undefined;
    }
    const explicit = this.config.get<string>('SKYVERN_PLAY_LOCALHOST_REWRITE_HOST')?.trim();
    if (explicit) return explicit;
    return defaultLocalhostRewriteHostForSkyvern(this.config.get<string>('SKYVERN_API_BASE_URL'));
  }

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
    dbRunId: string | null;
  } {
    const s = this.sessions.get(navId);
    if (!s || s.userId !== userId) {
      return {
        active: false,
        skyvernRunId: null,
        lastStatus: null,
        playActiveSequence: null,
        dbRunId: null,
      };
    }
    return {
      active: true,
      skyvernRunId: s.skyvernRunId,
      lastStatus: s.lastStatus,
      playActiveSequence: s.lastActiveSequence,
      dbRunId: s.dbRunId,
    };
  }

  /**
   * Load navigation actions and build the same **`{ title, workflow_definition, status }`** payload
   * sent to Skyvern create/update (used by Play and GET preview).
   */
  private async loadPublishedWorkflowDefinition(
    navId: string,
    userId: string,
  ): Promise<{
    nav: NonNullable<Awaited<ReturnType<NavigationPlayService['prisma']['navigation']['findFirst']>>>;
    recorded: RecordedNavigationAction[];
    jsonDefinition: {
      title: string;
      workflow_definition: ReturnType<typeof buildSkyvernWorkflowApiPayload>['workflow_definition'];
      status: 'published';
    };
  }> {
    const nav = await this.prisma.navigation.findFirst({
      where: { id: navId, userId },
      include: { actions: { orderBy: { sequence: 'asc' } } },
    });
    if (!nav) throw new NotFoundException(`Navigation ${navId} not found`);
    if (nav.actions.length === 0) {
      throw new BadRequestException('No recorded actions — record a navigation first');
    }
    const recorded = nav.actions.map(prismaActionToRecorded);
    const localhostRewriteHost = this.skyvernLocalhostRewriteHost();
    if (localhostRewriteHost) {
      this.logger.debug(`Navigation Play: rewriting loopback URLs in workflow to host ${localhostRewriteHost}`);
    }
    const { title, workflow_definition } = buildSkyvernWorkflowApiPayload(
      { id: nav.id, name: nav.name, url: nav.url },
      recorded,
      { localhostRewriteHost },
    );
    return {
      nav,
      recorded,
      jsonDefinition: {
        title,
        workflow_definition,
        status: 'published',
      },
    };
  }

  /**
   * Preview/export: same JSON as Skyvern workflow sync (no Skyvern API call).
   */
  async getSkyvernWorkflowDefinition(
    navId: string,
    userId: string,
  ): Promise<{
    title: string;
    workflow_definition: ReturnType<typeof buildSkyvernWorkflowApiPayload>['workflow_definition'];
    status: 'published';
  }> {
    const { jsonDefinition } = await this.loadPublishedWorkflowDefinition(navId, userId);
    return jsonDefinition;
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
    /** Persisted run row id (null if DB insert failed). */
    dbRunId: string | null;
    /** Canonical run start timestamp (ISO 8601). */
    runStartedAt: string;
  }> {
    this.skyvern.assertConfigured();
    if (this.moduleRef.get(NavigationRecordingService, { strict: false }).hasSession(navId)) {
      throw new ConflictException('Stop recording before starting Play');
    }
    this.assertNoPlaySession(navId);

    const { nav, recorded, jsonDefinition } = await this.loadPublishedWorkflowDefinition(navId, userId);

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
    const receiptTime = new Date();
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

    const skyvernBlockLabels = jsonDefinition.workflow_definition.blocks.map((b) => b.label);
    const playActionSequences = recorded.map((a) => a.sequence);
    const browserMode: 'hosted' | 'browser_worker' = useHostedBrowser ? 'hosted' : 'browser_worker';
    const dbRunId = await this.persistSkyvernRunStart({
      navigationId: navId,
      userId,
      skyvernRunId: run.run_id,
      workflowPermanentId: workflowId,
      run,
      receiptTime,
      browserMode,
    });

    const room = this.playRoomId(navId);
    const session: NavigationPlaySession = {
      navigationId: navId,
      userId,
      skyvernRunId: run.run_id,
      dbRunId,
      workflowPermanentIdForRun: workflowId,
      wsEndpoint: browserAddressForSkyvern ?? '',
      pollTimer: null,
      playStartedAt: Date.now(),
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

    const scheduleFollowingPoll = (): void => {
      const s = this.sessions.get(navId);
      if (!s || s.stopped) return;
      const elapsed = Date.now() - s.playStartedAt;
      const burst =
        !s.latestFrame && elapsed < POLL_BURST_FOR_FIRST_FRAME_MS;
      const delay = burst ? POLL_MS_UNTIL_FIRST_FRAME : POLL_MS;
      s.pollTimer = setTimeout(() => {
        void this.pollOnce(navId, userId).finally(() => {
          scheduleFollowingPoll();
        });
      }, delay);
    };
    void this.pollOnce(navId, userId).finally(() => {
      scheduleFollowingPoll();
    });

    return {
      skyvernRunId: run.run_id,
      workflowId,
      browserAddress: browserAddressForSkyvern ?? '',
      activeSequence: session.lastActiveSequence,
      dbRunId,
      runStartedAt: parseSkyvernRunStartedAt(run, receiptTime).toISOString(),
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
      await this.persistSkyvernRunPoll(session, run, timelineRaw);

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
        appUrl: run.app_url ?? null,
        recordingUrl: run.recording_url ?? null,
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

      let didPushFrame = false;

      const timelineScreenshots = collectTimelineScreenshotUrls(timelineRaw);
      if (timelineScreenshots.length > 0) {
        const newest = timelineScreenshots.slice().reverse();
        for (const imageUrl of newest.slice(0, 5)) {
          const fetched = await this.fetchScreenshotAsBase64(imageUrl);
          if (fetched) {
            this.pushPlayFrame(navId, session, fetched, 'run_urls');
            didPushFrame = true;
            break;
          }
        }
      }

      if (!didPushFrame) {
        const runUrls = this.collectRunScreenshotUrls(run);
        for (const imageUrl of runUrls) {
          const fetched = await this.fetchScreenshotAsBase64(imageUrl);
          if (fetched) {
            this.pushPlayFrame(navId, session, fetched, 'run_urls');
            didPushFrame = true;
            break;
          }
        }
      }

      if (!didPushFrame) {
        const { shots } = await this.listScreenshotArtifactsSorted(session.skyvernRunId);
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
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Play poll error nav=${navId}: ${msg}`);
    }
  }

  /**
   * Skyvern: `screenshot_urls` are reverse-chronological — **index 0 is the latest** (OpenAPI).
   * Try in order so the freshest presign is attempted first; still iterate the rest if GET fails.
   */
  private collectRunScreenshotUrls(run: SkyvernWorkflowRunResponse): string[] {
    const urls = run.screenshot_urls;
    if (!Array.isArray(urls) || urls.length === 0) return [];
    return urls.filter((u): u is string => typeof u === 'string' && u.startsWith('http'));
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
    let arts = await this.skyvern.listRunArtifacts(runId);
    if (arts.length === 0) {
      arts = await this.skyvern.listRunArtifacts(runId, 'screenshot');
    }
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
    if (cancelled && session.dbRunId) {
      try {
        const [run, timelineRaw] = await Promise.all([
          this.skyvern.getRun(session.skyvernRunId),
          this.skyvern.getRunTimeline(session.skyvernRunId),
        ]);
        await this.persistSkyvernRunPoll(session, run, timelineRaw);
      } catch (err) {
        this.logger.warn(
          `Skyvern run final persist on cancel failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    session.stopped = true;
    if (session.pollTimer) {
      clearTimeout(session.pollTimer);
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

  async listSkyvernWorkflowRuns(navId: string, userId: string) {
    const nav = await this.prisma.navigation.findFirst({
      where: { id: navId, userId },
      select: { id: true },
    });
    if (!nav) throw new NotFoundException(`Navigation ${navId} not found`);

    return this.prisma.navigationSkyvernWorkflowRun.findMany({
      where: { navigationId: navId, userId },
      orderBy: { runStartedAt: 'desc' },
      select: {
        id: true,
        skyvernRunId: true,
        skyvernWorkflowPermanentId: true,
        runStartedAt: true,
        lastStatus: true,
        finishedAt: true,
        failureReason: true,
        browserMode: true,
        createdAt: true,
      },
    });
  }

  async getSkyvernWorkflowRunDetail(navId: string, runId: string, userId: string) {
    const nav = await this.prisma.navigation.findFirst({
      where: { id: navId, userId },
      select: { id: true },
    });
    if (!nav) throw new NotFoundException(`Navigation ${navId} not found`);

    const run = await this.prisma.navigationSkyvernWorkflowRun.findFirst({
      where: { id: runId, navigationId: navId, userId },
      include: {
        blocks: { orderBy: { blockIndex: 'asc' } },
      },
    });
    if (!run) throw new NotFoundException(`Skyvern workflow run ${runId} not found`);
    return run;
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
