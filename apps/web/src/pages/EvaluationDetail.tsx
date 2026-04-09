import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  evaluationsApi,
  projectsApi,
  type AutoClerkOtpUiMode,
  type EvaluationRunMode,
  type EvaluationStepDto,
  type ProjectDto,
} from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import {
  useEvaluationLive,
  type EvaluationProgressPayload,
  type EvaluationDebugLogLine,
} from '@/hooks/useEvaluationLive';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Play,
  Square,
  ClipboardList,
  ExternalLink,
  Loader2,
  Radio,
  RotateCcw,
  Save,
  X,
} from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { ThinkingProcessPanel } from '@/components/evaluation/ThinkingProcessPanel';
import { EvaluationStepCard, type TimelineViewMode } from '@/components/evaluation/EvaluationStepCard';

const PLACEHOLDER_STEP_PREFIX = '__pending__';

function mergeStepsWithLivePlaceholder(
  steps: EvaluationStepDto[],
  lastProgress: EvaluationProgressPayload | null,
): EvaluationStepDto[] {
  if (lastProgress == null || lastProgress.sequence == null) return steps;
  const seq = lastProgress.sequence;
  if (steps.some((s) => s.sequence === seq)) return steps;
  const phase = String(lastProgress.phase ?? '');
  /** Include `analyzing` so a placeholder row exists if the client has not refetched the new step yet. */
  if (phase !== 'proposing' && phase !== 'executing' && phase !== 'analyzing') return steps;
  const placeholder: EvaluationStepDto = {
    id: `${PLACEHOLDER_STEP_PREFIX}${seq}`,
    sequence: seq,
    stepKind: 'llm',
    pageUrl: typeof lastProgress.pageUrl === 'string' ? lastProgress.pageUrl : null,
    stepTitle: null,
    progressSummaryBefore:
      typeof lastProgress.progressSummaryBefore === 'string' ? lastProgress.progressSummaryBefore : null,
    codegenInputJson: null,
    codegenOutputJson: null,
    analyzerInputJson: null,
    analyzerOutputJson: null,
    thinkingText: null,
    proposedCode: null,
    expectedOutcome: null,
    actualOutcome: null,
    errorMessage: null,
    decision: null,
    analyzerRationale: null,
    stepDurationMs: null,
    createdAt: new Date(0).toISOString(),
  };
  return [...steps, placeholder].sort((a, b) => a.sequence - b.sequence);
}

