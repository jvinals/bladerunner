import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { LlmService } from '../llm/llm.service';
import { randomUUID } from 'node:crypto';
import { sleepMs } from '@bladerunner/clerk-agentmail-signin';

/** Max LLM-driven exploration steps (each may execute one Playwright snippet). */
const DISCOVERY_MAX_EXPLORATION_STEPS = 40;
/** Wall-clock cap for exploration + synthesis. */
const DISCOVERY_MAX_WALL_MS = 12 * 60 * 1000;

function normalizeDiscoveryUrlForDedup(url: string): string {
  try {
    const u = new URL(url);
    const drop = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid']);
    for (const k of [...u.searchParams.keys()]) {
      if (k.startsWith('utm_') || drop.has(k)) {
        u.searchParams.delete(k);
      }
    }
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

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
      create: { projectId, discoveryStatus: 'queued' },
      update: {
        discoveryStatus: 'queued',
        discoveryError: null,
      },
    });

    this.busy.add(projectId);
    void this.runJob(projectId, userId).finally(() => this.busy.delete(projectId));
    return { accepted: true };
  }

  private async runJob(projectId: string, userId: string): Promise<void> {
    const discoverySessionId = randomUUID();
    try {
      await this.prisma.projectAgentKnowledge.update({
        where: { projectId },
        data: {
          discoveryStatus: 'running',
          discoveryStartedAt: new Date(),
          discoveryError: null,
        },
      });

      await this.recording.startDiscoverySession(discoverySessionId, userId, projectId);

      const project = await this.prisma.project.findFirst({
        where: { id: projectId, userId },
      });
      if (!project?.url?.trim()) {
        throw new Error('Project URL missing');
      }

      await this.recording.discoveryGoto(discoverySessionId, userId, project.url.trim());

      const authState = { clerkFullSignInDone: false };
      /** Match evaluations: attempt assist whenever a test email is set (Clerk can use env credentials; generic still needs password in project). */
      const wantAuto = !!project.testUserEmail?.trim();
      const signInMaxIters = 15;
      for (let i = 0; i < signInMaxIters; i++) {
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
        if (authState.clerkFullSignInDone) {
          break;
        }
        await sleepMs(1200);
      }
      await this.recording.discoveryWaitForDomContentLoaded(discoverySessionId, userId);
      /** Let SPAs hydrate after auth before exploration. */
      await sleepMs(2500);

      /** Exploration-only wall clock (auth + settle do not count toward the 12 min crawl cap). */
      const explorationStartedAt = Date.now();
      const authContextSummary = project.testUserEmail?.trim()
        ? `Test email configured (automatic sign-in attempted). Email provider: ${project.testEmailProvider ?? 'default'}. Password ${project.testUserPassword?.trim() ? 'configured' : 'not set'}.`
        : 'No test email configured; only public/unauthenticated flows were available.';

      const explorationLogLines: string[] = [];
      let stepIndex = 0;
      let consecutiveFailures = 0;

      while (stepIndex < DISCOVERY_MAX_EXPLORATION_STEPS && Date.now() - explorationStartedAt < DISCOVERY_MAX_WALL_MS) {
        const elapsedMs = Date.now() - explorationStartedAt;
        const ctx = await this.recording.captureDiscoveryLlmPageContext(discoverySessionId, userId);
        const shot = ctx.screenshotBase64?.trim();
        if (!shot) {
          throw new Error('Discovery capture produced no screenshot');
        }
        const visitedScreensSoFar = this.recording.getDiscoveryVisitedScreens(discoverySessionId);
        const uniqNorm = new Set(visitedScreensSoFar.map((v) => normalizeDiscoveryUrlForDedup(v.url)));

        const plan = await this.llm.projectDiscoveryExploreStep(
          {
            baseUrl: project.url.trim(),
            authContextSummary,
            maxNavigations: DISCOVERY_MAX_EXPLORATION_STEPS,
            maxWallMs: DISCOVERY_MAX_WALL_MS,
            elapsedMs,
            stepIndex,
            navigationsSoFar: uniqNorm.size,
            visitedUrlsSample: [...uniqNorm],
            pageUrl: ctx.pageUrl,
            pageTitle: ctx.pageTitle,
            somManifest: ctx.somManifest,
            accessibilitySnapshot: ctx.accessibilitySnapshot,
            screenshotBase64: shot,
          },
          { userId },
        );

        if (plan.stop || !plan.playwrightCode?.trim()) {
          explorationLogLines.push(`Explore stop at step ${stepIndex + 1}: ${plan.reason}`);
          break;
        }

        try {
          await this.recording.discoveryRunPlaywrightSnippet(
            discoverySessionId,
            userId,
            plan.playwrightCode,
          );
          const codePreview =
            plan.playwrightCode.length > 500 ? `${plan.playwrightCode.slice(0, 500)}…` : plan.playwrightCode;
          explorationLogLines.push(
            `Step ${stepIndex + 1}: ${plan.reason}\n\`\`\`js\n${codePreview}\n\`\`\``,
          );
          consecutiveFailures = 0;
        } catch (err) {
          consecutiveFailures += 1;
          const msg = err instanceof Error ? err.message : String(err);
          explorationLogLines.push(`Step ${stepIndex + 1} FAILED: ${msg}`);
          if (consecutiveFailures >= 3) {
            explorationLogLines.push('Aborted exploration after 3 consecutive failures.');
            break;
          }
        }

        await this.recording.discoveryWaitForDomContentLoaded(discoverySessionId, userId);
        await sleepMs(600);
        stepIndex += 1;
      }

      if (Date.now() - explorationStartedAt >= DISCOVERY_MAX_WALL_MS) {
        explorationLogLines.push('Exploration stopped: wall clock cap reached.');
      } else if (stepIndex >= DISCOVERY_MAX_EXPLORATION_STEPS) {
        explorationLogLines.push('Exploration stopped: max exploration steps reached.');
      }

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

      await this.prisma.projectAgentKnowledge.update({
        where: { projectId },
        data: {
          discoveryStatus: 'completed',
          discoveryCompletedAt: new Date(),
          discoverySummaryMarkdown,
          discoveryStructured: structuredMerged as object,
          discoveryError: null,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Project discovery failed for ${projectId}: ${msg}`);
      await this.prisma.projectAgentKnowledge
        .update({
          where: { projectId },
          data: {
            discoveryStatus: 'failed',
            discoveryCompletedAt: new Date(),
            discoveryError: msg.slice(0, 8000),
          },
        })
        .catch(() => {});
    } finally {
      await this.recording.stopDiscoverySession(discoverySessionId, userId).catch(() => {});
    }
  }
}
