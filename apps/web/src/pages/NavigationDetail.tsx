import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  navigationsApi,
  projectsApi,
  type AutoClerkOtpUiMode,
  type EvaluationRunMode,
  type NavigationDetailDto,
  type ProjectDto,
} from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { NavigationRecorderLayout } from '@/components/navigation/NavigationRecorderLayout';
import { NavigationPlayWorkspace } from '@/components/navigation/NavigationPlayWorkspace';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { RecordedNavigationAction } from '@/hooks/useNavigationRecording';
import {
  ArrowLeft,
  Circle,
  ExternalLink,
  Loader2,
  Navigation as NavigationIcon,
  Play,
  Save,
} from 'lucide-react';

function toRecordedActions(rows: NavigationDetailDto['actions']): RecordedNavigationAction[] {
  return rows.map((a) => ({
    sequence: a.sequence,
    actionType: a.actionType as RecordedNavigationAction['actionType'],
    x: a.x,
    y: a.y,
    elementTag: a.elementTag,
    elementId: a.elementId,
    elementText: a.elementText,
    ariaLabel: a.ariaLabel,
    inputValue: a.inputValue,
    inputMode: (a.inputMode as RecordedNavigationAction['inputMode']) ?? null,
    pageUrl: a.pageUrl,
  }));
}

