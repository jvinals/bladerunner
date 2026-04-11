import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma } from '../../generated/prisma/client';

@Injectable()
export class NavigationsService {
  constructor(private readonly prisma: PrismaService) {}

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
      },
    });
  }

  async findOne(id: string, userId: string) {
    const row = await this.prisma.navigation.findFirst({
      where: { id, userId },
      include: {
        project: { select: { id: true, name: true, color: true } },
      },
    });
    if (!row) throw new NotFoundException(`Navigation ${id} not found`);
    return {
      ...row,
      steps: [],
      questions: [],
      reports: [],
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
}
