import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { LlmService } from '../llm/llm.service';
import { randomUUID } from 'node:crypto';
import { sleepMs } from '@bladerunner/clerk-agentmail-signin';

/**
 * MVP: single-page capture + LLM synthesis into project discovery fields.
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
      /** Let SPAs hydrate after auth before SOM capture. */
      await sleepMs(2500);

      const ctx = await this.recording.captureDiscoveryLlmPageContext(discoverySessionId, userId);
      const visitedScreens = this.recording.getDiscoveryVisitedScreens(discoverySessionId);
      const shot = ctx.screenshotBase64?.trim();
      if (!shot) {
        throw new Error('Discovery capture produced no screenshot');
      }

      const synthesized = await this.llm.projectDiscoverySynthesize(
        {
          projectName: project.name,
          startUrl: project.url.trim(),
          pageUrl: ctx.pageUrl,
          somManifest: ctx.somManifest,
          accessibilitySnapshot: ctx.accessibilitySnapshot,
          screenshotBase64: shot,
          screensVisited: visitedScreens,
        },
        { userId },
      );

      const structuredMerged = {
        ...synthesized.structured,
        screensVisited: visitedScreens,
      };

      await this.prisma.projectAgentKnowledge.update({
        where: { projectId },
        data: {
          discoveryStatus: 'completed',
          discoveryCompletedAt: new Date(),
          discoverySummaryMarkdown: synthesized.markdown,
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
