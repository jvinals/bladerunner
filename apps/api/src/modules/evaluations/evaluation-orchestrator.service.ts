import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecordingService } from '../recording/recording.service';
import { LlmService } from '../llm/llm.service';
import { EvaluationsService } from './evaluations.service';
import { AgentContextService } from '../agent-context/agent-context.service';

const MAX_EVALUATION_STEPS = 80;

/** Vision + JSON calls can stall indefinitely without an AbortSignal; Gemini honors `signal`. */
function evaluationCodegenTimeoutMs(): number {
  const n = Number(process.env.EVALUATION_CODEGEN_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 180_000;
}

function evaluationAnalyzerTimeoutMs(): number {
  const n = Number(process.env.EVALUATION_ANALYZER_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 180_000;
}

function isAbortOrTimeoutError(e: unknown): boolean {
  if (e instanceof Error) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
    if (/aborted|AbortError|timeout/i.test(e.message)) return true;
  }
  return false;
}

// #region agent log
function dbgEvalStep(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3619df' },
    body: JSON.stringify({
      sessionId: '3619df',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

export type EvaluationScheduleOpts = {
  resumeAfterHuman?: boolean;
  resumeAfterReview?: boolean;
};

@Injectable()
export class EvaluationOrchestratorService {
  private readonly logger = new Logger(EvaluationOrchestratorService.name);
  private readonly active = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly recording: RecordingService,
    private readonly llm: LlmService,
    private readonly evaluations: EvaluationsService,
    private readonly agentContext: AgentContextService,
  ) {}

  /**
   * Fire-and-forget autonomous loop (or resume after human / review pause).
   * @returns false if a run is already in progress for this id (caller should refetch; do not treat as error).
   */
  scheduleRun(evaluationId: string, userId: string, opts?: EvaluationScheduleOpts): boolean {
    if (this.active.has(evaluationId)) {
      return false;
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
    return true;
  }

  private async runLoop(
    evaluationId: string,
    userId: string,
    opts: EvaluationScheduleOpts,
  ): Promise<void> {
    const ev = await this.prisma.evaluation.findFirst({
      where: { id: evaluationId, userId },
      include: {
        project: {
          select: {
            testUserEmail: true,
            testUserPassword: true,
            testEmailProvider: true,
          },
        },
      },
    });
    if (!ev) throw new NotFoundException('Evaluation not found');

    if (ev.status === 'COMPLETED' || ev.status === 'CANCELLED' || ev.status === 'FAILED') {
      throw new BadRequestException('Evaluation is not runnable');
    }
    if (ev.status === 'WAITING_FOR_HUMAN' && !opts.resumeAfterHuman) {
      throw new BadRequestException('Evaluation is waiting for human input');
    }
    if (ev.status === 'WAITING_FOR_REVIEW' && !opts.resumeAfterReview) {
      throw new BadRequestException('Evaluation is paused for review');
    }

    await this.prisma.evaluation.update({
      where: { id: evaluationId, userId },
      data: {
        status: 'RUNNING',
        startedAt: ev.startedAt ?? new Date(),
        failureMessage: null,
      },
    });

    this.recording.clearEvaluationDebugLog(evaluationId);
    this.recording.emitEvaluationDebugLog(evaluationId, '[Eval] Evaluation run loop started', {
      evaluationId,
      resumeAfterHuman: Boolean(opts.resumeAfterHuman),
      resumeAfterReview: Boolean(opts.resumeAfterReview),
    });

    const sessionExists = !!this.recording.getEvaluationSession(evaluationId);
    if (!sessionExists) {
      await this.recording.startEvaluationSession(evaluationId, userId);
      const s = this.recording.getEvaluationSession(evaluationId);
      if (!s) throw new Error('Evaluation session missing after start');
      if (!opts.resumeAfterHuman && !opts.resumeAfterReview) {
        await s.page.goto(ev.url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      }
    }

    const evalSession = this.recording.getEvaluationSession(evaluationId);
    if (!evalSession) throw new Error('Evaluation session missing');
    const authState = { clerkFullSignInDone: evalSession.autoSignInCompleted ?? false };

    let stepCount = await this.prisma.evaluationStep.count({ where: { evaluationId } });
    while (stepCount < MAX_EVALUATION_STEPS) {
      const fresh = await this.prisma.evaluation.findFirst({
        where: { id: evaluationId, userId },
        include: {
          project: {
            select: {
              testUserEmail: true,
              testUserPassword: true,
              testEmailProvider: true,
            },
          },
        },
      });
      if (!fresh || fresh.status === 'CANCELLED') {
        await this.recording.stopEvaluationSession(evaluationId, userId);
        return;
      }
      if (fresh.status === 'WAITING_FOR_HUMAN') {
        return;
      }
      if (fresh.status === 'WAITING_FOR_REVIEW') {
        return;
      }

      const page = this.recording.getEvaluationSession(evaluationId)?.page;
      if (!page) {
        throw new Error('Browser session lost');
      }

      const projectForAuth = fresh.project
        ? {
            testUserEmail: fresh.project.testUserEmail,
            testUserPassword: fresh.project.testUserPassword,
            testEmailProvider: fresh.project.testEmailProvider,
          }
        : null;
      const signInOtpMode = this.recording.resolveClerkOtpModeForEvaluation(fresh.autoSignInClerkOtpMode);

      const sequence = await this.evaluations.nextStepSequence(evaluationId);
      const progressSummaryBefore = fresh.progressSummary?.trim() ?? '';
      const trace = (message: string, detail?: Record<string, unknown>) =>
        this.recording.emitEvaluationDebugLog(evaluationId, `[Step ${sequence}] ${message}`, {
          sequence,
          ...detail,
        });
      // #region agent log
      const stepWallStart = Date.now();
      dbgEvalStep(
        'evaluation-orchestrator.service.ts:step_start',
        'step iteration start',
        { evaluationId, sequence, autoSignIn: fresh.autoSignIn },
        'H0',
      );
      // #endregion
      trace('Iteration started', {
        autoSignIn: fresh.autoSignIn,
        pageUrl: page.url(),
      });
      /** Emit before sign-in + SOM capture so the UI can show a placeholder step with spinners immediately. */
      this.recording.emitEvaluationProgress(evaluationId, {
        phase: 'proposing',
        sequence,
        progressSummaryBefore,
        pageUrl: page.url(),
      });
      // #region agent log
      dbgEvalStep(
        'evaluation-orchestrator.service.ts:after_proposing_emit',
        'emitted proposing',
        { evaluationId, sequence, elapsedMs: Date.now() - stepWallStart },
        'H1',
      );
      // #endregion

      /** Until `authState.clerkFullSignInDone`, each step may land on login (step 1, 2, …); the recording layer only acts when the page looks like sign-in. After any successful assist, never call again. */
      const autoSignInPending = fresh.autoSignIn && !authState.clerkFullSignInDone;
      if (autoSignInPending) {
        trace('Auto sign-in: attempting (until first success; Clerk/generic assist may run; external OTP/email polling can take time)', {
          clerkOtpMode: signInOtpMode,
          sequence,
          msSinceStepStart: Date.now() - stepWallStart,
        });
        const tSign = Date.now();
        await this.recording.maybeEvaluationAutoSignInAssist(evaluationId, userId, {
          runUrl: fresh.url,
          projectForAuth,
          wantAuto: true,
          clerkOtpMode: signInOtpMode,
          state: authState,
        });
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        trace('Auto sign-in: block finished', {
          ms: Date.now() - tSign,
          pageUrl: page.url(),
          completedThisRun: authState.clerkFullSignInDone,
        });
      } else if (fresh.autoSignIn) {
        trace('Auto sign-in: skipped (already completed earlier this run)', { sequence });
      } else {
        trace('Auto sign-in: skipped (evaluation.autoSignIn is false)');
      }
      // #region agent log
      dbgEvalStep(
        'evaluation-orchestrator.service.ts:after_auto_sign_in',
        'after auto sign-in block',
        {
          evaluationId,
          sequence,
          elapsedMs: Date.now() - stepWallStart,
          autoSignInAttempted: autoSignInPending,
          clerkFullSignInDoneAfter: authState.clerkFullSignInDone,
        },
        'H1',
      );
      // #endregion

      trace('Codegen capture: starting captureEvaluationLlmPageContext (SOM overlay + screenshot + CDP a11y)', {
        msSinceStepStart: Date.now() - stepWallStart,
      });
      const tCap = Date.now();
      const codegenCtx = await this.recording.captureEvaluationLlmPageContext(evaluationId, userId);
      const screenshotB64 = codegenCtx.screenshotBase64;
      if (!screenshotB64) {
        throw new Error('Evaluation codegen capture produced no screenshot');
      }
      const pageUrl = codegenCtx.pageUrl;
      // #region agent log
      dbgEvalStep(
        'evaluation-orchestrator.service.ts:after_codegen_capture',
        'after captureEvaluationLlmPageContext',
        { evaluationId, sequence, elapsedMs: Date.now() - stepWallStart },
        'H2',
      );
      // #endregion
      trace('Codegen capture: finished', {
        ms: Date.now() - tCap,
        pageUrl,
        screenshotBase64Chars: screenshotB64.length,
        somManifestChars: codegenCtx.somManifest?.length ?? 0,
        accessibilitySnapshotChars: codegenCtx.accessibilitySnapshot?.length ?? 0,
      });

      const priorStepsDesc = await this.prisma.evaluationStep.findMany({
        where: { evaluationId },
        orderBy: { sequence: 'desc' },
        take: 10,
      });
      /** Chronological (oldest first) so the model reads a clear failure story; last lines are most recent. */
      const priorSteps = [...priorStepsDesc].reverse();
      const priorBrief = priorSteps
        .map((st) => {
          const title = (st.stepTitle ?? '').trim().slice(0, 80) || '(no title)';
          const code = (st.proposedCode ?? '').replace(/\s+/g, ' ').trim().slice(0, 180);
          const err = st.errorMessage?.replace(/\s+/g, ' ').trim().slice(0, 140);
          const run = st.errorMessage ? `FAIL` : `OK`;
          const tail = err ? ` | err: ${err}` : '';
          return `seq ${st.sequence}: "${title}" | ${run} | ${st.decision ?? '?'} | code: ${code}${tail}`;
        })
        .join('\n');

      const codegenInputJson = {
        startUrl: ev.url,
        pageUrl,
        intent: ev.intent,
        desiredOutput: ev.desiredOutput,
        progressSummaryBefore,
        priorStepsBrief: priorBrief,
        viewportJpegBase64: screenshotB64,
        somManifest: codegenCtx.somManifest,
        accessibilitySnapshot: codegenCtx.accessibilitySnapshot,
        autoSignInEnabled: fresh.autoSignIn,
        autoSignInCompleted: authState.clerkFullSignInDone,
        note:
          'Full-page Set-of-Marks JPEG + SOM manifest + CDP accessibility sent to codegen (viewportJpegBase64 for UI preview).',
      };

      // #region agent log
      dbgEvalStep(
        'evaluation-orchestrator.service.ts:before_codegen_llm',
        'before evaluationProposePlaywrightStep',
        { evaluationId, sequence, elapsedMs: Date.now() - stepWallStart },
        'H3',
      );
      // #endregion
      trace('Codegen LLM: calling evaluationProposePlaywrightStep', {
        timeoutMs: evaluationCodegenTimeoutMs(),
        msSinceStepStart: Date.now() - stepWallStart,
      });
      const agentContextAppendix =
        fresh.projectId != null
          ? (await this.agentContext.getPromptInjectionBlock(userId, fresh.projectId)).trim() || undefined
          : undefined;
      const proposed = await this.llm.evaluationProposePlaywrightStep(
        {
          url: ev.url,
          intent: ev.intent,
          desiredOutput: ev.desiredOutput,
          progressSummary: fresh.progressSummary,
          priorStepsBrief: priorBrief,
          screenshotBase64: screenshotB64,
          pageUrl,
          somManifest: codegenCtx.somManifest,
          accessibilitySnapshot: codegenCtx.accessibilitySnapshot,
          autoSignInEnabled: fresh.autoSignIn,
          autoSignInCompleted: authState.clerkFullSignInDone,
          agentContextAppendix,
        },
        {
          userId,
          signal: AbortSignal.timeout(evaluationCodegenTimeoutMs()),
          onDebugLog: (m, d) => trace(m, d),
        },
      );
      // #region agent log
      dbgEvalStep(
        'evaluation-orchestrator.service.ts:after_codegen_llm',
        'after evaluationProposePlaywrightStep',
        { evaluationId, sequence, elapsedMs: Date.now() - stepWallStart },
        'H3',
      );
      // #endregion

      const codegenOutputJson = {
        stepTitle: proposed.stepTitle,
        thinking: proposed.thinking,
        playwrightCode: proposed.playwrightCode,
        expectedOutcome: proposed.expectedOutcome,
      };

      await this.evaluations.createStep(userId, {
        evaluationId,
        sequence,
        pageUrl,
        stepTitle: proposed.stepTitle,
        progressSummaryBefore,
        codegenInputJson,
        codegenOutputJson,
        thinkingText: proposed.thinking,
        proposedCode: proposed.playwrightCode,
        expectedOutcome: proposed.expectedOutcome,
      });
      trace('Persisted evaluation step row (codegen inputs + outputs)', { stepTitle: proposed.stepTitle });

      this.recording.emitEvaluationProgress(evaluationId, {
        phase: 'executing',
        sequence,
        thinking: proposed.thinking,
        playwrightCode: proposed.playwrightCode,
        expectedOutcome: proposed.expectedOutcome,
      });
      trace('Socket: emitted phase executing with proposed Playwright snippet', {
        codeChars: proposed.playwrightCode.length,
      });

      let executionOk = true;
      let errorMessage: string | undefined;
      try {
        trace('Playwright execution: starting runEvaluationPlaywright', {
          msSinceStepStart: Date.now() - stepWallStart,
        });
        const tPw = Date.now();
        await this.recording.runEvaluationPlaywright(evaluationId, userId, proposed.playwrightCode);
        trace('Playwright execution: finished OK', { ms: Date.now() - tPw });
      } catch (e) {
        executionOk = false;
        errorMessage = e instanceof Error ? e.message : String(e);
        trace('Playwright execution: failed', { error: errorMessage });
      }

      trace('Analyzer capture: starting captureEvaluationLlmPageContext (after step)');
      const tAfterCap = Date.now();
      const afterCtx = await this.recording.captureEvaluationLlmPageContext(evaluationId, userId);
      const afterB64 = afterCtx.screenshotBase64;
      if (!afterB64) {
        throw new Error('Evaluation analyzer capture produced no screenshot');
      }
      const afterUrl = afterCtx.pageUrl;
      trace('Analyzer capture: finished', {
        ms: Date.now() - tAfterCap,
        pageUrlAfter: afterUrl,
        afterScreenshotChars: afterB64.length,
      });

      const analyzerInputJson = {
        intent: ev.intent,
        desiredOutput: ev.desiredOutput,
        progressSummary: fresh.progressSummary,
        executedCode: proposed.playwrightCode,
        executionOk,
        errorMessage: errorMessage ?? null,
        pageUrlAfter: afterUrl,
        afterStepViewportJpegBase64: afterB64,
        somManifest: afterCtx.somManifest,
        accessibilitySnapshot: afterCtx.accessibilitySnapshot,
        autoSignInEnabled: fresh.autoSignIn,
        autoSignInCompleted: authState.clerkFullSignInDone,
        note:
          'After-step full-page Set-of-Marks JPEG + manifest + accessibility sent to analyzer (afterStepViewportJpegBase64 for UI preview).',
      };

      await this.evaluations.updateStepAnalyzerInputsOnly(evaluationId, sequence, { analyzerInputJson });

      this.recording.emitEvaluationProgress(evaluationId, {
        phase: 'analyzing',
        sequence,
        pageUrlAfter: afterUrl,
        executionOk,
        errorMessage: errorMessage ?? null,
      });
      trace('Socket: emitted phase analyzing; analyzer inputs persisted');

      let analysis: Awaited<ReturnType<LlmService['evaluationAnalyzeAfterStep']>>;
      try {
        trace('Analyzer LLM: calling evaluationAnalyzeAfterStep', {
          timeoutMs: evaluationAnalyzerTimeoutMs(),
        });
        analysis = await this.llm.evaluationAnalyzeAfterStep(
          {
            intent: ev.intent,
            desiredOutput: ev.desiredOutput,
            progressSummary: fresh.progressSummary,
            executedCode: proposed.playwrightCode,
            executionOk,
            errorMessage,
            pageUrlAfter: afterUrl,
            screenshotAfterBase64: afterB64,
            somManifest: afterCtx.somManifest,
            accessibilitySnapshot: afterCtx.accessibilitySnapshot,
            autoSignInEnabled: fresh.autoSignIn,
            autoSignInCompleted: authState.clerkFullSignInDone,
            agentContextAppendix,
          },
          {
            userId,
            signal: AbortSignal.timeout(evaluationAnalyzerTimeoutMs()),
            onDebugLog: (m, d) => trace(m, d),
          },
        );
      } catch (e) {
        if (!isAbortOrTimeoutError(e)) {
          throw e;
        }
        const ms = evaluationAnalyzerTimeoutMs();
        this.logger.warn(
          `evaluation_analyzer timed out or aborted (evaluationId=${evaluationId} sequence=${sequence} timeoutMs=${ms}): ${e instanceof Error ? e.message : String(e)}`,
        );
        analysis = {
          goalProgress: 'partial',
          decision: 'retry',
          rationale: `Analyzer model did not finish within ${Math.round(ms / 1000)}s (timeout or cancellation).`,
        };
        trace('Analyzer LLM: timeout or abort', { timeoutMs: ms });
      }

      if (
        analysis.decision === 'ask_human' &&
        fresh.autoSignIn &&
        !authState.clerkFullSignInDone
      ) {
        const suffix =
          ' (overridden: automatic sign-in is enabled and still in progress; not pausing for credentials.)';
        analysis = {
          ...analysis,
          decision: 'retry',
          rationale: `${analysis.rationale}${suffix}`.slice(0, 8000),
          humanQuestion: undefined,
          humanOptions: undefined,
        };
        trace('Analyzer: coerced ask_human to retry while auto sign-in pending', { sequence });
      }

      const analyzerOutputJson = {
        goalProgress: analysis.goalProgress,
        decision: analysis.decision,
        rationale: analysis.rationale,
        ...(analysis.humanQuestion ? { humanQuestion: analysis.humanQuestion } : {}),
        ...(analysis.humanOptions?.length ? { humanOptions: analysis.humanOptions } : {}),
      };

      await this.evaluations.updateStepAfterAnalyzer(evaluationId, sequence, {
        analyzerInputJson,
        analyzerOutputJson,
        actualOutcome: executionOk ? `OK at ${afterUrl}` : errorMessage ?? 'failed',
        errorMessage: executionOk ? null : errorMessage ?? 'error',
        decision: analysis.decision,
        analyzerRationale: analysis.rationale,
        stepDurationMs: Date.now() - stepWallStart,
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
      trace('Analyzer result persisted', {
        decision: analysis.decision,
        goalProgress: analysis.goalProgress,
        msSinceStepStart: Date.now() - stepWallStart,
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

      if (fresh.runMode === 'step_review') {
        await this.prisma.evaluation.update({
          where: { id: evaluationId, userId },
          data: { status: 'WAITING_FOR_REVIEW' },
        });
        this.recording.emitEvaluationProgress(evaluationId, {
          phase: 'paused_review',
          sequence,
        });
        return;
      }
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
          `### Step ${s.sequence}${s.stepTitle ? `: ${s.stepTitle}` : ''}\n- Thinking: ${s.thinkingText ?? ''}\n- Code: \`${(s.proposedCode ?? '').slice(0, 800)}\`\n- Decision: ${s.decision ?? ''}\n- Rationale: ${s.analyzerRationale ?? ''}\n`,
      )
      .join('\n');

    this.recording.emitEvaluationDebugLog(
      evaluationId,
      '[Report] Final report LLM: starting evaluationGenerateFinalReport',
      {
        stepsCount: steps.length,
      },
    );
    const report = await this.llm.evaluationGenerateFinalReport(
      {
        intent,
        desiredOutput,
        progressSummary: ev?.progressSummary ?? null,
        stepsMarkdown: stepsMd,
      },
      {
        userId,
        onDebugLog: (m, d) => this.recording.emitEvaluationDebugLog(evaluationId, `[Report] ${m}`, d),
      },
    );
    this.recording.emitEvaluationDebugLog(evaluationId, '[Report] Final report LLM: done', {
      markdownChars: report.markdown.length,
    });

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

  async resumeAfterReview(evaluationId: string, userId: string): Promise<void> {
    const ev = await this.prisma.evaluation.findFirst({
      where: { id: evaluationId, userId },
    });
    if (!ev) throw new NotFoundException('Evaluation not found');
    if (ev.status !== 'WAITING_FOR_REVIEW') {
      throw new BadRequestException('Evaluation is not paused for review');
    }
    await this.prisma.evaluation.update({
      where: { id: evaluationId, userId },
      data: { status: 'RUNNING' },
    });
    this.scheduleRun(evaluationId, userId, { resumeAfterReview: true });
  }
}
