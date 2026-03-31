import { useMemo, useState, useRef, useCallback, useEffect, type RefObject } from 'react';
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
  Image,
  ScanSearch,
} from 'lucide-react';
import {
  ViewportJpegPreviewIconButton,
  getAnalyzerViewportJpegBase64,
  getCodegenViewportJpegBase64,
  omitBinaryPreviewKeys,
} from '@/components/ui/ViewportJpegPreviewIconButton';

function JsonBlock({ value }: { value: unknown }) {
  if (value == null || (typeof value === 'object' && value !== null && Object.keys(value as object).length === 0)) {
    return <span className="text-gray-400 text-xs">—</span>;
  }
  return (
    <pre className="text-[11px] font-mono bg-gray-50 border border-gray-100 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-gray-800">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

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
    createdAt: new Date(0).toISOString(),
  };
  return [...steps, placeholder].sort((a, b) => a.sequence - b.sequence);
}

function getLiveLoadingFlags(
  st: EvaluationStepDto,
  lastProgress: EvaluationProgressPayload | null,
): {
  codegenInputs: boolean;
  codegenOutputs: boolean;
  analyzerInputs: boolean;
  analyzerOutputs: boolean;
} {
  if (
    lastProgress == null ||
    lastProgress.sequence == null ||
    lastProgress.sequence !== st.sequence
  ) {
    return { codegenInputs: false, codegenOutputs: false, analyzerInputs: false, analyzerOutputs: false };
  }
  const phase = String(lastProgress.phase ?? '');
  /** Use `!= null` (not `stepJsonPresent`) so `{}` from the API still clears spinners — empty object is persisted, not "still loading". */
  const hasCodegenIn = st.codegenInputJson != null;
  const hasCodegenOut = st.codegenOutputJson != null;
  const hasAnalyzerIn = st.analyzerInputJson != null;
  const hasAnalyzerOut = st.analyzerOutputJson != null;

  /**
   * Never hardcode spinners for a whole phase: `lastProgress.phase` can lag behind refetched
   * step JSON (socket catch-up, missed events). Show PendingPanel only while the matching
   * field is still absent.
   */
  if (phase === 'proposing') {
    return {
      codegenInputs: !hasCodegenIn,
      codegenOutputs: !hasCodegenOut,
      analyzerInputs: !hasAnalyzerIn,
      analyzerOutputs: !hasAnalyzerOut,
    };
  }
  if (phase === 'executing') {
    return {
      codegenInputs: !hasCodegenIn,
      codegenOutputs: !hasCodegenOut,
      analyzerInputs: !hasAnalyzerIn,
      analyzerOutputs: !hasAnalyzerOut,
    };
  }
  if (phase === 'analyzing') {
    return {
      codegenInputs: false,
      codegenOutputs: false,
      analyzerInputs: !hasAnalyzerIn,
      analyzerOutputs: !hasAnalyzerOut,
    };
  }
  return { codegenInputs: false, codegenOutputs: false, analyzerInputs: false, analyzerOutputs: false };
}

function PendingPanel({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-[72px] items-center justify-center gap-2 rounded border border-dashed border-gray-200 bg-gray-50/90 text-gray-500"
      role="status"
      aria-busy
    >
      <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
      <span className="text-xs">{label}</span>
    </div>
  );
}

function analyzerSectionPendingLabel(phase: string | undefined): string {
  if (phase === 'proposing') return 'Waiting for codegen step…';
  return 'Analyzer model running…';
}

