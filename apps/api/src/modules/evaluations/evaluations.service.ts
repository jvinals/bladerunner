import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { EvaluationStatus, EvaluationStepDecision, Prisma } from '@prisma/client';

type JsonValue = Prisma.InputJsonValue;

@Injectable()
export class EvaluationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    data: { name?: string; url: string; intent: string; desiredOutput: string },
  ) {
    return this.prisma.evaluation.create({
      data: {
        userId,
        name: data.name?.trim() || 'Evaluation',
        url: data.url.trim(),
        intent: data.intent.trim(),
        desiredOutput: data.desiredOutput.trim(),
        status: 'QUEUED',
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
        status: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        completedAt: true,
      },
    });
  }

  async findOne(id: string, userId: string) {
    const ev = await this.prisma.evaluation.findFirst({
      where: { id, userId },
      include: {
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
}
