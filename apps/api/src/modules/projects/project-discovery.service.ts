import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { LlmService } from '../llm/llm.service';
import { randomUUID } from 'node:crypto';
import { normalizeDiscoveryUrlForDedup } from './discovery-url.util';
import { DiscoveryNavigationTree } from './discovery-navigation-tree';
import type { DiscoveryLlmExchangePayload } from '../llm/discovery-llm-log.types';

/** Max LLM-driven exploration steps (each may execute one Playwright snippet). */
const DISCOVERY_MAX_EXPLORATION_STEPS = 200;
/** Wall-clock cap for exploration (auth + final LLM synthesis are outside this window). */
const DISCOVERY_MAX_WALL_MS = 45 * 60 * 1000;
/** Do not honor model "stop" until this many steps have executed (unless blocked). */
const DISCOVERY_MIN_STEPS_BEFORE_STOP = 28;
/** And until this many distinct normalized URLs have been seen (AND with min steps). */
const DISCOVERY_MIN_DISTINCT_URLS_BEFORE_STOP = 32;
/** Extra vision calls when the model stops before the budget. */
const DISCOVERY_EXPLORE_MAX_RETRIES = 2;

/** Max depth in the IA tree (0 = root). */
export const DISCOVERY_MAX_NAV_DEPTH = 5;

async function sleepMsOrAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException('Discovery cancelled', 'AbortError');
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(t);
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Discovery cancelled', 'AbortError'));
    };
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort);
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Discovery cancelled', 'AbortError');
}

/** Collapse whitespace so near-identical snippets dedupe for attempt limits. */
function normalizeDiscoveryPlaywrightCode(code: string): string {
  return code.replace(/\s+/g, ' ').trim();
}

/** Persisted in `project_agent_knowledge.discovery_steps_json` for the latest run. */
export type DiscoveryRunStepJson = {
  id: string;
  sequence: number;
  kind: 'orchestrator_goto' | 'orchestrator_auth' | 'llm_explore';
  title: string;
  playwrightCode?: string;
  outcome?: 'success' | 'failed' | 'blocked';
  error?: string;
  thinkingStructured?: Record<string, unknown>;
  createdAt: string;
};

/**
 * LLM-driven breadth-first exploration + final evidence-based report.
 */