function parseOptions(q: { optionsJson: string }): string[] {
  try {
    const parsed = JSON.parse(q.optionsJson) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** True when the server marked this line as an actual model request/response (see `llmInvocation` on detail). */
function isTraceLlmInvocation(line: EvaluationDebugLogLine): boolean {
  const d = line.detail;
  return typeof d === 'object' && d != null && d.llmInvocation === true;
}

function formatTraceDeltaSeconds(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${s.toFixed(2)} s`;
}

/** `provider / model` when both exist; otherwise model id from trace detail. */
function formatTraceModelLabel(detail: Record<string, unknown> | undefined): string | null {
  if (!detail) return null;
  const model = detail.model;
  const provider = detail.provider;
  if (typeof model !== 'string' || !model.trim()) return null;
  const m = model.trim();
  if (typeof provider === 'string' && provider.trim()) {
    return `${provider.trim()} / ${m}`;
  }
  return m;
}

type EvaluationTracePanelProps = {
  evaluationTrace: EvaluationDebugLogLine[];
  connected: boolean;
  liveEnabled: boolean;
  runStatus: string | undefined;
  scrollClassName: string;
  /** When true, panel stretches to fill a flex parent (parallel layout). */
  fillHeight?: boolean;
};

function EvaluationTracePanel({
  evaluationTrace,
  connected,
  liveEnabled,
  runStatus,
  scrollClassName,
  fillHeight,
}: EvaluationTracePanelProps) {
  const traceScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = traceScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [evaluationTrace.length]);

  const traceEntries = useMemo(() => {
    return evaluationTrace.map((line, idx) => {
      let deltaSincePrevLineMs: number | null = null;
      if (idx > 0) {
        const t = Date.parse(line.at);
        const tPrev = Date.parse(evaluationTrace[idx - 1].at);
        if (!Number.isNaN(t) && !Number.isNaN(tPrev)) {
          deltaSincePrevLineMs = t - tPrev;
        }
      }
      return {
        line,
        idx,
        deltaSincePrevLineMs,
        isLlmInvocation: isTraceLlmInvocation(line),
      };
    });
  }, [evaluationTrace]);

  return (
    <div
      className={`flex flex-col min-h-0 min-w-0 border border-amber-200/80 bg-amber-50/40 rounded-lg overflow-hidden ${
        fillHeight ? 'h-full min-h-0 flex-1' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-1 shrink-0">
        <span className="text-xs font-semibold text-amber-950">Evaluation trace (live)</span>
        <span className="text-[10px] text-gray-500 shrink-0">
          {connected ? 'Socket connected' : 'Socket disconnected'}
        </span>
      </div>
      <p className="text-[10px] text-gray-600 px-3 pb-2 leading-snug shrink-0">
        Each entry includes Δ duration since the previous log line (chronological). Lines where a model request or
        response was logged use bold blue titles and show provider/model. Step wall summaries stay green.
      </p>
      <div className="px-2 pb-2 flex-1 min-h-0 flex flex-col font-mono text-[10px] leading-relaxed text-gray-900">
        <div
          ref={traceScrollRef}
          className={`rounded border border-amber-100 bg-white p-2 shadow-inner flex-1 min-h-0 overflow-y-auto ${scrollClassName}`}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {evaluationTrace.length === 0 ? (
            <span className="text-gray-400">
              {runStatus === 'RUNNING' && liveEnabled
                ? 'Waiting for trace lines from the server…'
                : 'No trace in this session (start a run or reconnect while the evaluation is active).'}
            </span>
          ) : (
            traceEntries.map(({ line, idx, deltaSincePrevLineMs, isLlmInvocation }) => {
              const detailObj =
                line.detail != null && typeof line.detail === 'object'
                  ? (line.detail as Record<string, unknown>)
                  : undefined;
              const modelLabel =
                isLlmInvocation && detailObj ? formatTraceModelLabel(detailObj) : null;
              const keyCount = detailObj != null ? Object.keys(detailObj).length : 0;
              const hasDetail = keyCount > 0;
              const isStepWall =
                line.detail != null &&
                typeof line.detail === 'object' &&
                (line.detail as { stepWallKind?: string }).stepWallKind;
              const titleClass = isLlmInvocation
                ? 'font-bold text-blue-700 dark:text-blue-300'
                : isStepWall
                  ? 'text-emerald-900/90 font-medium'
                  : '';
              const stampClass = isLlmInvocation
                ? 'text-blue-700 dark:text-blue-300 font-bold'
                : 'text-amber-800/90';
              const msgClass = isLlmInvocation
                ? 'text-blue-700 dark:text-blue-300 font-bold break-words whitespace-pre-wrap'
                : `text-gray-700 break-words whitespace-pre-wrap ${isStepWall ? 'text-emerald-900/90' : ''}`;

              return (
                <div
                  key={`${line.at}-${idx}`}
                  className="border-b border-gray-50 pb-1 mb-1 last:border-0 last:pb-0 last:mb-0 text-[10px] leading-snug"
                >
                  <div className="min-w-0">
                    <div className={titleClass || undefined}>
                      <span className={stampClass}>{line.at}</span>{' '}
                      <span className={msgClass}>— {line.message}</span>
                    </div>
                    {modelLabel ? (
                      <div className="mt-0.5 pl-1 text-[9px] leading-tight font-semibold text-blue-600 dark:text-blue-400">
                        Model: {modelLabel}
                      </div>
                    ) : null}
                    {idx > 0 && deltaSincePrevLineMs != null ? (
                      <div className="mt-0.5 pl-1 text-[9px] text-gray-500 leading-tight">
                        Δ {formatTraceDeltaSeconds(deltaSincePrevLineMs)} since previous log line
                      </div>
                    ) : null}
                    {hasDetail ? (
                      <div className="mt-0.5">
                        <details className="inline min-w-0 max-w-full align-baseline open:block open:w-full">
                          <summary className="inline cursor-pointer text-[9px] text-gray-500 hover:text-gray-700 marker:text-gray-400">
                            ({keyCount} keys)
                          </summary>
                          <pre className="mt-1 block w-full min-w-0 max-w-full pl-3 border-l border-amber-200/80 text-gray-600 whitespace-pre-wrap break-words text-[9px]">
                            {JSON.stringify(line.detail, null, 2)}
                          </pre>
                        </details>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default function EvaluationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [humanSelection, setHumanSelection] = useState<Record<string, number>>({});
  const [startFeedback, setStartFeedback] = useState<string | null>(null);
  const [isDetached, setIsDetached] = useState(false);
  const detachedWindowRef = useRef<Window | null>(null);
  const [intentDraft, setIntentDraft] = useState('');
  const [desiredDraft, setDesiredDraft] = useState('');
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const [autoSignInDraft, setAutoSignInDraft] = useState(false);
  const [autoSignInOtpDraft, setAutoSignInOtpDraft] = useState<AutoClerkOtpUiMode>('default');
  const [runModeDraft, setRunModeDraft] = useState<EvaluationRunMode>('continuous');
  const [selectedStepIdx, setSelectedStepIdx] = useState(0);
  const [timelineViewMode, setTimelineViewMode] = useState<TimelineViewMode>('stacked');
  const [fullStepModalIdx, setFullStepModalIdx] = useState<number | null>(null);
  const parallelStepsScrollRef = useRef<HTMLDivElement>(null);
  const stackedStepsScrollRef = useRef<HTMLDivElement>(null);

  const query = useQuery({
    queryKey: ['evaluation', id],
    queryFn: () => evaluationsApi.get(id!),
    enabled: !!id,
  });

  const ev = query.data;

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  });
  const projects: ProjectDto[] = projectsQuery.data ?? [];

  useEffect(() => {
    if (!ev) return;
    setIntentDraft(ev.intent);
    setDesiredDraft(ev.desiredOutput);
    setProjectIdDraft(ev.projectId ?? '');
    setAutoSignInDraft(ev.autoSignIn);
    setAutoSignInOtpDraft(
      ev.autoSignInClerkOtpMode === 'mailslurp' || ev.autoSignInClerkOtpMode === 'clerk_test_email'
        ? ev.autoSignInClerkOtpMode
        : 'default',
    );
    setRunModeDraft(ev.runMode ?? 'continuous');
  }, [ev?.id, ev?.intent, ev?.desiredOutput, ev?.projectId, ev?.autoSignIn, ev?.autoSignInClerkOtpMode, ev?.runMode]);

  const liveEnabled =
    !!id &&
    !!ev &&
    (ev.status === 'RUNNING' ||
      ev.status === 'WAITING_FOR_HUMAN' ||
      ev.status === 'WAITING_FOR_REVIEW');

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['evaluation', id] });
    void queryClient.invalidateQueries({ queryKey: ['evaluations'] });
  }, [queryClient, id]);

  /** Keep socket + trace when preview is detached; only the inline frame is collapsed (see preview block). */
  const { frameDataUrl, lastProgress, evaluationTrace, connected } = useEvaluationLive(id, {
    enabled: liveEnabled,
    onStale: invalidate,
  });

  const displaySteps = useMemo(
    () => mergeStepsWithLivePlaceholder(ev?.steps ?? [], lastProgress),
    [ev?.steps, lastProgress],
  );

  useEffect(() => {
    if (!displaySteps.length) return;
    setSelectedStepIdx(displaySteps.length - 1);
  }, [displaySteps.length, ev?.id]);

  useEffect(() => {
    if (!displaySteps.length) return;
    const container =
      timelineViewMode === 'parallel' ? parallelStepsScrollRef.current : stackedStepsScrollRef.current;
    const child = container?.children[selectedStepIdx] as HTMLElement | undefined;
    if (container && child) {
      container.scrollTo({ left: child.offsetLeft, behavior: 'smooth' });
    }
  }, [selectedStepIdx, displaySteps.length, lastProgress?.sequence, timelineViewMode]);

  const handleDetachPreview = useCallback(() => {
    if (!id) return;
    const url = `${window.location.origin}/evaluation-preview/${id}`;
    const w = window.open(url, 'bladerunner-evaluation-preview', 'width=1320,height=780');
    if (w) {
      detachedWindowRef.current = w;
      setIsDetached(true);
      const check = setInterval(() => {
        if (w.closed) {
          setIsDetached(false);
          detachedWindowRef.current = null;
          clearInterval(check);
        }
      }, 500);
    }
  }, [id]);

  const handleReattachPreview = useCallback(() => {
    if (detachedWindowRef.current && !detachedWindowRef.current.closed) {
      detachedWindowRef.current.close();
    }
    detachedWindowRef.current = null;
    setIsDetached(false);
  }, []);

  const startMutation = useMutation({
    mutationFn: () => evaluationsApi.start(id!, { runMode: runModeDraft }),
    onSuccess: (data) => {
      if (data.scheduled === false) {
        setStartFeedback('A run was already in progress for this evaluation — refreshing status.');
      } else {
        setStartFeedback(null);
      }
      invalidate();
    },
    onError: (err: Error) => {
      setStartFeedback(err instanceof Error ? err.message : 'Start request failed');
    },
  });

  const patchMutation = useMutation({
    mutationFn: () =>
      evaluationsApi.patch(id!, {
        intent: intentDraft.trim(),
        desiredOutput: desiredDraft.trim(),
        projectId: projectIdDraft === '' ? null : projectIdDraft,
        autoSignIn: autoSignInDraft,
        autoSignInClerkOtpMode:
          autoSignInDraft && autoSignInOtpDraft !== 'default' ? autoSignInOtpDraft : null,
      }),
    onSuccess: () => {
      setStartFeedback(null);
      invalidate();
    },
    onError: (err: Error) => {
      setStartFeedback(err instanceof Error ? err.message : 'Save failed');
    },
  });

  const reprocessMutation = useMutation({
    mutationFn: () => evaluationsApi.reprocess(id!, { runMode: runModeDraft }),
    onSuccess: (data) => {
      if (data.scheduled === false) {
        setStartFeedback('A run was already in progress for this evaluation — refreshing status.');
      } else {
        setStartFeedback(null);
      }
      invalidate();
    },
    onError: (err: Error) => {
      setStartFeedback(err instanceof Error ? err.message : 'Re-run request failed');
    },
  });

  const continueReviewMutation = useMutation({
    mutationFn: () => evaluationsApi.continueReview(id!),
    onSuccess: () => {
      setStartFeedback(null);
      invalidate();
    },
    onError: (err: Error) => {
      setStartFeedback(err instanceof Error ? err.message : 'Continue failed');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => evaluationsApi.cancel(id!),
    onSuccess: invalidate,
  });

  const humanMutation = useMutation({
    mutationFn: (body: { questionId: string; selectedIndex: number }) =>
      evaluationsApi.humanAnswer(id!, body),
    onSuccess: invalidate,
  });

  const pendingQuestion = useMemo(() => {
    if (!ev?.questions?.length) return null;
    return ev.questions.find((q) => q.state === 'pending') ?? null;
  }, [ev]);

  const latestReport = ev?.reports?.[0] ?? null;

  if (!id) {
    return <ErrorState message="Missing evaluation id" />;
  }
  if (query.isLoading) return <LoadingState message="Loading evaluation..." />;
  if (query.error || !ev) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <ErrorState message="Evaluation not found or failed to load." />
        <Link to="/evaluations" className="text-sm text-[#4B90FF] mt-4 inline-block">
          ← Back to evaluations
        </Link>
      </div>
    );
  }

  const canEditContent =
    ev.status !== 'RUNNING' &&
    ev.status !== 'WAITING_FOR_HUMAN' &&
    ev.status !== 'WAITING_FOR_REVIEW';
  const serverOtp: AutoClerkOtpUiMode =
    ev.autoSignInClerkOtpMode === 'mailslurp' || ev.autoSignInClerkOtpMode === 'clerk_test_email'
      ? ev.autoSignInClerkOtpMode
      : 'default';
  const draftsDirty =
    intentDraft !== ev.intent ||
    desiredDraft !== ev.desiredOutput ||
    projectIdDraft !== (ev.projectId ?? '') ||
    autoSignInDraft !== ev.autoSignIn ||
    autoSignInOtpDraft !== serverOtp;
  const canStartQueued = ev.status === 'QUEUED';
  const canReprocess =
    ev.status === 'FAILED' ||
    ev.status === 'COMPLETED' ||
    ev.status === 'CANCELLED' ||
    ev.status === 'WAITING_FOR_HUMAN' ||
    ev.status === 'WAITING_FOR_REVIEW';
  const canCancel =
    ev.status === 'RUNNING' ||
    ev.status === 'QUEUED' ||
    ev.status === 'WAITING_FOR_HUMAN' ||
    ev.status === 'WAITING_FOR_REVIEW';
  const runMode = ev.runMode ?? 'continuous';
  /** Allow choosing Normal vs Review before Start, or before Re-run / Retry (not only while QUEUED). Otherwise a prior step_review run could not be switched to continuous without editing DB. */
  const canPickRunMode = ev.status === 'QUEUED' || canReprocess;
  const canContinueReview = ev.status === 'WAITING_FOR_REVIEW' && runMode === 'step_review';
  const showHuman =
    ev.status === 'WAITING_FOR_HUMAN' && pendingQuestion && parseOptions(pendingQuestion).length > 0;

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
      <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="mb-6">
        <Link
          to="/evaluations"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
        >
          <ArrowLeft size={16} />
          Evaluations
        </Link>
      </div>

      <div className="w-full space-y-6">
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-2xl font-semibold text-gray-900 tracking-tight flex items-center gap-2">
                <ClipboardList className="w-7 h-7 text-[#4B90FF]" />
                {ev.name}
              </h1>
              <StatusBadge status={ev.status} />
            </div>
            <a
              href={ev.url}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-[#4B90FF] inline-flex items-center gap-1 hover:underline"
            >
              <ExternalLink size={14} />
              {ev.url}
            </a>
            <div className="mt-3">
              <p className="text-xs font-medium text-gray-500 mb-1">Project</p>
              {canEditContent ? (
                <select
                  className="w-full max-w-md rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                  value={projectIdDraft}
                  onChange={(e) => setProjectIdDraft(e.target.value)}
                  aria-label="Project"
                >
                  <option value="">No project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : ev.project ? (
                <span className="inline-flex items-center gap-2 text-sm text-gray-800">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: ev.project.color }}
                    aria-hidden
                  />
                  {ev.project.name}
                </span>
              ) : (
                <span className="text-sm text-gray-400">No project</span>
              )}
            </div>
            <div className="mt-4">
              <p className="text-xs font-medium text-gray-500 mb-1">Auto-sign in</p>
              {canEditContent ? (
                <div className="rounded-md border border-gray-100 bg-gray-50/80 px-3 py-3 space-y-2 max-w-md">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-gray-300"
                      checked={autoSignInDraft}
                      onChange={(e) => setAutoSignInDraft(e.target.checked)}
                    />
                    <span className="text-sm text-gray-800">
                      Attempt automatic sign-in when the remote browser hits a login screen (uses the same Clerk / project
                      test credentials as recording playback).
                    </span>
                  </label>
                  {autoSignInDraft && (
                    <div className="pl-6 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                      <label htmlFor="eval-detail-clerk-otp" className="whitespace-nowrap">
                        Clerk OTP
                      </label>
                      <select
                        id="eval-detail-clerk-otp"
                        value={autoSignInOtpDraft}
                        onChange={(e) => setAutoSignInOtpDraft(e.target.value as AutoClerkOtpUiMode)}
                        className="flex-1 min-w-[160px] border border-gray-200 rounded-md px-2 py-1.5 text-[11px] text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                      >
                        <option value="default">Server default</option>
                        <option value="clerk_test_email">Test email (424242)</option>
                        <option value="mailslurp">MailSlurp inbox</option>
                      </select>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-700">
                  {ev.autoSignIn ? 'On' : 'Off'}
                  {ev.autoSignIn && serverOtp !== 'default' ? (
                    <span className="text-gray-500">
                      {' '}
                      (Clerk OTP: {serverOtp === 'mailslurp' ? 'MailSlurp' : 'Test email'})
                    </span>
                  ) : null}
                </p>
              )}
            </div>
            {ev.failureMessage && (
              <p className="mt-2 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{ev.failureMessage}</p>
            )}
            {startFeedback && (
              <p className="mt-2 text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">{startFeedback}</p>
            )}
          </div>

          <section className="w-full rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="eval-goal-heading">
            <h2 id="eval-goal-heading" className="text-sm font-semibold text-gray-800 mb-3">
              Goal Definitions
            </h2>
            <p className="text-xs font-medium text-gray-500 mb-1">Intent</p>
            {canEditContent ? (
              <textarea
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 min-h-[100px] focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                value={intentDraft}
                onChange={(e) => setIntentDraft(e.target.value)}
                aria-label="Evaluation intent"
              />
            ) : (
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{ev.intent}</p>
            )}
            <p className="text-xs font-medium text-gray-500 mt-4 mb-1">Desired output</p>
            {canEditContent ? (
              <textarea
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 min-h-[100px] focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                value={desiredDraft}
                onChange={(e) => setDesiredDraft(e.target.value)}
                aria-label="Desired evaluation output"
              />
            ) : (
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{ev.desiredOutput}</p>
            )}
            {canEditContent && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-gray-500 max-w-xl">
                  Save changes before <strong>Start</strong> or <strong>Re-run</strong> so the server uses your latest text.
                  Re-run clears prior steps, questions, and the last report.
                </p>
                {draftsDirty && (
                  <button
                    type="button"
                    disabled={patchMutation.isPending || !intentDraft.trim() || !desiredDraft.trim()}
                    onClick={() => patchMutation.mutate()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:border-[#4B90FF]/40 hover:text-[#4B90FF] disabled:opacity-50"
                  >
                    {patchMutation.isPending ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                    Save changes
                  </button>
                )}
              </div>
            )}
          </section>

          <div className="flex flex-wrap gap-2">
            {canStartQueued && (
              <button
                type="button"
                disabled={startMutation.isPending}
                onClick={() => {
                  setStartFeedback(null);
                  startMutation.mutate();
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-[#4B90FF] text-white text-sm font-medium px-4 py-2 hover:bg-[#3d7fe6] disabled:opacity-50"
              >
                {startMutation.isPending ? <Loader2 className="animate-spin" size={18} /> : <Play size={18} />}
                Start run
              </button>
            )}
            {canReprocess && (
              <button
                type="button"
                disabled={reprocessMutation.isPending}
                onClick={() => {
                  setStartFeedback(null);
                  reprocessMutation.mutate();
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-[#4B90FF] text-white text-sm font-medium px-4 py-2 hover:bg-[#3d7fe6] disabled:opacity-50"
                title="Clear prior steps and report, then start a new run with the current intent and output"
              >
                {reprocessMutation.isPending ? (
                  <Loader2 className="animate-spin" size={18} />
                ) : (
                  <RotateCcw size={18} />
                )}
                {ev.status === 'FAILED' ? 'Retry run' : 'Re-run'}
              </button>
            )}
            {canCancel && (
              <button
                type="button"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 hover:bg-gray-50 disabled:opacity-50"
              >
                <Square size={16} />
                Cancel
              </button>
            )}
            {(ev.status === 'RUNNING' ||
              ev.status === 'WAITING_FOR_HUMAN' ||
              ev.status === 'WAITING_FOR_REVIEW') && (
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                <Radio size={14} className={connected ? 'text-green-500' : 'text-amber-500'} />
                {connected ? 'Live stream connected' : 'Connecting…'}
              </span>
            )}
          </div>

          {canPickRunMode && (
            <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2 text-sm">
              <span className="text-xs font-medium text-gray-500 block mb-2">Run mode</span>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="eval-run-mode"
                    checked={runModeDraft === 'continuous'}
                    onChange={() => setRunModeDraft('continuous')}
                  />
                  <span>Normal — run all steps continuously</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="eval-run-mode"
                    checked={runModeDraft === 'step_review'}
                    onChange={() => setRunModeDraft('step_review')}
                  />
                  <span>Review — pause after each step (Continue to advance)</span>
                </label>
              </div>
              {ev.status !== 'QUEUED' && (
                <p className="text-[11px] text-gray-500 mt-2">
                  Applies when you start or re-run this evaluation (only pauses for human questions in Normal mode).
                </p>
              )}
            </div>
          )}
          {!canPickRunMode && (
            <p className="text-xs text-gray-500">
              Run mode:{' '}
              <strong>{runMode === 'step_review' ? 'Review (step-by-step)' : 'Normal (continuous)'}</strong>
            </p>
          )}

          <div className="w-full">
            <div
              className={`w-full rounded-xl border border-gray-200 bg-black overflow-hidden flex relative ${
                liveEnabled && isDetached
                  ? 'h-[10px] min-h-[10px] max-h-[10px] items-stretch justify-stretch'
                  : 'aspect-video min-h-[200px] items-center justify-center'
              }`}
            >
              {liveEnabled && isDetached ? (
                <button
                  type="button"
                  onClick={handleReattachPreview}
                  className="absolute inset-0 w-full h-full cursor-pointer bg-gray-800/90 hover:bg-gray-700/90 border-0 p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4B90FF] focus-visible:ring-inset"
                  title="Preview detached to another window — click to reattach here"
                  aria-label="Preview detached to another window. Reattach here."
                />
              ) : liveEnabled && !isDetached ? (
                <>
                  {frameDataUrl ? (
                    <img src={frameDataUrl} alt="Live browser" className="w-full h-full object-contain" />
                  ) : (
                    <span className="text-gray-500 text-sm px-4 text-center">
                      {ev.status === 'RUNNING' ||
                      ev.status === 'WAITING_FOR_HUMAN' ||
                      ev.status === 'WAITING_FOR_REVIEW'
                        ? 'Waiting for video frame…'
                        : 'Connecting…'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleDetachPreview}
                    className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 bg-white/90 backdrop-blur border border-gray-200 rounded-md text-xs text-gray-700 hover:text-[#4B90FF] hover:border-[#4B90FF]/30 transition-all shadow-sm"
                    title="Detach preview to new window"
                    aria-label="Detach evaluation preview to new window"
                  >
                    <ExternalLink size={12} aria-hidden />
                    Detach
                  </button>
                </>
              ) : (
                <span className="text-gray-500 text-sm px-4 text-center">
                  {ev.status === 'COMPLETED'
                    ? 'Run finished'
                    : 'Start the run to see the browser'}
                </span>
              )}
            </div>
            {!isDetached ? (
              <p className="text-[10px] text-gray-400 mt-2 text-center">
                Remote browser · same worker as recording
              </p>
            ) : null}
          </div>

          <section
            className="w-full rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
            aria-labelledby="thinking-process-heading"
          >
            <h2
              id="thinking-process-heading"
              className="text-sm font-semibold text-gray-800 px-4 pt-4 pb-2 border-b border-gray-100"
            >
              Thinking process
            </h2>
            <ThinkingProcessPanel
              steps={displaySteps}
              lastProgress={lastProgress}
              onOpenFullStep={(idx) => setFullStepModalIdx(idx)}
            />
          </section>

          <Dialog.Root open={fullStepModalIdx !== null} onOpenChange={(open) => !open && setFullStepModalIdx(null)}>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/50" />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-[201] flex max-h-[90vh] w-[min(96vw,56rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-gray-200 bg-white p-0 shadow-xl outline-none">
                <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 shrink-0">
                  <Dialog.Title className="text-sm font-semibold text-gray-900 pr-2">
                    {fullStepModalIdx !== null && displaySteps[fullStepModalIdx]
                      ? `Step ${displaySteps[fullStepModalIdx].sequence}${
                          displaySteps[fullStepModalIdx].stepTitle
                            ? ` — ${displaySteps[fullStepModalIdx].stepTitle}`
                            : ''
                        }`
                      : 'Step detail'}
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 shrink-0"
                      aria-label="Close"
                    >
                      <X size={18} />
                    </button>
                  </Dialog.Close>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {fullStepModalIdx !== null && displaySteps[fullStepModalIdx] ? (
                    <EvaluationStepCard
                      st={displaySteps[fullStepModalIdx]}
                      idx={fullStepModalIdx}
                      selectedStepIdx={fullStepModalIdx}
                      lastProgress={lastProgress}
                      layout="stacked"
                      embedMode="modal"
                    />
                  ) : null}
                </div>
                <Dialog.Description className="sr-only">
                  Full step detail: codegen and analyzer inputs and outputs for this evaluation step.
                </Dialog.Description>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>

          <section
            className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
            aria-label="Evaluation step timeline"
          >
            {ev.progressSummary ? (
              <details className="group border-b border-gray-100 px-4 py-3">
                <summary className="cursor-pointer list-none text-xs font-medium text-gray-500 marker:content-none [&::-webkit-details-marker]:hidden flex items-center gap-1.5">
                  <ChevronRight
                    size={14}
                    className="text-gray-400 shrink-0 transition-transform group-open:rotate-90"
                    aria-hidden
                  />
                  Full progress log
                </summary>
                <pre className="mt-2 text-[11px] font-mono text-gray-600 max-h-48 overflow-y-auto whitespace-pre-wrap">
                  {ev.progressSummary}
                </pre>
              </details>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2 border-b border-gray-100">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <h2 className="text-sm font-semibold text-gray-800 shrink-0">Step timeline</h2>
                <div
                  className="flex items-center gap-0.5 rounded-lg border border-gray-200 bg-gray-50 p-0.5 shrink-0"
                  role="group"
                  aria-label="Timeline layout"
                >
                  <button
                    type="button"
                    onClick={() => setTimelineViewMode('stacked')}
                    className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                      timelineViewMode === 'stacked'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Stacked
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimelineViewMode('parallel')}
                    className={`px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors ${
                      timelineViewMode === 'parallel'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Parallel
                  </button>
                </div>
                {displaySteps.length > 0 && (
                  <div className="flex items-center gap-1 overflow-x-auto min-w-0 flex-1 py-1">
                    <button
                      type="button"
                      className="p-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 shrink-0"
                      disabled={selectedStepIdx <= 0}
                      onClick={() => setSelectedStepIdx((i) => Math.max(0, i - 1))}
                      aria-label="Previous step"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div className="flex items-center gap-1 text-xs text-gray-600">
                      {displaySteps.map((st, idx) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => setSelectedStepIdx(idx)}
                          className={`whitespace-nowrap px-2 py-1 rounded-md border max-w-[140px] truncate ${
                            selectedStepIdx === idx
                              ? 'border-[#4B90FF] bg-[#4B90FF]/10 text-[#4B90FF] font-medium'
                              : 'border-gray-200 hover:bg-gray-50'
                          }`}
                          title={st.stepTitle ?? `Step ${st.sequence}`}
                        >
                          {st.stepTitle
                            ? `${st.sequence}. ${st.stepTitle.length > 20 ? `${st.stepTitle.slice(0, 20)}…` : st.stepTitle}`
                            : `Step ${st.sequence}`}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="p-1 rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-40 shrink-0"
                      disabled={selectedStepIdx >= displaySteps.length - 1}
                      onClick={() =>
                        setSelectedStepIdx((i) => Math.min(displaySteps.length - 1, i + 1))
                      }
                      aria-label="Next step"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>
              {canContinueReview && (
                <button
                  type="button"
                  disabled={continueReviewMutation.isPending}
                  onClick={() => continueReviewMutation.mutate()}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#4B90FF] text-white text-sm font-medium px-4 py-2 hover:bg-[#3d7fe6] disabled:opacity-50 shrink-0"
                >
                  {continueReviewMutation.isPending ? <Loader2 className="animate-spin" size={18} /> : null}
                  Continue
                </button>
              )}
            </div>
            {displaySteps.length === 0 ? (
              <p className="text-sm text-gray-500 px-4 py-6">
                No steps yet. Start the run to record each step (inputs and outputs appear after the model runs).
              </p>
            ) : timelineViewMode === 'parallel' ? (
              <div className="flex flex-col lg:flex-row gap-4 px-4 pb-4 pt-2 lg:h-[1200px] lg:max-h-[1200px] lg:min-h-0 lg:items-stretch">
                <div className="min-w-0 w-full lg:flex-1 flex flex-col min-h-[1200px] lg:h-full lg:min-h-0">
                  <div
                    ref={parallelStepsScrollRef}
                    className="flex h-full min-h-[1200px] lg:min-h-0 w-full overflow-x-auto overflow-y-visible snap-x snap-mandatory scroll-smooth rounded-lg border border-gray-100 bg-gray-50/30"
                  >
                    {displaySteps.map((st, idx) => (
                      <EvaluationStepCard
                        key={st.id}
                        st={st}
                        idx={idx}
                        selectedStepIdx={selectedStepIdx}
                        lastProgress={lastProgress}
                        layout="parallel"
                      />
                    ))}
                  </div>
                </div>
                <div className="min-w-0 w-full lg:flex-1 flex flex-col min-h-[1200px] lg:h-full lg:min-h-0">
                  {liveEnabled || evaluationTrace.length > 0 ? (
                    <EvaluationTracePanel
                      evaluationTrace={evaluationTrace}
                      connected={connected}
                      liveEnabled={liveEnabled}
                      runStatus={ev.status}
                      scrollClassName=""
                      fillHeight
                    />
                  ) : (
                    <div className="flex h-full min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-amber-50/30 text-xs text-gray-500 px-4 text-center">
                      Trace appears when the run is live or after lines arrive from the server.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div
                  ref={stackedStepsScrollRef}
                  className="flex w-full min-w-0 h-[1200px] flex-row gap-4 overflow-x-auto overflow-y-visible px-4 pb-4 pt-2 scroll-smooth snap-x snap-mandatory items-stretch"
                >
                  {displaySteps.map((st, idx) => (
                    <EvaluationStepCard
                      key={st.id}
                      st={st}
                      idx={idx}
                      selectedStepIdx={selectedStepIdx}
                      lastProgress={lastProgress}
                      layout="stacked"
                    />
                  ))}
                </div>
                {liveEnabled || evaluationTrace.length > 0 ? (
                  <div className="px-4 pb-4 pt-2 border-t border-amber-100/80">
                    <EvaluationTracePanel
                      evaluationTrace={evaluationTrace}
                      connected={connected}
                      liveEnabled={liveEnabled}
                      runStatus={ev.status}
                      scrollClassName="max-h-72"
                    />
                  </div>
                ) : null}
              </>
            )}
          </section>

          {showHuman && pendingQuestion && (
            <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
              <h2 className="text-sm font-semibold text-violet-900 mb-2">Your input</h2>
              <p className="text-sm text-gray-800 mb-3">{pendingQuestion.prompt}</p>
              <div className="space-y-2">
                {parseOptions(pendingQuestion).map((opt, idx) => (
                  <label
                    key={idx}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="human-q"
                      checked={(humanSelection[pendingQuestion.id] ?? -1) === idx}
                      onChange={() =>
                        setHumanSelection((s) => ({ ...s, [pendingQuestion.id]: idx }))
                      }
                    />
                    {opt}
                  </label>
                ))}
              </div>
              <button
                type="button"
                className="mt-4 rounded-lg bg-violet-600 text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
                disabled={
                  humanMutation.isPending ||
                  typeof humanSelection[pendingQuestion.id] !== 'number'
                }
                onClick={() => {
                  const sel = humanSelection[pendingQuestion.id];
                  if (typeof sel !== 'number') return;
                  humanMutation.mutate({ questionId: pendingQuestion.id, selectedIndex: sel });
                }}
              >
                {humanMutation.isPending ? 'Submitting…' : 'Submit answer'}
              </button>
            </section>
          )}

          {latestReport && (
            <section>
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Report</h2>
              <div className="rounded-xl border border-gray-200 bg-white p-4 prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800">{latestReport.content}</pre>
              </div>
            </section>
          )}

      </div>
      </div>
    </div>
  );
}
