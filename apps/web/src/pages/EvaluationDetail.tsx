import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  evaluationsApi,
  projectsApi,
  type AutoClerkOtpUiMode,
  type ProjectDto,
} from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useEvaluationLive } from '@/hooks/useEvaluationLive';
import {
  ArrowLeft,
  Play,
  Square,
  ClipboardList,
  ExternalLink,
  Loader2,
  Radio,
  RotateCcw,
  Save,
} from 'lucide-react';

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
  }, [ev?.id, ev?.intent, ev?.desiredOutput, ev?.projectId, ev?.autoSignIn, ev?.autoSignInClerkOtpMode]);

  const liveEnabled =
    !!id && !!ev && (ev.status === 'RUNNING' || ev.status === 'WAITING_FOR_HUMAN');

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['evaluation', id] });
    void queryClient.invalidateQueries({ queryKey: ['evaluations'] });
  }, [queryClient, id]);

  const { frameDataUrl, lastProgress, connected } = useEvaluationLive(id, {
    enabled: liveEnabled && !isDetached,
    onStale: invalidate,
  });

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
    mutationFn: () => evaluationsApi.start(id!),
    onSuccess: (data) => {
      // #region agent log
      fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3619df' },
        body: JSON.stringify({
          sessionId: '3619df',
          hypothesisId: 'H5',
          location: 'EvaluationDetail.tsx:startMutation.onSuccess',
          message: 'POST /evaluations/:id/start response',
          data: { scheduled: data.scheduled, evaluationId: data.evaluationId },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      if (data.scheduled === false) {
        setStartFeedback('A run was already in progress for this evaluation — refreshing status.');
      } else {
        setStartFeedback(null);
      }
      invalidate();
    },
    onError: (err: Error) => {
      // #region agent log
      fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3619df' },
        body: JSON.stringify({
          sessionId: '3619df',
          hypothesisId: 'H7',
          location: 'EvaluationDetail.tsx:startMutation.onError',
          message: String(err?.message ?? err).slice(0, 400),
          data: {},
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
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
    mutationFn: () => evaluationsApi.reprocess(id!),
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

  const canEditContent = ev.status !== 'RUNNING';
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
    ev.status === 'WAITING_FOR_HUMAN';
  const canCancel = ev.status === 'RUNNING' || ev.status === 'QUEUED' || ev.status === 'WAITING_FOR_HUMAN';
  const showHuman =
    ev.status === 'WAITING_FOR_HUMAN' && pendingQuestion && parseOptions(pendingQuestion).length > 0;

  return (
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

      <div className="flex flex-col lg:flex-row lg:items-start gap-8">
        <div className="flex-1 min-w-0 space-y-6">
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
            {ev.status === 'RUNNING' && (
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
                <Radio size={14} className={connected ? 'text-green-500' : 'text-amber-500'} />
                {connected ? 'Live stream connected' : 'Connecting…'}
              </span>
            )}
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-gray-800 mb-2">Global intent</h2>
            {canEditContent ? (
              <textarea
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 min-h-[100px] focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                value={intentDraft}
                onChange={(e) => setIntentDraft(e.target.value)}
                aria-label="Global intent"
              />
            ) : (
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{ev.intent}</p>
            )}
            <h2 className="text-sm font-semibold text-gray-800 mt-4 mb-2">Desired output</h2>
            {canEditContent ? (
              <textarea
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 min-h-[100px] focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                value={desiredDraft}
                onChange={(e) => setDesiredDraft(e.target.value)}
                aria-label="Desired output"
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

          {(!!(lastProgress && lastProgress.phase) || !!ev.progressSummary) && (
            <section
              className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden"
              aria-label="Evaluation activity log"
            >
              <h2 className="text-sm font-semibold text-gray-800 px-4 pt-4 pb-2 border-b border-gray-100">
                Activity log
              </h2>
              <div className="max-h-64 overflow-y-auto overflow-x-auto px-4 py-3 space-y-4">
                {lastProgress && lastProgress.phase && (
                  <div className="text-xs font-mono text-gray-700">
                    <span className="text-gray-500">Last event · {lastProgress.phase}</span>
                    <pre className="mt-2 whitespace-pre-wrap break-words">
                      {JSON.stringify(lastProgress, null, 2)}
                    </pre>
                  </div>
                )}
                {ev.progressSummary && (
                  <div className="text-xs text-gray-600">
                    <span className="text-gray-500 font-medium block mb-2">Progress</span>
                    <pre className="whitespace-pre-wrap font-mono">{ev.progressSummary}</pre>
                  </div>
                )}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-sm font-semibold text-gray-800 mb-3">Steps</h2>
            {ev.steps.length === 0 ? (
              <p className="text-sm text-gray-500">No steps yet.</p>
            ) : (
              <ol className="space-y-3">
                {ev.steps.map((st) => (
                  <li
                    key={st.id}
                    className="rounded-lg border border-gray-200 bg-white p-3 text-sm"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-900">Step {st.sequence}</span>
                      {st.decision && (
                        <span className="text-[10px] uppercase tracking-wide text-gray-500">
                          {st.decision}
                        </span>
                      )}
                    </div>
                    {st.thinkingText && (
                      <p className="text-gray-600 text-xs whitespace-pre-wrap mb-2">{st.thinkingText}</p>
                    )}
                    {st.proposedCode && (
                      <pre className="text-[11px] bg-gray-900 text-gray-100 rounded-md p-2 overflow-x-auto max-h-40">
                        {st.proposedCode}
                      </pre>
                    )}
                    {st.analyzerRationale && (
                      <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap">{st.analyzerRationale}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {latestReport && (
            <section>
              <h2 className="text-sm font-semibold text-gray-800 mb-3">Report</h2>
              <div className="rounded-xl border border-gray-200 bg-white p-4 prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800">{latestReport.content}</pre>
              </div>
            </section>
          )}

        </div>

        <div className="w-full lg:w-[420px] shrink-0">
          <div className="sticky top-6 rounded-xl border border-gray-200 bg-black overflow-hidden aspect-video flex items-center justify-center relative min-h-[200px]">
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
                    {ev.status === 'RUNNING' ? 'Waiting for video frame…' : 'Connecting…'}
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
      </div>
    </div>
  );
}