@Injectable()
export class ProjectDiscoveryService {
  private readonly logger = new Logger(ProjectDiscoveryService.name);
  private readonly busy = new Set<string>();
  private readonly runAbortControllers = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly recording: RecordingService,
    private readonly llm: LlmService,
  ) {}

  private async appendDiscoveryStep(
    projectId: string,
    steps: DiscoveryRunStepJson[],
    row: Omit<DiscoveryRunStepJson, 'id' | 'sequence' | 'createdAt'>,
  ): Promise<void> {
    const sequence = steps.length + 1;
    const full: DiscoveryRunStepJson = {
      id: randomUUID(),
      sequence,
      createdAt: new Date().toISOString(),
      ...row,
    };
    steps.push(full);
    await this.prisma.projectAgentKnowledge.update({
      where: { projectId },
      data: { discoveryStepsJson: steps as unknown as Prisma.InputJsonValue },
    });
  }

  /** True when this Node process has an in-flight discovery job (lost on restart; DB may still say queued/running). */
  isDiscoveryBusy(projectId: string): boolean {
    return this.busy.has(projectId);
  }

  /**
   * Request cancellation of the in-process discovery run (abort signal + best-effort cleanup in finally).
   */
  async cancel(projectId: string, userId: string): Promise<{ cancelled: boolean; reason?: string }> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    if (!this.busy.has(projectId)) {
      return { cancelled: false, reason: 'No discovery run is in progress for this project.' };
    }
    this.runAbortControllers.get(projectId)?.abort();
    return { cancelled: true };
  }

  /**
   * @returns 202-style payload; runs async in-process.
   */
  async trigger(projectId: string, userId: string): Promise<{ accepted: boolean; reason?: string }> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    if (project.kind !== 'WEB' || !project.url?.trim()) {
      return { accepted: false, reason: 'Discovery requires a web project with a URL.' };
    }
    if (this.busy.has(projectId)) {
      return { accepted: false, reason: 'Discovery is already running for this project.' };
    }

    await this.prisma.projectAgentKnowledge.upsert({
      where: { projectId },
      create: { projectId, discoveryStatus: 'queued', discoveryNavigationMermaid: null, discoveryStepsJson: [] },
      update: {
        discoveryStatus: 'queued',
        discoveryError: null,
        discoveryNavigationMermaid: null,
        discoveryStepsJson: [],
      },
    });

    this.busy.add(projectId);
    const ac = new AbortController();
    this.runAbortControllers.set(projectId, ac);
    void this.runJob(projectId, userId, ac.signal).finally(() => {
      this.busy.delete(projectId);
      this.runAbortControllers.delete(projectId);
    });
    return { accepted: true };
  }

  private async runJob(projectId: string, userId: string, signal: AbortSignal): Promise<void> {
    const discoverySessionId = randomUUID();
    const log = (message: string, detail?: Record<string, unknown>) =>
      this.recording.emitDiscoveryDebugLog(projectId, message, detail);
    const emitLlmExchange = (message: string, payload: DiscoveryLlmExchangePayload) =>
      this.recording.emitDiscoveryDebugLog(projectId, message, { llm: payload });
    let finalMermaid: string | null = null;
    const discoverySteps: DiscoveryRunStepJson[] = [];
    try {
      throwIfAborted(signal);
      const project = await this.prisma.project.findFirst({
        where: { id: projectId, userId },
      });
      if (!project?.url?.trim()) {
        throw new Error('Project URL missing');
      }

      this.recording.clearDiscoveryDebugLog(projectId);
      this.recording.beginDiscoveryLogFile(projectId, project.name);
      log('Discovery run started', { discoverySessionId });
      await this.prisma.projectAgentKnowledge.update({
        where: { projectId },
        data: {
          discoveryStatus: 'running',
          discoveryStartedAt: new Date(),
          discoveryError: null,
          discoveryNavigationMermaid: null,
          discoveryStepsJson: [],
        },
      });
      log('Status set to running; persisting discoveryStartedAt');

      await this.recording.startDiscoverySession(discoverySessionId, userId, projectId);
      log('Remote browser connected (browser-worker); screencast attached');

      log('Loaded project record', { name: project.name, url: project.url?.trim() });

      log('Navigating to base URL (domcontentloaded)', { url: project.url.trim() });
      await this.recording.discoveryGoto(discoverySessionId, userId, project.url.trim());
      log('Initial navigation finished');
      await this.appendDiscoveryStep(projectId, discoverySteps, {
        kind: 'orchestrator_goto',
        title: 'Load project URL',
        playwrightCode: `await page.goto(${JSON.stringify(project.url.trim())}, { waitUntil: 'domcontentloaded', timeout: 120_000 });`,
        outcome: 'success',
      });

      const authState = { clerkFullSignInDone: false };
      /** Match evaluations: attempt assist whenever a test email is set (Clerk can use env credentials; generic still needs password in project). */
      const wantAuto = !!project.testUserEmail?.trim();
      const signInMaxIters = 15;
      log('Starting automatic sign-in assist phase', {
        wantAuto,
        iterationsMax: signInMaxIters,
      });
      for (let i = 0; i < signInMaxIters; i++) {
        throwIfAborted(signal);
        log(`Auto sign-in assist iteration ${i + 1}/${signInMaxIters}`);
        await this.recording.maybeDiscoveryAutoSignInAssist(discoverySessionId, userId, {
          runUrl: project.url.trim(),
          projectForAuth: {
            testUserEmail: project.testUserEmail,
            testUserPassword: project.testUserPassword,
            testEmailProvider: project.testEmailProvider,
          },
          wantAuto,
          clerkOtpMode: this.recording.resolveClerkOtpModeForEvaluation(project.testEmailProvider),
          state: authState,
        });
        await this.recording.discoveryWaitForDomContentLoaded(discoverySessionId, userId);
        log('Assist iteration complete', { clerkFullSignInDone: authState.clerkFullSignInDone });
        if (authState.clerkFullSignInDone) {
          break;
        }
        await sleepMsOrAbort(1200, signal);
      }
      await this.recording.discoveryWaitForDomContentLoaded(discoverySessionId, userId);
      await this.appendDiscoveryStep(projectId, discoverySteps, {
        kind: 'orchestrator_auth',
        title: 'Automatic sign-in',
        outcome: authState.clerkFullSignInDone ? 'success' : 'failed',
        error: authState.clerkFullSignInDone
          ? undefined
          : 'Sign-in assist did not complete within iteration budget',
      });
      /** Let SPAs hydrate after auth before exploration. */
      log('Waiting 2.5s for SPA to settle after auth');
      await sleepMsOrAbort(2500, signal);

      /** Exploration-only wall clock (auth + settle do not count toward the crawl cap). */
      const explorationStartedAt = Date.now();
      log('Exploration phase started', {
        maxSteps: DISCOVERY_MAX_EXPLORATION_STEPS,
        maxWallMs: DISCOVERY_MAX_WALL_MS,
        minStepsBeforeStop: DISCOVERY_MIN_STEPS_BEFORE_STOP,
        minDistinctUrlsBeforeStop: DISCOVERY_MIN_DISTINCT_URLS_BEFORE_STOP,
      });
      const authContextSummary = project.testUserEmail?.trim()
        ? `Test email configured (automatic sign-in attempted). Email provider: ${project.testEmailProvider ?? 'default'}. Password ${project.testUserPassword?.trim() ? 'configured' : 'not set'}.`
        : 'No test email configured; only public/unauthenticated flows were available.';

      const explorationLogLines: string[] = [];
      let stepIndex = 0;
      let consecutiveFailures = 0;
      /** Last executed snippet + outcome for the next explore call (success or failure). */
      let lastStepOutcome: { code: string; ok: boolean; error?: string } | undefined;
      /** Count executions per normalized playwrightCode (max 2 runs; 3rd identical is blocked). */
      const codeAttemptCounts = new Map<string, number>();
      const navTree = new DiscoveryNavigationTree(DISCOVERY_MAX_NAV_DEPTH);
      navTree.syncFromVisitedScreens(this.recording.getDiscoveryVisitedScreens(discoverySessionId));
      finalMermaid = navTree.toMermaid();
      this.recording.emitDiscoveryNavigationMermaid(projectId, finalMermaid);

      let explorationLoopIterations = 0;
      while (stepIndex < DISCOVERY_MAX_EXPLORATION_STEPS && Date.now() - explorationStartedAt < DISCOVERY_MAX_WALL_MS) {
        explorationLoopIterations += 1;
        if (explorationLoopIterations > DISCOVERY_MAX_EXPLORATION_STEPS * 4) {
          log('Exploration ended: loop guard (too many iterations without advancing steps)');
          explorationLogLines.push('Exploration stopped: internal loop guard (duplicate-code retries).');
          break;
        }
        throwIfAborted(signal);
        const elapsedMs = Date.now() - explorationStartedAt;
        log(`Exploration loop iteration (completed steps: ${stepIndex})`, {
          elapsedMs,
          wallRemainingMs: DISCOVERY_MAX_WALL_MS - elapsedMs,
        });
        log('Capturing page for exploration (Set-of-Marks + accessibility + screenshot)');
        const ctx = await this.recording.captureDiscoveryLlmPageContext(discoverySessionId, userId);
        const shot = ctx.screenshotBase64?.trim();
        if (!shot) {
          throw new Error('Discovery capture produced no screenshot');
        }
        log('Page snapshot captured', {
          pageUrl: ctx.pageUrl,
          pageTitle: ctx.pageTitle?.slice(0, 200),
          screenshotChars: shot.length,
        });
        const visitedScreensSoFar = this.recording.getDiscoveryVisitedScreens(discoverySessionId);
        navTree.syncFromVisitedScreens(visitedScreensSoFar);
        finalMermaid = navTree.toMermaid();
        this.recording.emitDiscoveryNavigationMermaid(projectId, finalMermaid);
        const uniqNorm = new Set(visitedScreensSoFar.map((v) => normalizeDiscoveryUrlForDedup(v.url)));
        const explorationIncomplete =
          stepIndex < DISCOVERY_MIN_STEPS_BEFORE_STOP ||
          uniqNorm.size < DISCOVERY_MIN_DISTINCT_URLS_BEFORE_STOP;
        log('Visited screens count', {
          rawNavigations: visitedScreensSoFar.length,
          distinctNormalizedUrls: uniqNorm.size,
        });

        const exploreBase = {
          baseUrl: project.url.trim(),
          authContextSummary,
          maxNavigations: DISCOVERY_MAX_EXPLORATION_STEPS,
          maxWallMs: DISCOVERY_MAX_WALL_MS,
          elapsedMs,
          stepIndex,
          navigationsSoFar: uniqNorm.size,
          minStepsBeforeStop: DISCOVERY_MIN_STEPS_BEFORE_STOP,
          minDistinctUrlsBeforeStop: DISCOVERY_MIN_DISTINCT_URLS_BEFORE_STOP,
          visitedUrlsSample: [...uniqNorm],
          pageUrl: ctx.pageUrl,
          pageTitle: ctx.pageTitle,
          somManifest: ctx.somManifest,
          accessibilitySnapshot: ctx.accessibilitySnapshot,
          screenshotBase64: shot,
          navigationTreeSummary: navTree.formatSummaryForLlm(),
          maxNavDepth: DISCOVERY_MAX_NAV_DEPTH,
          currentNavDepth: navTree.depthOf(navTree.focusId),
          lastStepOutcome,
        };

        let plan = await this.llm.projectDiscoveryExploreStep(exploreBase, {
          userId,
          signal,
          onLlmExchange: (payload) => emitLlmExchange(`LLM explore step ${stepIndex + 1}`, payload),
        });

        for (let r = 0; r < DISCOVERY_EXPLORE_MAX_RETRIES; r++) {
          const valid = !plan.stop && !!plan.playwrightCode?.trim();
          if (valid) {
            break;
          }
          const wallRemainingMs = DISCOVERY_MAX_WALL_MS - (Date.now() - explorationStartedAt);
          if (!explorationIncomplete || wallRemainingMs < 120_000) {
            break;
          }
          this.logger.warn(
            `Discovery: retrying explore after premature stop (project ${projectId}, completedSteps=${stepIndex}, urls=${uniqNorm.size}, retry ${r + 1})`,
          );
          log(`Retrying explore LLM after premature stop (${r + 1}/${DISCOVERY_EXPLORE_MAX_RETRIES})`, {
            reason: plan.reason?.slice(0, 300),
          });
          explorationLogLines.push(
            `Premature stop or empty code — retry ${r + 1}/${DISCOVERY_EXPLORE_MAX_RETRIES}: ${plan.reason}`,
          );
          plan = await this.llm.projectDiscoveryExploreStep(
            {
              ...exploreBase,
              continuationHint:
                'You are below the minimum exploration budget. Do not stop. Open a different major area: pick a visible sidebar, top nav, or menu destination you have not followed yet; or open one list row / primary action on the current screen. Prefer breadth across product areas. Return stop=false with one playwrightCode line.',
            },
            {
              userId,
              signal,
              onLlmExchange: (payload) =>
                emitLlmExchange(
                  `LLM explore step ${stepIndex + 1} (retry ${r + 1}/${DISCOVERY_EXPLORE_MAX_RETRIES})`,
                  payload,
                ),
            },
          );
        }

        if (plan.stop || !plan.playwrightCode?.trim()) {
          log('Exploration stopping (model stop or empty code)', { reason: plan.reason?.slice(0, 500) });
          explorationLogLines.push(`Explore stop at step ${stepIndex + 1}: ${plan.reason}`);
          break;
        }

        const rawPw = plan.playwrightCode.trim();
        const pwKey = normalizeDiscoveryPlaywrightCode(rawPw);
        const priorAttempts = codeAttemptCounts.get(pwKey) ?? 0;
        if (priorAttempts >= 2) {
          const blockedMsg =
            'Blocked: identical playwrightCode was already executed twice; use a different locator, scope, or interaction.';
          lastStepOutcome = { code: plan.playwrightCode, ok: false, error: blockedMsg };
          explorationLogLines.push(
            `Step ${stepIndex + 1} BLOCKED (same normalized code would be 3rd attempt): ${rawPw.slice(0, 400)}`,
          );
          log('Discovery explore blocked duplicate playwrightCode', {
            priorAttempts,
            keyPreview: pwKey.slice(0, 240),
          });
          await this.appendDiscoveryStep(projectId, discoverySteps, {
            kind: 'llm_explore',
            title: (plan.reason?.slice(0, 200) || 'Explore step').trim(),
            playwrightCode: plan.playwrightCode,
            thinkingStructured: plan.thinkingStructured as unknown as Record<string, unknown> | undefined,
            outcome: 'blocked',
            error: blockedMsg,
          });
          // #region agent log
          fetch('http://127.0.0.1:7445/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ba63e6' },
            body: JSON.stringify({
              sessionId: 'ba63e6',
              location: 'project-discovery.service.ts:discovery_duplicate_blocked',
              message: 'discovery duplicate playwright blocked',
              data: { hypothesisId: 'H2', priorAttempts, keyPreview: pwKey.slice(0, 200) },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          await sleepMsOrAbort(500, signal);
          continue;
        }

        let stepOk = false;
        try {
          log('Executing Playwright snippet from explore step');
          await this.recording.discoveryRunPlaywrightSnippet(
            discoverySessionId,
            userId,
            plan.playwrightCode,
          );
          log('Playwright snippet completed');
          codeAttemptCounts.set(pwKey, (codeAttemptCounts.get(pwKey) ?? 0) + 1);
          lastStepOutcome = { code: plan.playwrightCode, ok: true };
          const codePreview =
            plan.playwrightCode.length > 500 ? `${plan.playwrightCode.slice(0, 500)}…` : plan.playwrightCode;
          explorationLogLines.push(
            `Step ${stepIndex + 1}: ${plan.reason}\n\`\`\`js\n${codePreview}\n\`\`\``,
          );
          consecutiveFailures = 0;
          stepOk = true;
          await this.appendDiscoveryStep(projectId, discoverySteps, {
            kind: 'llm_explore',
            title: (plan.reason?.slice(0, 200) || 'Explore step').trim(),
            playwrightCode: plan.playwrightCode,
            thinkingStructured: plan.thinkingStructured as unknown as Record<string, unknown> | undefined,
            outcome: 'success',
          });
        } catch (err) {
          consecutiveFailures += 1;
          const msg = err instanceof Error ? err.message : String(err);
          codeAttemptCounts.set(pwKey, (codeAttemptCounts.get(pwKey) ?? 0) + 1);
          lastStepOutcome = { code: plan.playwrightCode ?? '', ok: false, error: msg };
          // #region agent log
          fetch('http://127.0.0.1:7445/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ba63e6' },
            body: JSON.stringify({
              sessionId: 'ba63e6',
              location: 'project-discovery.service.ts:discovery_pw_fail',
              message: 'discovery explore snippet failed',
              data: { hypothesisId: 'H1', errPreview: msg.slice(0, 300), codePreview: (plan.playwrightCode ?? '').slice(0, 200) },
              timestamp: Date.now(),
            }),
          }).catch(() => {});
          // #endregion
          log('Playwright snippet failed', { error: msg.slice(0, 800), consecutiveFailures });
          explorationLogLines.push(`Step ${stepIndex + 1} FAILED: ${msg}`);
          await this.appendDiscoveryStep(projectId, discoverySteps, {
            kind: 'llm_explore',
            title: (plan.reason?.slice(0, 200) || 'Explore step').trim(),
            playwrightCode: plan.playwrightCode,
            thinkingStructured: plan.thinkingStructured as unknown as Record<string, unknown> | undefined,
            outcome: 'failed',
            error: msg,
          });
          if (consecutiveFailures >= 5) {
            log('Aborting exploration after 5 consecutive Playwright failures');
            explorationLogLines.push('Aborted exploration after 5 consecutive failures.');
            break;
          }
        }

        await this.recording.discoveryWaitForDomContentLoaded(discoverySessionId, userId);
        log('Waiting 900ms before next exploration step');
        await sleepMsOrAbort(900, signal);
        if (stepOk) {
          navTree.syncFromVisitedScreens(this.recording.getDiscoveryVisitedScreens(discoverySessionId));
          if (plan.subsectionComplete) {
            navTree.subsectionComplete();
          }
          finalMermaid = navTree.toMermaid();
          this.recording.emitDiscoveryNavigationMermaid(projectId, finalMermaid);
        }
        stepIndex += 1;
      }

      if (Date.now() - explorationStartedAt >= DISCOVERY_MAX_WALL_MS) {
        log('Exploration ended: wall clock cap reached');
        explorationLogLines.push('Exploration stopped: wall clock cap reached.');
      } else if (stepIndex >= DISCOVERY_MAX_EXPLORATION_STEPS) {
        log('Exploration ended: max steps reached');
        explorationLogLines.push('Exploration stopped: max exploration steps reached.');
      }

      throwIfAborted(signal);
      log('Starting final page capture for synthesis');
      const finalCtx = await this.recording.captureDiscoveryLlmPageContext(discoverySessionId, userId);
      const visitedScreens = this.recording.getDiscoveryVisitedScreens(discoverySessionId);
      const finalShot = finalCtx.screenshotBase64?.trim();
      if (!finalShot) {
        throw new Error('Discovery final capture produced no screenshot');
      }
      const finalReport = await this.llm.projectDiscoveryFinalReport(
        {
          projectName: project.name,
          baseUrl: project.url.trim(),
          authContextSummary,
          signInAssistCompleted: authState.clerkFullSignInDone,
          explorationLogMarkdown: explorationLogLines.join('\n\n'),
          screensVisitedAuthoritative: visitedScreens,
          finalPageUrl: finalCtx.pageUrl,
          somManifest: finalCtx.somManifest,
          accessibilitySnapshot: finalCtx.accessibilitySnapshot,
          screenshotBase64: finalShot,
        },
        {
          userId,
          signal,
          onLlmExchange: (payload) => emitLlmExchange('LLM project_discovery (final synthesis)', payload),
        },
      );

      const section1Lines = visitedScreens
        .map((v) => `${v.url} — ${v.title?.trim() ? v.title : '(no title)'}`)
        .join('\n');
      const discoverySummaryMarkdown = `# Screens Visited\n\n${section1Lines || '(none)'}\n\n# Discovery Summary\n\n${finalReport.discoverySummaryBodyMarkdown}`;

      const structuredMerged = {
        ...finalReport.structured,
        schemaVersion: 1,
        screensVisited: visitedScreens,
      };

      log('Persisting discovery results to database (completed)');
      await this.prisma.projectAgentKnowledge.update({
        where: { projectId },
        data: {
          discoveryStatus: 'completed',
          discoveryCompletedAt: new Date(),
          discoverySummaryMarkdown,
          discoveryStructured: structuredMerged as object,
          discoveryNavigationMermaid: finalMermaid,
          discoveryError: null,
          discoveryStepsJson: discoverySteps as unknown as Prisma.InputJsonValue,
        },
      });
      log('Discovery run completed successfully');
    } catch (e) {
      const aborted =
        signal.aborted ||
        (e instanceof DOMException && e.name === 'AbortError') ||
        (e instanceof Error && e.name === 'AbortError');
      const msg = aborted
        ? 'Cancelled by user.'
        : e instanceof Error
          ? e.message
          : String(e);
      this.logger.warn(`Project discovery failed for ${projectId}: ${msg}`);
      this.recording.emitDiscoveryDebugLog(projectId, aborted ? 'Discovery cancelled' : 'Discovery run failed', {
        error: msg.slice(0, 2000),
      });
      const partialMermaid = this.recording.getDiscoveryNavigationMermaid(projectId);
      await this.prisma.projectAgentKnowledge
        .update({
          where: { projectId },
          data: {
            discoveryStatus: 'failed',
            discoveryCompletedAt: new Date(),
            discoveryError: msg.slice(0, 8000),
            discoveryStepsJson: discoverySteps as unknown as Prisma.InputJsonValue,
            ...(partialMermaid ? { discoveryNavigationMermaid: partialMermaid } : {}),
          },
        })
        .catch(() => {});
    } finally {
      this.recording.emitDiscoveryDebugLog(projectId, 'Closing remote browser session');
      await this.recording.stopDiscoverySession(discoverySessionId, userId).catch(() => {});
      const logBasename = await this.recording.finalizeDiscoveryLogFile(projectId);
      if (logBasename) {
        await this.prisma.projectAgentKnowledge
          .update({
            where: { projectId },
            data: { discoveryAgentLogFile: logBasename },
          })
          .catch(() => {});
      }
    }
  }
}