function parseOptions(q: { optionsJson: string }): string[] {
  try {
    const parsed = JSON.parse(q.optionsJson) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

type TimelineViewMode = 'stacked' | 'parallel';

function EvaluationStepCard({
  st,
  idx,
  selectedStepIdx,
  lastProgress,
  innerRef,
  layout,
}: {
  st: EvaluationStepDto;
  idx: number;
  selectedStepIdx: number;
  lastProgress: EvaluationProgressPayload | null;
  innerRef?: (el: HTMLDivElement | null) => void;
  layout: TimelineViewMode;
}) {
  const load = getLiveLoadingFlags(st, lastProgress);
  const showCodegenFromLive =
    load.codegenOutputs &&
    lastProgress?.sequence === st.sequence &&
    lastProgress.phase === 'executing' &&
    (lastProgress.thinking || lastProgress.playwrightCode || lastProgress.expectedOutcome);

  const outerClass =
    layout === 'stacked'
      ? `snap-center shrink-0 min-w-0 flex-[0_0_calc(50%-0.5rem)] rounded-lg border p-3 text-sm ${
          selectedStepIdx === idx ? 'border-[#4B90FF] ring-1 ring-[#4B90FF]/30' : 'border-gray-200'
        }`
      : `w-full min-w-[100%] shrink-0 snap-center snap-always flex flex-col min-h-0 max-h-full overflow-y-auto rounded-lg border p-3 text-sm ${
          selectedStepIdx === idx ? 'border-[#4B90FF] ring-1 ring-[#4B90FF]/30' : 'border-gray-200'
        }`;

  return (
    <div ref={innerRef} className={outerClass}>
      <div className="flex items-start justify-between gap-2 mb-2 shrink-0">
        <div>
          <span className="font-semibold text-gray-900">Step {st.sequence}</span>
          {st.stepTitle ? <p className="text-xs text-gray-600 mt-0.5">{st.stepTitle}</p> : null}
        </div>
        {st.decision ? (
          <span className="text-[10px] uppercase tracking-wide text-gray-500 shrink-0">{st.decision}</span>
        ) : lastProgress?.sequence === st.sequence && lastProgress.phase ? (
          <span
            className="text-[10px] uppercase tracking-wide text-[#4B90FF] shrink-0 max-w-[120px] truncate"
            title={String(lastProgress.phase)}
          >
            {String(lastProgress.phase).replace(/_/g, ' ')}
          </span>
        ) : null}
      </div>
      <div className="space-y-3 text-xs min-h-0">
        <div>
          <span className="text-gray-500 font-medium block mb-1">Activity log before this step</span>
          <div className="max-h-24 overflow-y-auto rounded border border-gray-100 bg-gray-50/80 p-2 font-mono text-gray-700 whitespace-pre-wrap">
            {st.progressSummaryBefore?.trim() || '(empty)'}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-gray-500 font-medium">Codegen inputs (LLM)</span>
            <ViewportJpegPreviewIconButton
              base64={getCodegenViewportJpegBase64(st.codegenInputJson)}
              icon={Image}
              modalTitle="Codegen — full-page Set-of-Marks JPEG sent to the model"
              openLabel="Preview JPEG sent to the codegen model"
              emptyLabel="No stored viewport JPEG (older runs did not persist it)"
            />
          </div>
          {load.codegenInputs ? (
            <PendingPanel
              label={
                lastProgress?.phase === 'proposing' ? 'Capturing inputs for codegen…' : 'Loading codegen inputs…'
              }
            />
          ) : (
            <JsonBlock
              value={omitBinaryPreviewKeys(
                omitBinaryPreviewKeys(st.codegenInputJson, ['viewportJpegBase64']),
                ['somManifest', 'accessibilitySnapshot'],
                '[omitted — long text; see LLM inputs]',
              )}
            />
          )}
        </div>
        <div>
          <span className="text-gray-500 font-medium block mb-1">Codegen outputs</span>
          {load.codegenOutputs ? (
            showCodegenFromLive ? (
              <JsonBlock
                value={{
                  thinking: lastProgress.thinking,
                  playwrightCode: lastProgress.playwrightCode,
                  expectedOutcome: lastProgress.expectedOutcome,
                }}
              />
            ) : lastProgress?.phase === 'proposing' ? (
              <PendingPanel label="Queued: codegen runs after page capture (SOM, accessibility)…" />
            ) : (
              <PendingPanel label="Codegen model running…" />
            )
          ) : (
            <JsonBlock value={st.codegenOutputJson} />
          )}
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-gray-500 font-medium">Analyzer inputs</span>
            <ViewportJpegPreviewIconButton
              base64={getAnalyzerViewportJpegBase64(st.analyzerInputJson)}
              icon={ScanSearch}
              modalTitle="Analyzer — after-step full-page Set-of-Marks JPEG"
              openLabel="Preview after-step JPEG sent to the analyzer"
              emptyLabel="No stored after-step JPEG (step not analyzed yet or older runs)"
            />
          </div>
          {load.analyzerInputs ? (
            <PendingPanel label={analyzerSectionPendingLabel(lastProgress?.phase)} />
          ) : (
            <JsonBlock
              value={omitBinaryPreviewKeys(
                omitBinaryPreviewKeys(st.analyzerInputJson, ['afterStepViewportJpegBase64']),
                ['somManifest', 'accessibilitySnapshot'],
                '[omitted — long text; see LLM inputs]',
              )}
            />
          )}
        </div>
        <div>
          <span className="text-gray-500 font-medium block mb-1">Analyzer outputs</span>
          {load.analyzerOutputs ? (
            <PendingPanel label={analyzerSectionPendingLabel(lastProgress?.phase)} />
          ) : (
            <JsonBlock value={st.analyzerOutputJson} />
          )}
        </div>
      </div>
    </div>
  );
}

type EvaluationTracePanelProps = {
  evaluationTrace: EvaluationDebugLogLine[];
  connected: boolean;
  liveEnabled: boolean;
  runStatus: string | undefined;
  traceEndRef: RefObject<HTMLDivElement | null>;
  scrollClassName: string;
  /** When true, panel stretches to fill a flex parent (parallel layout). */
  fillHeight?: boolean;
};

function EvaluationTracePanel({
  evaluationTrace,
  connected,
  liveEnabled,
  runStatus,
  traceEndRef,
  scrollClassName,
  fillHeight,
}: EvaluationTracePanelProps) {
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
        Server-emitted timeline: auto sign-in, page capture (SOM + accessibility), LLM request/response milestones,
        Playwright execution. Streaming model “thinking” is not available for JSON codegen (single round-trip);
        Gemini request/response timings appear as separate lines.
      </p>
      <div className="px-2 pb-2 flex-1 min-h-0 flex flex-col font-mono text-[10px] leading-relaxed text-gray-900">
        <div
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
            evaluationTrace.map((line, idx) => {
              const keyCount =
                line.detail != null && typeof line.detail === 'object'
                  ? Object.keys(line.detail as object).length
                  : 0;
              const hasDetail = keyCount > 0;
              return (
                <div
                  key={`${line.at}-${idx}`}
                  className="border-b border-gray-50 pb-1 mb-1 last:border-0 last:pb-0 last:mb-0 text-[10px] leading-snug"
                >
                  <div className="min-w-0">
                    <span className="text-amber-800/90">{line.at}</span>{' '}
                    <span className="text-gray-700 break-words">— {line.message}</span>
                    {hasDetail ? (
                      <>
                        {' '}
                        <details className="inline min-w-0 max-w-full align-baseline open:block open:w-full">
                          <summary className="inline cursor-pointer text-[9px] text-gray-500 hover:text-gray-700 marker:text-gray-400">
                            ({keyCount} keys)
                          </summary>
                          <pre className="mt-1 block w-full min-w-0 max-w-full pl-3 border-l border-amber-200/80 text-gray-600 whitespace-pre-wrap break-words text-[9px]">
                            {JSON.stringify(line.detail, null, 2)}
                          </pre>
                        </details>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
          <div ref={traceEndRef} />
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
  const stepCardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const parallelStepsScrollRef = useRef<HTMLDivElement>(null);

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

  const traceEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    traceEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [evaluationTrace.length]);

  const displaySteps = useMemo(
    () => mergeStepsWithLivePlaceholder(ev?.steps ?? [], lastProgress),
    [ev?.steps, lastProgress],
  );

  useEffect(() => {
    if (!displaySteps.length) return;
    setSelectedStepIdx(displaySteps.length - 1);
  }, [displaySteps.length, ev?.id]);

  useEffect(() => {
    if (timelineViewMode === 'parallel') {
      const container = parallelStepsScrollRef.current;
      const child = container?.children[selectedStepIdx] as HTMLElement | undefined;
      child?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    } else {
      const el = stepCardRefs.current[selectedStepIdx];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
      }
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

          {ev.status === 'QUEUED' && (
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
            </div>
          )}
          {ev.status !== 'QUEUED' && (
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
            className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
            aria-label="Evaluation step timeline"
          >
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
              <div className="flex flex-col lg:flex-row gap-4 px-4 pb-4 pt-2 min-h-[min(70vh,640px)] lg:items-stretch">
                <div className="min-w-0 w-full lg:flex-1 flex flex-col min-h-[min(36vh,280px)] lg:min-h-0 lg:max-h-[min(70vh,640px)]">
                  <div
                    ref={parallelStepsScrollRef}
                    className="flex min-h-0 flex-1 w-full overflow-x-auto overflow-y-visible snap-x snap-mandatory scroll-smooth rounded-lg border border-gray-100 bg-gray-50/30"
                  >
                    {displaySteps.map((st, idx) => (
                      <EvaluationStepCard
                        key={st.id}
                        st={st}
                        idx={idx}
                        selectedStepIdx={selectedStepIdx}
                        lastProgress={lastProgress}
                        layout="parallel"
                        innerRef={(el) => {
                          stepCardRefs.current[idx] = el;
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div className="min-w-0 w-full lg:flex-1 flex flex-col min-h-[min(36vh,280px)] lg:min-h-0 lg:max-h-[min(70vh,640px)]">
                  {liveEnabled || evaluationTrace.length > 0 ? (
                    <EvaluationTracePanel
                      evaluationTrace={evaluationTrace}
                      connected={connected}
                      liveEnabled={liveEnabled}
                      runStatus={ev.status}
                      traceEndRef={traceEndRef}
                      scrollClassName=""
                      fillHeight
                    />
                  ) : (
                    <div className="flex flex-1 min-h-[12rem] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-amber-50/30 text-xs text-gray-500 px-4 text-center">
                      Trace appears when the run is live or after lines arrive from the server.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="flex w-full min-w-0 flex-row gap-4 overflow-x-auto overflow-y-visible px-4 pb-4 pt-2 scroll-smooth snap-x snap-mandatory">
                  {displaySteps.map((st, idx) => (
                    <EvaluationStepCard
                      key={st.id}
                      st={st}
                      idx={idx}
                      selectedStepIdx={selectedStepIdx}
                      lastProgress={lastProgress}
                      layout="stacked"
                      innerRef={(el) => {
                        stepCardRefs.current[idx] = el;
                      }}
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
                      traceEndRef={traceEndRef}
                      scrollClassName="max-h-72"
                    />
                  </div>
                ) : null}
              </>
            )}
            {ev.progressSummary ? (
              <div className="px-4 pb-4 pt-0 border-t border-gray-100">
                <span className="text-xs font-medium text-gray-500">Full progress log</span>
                <pre className="mt-1 text-[11px] font-mono text-gray-600 max-h-32 overflow-y-auto whitespace-pre-wrap">
                  {ev.progressSummary}
                </pre>
              </div>
            ) : null}
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
