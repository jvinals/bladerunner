import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { LlmService } from '../llm/llm.service';
import { randomUUID } from 'node:crypto';
import { sleepMs } from '@bladerunner/clerk-agentmail-signin';
import { normalizeDiscoveryUrlForDedup } from './discovery-url.util';
import { DiscoveryNavigationTree } from './discovery-navigation-tree';

/** Max LLM-driven exploration steps (each may execute one Playwright snippet). */
const DISCOVERY_MAX_EXPLORATION_STEPS = 200;
/** Wall-clock cap for exploration (auth + final LLM synthesis are outside this window). */
const DISCOVERY_MAX_WALL_MS = 45 * 60 * 1000;
/** Do not honor model "stop" until this many steps have executed (unless blocked). */
const DISCOVERY_MIN_STEPS_BEFORE_STOP = 28;
/** Or until this many distinct normalized URLs have been seen. */
const DISCOVERY_MIN_DISTINCT_URLS_BEFORE_STOP = 14;
/** Extra vision calls when the model stops before the budget. */
const DISCOVERY_EXPLORE_MAX_RETRIES = 2;

/** Max depth in the IA tree (0 = root). */
export const DISCOVERY_MAX_NAV_DEPTH = 5;

/**
 * LLM-driven breadth-first exploration + final evidence-based report.
 */