export default function NavigationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [intentDraft, setIntentDraft] = useState('');
  const [desiredDraft, setDesiredDraft] = useState('');
  const [projectIdDraft, setProjectIdDraft] = useState('');
  const [autoSignInDraft, setAutoSignInDraft] = useState(false);
  const [autoSignInOtpDraft, setAutoSignInOtpDraft] = useState<AutoClerkOtpUiMode>('default');
  const [runModeDraft, setRunModeDraft] = useState<EvaluationRunMode>('continuous');
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  /** null = drawer collapsed; only one of play | record visible at a time. */
  const [workspaceMode, setWorkspaceMode] = useState<null | 'play' | 'record'>(null);
  /** Keep recorder mounted when hidden so an active session is not torn down by switching views. */
  const [recordWorkspaceMounted, setRecordWorkspaceMounted] = useState(false);
  const [recordingSessionActive, setRecordingSessionActive] = useState(false);

  const query = useQuery({
    queryKey: ['navigation', id],
    queryFn: () => navigationsApi.get(id!),
    enabled: !!id,
  });
  const ev = query.data;

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  });
  const projects: ProjectDto[] = projectsQuery.data ?? [];

  const { mutate: patchNavigate, isPending: patchPending } = useMutation({
    mutationFn: () =>
      navigationsApi.patch(id!, {
        intent: intentDraft.trim(),
        desiredOutput: desiredDraft.trim(),
        projectId: projectIdDraft === '' ? null : projectIdDraft,
        autoSignIn: autoSignInDraft,
        autoSignInClerkOtpMode:
          autoSignInDraft && autoSignInOtpDraft !== 'default' ? autoSignInOtpDraft : null,
        runMode: runModeDraft,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['navigation', id] });
      void queryClient.invalidateQueries({ queryKey: ['navigations'] });
      setSaveFeedback('Saved.');
      window.setTimeout(() => setSaveFeedback(null), 3000);
    },
    onError: (err: unknown) => {
      setSaveFeedback(err instanceof Error ? err.message : 'Save failed');
      window.setTimeout(() => setSaveFeedback(null), 5000);
    },
  });

  useEffect(() => {
    setWorkspaceMode(null);
    setRecordWorkspaceMounted(false);
    setRecordingSessionActive(false);
  }, [id]);

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

  const handleSave = useCallback(() => {
    if (!intentDraft.trim() || !desiredDraft.trim()) return;
    patchNavigate();
  }, [intentDraft, desiredDraft, patchNavigate]);

  if (!id) {
    return <ErrorState message="Missing navigation id" />;
  }
  if (query.isLoading) return <LoadingState message="Loading navigation..." />;
  if (query.error || !ev) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <ErrorState message="Navigation not found or failed to load." />
        <Link to="/navigations" className="text-sm text-[#4B90FF] mt-4 inline-block">
          ← Back to navigations
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
    autoSignInOtpDraft !== serverOtp ||
    runModeDraft !== (ev.runMode ?? 'continuous');

  const persistedRecorded = toRecordedActions(ev.actions);
  const sum = ev.summary;

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6">
          <Link
            to="/navigations"
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
          >
            <ArrowLeft size={16} />
            Navigations
          </Link>
        </div>

        <div className="w-full space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <h1 className="text-2xl font-semibold text-gray-900 tracking-tight flex items-center gap-2">
                <NavigationIcon className="w-7 h-7 text-[#4B90FF]" />
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
            <dl className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <dt className="text-gray-500 font-medium">Recorded steps</dt>
                <dd className="text-gray-900 font-semibold">{sum.totalSteps}</dd>
              </div>
              <div>
                <dt className="text-gray-500 font-medium">Variable-style steps</dt>
                <dd className="text-gray-900 font-semibold">{sum.variableStepCount}</dd>
              </div>
              <div>
                <dt className="text-gray-500 font-medium">Last recorded</dt>
                <dd className="text-gray-900">
                  {sum.lastRecordedAt ? new Date(sum.lastRecordedAt).toLocaleString() : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-gray-500 font-medium">Skyvern workflow</dt>
                <dd className="text-gray-900 font-mono truncate" title={ev.skyvernWorkflowId ?? ''}>
                  {ev.skyvernWorkflowId ?? '—'}
                </dd>
              </div>
            </dl>
            {Object.keys(sum.actionTypeCounts).length > 0 && (
              <p className="mt-2 text-[11px] text-gray-500">
                By type:{' '}
                {Object.entries(sum.actionTypeCounts)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' · ')}
              </p>
            )}
          </div>

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
                    Attempt automatic sign-in when the remote browser hits a login screen.
                  </span>
                </label>
                {autoSignInDraft && (
                  <div className="pl-6 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                    <label htmlFor="nav-detail-clerk-otp" className="whitespace-nowrap">
                      Clerk OTP
                    </label>
                    <select
                      id="nav-detail-clerk-otp"
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
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{ev.failureMessage}</p>
          )}
          {saveFeedback && (
            <p
              className={`text-sm rounded-lg px-3 py-2 ${
                saveFeedback === 'Saved.' ? 'text-emerald-800 bg-emerald-50' : 'text-red-800 bg-red-50'
              }`}
            >
              {saveFeedback}
            </p>
          )}

          <section className="w-full rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="nav-goal-heading">
            <h2 id="nav-goal-heading" className="text-sm font-semibold text-gray-800 mb-3">
              Goal Definitions
            </h2>
            <p className="text-xs font-medium text-gray-500 mb-1">Intent</p>
            {canEditContent ? (
              <textarea
                className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 min-h-[100px] focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                value={intentDraft}
                onChange={(e) => setIntentDraft(e.target.value)}
                aria-label="Navigation intent"
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
                aria-label="Desired navigation output"
              />
            ) : (
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{ev.desiredOutput}</p>
            )}
            {canEditContent && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-gray-500 max-w-xl">Save updates this navigation in the database.</p>
                {draftsDirty && (
                  <button
                    type="button"
                    disabled={patchPending || !intentDraft.trim() || !desiredDraft.trim()}
                    onClick={() => void handleSave()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:border-[#4B90FF]/40 hover:text-[#4B90FF] disabled:opacity-50"
                  >
                    {patchPending ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                    Save changes
                  </button>
                )}
              </div>
            )}
          </section>

          {canEditContent && (
            <div className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2 text-sm">
              <span className="text-xs font-medium text-gray-500 block mb-2">Run mode (for future runs)</span>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="nav-run-mode"
                    checked={runModeDraft === 'continuous'}
                    onChange={() => setRunModeDraft('continuous')}
                  />
                  <span className="text-xs">Normal — continuous</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="nav-run-mode"
                    checked={runModeDraft === 'step_review'}
                    onChange={() => setRunModeDraft('step_review')}
                  />
                  <span className="text-xs">Review — step-by-step</span>
                </label>
              </div>
            </div>
          )}

          <section
            className="w-full rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
            aria-label="Play or record workspace"
          >
            <h2 className="text-sm font-semibold text-gray-800 mb-3">Browser workspace</h2>
            <p className="text-xs text-gray-500 mb-3">
              Open <strong>Play</strong> or <strong>Record</strong> below. Only one panel is shown at a time. While a
              recording is active, Play stays unavailable until you stop or cancel.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={recordingSessionActive}
                title={
                  recordingSessionActive
                    ? 'Stop or cancel recording before opening Play'
                    : workspaceMode === 'play'
                      ? 'Close Play panel'
                      : 'Open Play panel'
                }
                onClick={() => {
                  if (recordingSessionActive) return;
                  setWorkspaceMode((m) => (m === 'play' ? null : 'play'));
                }}
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  workspaceMode === 'play'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                    : 'border-gray-200 bg-white text-gray-800 hover:border-emerald-300 hover:bg-emerald-50/50'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <Play size={18} className={workspaceMode === 'play' ? 'fill-current' : ''} />
                Play
              </button>
              <button
                type="button"
                title={
                  workspaceMode === 'record'
                    ? recordingSessionActive
                      ? 'Stop recording before closing'
                      : 'Close Record panel'
                    : 'Open Record panel'
                }
                onClick={() => {
                  setRecordWorkspaceMounted(true);
                  setWorkspaceMode((m) => {
                    if (m === 'record') {
                      if (recordingSessionActive) return 'record';
                      return null;
                    }
                    return 'record';
                  });
                }}
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  workspaceMode === 'record'
                    ? 'border-red-500 bg-red-50 text-red-900'
                    : 'border-gray-200 bg-white text-gray-800 hover:border-red-300 hover:bg-red-50/40'
                }`}
              >
                <Circle size={18} className={workspaceMode === 'record' ? 'fill-red-500 text-red-500' : ''} />
                Record
              </button>
            </div>

            {workspaceMode === 'play' && (
              <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                <p className="text-xs text-gray-600">
                  Skyvern workflow run against the browser-worker CDP endpoint. Requires{' '}
                  <code className="text-[10px] bg-gray-100 px-1 rounded">SKYVERN_API_KEY</code> and a reachable Skyvern
                  API (<code className="text-[10px] bg-gray-100 px-1 rounded">SKYVERN_API_BASE_URL</code> when
                  self-hosted).
                </p>
                <NavigationPlayWorkspace navId={id} persistedActions={persistedRecorded} />
              </div>
            )}

            {recordWorkspaceMounted && (
              <div
                className={workspaceMode === 'record' ? 'mt-4 pt-4 border-t border-gray-100' : 'hidden'}
                aria-hidden={workspaceMode !== 'record'}
              >
                <NavigationRecorderLayout
                  navId={id}
                  onSessionActivityChange={setRecordingSessionActive}
                />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
