import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { NavigationRecordingService } from './navigation-recording.service';
import { NavigationPlayService } from './navigation-play.service';
import { LlmService } from '../llm/llm.service';
import type {
  ImproveNavigationActionInstructionDto,
  PatchNavigationActionDto,
} from './navigations.dto';

@Injectable()
export class NavigationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly navigationRecording: NavigationRecordingService,
    private readonly navigationPlay: NavigationPlayService,
    private readonly llm: LlmService,
  ) {}

  private async assertProjectOwned(userId: string, projectId: string): Promise<void> {
    const p = await this.prisma.project.findFirst({ where: { id: projectId, userId } });
    if (!p) throw new BadRequestException('Project not found or access denied');
  }

  async create(
    userId: string,
    data: {
      name?: string;
      url: string;
      intent: string;
      desiredOutput: string;
      projectId?: string | null;
      autoSignIn?: boolean;
      autoSignInClerkOtpMode?: 'mailslurp' | 'clerk_test_email' | null;
    },
  ) {
    if (data.projectId) {
      await this.assertProjectOwned(userId, data.projectId);
    }
    return this.prisma.navigation.create({
      data: {
        userId,
        projectId: data.projectId ?? null,
        name: data.name?.trim() || 'Navigation',
        url: data.url.trim(),
        intent: data.intent.trim(),
        desiredOutput: data.desiredOutput.trim(),
        status: 'QUEUED',
        autoSignIn: data.autoSignIn ?? false,
        autoSignInClerkOtpMode: data.autoSignInClerkOtpMode ?? null,
      },
      select: {
        id: true,
        name: true,
        url: true,
        projectId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        completedAt: true,
        project: { select: { id: true, name: true, color: true } },
        autoSignIn: true,
        autoSignInClerkOtpMode: true,
        runMode: true,
        skyvernWorkflowId: true,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.navigation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        url: true,
        projectId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        completedAt: true,
        project: { select: { id: true, name: true, color: true } },
        autoSignIn: true,
        autoSignInClerkOtpMode: true,
        runMode: true,
        skyvernWorkflowId: true,
      },
    });
  }

  async findOne(id: string, userId: string) {
    const row = await this.prisma.navigation.findFirst({
      where: { id, userId },
      include: {
        project: { select: { id: true, name: true, color: true } },
        actions: { orderBy: { sequence: 'asc' } },
      },
    });
    if (!row) throw new NotFoundException(`Navigation ${id} not found`);

    const { actions, ...rest } = row;
    const actionTypeCounts: Record<string, number> = {};
    for (const a of actions) {
      actionTypeCounts[a.actionType] = (actionTypeCounts[a.actionType] ?? 0) + 1;
    }
    const variableStepCount = actions.filter(
      (a) => a.actionType === 'variable_input' || a.actionType === 'prompt_type',
    ).length;
    let lastRecordedAt: string | null = null;
    if (actions.length > 0) {
      const latest = actions.reduce(
        (max, a) => (a.createdAt > max ? a.createdAt : max),
        actions[0].createdAt,
      );
      lastRecordedAt = latest.toISOString();
    }

    return {
      ...rest,
      actions,
      summary: {
        totalSteps: actions.length,
        actionTypeCounts,
        variableStepCount,
        lastRecordedAt,
      },
      steps: [],
      questions: [],
      reports: [],
    };
  }

  async getLiveSessions(id: string, userId: string) {
    const nav = await this.prisma.navigation.findFirst({ where: { id, userId }, select: { id: true } });
    if (!nav) throw new NotFoundException(`Navigation ${id} not found`);
    const recording = this.navigationRecording.getSessionState(id, userId);
    const play = this.navigationPlay.getSessionSummary(id, userId);
    return {
      recordingActive: recording.active,
      recordingPaused: recording.paused,
      playActive: play.active,
      skyvernRunId: play.skyvernRunId,
      playStatus: play.lastStatus,
      playActiveSequence: play.playActiveSequence,
    };
  }

  async updateFields(
    id: string,
    userId: string,
    data: {
      name?: string;
      intent?: string;
      desiredOutput?: string;
      projectId?: string | null;
      autoSignIn?: boolean;
      autoSignInClerkOtpMode?: 'mailslurp' | 'clerk_test_email' | null;
      runMode?: 'continuous' | 'step_review';
    },
  ) {
    const nav = await this.prisma.navigation.findFirst({ where: { id, userId } });
    if (!nav) throw new NotFoundException(`Navigation ${id} not found`);
    if (nav.status === 'RUNNING' || nav.status === 'WAITING_FOR_HUMAN' || nav.status === 'WAITING_FOR_REVIEW') {
      throw new BadRequestException('Cannot edit while this navigation is in a running or paused state');
    }
    const patch: Prisma.NavigationUpdateInput = {};
    if (data.name !== undefined) patch.name = data.name.trim() || 'Navigation';
    if (data.intent !== undefined) patch.intent = data.intent.trim();
    if (data.desiredOutput !== undefined) patch.desiredOutput = data.desiredOutput.trim();
    if (data.autoSignIn !== undefined) patch.autoSignIn = data.autoSignIn;
    if (data.autoSignInClerkOtpMode !== undefined) {
      patch.autoSignInClerkOtpMode = data.autoSignInClerkOtpMode;
    }
    if (data.runMode !== undefined) patch.runMode = data.runMode;
    if (data.projectId !== undefined) {
      if (data.projectId === null) {
        patch.project = { disconnect: true };
      } else {
        await this.assertProjectOwned(userId, data.projectId);
        patch.project = { connect: { id: data.projectId } };
      }
    }
    if (Object.keys(patch).length === 0) {
      return this.findOne(id, userId);
    }
    await this.prisma.navigation.update({ where: { id, userId }, data: patch });
    return this.findOne(id, userId);
  }

  async improveActionInstruction(
    navigationId: string,
    userId: string,
    dto: ImproveNavigationActionInstructionDto,
  ): Promise<{ improved: string }> {
    const nav = await this.prisma.navigation.findFirst({
      where: { id: navigationId, userId },
      select: { id: true },
    });
    if (!nav) throw new NotFoundException(`Navigation ${navigationId} not found`);
    return this.llm.improveNavigationActionInstruction(
      {
        draft: dto.draft,
        actionType: dto.actionType,
        elementText: dto.elementText ?? null,
        ariaLabel: dto.ariaLabel ?? null,
        inputValue: dto.inputValue ?? null,
        pageUrl: dto.pageUrl ?? null,
      },
      { userId },
    );
  }

  async patchNavigationAction(
    navigationId: string,
    userId: string,
    sequence: number,
    dto: PatchNavigationActionDto,
  ) {
    const nav = await this.prisma.navigation.findFirst({
      where: { id: navigationId, userId },
      select: { status: true },
    });
    if (!nav) throw new NotFoundException(`Navigation ${navigationId} not found`);
    if (
      nav.status === 'RUNNING' ||
      nav.status === 'WAITING_FOR_HUMAN' ||
      nav.status === 'WAITING_FOR_REVIEW'
    ) {
      throw new BadRequestException('Cannot edit actions while this navigation is in a running or paused state');
    }
    const data: Prisma.NavigationActionUpdateManyMutationInput = {};
    if (dto.actionInstruction !== undefined) {
      data.actionInstruction = dto.actionInstruction;
    }
    if (dto.actionType !== undefined) {
      data.actionType = dto.actionType;
    }
    if (dto.inputValue !== undefined) {
      data.inputValue = dto.inputValue;
    }
    if (dto.inputMode !== undefined) {
      data.inputMode = dto.inputMode;
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No fields to update');
    }
    const updated = await this.prisma.navigationAction.updateMany({
      where: { navigationId, userId, sequence },
      data,
    });
    if (updated.count === 0) {
      throw new NotFoundException(`No action with sequence ${sequence} on this navigation`);
    }
    const row = await this.prisma.navigationAction.findFirst({
      where: { navigationId, userId, sequence },
    });
    return row;
  }

  /**
   * Delete one step and renumber remaining actions to 1…n so Skyvern block order stays consistent.
   */
  async deleteNavigationAction(navigationId: string, userId: string, sequence: number) {
    const nav = await this.prisma.navigation.findFirst({
      where: { id: navigationId, userId },
      select: { status: true },
    });
    if (!nav) throw new NotFoundException(`Navigation ${navigationId} not found`);
    if (
      nav.status === 'RUNNING' ||
      nav.status === 'WAITING_FOR_HUMAN' ||
      nav.status === 'WAITING_FOR_REVIEW'
    ) {
      throw new BadRequestException('Cannot edit actions while this navigation is in a running or paused state');
    }

    const rows = await this.prisma.navigationAction.findMany({
      where: { navigationId, userId },
      orderBy: { sequence: 'asc' },
    });
    const idx = rows.findIndex((r) => r.sequence === sequence);
    if (idx === -1) {
      throw new NotFoundException(`No action with sequence ${sequence} on this navigation`);
    }

    const remaining = rows.filter((_, i) => i !== idx);

    await this.prisma.$transaction(async (tx) => {
      await tx.navigationAction.deleteMany({ where: { navigationId } });
      if (remaining.length > 0) {
        await tx.navigationAction.createMany({
          data: remaining.map((r, i) => ({
            navigationId: r.navigationId,
            userId: r.userId,
            sequence: i + 1,
            actionType: r.actionType,
            x: r.x,
            y: r.y,
            elementTag: r.elementTag,
            elementId: r.elementId,
            elementText: r.elementText,
            ariaLabel: r.ariaLabel,
            inputValue: r.inputValue,
            inputMode: r.inputMode,
            pageUrl: r.pageUrl,
            actionInstruction: r.actionInstruction,
          })),
        });
      }
    });

    return this.findOne(navigationId, userId);
  }
}