@Injectable()
export class ProjectDiscoveryService {
  private readonly logger = new Logger(ProjectDiscoveryService.name);
  private readonly busy = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly recording: RecordingService,
    private readonly llm: LlmService,
  ) {}

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
      create: { projectId, discoveryStatus: 'queued', discoveryNavigationMermaid: null },
      update: {
        discoveryStatus: 'queued',
        discoveryError: null,
        discoveryNavigationMermaid: null,
      },
    });

    this.busy.add(projectId);
    void this.runJob(projectId, userId).finally(() => this.busy.delete(projectId));
    return { accepted: true };
  }

  private async runJob(projectId: string, userId: string): Promise<void> {
    const discoverySessionId = randomUUID();
    const log = (message: string, detail?: Record<string, unknown>) =>
      this.recording.emitDiscoveryDebugLog(projectId, message, detail);
    let finalMermaid: string | null = null;
    try {
      this.recording.clearDiscoveryDebugLog(projectId);
      log('Discovery run started', { discoverySessionId });
      await this.prisma.projectAgentKnowledge.update({
        where: { projectId },
        data: {
          discoveryStatus: 'running',
          discoveryStartedAt: new Date(),
          discoveryError: null,
          discoveryNavigationMermaid: null,
        },
      });
      log('Status set to running; persisting discoveryStartedAt');

      await this.recording.startDiscoverySession(discoverySessionId, userId, projectId);
      log('Remote browser connected (browser-worker); screencast attached');

      const project = await this.prisma.project.findFirst({
        where: { id: projectId, userId },
      });
      if (!project?.url?.trim()) {
        throw new Error('Project URL missing');
      }
      log('Loaded project record', { name: project.name, url: project.url?.trim() });

      log('Navigating to base URL (domcontentloaded)', { url: project.url.trim() });
      await this.recording.discoveryGoto(discoverySessionId, userId, project.url.trim());
      log('Initial navigation finished');

      const authState = { clerkFullSignInDone: false };
      /** Match evaluations: attempt assist whenever a test email is set (Clerk can use env credentials; generic still needs password in project). */
      const wantAuto = !!project.testUserEmail?.trim();
      const signInMaxIters = 15;
      log('Starting automatic sign-in assist phase', {
        wantAuto,
        iterationsMax: signInMaxIters,
      });
      for (let i = 0; i < signInMaxIters; i++) {
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
        await sleepMs(1200);
      }
      await this.recording.discoveryWaitForDomContentLoaded(discoverySessionId, userId);
      /** Let SPAs hydrate after auth before exploration. */
      log('Waiting 2.5s for SPA to settle after auth');
      await sleepMs(2500);

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
      const navTree = new DiscoveryNavigationTree(DISCOVERY_MAX_NAV_DEPTH);
      navTree.syncFromVisitedScreens(this.recording.getDiscoveryVisitedScreens(discoverySessionId));
      finalMermaid = navTree.toMermaid();
      this.recording.emitDiscoveryNavigationMermaid(projectId, finalMermaid);

      while (stepIndex < DISCOVERY_MAX_EXPLORATION_STEPS && Date.now() - explorationStartedAt < DISCOVERY_MAX_WALL_MS) {
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
        };

        log('Calling explore LLM (project_discovery) for next action');
        let plan = await this.llm.projectDiscoveryExploreStep(exploreBase, { userId });
        log('Explore LLM response', {
          stop: plan.stop,
          subsectionComplete: plan.subsectionComplete,
          reason: plan.reason?.slice(0, 500),
          playwrightCodeChars: plan.playwrightCode?.length ?? 0,
        });

        for (let r = 0; r < DISCOVERY_EXPLORE_MAX_RETRIES; r++) {
          const valid = !plan.stop && !!plan.playwrightCode?.trim();
          if (valid) {
            break;
          }
          const underBudget =
            stepIndex < DISCOVERY_MIN_STEPS_BEFORE_STOP && uniqNorm.size < DISCOVERY_MIN_DISTINCT_URLS_BEFORE_STOP;
          const wallRemainingMs = DISCOVERY_MAX_WALL_MS - (Date.now() - explorationStartedAt);
          if (!underBudget || wallRemainingMs < 120_000) {
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
            { userId },
          );
          log('Explore LLM retry response', {
            stop: plan.stop,
            playwrightCodeChars: plan.playwrightCode?.length ?? 0,
          });
        }

        if (plan.stop || !plan.playwrightCode?.trim()) {
          log('Exploration stopping (model stop or empty code)', { reason: plan.reason?.slice(0, 500) });
          explorationLogLines.push(`Explore stop at step ${stepIndex + 1}: ${plan.reason}`);
          break;
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
          const codePreview =
            plan.playwrightCode.length > 500 ? `${plan.playwrightCode.slice(0, 500)}…` : plan.playwrightCode;
          explorationLogLines.push(
            `Step ${stepIndex + 1}: ${plan.reason}\n\`\`\`js\n${codePreview}\n\`\`\``,
          );
          consecutiveFailures = 0;
          stepOk = true;
        } catch (err) {
          consecutiveFailures += 1;
          const msg = err instanceof Error ? err.message : String(err);
          log('Playwright snippet failed', { error: msg.slice(0, 800), consecutiveFailures });
          explorationLogLines.push(`Step ${stepIndex + 1} FAILED: ${msg}`);
          if (consecutiveFailures >= 5) {
            log('Aborting exploration after 5 consecutive Playwright failures');
            explorationLogLines.push('Aborted exploration after 5 consecutive failures.');
            break;
          }
        }

        await this.recording.discoveryWaitForDomContentLoaded(discoverySessionId, userId);
        log('Waiting 900ms before next exploration step');
        await sleepMs(900);
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

      log('Starting final page capture for synthesis');
      const finalCtx = await this.recording.captureDiscoveryLlmPageContext(discoverySessionId, userId);
      const visitedScreens = this.recording.getDiscoveryVisitedScreens(discoverySessionId);
      const finalShot = finalCtx.screenshotBase64?.trim();
      if (!finalShot) {
        throw new Error('Discovery final capture produced no screenshot');
      }
      log('Calling final discovery LLM (project_discovery synthesis)', {
        screensVisitedCount: visitedScreens.length,
        explorationLogChars: explorationLogLines.join('\n').length,
      });

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
        { userId },
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
        },
      });
      log('Discovery run completed successfully');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Project discovery failed for ${projectId}: ${msg}`);
      this.recording.emitDiscoveryDebugLog(projectId, 'Discovery run failed', { error: msg.slice(0, 2000) });
      const partialMermaid = this.recording.getDiscoveryNavigationMermaid(projectId);
      await this.prisma.projectAgentKnowledge
        .update({
          where: { projectId },
          data: {
            discoveryStatus: 'failed',
            discoveryCompletedAt: new Date(),
            discoveryError: msg.slice(0, 8000),
            ...(partialMermaid ? { discoveryNavigationMermaid: partialMermaid } : {}),
          },
        })
        .catch(() => {});
    } finally {
      this.recording.emitDiscoveryDebugLog(projectId, 'Closing remote browser session');
      await this.recording.stopDiscoverySession(discoverySessionId, userId).catch(() => {});
    }
  }
}
