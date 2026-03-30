import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { LlmService } from '../llm/llm.service';
import { EvaluationsService } from './evaluations.service';

const MAX_EVALUATION_STEPS = 12;
const LLM_JPEG_QUALITY = 85;

@Injectable()
export class EvaluationOrchestratorService {
  private readonly logger = new Logger(EvaluationOrchestratorService.name);
  private readonly active = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly recording: RecordingService,
    private readonly llm: LlmService,
    private readonly evaluations: EvaluationsService,
  ) {}

  /** Fire-and-forget autonomous loop (or resume after human). */
  scheduleRun(evaluationId: string, userId: string, opts?: { resumeAfterHuman?: boolean }): void {
    if (this.active.has(evaluationId)) {
      return;
    }
    this.active.add(evaluationId);
    void this.runLoop(evaluationId, userId, opts ?? {})
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Evaluation ${evaluationId} failed: ${msg}`);
        void this.prisma.evaluation
          .update({
            where: { id: evaluationId, userId },
            data: {
              status: 'FAILED',
              completedAt: new Date(),
              failureMessage: msg.slice(0, 4000),
            },
          })
          .catch(() => {});
        void this.recording.stopEvaluationSession(evaluationId, userId).catch(() => {});
      })
      .finally(() => {
        this.active.delete(evaluationId);
      });
  }

  private async runLoop(
    evaluationId: string,
    userId: string,
    opts: { resumeAfterHuman?: boolean },
  ): Promise<void> {
    const ev = await this.prisma.evaluation.findFirst({
      where: { id: evaluationId, userId },
    });
    if (!ev) throw new NotFoundException('Evaluation not found');
    if (ev.status === 'COMPLETED' || ev.status === 'CANCELLED' || ev.status === 'FAILED') {
      throw new BadRequestException('Evaluation is not runnable');
    }

    await this.prisma.evaluation.update({
      where: { id: evaluationId, userId },
      data: {
        status: 'RUNNING',
        startedAt: ev.startedAt ?? new Date(),
        failureMessage: null,
      },
    });

    const sessionExists = !!this.recording.getEvaluationSession(evaluationId);
    if (!sessionExists) {
      await this.recording.startEvaluationSession(evaluationId, userId);
      const s = this.recording.getEvaluationSession(evaluationId);
      if (!s) throw new Error('Evaluation session missing after start');
      if (!opts.resumeAfterHuman) {
        await s.page.goto(ev.url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      }
    }

    let stepCount = await this.prisma.evaluationStep.count({ where: { evaluationId } });
    while (stepCount < MAX_EVALUATION_STEPS) {
      const fresh = await this.prisma.evaluation.findFirst({ where: { id: evaluationId, userId } });
      if (!fresh || fresh.status === 'CANCELLED') {
        await this.recording.stopEvaluationSession(evaluationId, userId);
        return;
      }
      if (fresh.status === 'WAITING_FOR_HUMAN') {
        return;
      }

      const page = this.recording.getEvaluationSession(evaluationId)?.page;
      if (!page) {
        throw new Error('Browser session lost');
      }

      const sequence = await this.evaluations.nextStepSequence(evaluationId);
      const jpeg = await page.screenshot({ type: 'jpeg', quality: LLM_JPEG_QUALITY });
      const screenshotB64 = jpeg.toString('base64');
      const pageUrl = page.url();

      const priorSteps = await this.prisma.evaluationStep.findMany({
        where: { evaluationId },
        orderBy: { sequence: 'desc' },
        take: 8,
      });
      const priorBrief = priorSteps
        .map(
          (st) =>
            `seq ${st.sequence}: ${st.decision ?? '?'} — ${(st.analyzerRationale ?? st.thinkingText ?? '').slice(0, 200)}`,
        )
        .join('\n');

      this.recording.emitEvaluationProgress(evaluationId, {
        phase: 'proposing',
        sequence,
      });

      const proposed = await this.llm.evaluationProposePlaywrightStep(
        {
          url: ev.url,
          intent: ev.intent,
          desiredOutput: ev.desiredOutput,
          progressSummary: fresh.progressSummary,
          priorStepsBrief: priorBrief,
          screenshotBase64: screenshotB64,
          pageUrl,
        },
        { userId },
      );

      await this.evaluations.createStep(userId, {
        evaluationId,
        sequence,
        pageUrl,
        thinkingText: proposed.thinking,
        proposedCode: proposed.playwrightCode,
        expectedOutcome: proposed.expectedOutcome,
      });

      this.recording.emitEvaluationProgress(evaluationId, {
        phase: 'executing',
        sequence,
        thinking: proposed.thinking,
        playwrightCode: proposed.playwrightCode,
        expectedOutcome: proposed.expectedOutcome,
      });

      let executionOk = true;
      let errorMessage: string | undefined;
      try {
        await this.recording.runEvaluationPlaywright(evaluationId, userId, proposed.playwrightCode);
      } catch (e) {
        executionOk = false;
        errorMessage = e instanceof Error ? e.message : String(e);
      }

      const afterJpeg = await page.screenshot({ type: 'jpeg', quality: LLM_JPEG_QUALITY });
      const afterB64 = afterJpeg.toString('base64');
      const afterUrl = page.url();

      const analysis = await this.llm.evaluationAnalyzeAfterStep(
        {
          intent: ev.intent,
          desiredOutput: ev.desiredOutput,
          progressSummary: fresh.progressSummary,
          executedCode: proposed.playwrightCode,
          executionOk,
          errorMessage,
          pageUrlAfter: afterUrl,
          screenshotAfterBase64: afterB64,
        },
        { userId },
      );

      await this.prisma.evaluationStep.updateMany({
        where: { evaluationId, sequence },
        data: {
          actualOutcome: executionOk ? `OK at ${afterUrl}` : errorMessage ?? 'failed',
          errorMessage: executionOk ? null : errorMessage ?? 'error',
          decision: analysis.decision,
          analyzerRationale: analysis.rationale,
        },
      });

      await this.evaluations.appendProgressSummary(
        evaluationId,
        userId,
        `Step ${sequence}: ${analysis.decision} (${analysis.goalProgress}) — ${analysis.rationale.slice(0, 500)}`,
      );

      this.recording.emitEvaluationProgress(evaluationId, {
        phase: 'analyzed',
        sequence,
        decision: analysis.decision,
        goalProgress: analysis.goalProgress,
        rationale: analysis.rationale,
      });

      if (analysis.decision === 'finish' || analysis.goalProgress === 'complete') {
        await this.finalizeReport(evaluationId, userId, ev.intent, ev.desiredOutput);
        await this.recording.stopEvaluationSession(evaluationId, userId);
        return;
      }

      if (analysis.decision === 'ask_human' && analysis.humanQuestion && analysis.humanOptions?.length) {
        await this.evaluations.createQuestion(userId, {
          evaluationId,
          stepSequence: sequence,
          prompt: analysis.humanQuestion,
          options: analysis.humanOptions,
        });
        await this.prisma.evaluation.update({
          where: { id: evaluationId, userId },
          data: { status: 'WAITING_FOR_HUMAN' },
        });
        this.recording.emitEvaluationProgress(evaluationId, {
          phase: 'waiting_human',
          question: analysis.humanQuestion,
          options: analysis.humanOptions,
        });
        return;
      }

      stepCount += 1;
    }

    const evDone = await this.prisma.evaluation.findFirst({
      where: { id: evaluationId, userId },
    });
    if (evDone?.status === 'RUNNING') {
      await this.finalizeReport(evaluationId, userId, evDone.intent, evDone.desiredOutput);
    }
    await this.recording.stopEvaluationSession(evaluationId, userId);
  }

  private async finalizeReport(
    evaluationId: string,
    userId: string,
    intent: string,
    desiredOutput: string,
  ): Promise<void> {
    const ev = await this.prisma.evaluation.findFirst({
      where: { id: evaluationId, userId },
    });
    const steps = await this.prisma.evaluationStep.findMany({
      where: { evaluationId },
      orderBy: { sequence: 'asc' },
    });
    const stepsMd = steps
      .map(
        (s) =>
          `### Step ${s.sequence}\n- Thinking: ${s.thinkingText ?? ''}\n- Code: \`${(s.proposedCode ?? '').slice(0, 800)}\`\n- Decision: ${s.decision ?? ''}\n- Rationale: ${s.analyzerRationale ?? ''}\n`,
      )
      .join('\n');

    const report = await this.llm.evaluationGenerateFinalReport(
      {
        intent,
        desiredOutput,
        progressSummary: ev?.progressSummary ?? null,
        stepsMarkdown: stepsMd,
      },
      { userId },
    );

    await this.evaluations.saveReport(userId, {
      evaluationId,
      markdown: report.markdown,
      structured: report.structured,
    });

    await this.prisma.evaluation.update({
      where: { id: evaluationId, userId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    this.recording.emitEvaluationProgress(evaluationId, { phase: 'completed' });
  }

  async resumeAfterHumanAnswer(
    evaluationId: string,
    userId: string,
    questionId: string,
    selectedIndex: number,
  ): Promise<void> {
    const ev = await this.prisma.evaluation.findFirst({
      where: { id: evaluationId, userId },
    });
    if (!ev) throw new NotFoundException('Evaluation not found');
    if (ev.status !== 'WAITING_FOR_HUMAN') {
      throw new BadRequestException('Evaluation is not waiting for human input');
    }
    await this.evaluations.answerQuestion(userId, evaluationId, questionId, selectedIndex);
    await this.evaluations.appendProgressSummary(
      evaluationId,
      userId,
      `Human answered question ${questionId}: option index ${selectedIndex}`,
    );
    await this.prisma.evaluation.update({
      where: { id: evaluationId, userId },
      data: { status: 'RUNNING' },
    });
    this.scheduleRun(evaluationId, userId, { resumeAfterHuman: true });
  }
}
