import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { EvaluationStatus, EvaluationStepDecision, Prisma } from '../../generated/prisma/client';

type JsonValue = Prisma.InputJsonValue;

@Injectable()
export class EvaluationsService {
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
    return this.prisma.evaluation.create({
      data: {
        userId,
        projectId: data.projectId ?? null,
        name: data.name?.trim() || 'Evaluation',
        url: data.url.trim(),
        intent: data.intent.trim(),
        desiredOutput: data.desiredOutput.trim(),
        status: 'QUEUED',
        autoSignIn: data.autoSignIn ?? false,
        autoSignInClerkOtpMode: data.autoSignInClerkOtpMode ?? null,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.evaluation.findMany({
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
      },
    });
  }

  async findOne(id: string, userId: string) {
    const ev = await this.prisma.evaluation.findFirst({
      where: { id, userId },
      include: {
        project: { select: { id: true, name: true, color: true } },
        steps: { orderBy: { sequence: 'asc' } },
        questions: { orderBy: { createdAt: 'desc' } },
        reports: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!ev) throw new NotFoundException(`Evaluation ${id} not found`);
    return ev;
  }

  async updateStatus(id: string, userId: string, status: EvaluationStatus, extra?: Prisma.EvaluationUpdateInput) {
    return this.prisma.evaluation.update({
      where: { id, userId },
      data: { status, ...extra },
    });
  }

  async appendProgressSummary(id: string, userId: string, line: string) {
    const ev = await this.prisma.evaluation.findFirst({ where: { id, userId }, select: { progressSummary: true } });
    if (!ev) return;
    const prev = ev.progressSummary?.trim() ?? '';
    const next = [prev, line].filter(Boolean).join('\n').slice(-12000);
    await this.prisma.evaluation.update({
      where: { id, userId },
      data: { progressSummary: next },
    });
  }

  async createStep(
    userId: string,
    data: {
      evaluationId: string;
      sequence: number;
      pageUrl?: string | null;
      thinkingText?: string | null;
      proposedCode?: string | null;
      expectedOutcome?: string | null;
      actualOutcome?: string | null;
      errorMessage?: string | null;
      decision?: EvaluationStepDecision | null;
      analyzerRationale?: string | null;
    },
  ) {
    return this.prisma.evaluationStep.create({
      data: {
        userId,
        evaluationId: data.evaluationId,
        sequence: data.sequence,
        pageUrl: data.pageUrl ?? null,
        thinkingText: data.thinkingText ?? null,
        proposedCode: data.proposedCode ?? null,
        expectedOutcome: data.expectedOutcome ?? null,
        actualOutcome: data.actualOutcome ?? null,
        errorMessage: data.errorMessage ?? null,
        decision: data.decision ?? null,
        analyzerRationale: data.analyzerRationale ?? null,
      },
    });
  }

  async createQuestion(
    userId: string,
    data: {
      evaluationId: string;
      stepSequence: number | null;
      prompt: string;
      options: string[];
    },
  ) {
    return this.prisma.evaluationQuestion.create({
      data: {
        userId,
        evaluationId: data.evaluationId,
        stepSequence: data.stepSequence,
        prompt: data.prompt,
        optionsJson: JSON.stringify(data.options.slice(0, 4)),
        state: 'pending',
      },
    });
  }

  async answerQuestion(
    userId: string,
    evaluationId: string,
    questionId: string,
    selectedIndex: number,
  ) {
    const q = await this.prisma.evaluationQuestion.findFirst({
      where: { id: questionId, evaluationId, userId },
    });
    if (!q) throw new NotFoundException('Question not found');
    if (q.state !== 'pending') {
      throw new NotFoundException('Question already answered');
    }
    return this.prisma.evaluationQuestion.update({
      where: { id: questionId },
      data: {
        state: 'answered',
        selectedIndex,
        answeredAt: new Date(),
      },
    });
  }

  async saveReport(
    userId: string,
    data: { evaluationId: string; markdown: string; structured?: unknown },
  ) {
    return this.prisma.evaluationReport.create({
      data: {
        userId,
        evaluationId: data.evaluationId,
        format: 'markdown',
        content: data.markdown,
        structuredJson: data.structured === undefined ? undefined : (data.structured as JsonValue),
      },
    });
  }

  async nextStepSequence(evaluationId: string): Promise<number> {
    const max = await this.prisma.evaluationStep.findFirst({
      where: { evaluationId },
      orderBy: { sequence: 'desc' },
      select: { sequence: true },
    });
    return (max?.sequence ?? 0) + 1;
  }

  /** Update copy fields when not actively running. */
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
    },
  ) {
    const ev = await this.prisma.evaluation.findFirst({ where: { id, userId } });
    if (!ev) throw new NotFoundException(`Evaluation ${id} not found`);
    if (ev.status === 'RUNNING') {
      throw new BadRequestException('Cannot edit intent or output while the evaluation is running');
    }
    const patch: Prisma.EvaluationUpdateInput = {};
    if (data.name !== undefined) patch.name = data.name.trim() || 'Evaluation';
    if (data.intent !== undefined) patch.intent = data.intent.trim();
    if (data.desiredOutput !== undefined) patch.desiredOutput = data.desiredOutput.trim();
    if (data.autoSignIn !== undefined) patch.autoSignIn = data.autoSignIn;
    if (data.autoSignInClerkOtpMode !== undefined) {
      patch.autoSignInClerkOtpMode = data.autoSignInClerkOtpMode;
    }
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
    await this.prisma.evaluation.update({ where: { id, userId }, data: patch });
    return this.findOne(id, userId);
  }

  /**
   * Clear steps, questions, and reports; reset to QUEUED for a fresh run (same evaluation id).
   * Caller should stop any live browser session first.
   */
  async resetForReprocess(id: string, userId: string): Promise<void> {
    const ev = await this.prisma.evaluation.findFirst({ where: { id, userId } });
    if (!ev) throw new NotFoundException(`Evaluation ${id} not found`);
    if (ev.status === 'RUNNING') {
      throw new BadRequestException('Cannot reprocess while the evaluation is running; cancel first');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.evaluationStep.deleteMany({ where: { evaluationId: id } });
      await tx.evaluationQuestion.deleteMany({ where: { evaluationId: id } });
      await tx.evaluationReport.deleteMany({ where: { evaluationId: id } });
      await tx.evaluation.update({
        where: { id, userId },
        data: {
          status: 'QUEUED',
          progressSummary: null,
          failureMessage: null,
          startedAt: null,
          completedAt: null,
        },
      });
    });
  }
}
