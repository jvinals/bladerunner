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
import { useEvaluationLive, type EvaluationProgressPayload } from '@/hooks/useEvaluationLive';
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

function stepJsonPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'object' && value !== null && Object.keys(value as object).length === 0) return false;
  return true;
}

function mergeStepsWithLivePlaceholder(
  steps: EvaluationStepDto[],
  lastProgress: EvaluationProgressPayload | null,
): EvaluationStepDto[] {
  if (!lastProgress?.sequence) return steps;
  const seq = lastProgress.sequence;
  if (steps.some((s) => s.sequence === seq)) return steps;
  const phase = String(lastProgress.phase ?? '');
  if (phase !== 'proposing' && phase !== 'executing') return steps;
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
  if (!lastProgress?.sequence || lastProgress.sequence !== st.sequence) {
    return { codegenInputs: false, codegenOutputs: false, analyzerInputs: false, analyzerOutputs: false };
  }
  const phase = String(lastProgress.phase ?? '');
  const hasCodegenIn = stepJsonPresent(st.codegenInputJson);
  const hasCodegenOut = stepJsonPresent(st.codegenOutputJson);
  const hasAnalyzerOut = stepJsonPresent(st.analyzerOutputJson);

  if (phase === 'proposing') {
    return {
      codegenInputs: !hasCodegenIn,
      codegenOutputs: true,
      analyzerInputs: true,
      analyzerOutputs: true,
    };
  }
  if (phase === 'executing') {
    return {
      codegenInputs: !hasCodegenIn,
      codegenOutputs: !hasCodegenOut,
      analyzerInputs: !hasAnalyzerOut,
      analyzerOutputs: !hasAnalyzerOut,
    };
  }
  if (phase === 'analyzing') {
    return {
      codegenInputs: false,
      codegenOutputs: false,
      analyzerInputs: !hasAnalyzerOut,
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
  const stepCardRefs = useRef<(HTMLDivElement | null)[]>([]);

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

  const { frameDataUrl, lastProgress, connected } = useEvaluationLive(id, {
    enabled: liveEnabled && !isDetached,
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
    const el = stepCardRefs.current[selectedStepIdx];
    if (el) {
      // Align trailing edge so the latest step stays toward the right as the strip grows leftward.
      el.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
    }
  }, [selectedStepIdx, displaySteps.length, lastProgress?.sequence]);

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
            <div className="w-full rounded-xl border border-gray-200 bg-black overflow-hidden aspect-video flex items-center justify-center relative min-h-[200px]">
              {liveEnabled && isDetached ? (
                <div className="text-center px-4 py-8">
                  <ExternalLink size={28} className="mx-auto mb-2 text-gray-500" aria-hidden />
                  <p className="text-sm text-gray-400 mb-2">Preview detached to another window</p>
                  <button
                    type="button"
                    onClick={handleReattachPreview}
                    className="text-xs text-[#4B90FF] font-medium hover:underline"
                  >
                    Reattach here
                  </button>
                </div>
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
            <p className="text-[10px] text-gray-400 mt-2 text-center">
              Remote browser · same worker as recording
            </p>
          </div>

          <section
            className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
            aria-label="Evaluation step timeline"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2 border-b border-gray-100">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <h2 className="text-sm font-semibold text-gray-800 shrink-0">Step timeline</h2>
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
            ) : (
              <div className="flex w-full min-w-0 flex-row gap-4 overflow-x-auto overflow-y-visible px-4 pb-4 pt-2 scroll-smooth snap-x snap-mandatory">
                {displaySteps.map((st, idx) => {
                  const load = getLiveLoadingFlags(st, lastProgress);
                  const showCodegenFromLive =
                    load.codegenOutputs &&
                    lastProgress?.sequence === st.sequence &&
                    lastProgress.phase === 'executing' &&
                    (lastProgress.thinking || lastProgress.playwrightCode);
                  return (
                    <div
                      key={st.id}
                      ref={(el) => {
                        stepCardRefs.current[idx] = el;
                      }}
                      className={`snap-center shrink-0 min-w-0 flex-[0_0_calc(50%-0.5rem)] rounded-lg border p-3 text-sm ${
                        selectedStepIdx === idx ? 'border-[#4B90FF] ring-1 ring-[#4B90FF]/30' : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <span className="font-semibold text-gray-900">Step {st.sequence}</span>
                          {st.stepTitle ? (
                            <p className="text-xs text-gray-600 mt-0.5">{st.stepTitle}</p>
                          ) : null}
                        </div>
                        {st.decision ? (
                          <span className="text-[10px] uppercase tracking-wide text-gray-500 shrink-0">
                            {st.decision}
                          </span>
                        ) : lastProgress?.sequence === st.sequence && lastProgress.phase ? (
                          <span className="text-[10px] uppercase tracking-wide text-[#4B90FF] shrink-0 max-w-[120px] truncate" title={String(lastProgress.phase)}>
                            {String(lastProgress.phase).replace(/_/g, ' ')}
                          </span>
                        ) : null}
                      </div>
                      <div className="space-y-3 text-xs">
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
                              modalTitle="Codegen — viewport JPEG sent to the model"
                              openLabel="Preview viewport JPEG sent to the codegen model"
                              emptyLabel="No stored viewport JPEG (older runs did not persist it)"
                            />
                          </div>
                          {load.codegenInputs ? (
                            <PendingPanel
                              label={
                                lastProgress?.phase === 'proposing'
                                  ? 'Capturing inputs for codegen…'
                                  : 'Loading codegen inputs…'
                              }
                            />
                          ) : (
                            <JsonBlock
                              value={omitBinaryPreviewKeys(st.codegenInputJson, ['viewportJpegBase64'])}
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
                              modalTitle="Analyzer — after-step viewport JPEG sent to the model"
                              openLabel="Preview after-step viewport JPEG sent to the analyzer"
                              emptyLabel="No stored after-step JPEG (step not analyzed yet or older runs)"
                            />
                          </div>
                          {load.analyzerInputs ? (
                            <PendingPanel label={analyzerSectionPendingLabel(lastProgress?.phase)} />
                          ) : (
                            <JsonBlock
                              value={omitBinaryPreviewKeys(st.analyzerInputJson, ['afterStepViewportJpegBase64'])}
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
                })}
              </div>
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
