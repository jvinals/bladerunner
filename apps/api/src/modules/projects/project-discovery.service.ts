import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { LlmService } from '../llm/llm.service';
import { randomUUID } from 'node:crypto';

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

      await this.recording.startDiscoverySession(discoverySessionId, userId);

      const project = await this.prisma.project.findFirst({
        where: { id: projectId, userId },
      });
      if (!project?.url?.trim()) {
        throw new Error('Project URL missing');
      }

      await this.recording.discoveryGoto(discoverySessionId, userId, project.url.trim());

      const authState = { clerkFullSignInDone: false };
      const wantAuto = !!(project.testUserEmail?.trim() && project.testUserPassword);
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

      const ctx = await this.recording.captureDiscoveryLlmPageContext(discoverySessionId, userId);
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
        },
        { userId },
      );

      await this.prisma.projectAgentKnowledge.update({
        where: { projectId },
        data: {
          discoveryStatus: 'completed',
          discoveryCompletedAt: new Date(),
          discoverySummaryMarkdown: synthesized.markdown,
          discoveryStructured: synthesized.structured as object,
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
