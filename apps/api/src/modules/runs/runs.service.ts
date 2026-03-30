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
      projectId?: string;
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
    if (query?.projectId) {
      where.projectId = query.projectId;
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
          project: { select: { id: true, name: true, kind: true, color: true } },
        },
      }),
      this.prisma.run.count({ where }),
    ]);

    return {
      data: data.map((run) => ({
        ...run,
        hasLiveRecordingSession: !!this.recordingService.getSession(run.id),
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
    const run = await this.prisma.run.findFirst({
      where: { id, userId },
      include: {
        steps: { orderBy: { sequence: 'asc' } },
        recordings: true,
        project: true,
      },
    });
    if (!run) return null;
    const hasLiveRecordingSession = !!this.recordingService.getSession(id);
    // #region agent log
    fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'91995d'},body:JSON.stringify({sessionId:'91995d',runId:id,hypothesisId:'H32',location:'apps/api/src/modules/runs/runs.service.ts:104',message:'runs.findOne payload for playback gating',data:{dbStatus:run.status,hasLiveRecordingSession,stepsCount:run.steps.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    /** Match list DTO so Run detail metrics + playback gating can use `stepsCount` without a second round-trip. */
    return {
      ...run,
      hasLiveRecordingSession,
      stepsCount: run.steps.length,
      passedSteps: run.steps.length,
      failedSteps: 0,
      findingsCount: 0,
      artifactsCount: 0,
      tags: [] as string[],
      triggeredBy: 'Manual',
    };
  }

  async findSteps(runId: string, userId: string) {
    return this.prisma.runStep.findMany({
      where: { runId, userId },
      orderBy: { sequence: 'asc' },
    });
  }

  /** App-state checkpoints (Playwright `storageState` snapshots after each step while recording). */
  async findCheckpoints(runId: string, userId: string) {
    const run = await this.prisma.run.findFirst({ where: { id: runId, userId } });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    return this.prisma.runCheckpoint.findMany({
      where: { runId, userId },
      orderBy: { afterStepSequence: 'asc' },
      select: {
        id: true,
        afterStepSequence: true,
        label: true,
        pageUrl: true,
        storageStatePath: true,
        thumbnailPath: true,
        createdAt: true,
      },
    });
  }

  async findCheckpointById(checkpointId: string, runId: string, userId: string) {
    return this.prisma.runCheckpoint.findFirst({
      where: { id: checkpointId, runId, userId },
      select: { thumbnailPath: true },
    });
  }

  async findAiVisualIdTests(runId: string, userId: string) {
    const run = await this.prisma.run.findFirst({ where: { id: runId, userId }, select: { id: true } });
    if (!run) throw new NotFoundException(`Run ${runId} not found`);
    const rows = await this.prisma.aiVisualIdTest.findMany({
      where: { runId, userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        runId: true,
        stepSequence: true,
        provider: true,
        model: true,
        prompt: true,
        answer: true,
        pageUrl: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
    }));
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
      hasLiveRecordingSession: !!this.recordingService.getSession(runId),
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
