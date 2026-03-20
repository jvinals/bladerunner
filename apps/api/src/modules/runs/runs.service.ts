import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { RecordingService } from '../recording/recording.service';

@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recordingService: RecordingService,
  ) {}

  async findAll(
    userId: string,
    query?: {
      status?: string;
      platform?: string;
      search?: string;
      page?: number;
      pageSize?: number;
      sortBy?: string;
      sortOrder?: string;
    },
  ) {
    const where: Prisma.RunWhereInput = { userId };

    if (query?.status) {
      where.status = query.status as any;
    }
    if (query?.platform) {
      where.platform = query.platform as any;
    }
    if (query?.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { url: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const page = query?.page || 1;
    const pageSize = query?.pageSize || 20;

    const sortOrder = query?.sortOrder === 'asc' ? 'asc' : 'desc';
    const sortBy = query?.sortBy || 'createdAt';
    const orderBy: Prisma.RunOrderByWithRelationInput =
      sortBy === 'name'
        ? { name: sortOrder }
        : sortBy === 'durationMs'
          ? { durationMs: sortOrder }
          : sortBy === 'status'
            ? { status: sortOrder }
            : sortBy === 'updatedAt'
              ? { updatedAt: sortOrder }
              : { createdAt: sortOrder };

    const [data, total] = await Promise.all([
      this.prisma.run.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          _count: { select: { steps: true } },
          project: { select: { id: true, name: true, kind: true } },
        },
      }),
      this.prisma.run.count({ where }),
    ]);

    return {
      data: data.map((run) => ({
        ...run,
        stepsCount: run._count.steps,
        passedSteps: run._count.steps,
        failedSteps: 0,
        findingsCount: 0,
        artifactsCount: 0,
        tags: [],
        triggeredBy: 'Manual',
        project: run.project,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string, userId: string) {
    return this.prisma.run.findFirst({
      where: { id, userId },
      include: {
        steps: { orderBy: { sequence: 'asc' } },
        recordings: true,
        project: true,
      },
    });
  }

  async findSteps(runId: string, userId: string) {
    return this.prisma.runStep.findMany({
      where: { runId, userId },
      orderBy: { sequence: 'asc' },
    });
  }

  async getRunStatus(runId: string, userId: string) {
    const run = await this.prisma.run.findFirst({
      where: { id: runId, userId },
      include: { _count: { select: { steps: true } } },
    });

    if (!run) return null;

    return {
      runId: run.id,
      status: run.status,
      stepsCount: run._count.steps,
      durationMs: run.durationMs,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    };
  }

  async getDashboardKpis(userId: string) {
    const [totalRuns, passedRuns, allRuns] = await Promise.all([
      this.prisma.run.count({ where: { userId } }),
      this.prisma.run.count({ where: { userId, status: 'COMPLETED' } }),
      this.prisma.run.findMany({
        where: { userId, durationMs: { not: null } },
        select: { durationMs: true },
      }),
    ]);

    const passRate = totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 100) : 0;
    const avgDuration =
      allRuns.length > 0
        ? Math.round(allRuns.reduce((s, r) => s + (r.durationMs || 0), 0) / allRuns.length)
        : 0;

    return {
      totalRuns,
      passRate,
      avgDuration,
      activeAgents: 1,
      findingsCount: 0,
      runsToday: totalRuns,
      runsTrend: 0,
      passRateTrend: 0,
    };
  }

  async deleteOne(id: string, userId: string): Promise<void> {
    const run = await this.prisma.run.findFirst({ where: { id, userId } });
    if (!run) throw new NotFoundException(`Run ${id} not found`);
    if (run.status === 'RECORDING') {
      await this.recordingService.abortRecordingForDeletion(id, userId);
    }
    await this.prisma.run.delete({ where: { id } });
    await this.recordingService.deleteRunArtifactsFromDisk(id, userId);
  }
}
