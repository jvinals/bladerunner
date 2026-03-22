import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useRef, useEffect, useCallback, useState, useMemo, type ReactNode } from 'react';
import { runsApi, buildStartPlaybackBody, type AutoClerkOtpUiMode } from '@/lib/api';
import {
  useSessionRecordingPlayback,
  useSessionRecordingThumbnailOnly,
} from '@/hooks/useSessionRecordingPlayback';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { StepCard } from '@/components/ui/StepCard';
import { usePlayback } from '@/hooks/usePlayback';
import type { RecordedStep } from '@/hooks/useRecording';
import { playbackToneForStep } from '@/lib/playbackStepTone';
import { formatDuration, formatRelativeTime } from '@/lib/utils';
import {
  ArrowLeft, Monitor, Smartphone, Globe,
  Play, Square, ExternalLink,
  Film, Pause, RotateCcw, StepForward, X, PanelRight,
} from 'lucide-react';

const PLATFORM_ICONS: Record<string, typeof Monitor> = {
  desktop: Monitor,
  mobile: Smartphone,
  pwa: Globe,
};

const COMPACT_STRIP =
  'flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-gray-100 bg-white px-3 py-2 sm:px-4 sm:py-2.5';

/** Shared height for live preview + recorded steps (equal columns). */
const PLAYBACK_COL_HEIGHT = 'min-h-[380px] h-[min(64vh,720px)] max-h-[min(64vh,720px)]';

function CompactStrip({
  title,
  children,
  ariaLabel,
}: {
  title: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <div className={COMPACT_STRIP} role="group" aria-label={ariaLabel ?? title}>
      <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 shrink-0">{title}</span>
      <span className="min-w-0 flex-1 text-xs leading-snug text-gray-800 sm:text-sm">{children}</span>
    </div>
  );
}

function RightSlideOver({
  open,
  onClose,
  title,
  titleId,
  panelId,
  backdropAriaLabel,
  children,
  headerIcon,
  contentClassName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  titleId: string;
  panelId: string;
  backdropAriaLabel: string;
  children: ReactNode;
  headerIcon?: ReactNode;
  contentClassName?: string;
}) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button
        type="button"
        className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
        aria-label={backdropAriaLabel}
        onClick={onClose}
      />
      <div
        id={panelId}
        className={`absolute right-0 top-0 flex h-full w-full max-w-lg flex-col border-l border-gray-200 bg-white shadow-2xl transition-transform duration-300 ease-out ${
          entered ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {headerIcon ?? <PanelRight size={16} className="shrink-0 text-[#4B90FF]" aria-hidden />}
            <h2 id={titleId} className="truncate text-sm font-semibold text-gray-900">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto px-4 py-4 ${contentClassName ?? ''}`}>{children}</div>
      </div>
    </div>
  );
}

function RunDetailsSlideOver({
  open,
  onClose,
  run,
  timelineParts,
  findingsArr,
  artifactsCount,
  canPlayback,
  isPlaying,
  playbackAutoClerkMode,
  setPlaybackAutoClerkMode,
  playbackClerkOtpMode,
  setPlaybackClerkOtpMode,
  playbackSkipUntilSeq,
  setPlaybackSkipUntilSeq,
  playbackDelayMs,
  setPlaybackDelayMs,
}: {
  open: boolean;
  onClose: () => void;
  run: {
    id: string;
    platform: string;
    status: string;
    triggeredBy: string;
    createdAt: string;
    startedAt?: string | null;
    completedAt?: string | null;
  };
  timelineParts: string[];
  findingsArr: Array<{
    id: string;
    category: string;
    severity: string;
    title: string;
    description: string;
    expected?: string;
    actual?: string;
    suggestion?: string;
    resolved: boolean;
    createdAt: string;
  }>;
  artifactsCount: number;
  canPlayback: boolean;
  isPlaying: boolean;
  playbackAutoClerkMode: 'default' | 'on' | 'off';
  setPlaybackAutoClerkMode: (v: 'default' | 'on' | 'off') => void;
  playbackClerkOtpMode: AutoClerkOtpUiMode;
  setPlaybackClerkOtpMode: (v: AutoClerkOtpUiMode) => void;
  playbackSkipUntilSeq: string;
  setPlaybackSkipUntilSeq: (v: string) => void;
  playbackDelayMs: number;
  setPlaybackDelayMs: (v: number) => void;
}) {
  const artifactPreviewNames = Array.from({ length: Math.min(artifactsCount, 6) }, (_, i) =>
    i % 3 === 0 ? `screenshot_step_${i + 1}.png` : i % 3 === 1 ? `trace_${i + 1}.json` : `log_${i + 1}.txt`,
  );

  const severityClass = (s: string) =>
    s === 'critical'
      ? 'text-[#FF4D4D]'
      : s === 'warning'
        ? 'text-[#EAB508]'
        : s === 'info'
          ? 'text-[#4B90FF]'
          : 'text-gray-500';

  return (
    <RightSlideOver
      open={open}
      onClose={onClose}
      title="Run details"
      titleId="run-details-title"
      panelId="run-details-panel"
      backdropAriaLabel="Close run details"
      contentClassName="space-y-6"
    >
          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Playback</h3>
            <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3 text-left shadow-sm">
              {canPlayback && !isPlaying && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                  <label htmlFor="run-details-playback-clerk" className="whitespace-nowrap">
                    Automatic Clerk sign-in
                  </label>
                  <select
                    id="run-details-playback-clerk"
                    value={playbackAutoClerkMode}
                    onChange={(e) => setPlaybackAutoClerkMode(e.target.value as 'default' | 'on' | 'off')}
                    className="border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                    title="Automatic server-side Clerk sign-in during playback"
                  >
                    <option value="default">Automatic — server default</option>
                    <option value="on">Automatic — on</option>
                    <option value="off">Automatic — off</option>
                  </select>
                  <label htmlFor="run-details-playback-clerk-otp" className="whitespace-nowrap">
                    Automatic Clerk OTP
                  </label>
                  <select
                    id="run-details-playback-clerk-otp"
                    value={playbackClerkOtpMode}
                    onChange={(e) => setPlaybackClerkOtpMode(e.target.value as AutoClerkOtpUiMode)}
                    title="How to complete email verification when automatic Clerk sign-in runs"
                    className="border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                  >
                    <option value="default">OTP: server default</option>
                    <option value="clerk_test_email">OTP: test email (424242)</option>
                    <option value="mailslurp">OTP: MailSlurp inbox</option>
                  </select>
                  <label htmlFor="run-details-playback-skip" className="whitespace-nowrap">
                    Skip seq &lt;
                  </label>
                  <input
                    id="run-details-playback-skip"
                    type="number"
                    min={0}
                    placeholder="—"
                    value={playbackSkipUntilSeq}
                    onChange={(e) => setPlaybackSkipUntilSeq(e.target.value)}
                    className="w-16 border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                    title="Skip steps with sequence strictly less than this (legacy runs)"
                  />
                  <label htmlFor="run-details-playback-delay" className="whitespace-nowrap">
                    Delay
                  </label>
                  <input
                    id="run-details-playback-delay"
                    type="range"
                    min={0}
                    max={5000}
                    step={50}
                    value={playbackDelayMs}
                    onChange={(e) => setPlaybackDelayMs(Number(e.target.value))}
                    disabled={isPlaying}
                    className="w-24 sm:w-32 accent-[#4B90FF] disabled:opacity-50"
                    title="Delay between steps (ms). Fixed for the session once Play starts."
                  />
                  <span className="text-[11px] text-gray-500 tabular-nums">{playbackDelayMs}ms</span>
                </div>
              )}
              {!canPlayback && !isPlaying && (
                <p className="text-[11px] text-gray-500">
                  Playback options apply when this run has recorded steps and is not actively recording.
                </p>
              )}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Details</h3>
            <dl className="space-y-2 text-sm text-gray-800">
              <div className="flex flex-col gap-0.5">
                <dt className="text-[11px] text-gray-400">Run ID</dt>
                <dd className="ce-mono text-xs break-all">{run.id}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-[11px] text-gray-400">Platform</dt>
                <dd>{run.platform}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-[11px] text-gray-400">Status</dt>
                <dd className="capitalize">{run.status}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-[11px] text-gray-400">Triggered by</dt>
                <dd>{run.triggeredBy}</dd>
              </div>
              <div className="flex flex-col gap-0.5">
                <dt className="text-[11px] text-gray-400">Created</dt>
                <dd>{new Date(run.createdAt).toLocaleString()}</dd>
              </div>
              {run.startedAt && (
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[11px] text-gray-400">Started</dt>
                  <dd>{new Date(run.startedAt).toLocaleString()}</dd>
                </div>
              )}
              {run.completedAt && (
                <div className="flex flex-col gap-0.5">
                  <dt className="text-[11px] text-gray-400">Completed</dt>
                  <dd>{new Date(run.completedAt).toLocaleString()}</dd>
                </div>
              )}
            </dl>
          </section>

          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Timeline</h3>
            <ul className="list-none space-y-2 text-sm text-gray-800">
              {timelineParts.map((line, i) => (
                <li key={i} className="border-l-2 border-[#4B90FF]/30 pl-3">
                  {line}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Findings</h3>
            {findingsArr.length === 0 ? (
              <p className="text-sm text-gray-500">None</p>
            ) : (
              <ul className="space-y-3">
                {findingsArr.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2.5 text-sm"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-gray-900">{f.title}</span>
                      <span className={`text-[10px] font-semibold uppercase tracking-wide ${severityClass(f.severity)}`}>
                        {f.severity}
                      </span>
                    </div>
                    {f.description && <p className="mt-1.5 text-xs leading-snug text-gray-600">{f.description}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Artifacts</h3>
            {artifactsCount === 0 ? (
              <p className="text-sm text-gray-500">None</p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-gray-800">
                  <span className="font-semibold tabular-nums">{artifactsCount}</span> stored artifact
                  {artifactsCount === 1 ? '' : 's'}
                </p>
                <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {artifactPreviewNames.map((name, i) => (
                    <li
                      key={i}
                      className="truncate rounded border border-dashed border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-500 ce-mono"
                      title={name}
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
    </RightSlideOver>
  );
}

function SessionRecordingMedia({ runId, enabled }: { runId: string; enabled: boolean }) {
  const { url, kind, loading } = useSessionRecordingPlayback(runId, enabled);
  const [videoDecodeFailed, setVideoDecodeFailed] = useState(false);
  const thumbFallbackUrl = useSessionRecordingThumbnailOnly(
    runId,
    enabled && videoDecodeFailed && kind === 'video',
  );

  useEffect(() => {
    setVideoDecodeFailed(false);
  }, [runId, enabled]);

  const showVideo = kind === 'video' && url && !videoDecodeFailed;
  const showImg =
    (kind === 'image' && url) || (videoDecodeFailed && !!thumbFallbackUrl);
  const imgSrc = videoDecodeFailed ? thumbFallbackUrl : url;

  return (
    <>
      <div className="rounded-md border border-gray-100 bg-gray-900/5 min-h-[200px] flex items-center justify-center overflow-hidden">
        {loading ? (
          <p className="text-xs text-gray-400 px-4 py-8 text-center">Loading recording…</p>
        ) : showVideo ? (
          <video
            controls
            className="w-full max-h-[min(72vh,640px)] bg-black"
            src={url!}
            playsInline
            onError={() => setVideoDecodeFailed(true)}
          />
        ) : showImg && imgSrc ? (
          <img
            src={imgSrc}
            alt="Session recording preview"
            className="max-w-full max-h-[min(72vh,640px)] object-contain"
          />
        ) : (
          <p className="text-xs text-gray-400 px-4 py-8 text-center">No recording preview available.</p>
        )}
      </div>
      {videoDecodeFailed && (
        <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
          This browser could not play the video inline. Showing a preview frame instead.
        </p>
      )}
      {!videoDecodeFailed && kind === 'image' && (
        <p className="mt-2 text-[11px] text-gray-400">
          Preview frame from the session (no video file was stored for this run).
        </p>
      )}
    </>
  );
}

function SessionRecordingModal({
  open,
  onClose,
  runId,
}: {
  open: boolean;
  onClose: () => void;
  runId: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-recording-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        aria-label="Close session recording"
        onClick={onClose}
      />
      <div className="relative z-10 flex w-full max-w-4xl max-h-[min(92vh,900px)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Film size={16} className="shrink-0 text-[#4B90FF]" aria-hidden />
            <h2 id="session-recording-modal-title" className="truncate text-sm font-semibold text-gray-900">
              Session recording
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <SessionRecordingMedia runId={runId} enabled={open} />
        </div>
      </div>
    </div>
  );
}

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [sessionRecordingModalOpen, setSessionRecordingModalOpen] = useState(false);
  const [runDetailsOpen, setRunDetailsOpen] = useState(false);
  const [playbackAutoClerkMode, setPlaybackAutoClerkMode] = useState<'default' | 'on' | 'off'>('on');
  const [playbackClerkOtpMode, setPlaybackClerkOtpMode] = useState<AutoClerkOtpUiMode>('mailslurp');
  const [playbackDelayMs, setPlaybackDelayMs] = useState(600);
  const [playbackSkipUntilSeq, setPlaybackSkipUntilSeq] = useState('');
  const [playbackAdvanceToSeq, setPlaybackAdvanceToSeq] = useState('');
  const playbackCanvasRef = useRef<HTMLCanvasElement>(null);
  const stepRefs = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const detachedPlaybackWindowRef = useRef<Window | null>(null);

  const {
    playbackSessionId,
    sourceRunId: playbackSourceRunId,
    currentFrame,
    status: playbackStatus,
    isPlaying,
    highlightSequence,
    completedSequences,
    playbackError,
    isPaused,
    startPlayback,
    stopPlayback,
    pausePlayback,
    resumePlayback,
    advancePlaybackOne,
    advancePlaybackTo,
    restartPlayback,
  } = usePlayback();

  const { data: run, isLoading, error } = useQuery({
    queryKey: ['run', id],
    queryFn: () => runsApi.get(id!),
    enabled: !!id,
  });

  /** Same source as Runs page (`loadRunSteps`); `GET /runs/:id` may omit or empty `steps` in some responses. */
  const {
    data: stepsFromApi,
    isPending: stepsQueryPending,
    isError: stepsQueryError,
    error: stepsQueryErr,
  } = useQuery({
    queryKey: ['run-steps', id],
    queryFn: () => runsApi.getSteps(id!),
    enabled: !!id,
  });

  const { data: findings } = useQuery({
    queryKey: ['run-findings', id],
    queryFn: async () => {
      try {
        return await runsApi.getFindings(id!);
      } catch {
        /* API may not expose GET /runs/:id/findings yet — avoid breaking the page */
        return [];
      }
    },
    enabled: !!id,
  });

  const recordedSteps = useMemo(() => {
    const embedded = ((run as { steps?: RecordedStep[] } | undefined)?.steps ?? []) as RecordedStep[];
    const fetched = stepsFromApi as RecordedStep[] | undefined;
    if (fetched && fetched.length > 0) return fetched;
    return embedded;
  }, [run, stepsFromApi]);

  const runStepsCount = (run as { stepsCount?: number } | undefined)?.stepsCount ?? 0;
  /** Wait for parallel GET /steps when run payload had no steps but we expect some (avoids Play stuck disabled with pointer-events-none). */
  const waitingForSteps =
    !!run &&
    recordedSteps.length === 0 &&
    runStepsCount > 0 &&
    stepsQueryPending &&
    !stepsQueryError;

  const canPlayback =
    !!run &&
    recordedSteps.length > 0 &&
    (run as { status: string }).status !== 'RECORDING' &&
    !waitingForSteps;
  const canShowStepActions =
    !!run &&
    recordedSteps.length > 0 &&
    !waitingForSteps;

  const handleStepPlayback = useCallback(
    async (sequence: number, mode: 'from' | 'only') => {
      if (!id || !canPlayback) return;
      if (isPlaying) await stopPlayback();
      try {
        await startPlayback(
          id,
          buildStartPlaybackBody({
            delayMs: playbackDelayMs,
            autoClerkMode: playbackAutoClerkMode,
            clerkOtpMode: playbackClerkOtpMode,
            skipUntilSequence: sequence,
            ...(mode === 'only' ? { playThroughSequence: sequence } : {}),
          }),
        );
      } catch (e) {
        console.error('Step playback failed:', e);
      }
    },
    [
      id,
      canPlayback,
      isPlaying,
      stopPlayback,
      startPlayback,
      playbackAutoClerkMode,
      playbackClerkOtpMode,
      playbackDelayMs,
    ],
  );

  const { data: runCheckpoints = [] } = useQuery({
    queryKey: ['run-checkpoints', id],
    queryFn: () => runsApi.getCheckpoints(id!),
    enabled: !!id && !!canShowStepActions,
    refetchInterval:
      (run as { status?: string } | undefined)?.status === 'RECORDING' ? 3000 : false,
  });

  const stepsQueryErrorMessage =
    stepsQueryError && stepsQueryErr instanceof Error ? stepsQueryErr.message : null;
  const showReplayChrome =
    isPlaying || playbackStatus === 'playback' || (playbackStatus === 'failed' && !!playbackError);

  useEffect(() => {
    if (!currentFrame || !playbackCanvasRef.current) return;
    const canvas = playbackCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${currentFrame}`;
  }, [currentFrame]);

  useEffect(() => {
    if (highlightSequence == null) return;
    const el = stepRefs.current.get(highlightSequence);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [highlightSequence]);

  const handleStartPlayback = useCallback(async () => {
    if (!id || !canPlayback) return;
    try {
      const skipRaw = playbackSkipUntilSeq.trim();
      const skipNum = skipRaw === '' ? undefined : Number.parseInt(skipRaw, 10);
      await startPlayback(
        id,
        buildStartPlaybackBody({
          delayMs: playbackDelayMs,
          autoClerkMode: playbackAutoClerkMode,
          clerkOtpMode: playbackClerkOtpMode,
          skipUntilSequence:
            skipNum !== undefined && !Number.isNaN(skipNum) && skipNum >= 0 ? skipNum : undefined,
        }),
      );
    } catch (e) {
      console.error('Playback failed to start:', e);
    }
  }, [
    id,
    canPlayback,
    startPlayback,
    playbackAutoClerkMode,
    playbackClerkOtpMode,
    playbackSkipUntilSeq,
    playbackDelayMs,
  ]);

  const handleDetachPlayback = useCallback(() => {
    if (!playbackSessionId) return;
    const src = playbackSourceRunId;
    const url = `${window.location.origin}/playback/${playbackSessionId}${src ? `?source=${encodeURIComponent(src)}` : ''}`;
    const w = window.open(
      url,
      'bladerunner-playback',
      'width=1320,height=780',
    );
    if (w) {
      detachedPlaybackWindowRef.current = w;
      const check = setInterval(() => {
        if (w.closed) {
          detachedPlaybackWindowRef.current = null;
          clearInterval(check);
        }
      }, 500);
    }
  }, [playbackSessionId, playbackSourceRunId]);

  if (isLoading) return <LoadingState message="Loading run details..." />;
  if (error || !run) return <ErrorState message="Run not found" />;

  const r = run as {
    id: string;
    name: string;
    description?: string;
    status: string;
    platform: string;
    triggeredBy: string;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    stepsCount: number;
    passedSteps: number;
    failedSteps: number;
    findingsCount?: number;
    artifactsCount?: number;
    tags?: string[];
    targets?: Array<{
      id: string;
      platform: string;
      deviceName: string;
      browserOrApp?: string;
      resolution?: string;
      os?: string;
      status: string;
    }>;
    createdAt: string;
    steps?: RecordedStep[];
    recordings?: Array<{ id: string; format: string; url: string; sizeBytes: number }>;
    thumbnailUrl?: string | null;
  };

  const recordings = r.recordings ?? [];
  const thumbnailUrl = r.thumbnailUrl ?? null;
  /** Session artifacts: DB row optional — UI probes `/recording/video` first. */
  const showSessionRecordingCard = recordings.length > 0 || !!thumbnailUrl;

  const targets = r.targets ?? [];
  const tags = r.tags ?? [];
  const artifactsCount = r.artifactsCount ?? 0;
  const stepsCount = r.stepsCount ?? 0;
  const passedSteps = r.passedSteps ?? 0;
  const failedSteps = r.failedSteps ?? 0;
  const findingsCount = r.findingsCount ?? 0;

  const findingsArr = (findings || []) as Array<{
    id: string;
    category: string;
    severity: string;
    title: string;
    description: string;
    expected?: string;
    actual?: string;
    suggestion?: string;
    resolved: boolean;
    createdAt: string;
  }>;

  const timelineCompactParts: string[] = [`Run created ${new Date(r.createdAt).toLocaleString()}`];
  if (r.startedAt) {
    timelineCompactParts.push(`Execution started ${new Date(r.startedAt).toLocaleString()}`);
  }
  if (r.completedAt) {
    const ev =
      r.status === 'passed'
        ? 'Run completed successfully'
        : r.status === 'failed'
          ? 'Run completed with failures'
          : 'Run completed — needs review';
    timelineCompactParts.push(`${ev} ${new Date(r.completedAt).toLocaleString()}`);
  }

  const targetsCompact =
    targets.length === 0
      ? '—'
      : targets.map((t) => `${t.deviceName} (${t.browserOrApp ?? t.platform})`).join(' · ');

  const PlatformIcon = PLATFORM_ICONS[r.platform] || Monitor;

  return (
    <div className="flex-1 min-h-0 w-full max-w-none overflow-y-auto py-8 px-6 lg:px-10">
      {/* Back link */}
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-[#4B90FF] transition-colors mb-6">
        <ArrowLeft size={14} />
        Back to Home
      </Link>

      {/* Header */}
      <div className="mb-8">
        <div>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            <PlatformIcon size={18} className="text-gray-400" />
            <h1 className="text-xl font-bold text-gray-900">{r.name}</h1>
            <StatusBadge status={r.status} />
            {showSessionRecordingCard && (
              <button
                type="button"
                onClick={() => setSessionRecordingModalOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-[#4B90FF] hover:text-[#4B90FF]"
              >
                <Film size={14} className="text-[#4B90FF]" aria-hidden />
                Video recording
              </button>
            )}
          </div>
          {r.description && (
            <p className="text-sm text-gray-500 max-w-xl">{r.description}</p>
          )}
          <div className="flex items-center gap-4 mt-2 text-[11px] text-gray-400">
            <span className="ce-mono">{r.id}</span>
            <span>Triggered by {r.triggeredBy}</span>
            <span>{formatRelativeTime(r.createdAt)}</span>
          </div>
        </div>
      </div>

      {stepsQueryErrorMessage && (
        <p className="mb-4 text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-md px-2 py-1.5" role="alert">
          Could not load steps for playback: {stepsQueryErrorMessage}
        </p>
      )}

      {/* Metrics + playback (one row on large screens; same card chrome and height via items-stretch) */}
      <div className="space-y-2 mb-6">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-3">
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 self-stretch rounded-lg border border-gray-100 bg-white px-2 py-1.5 shadow-sm"
            role="group"
            aria-label="Run metrics"
          >
            {(
              [
                ['Duration', r.durationMs ? formatDuration(r.durationMs) : '—', 'text-gray-900'],
                ['Steps', `${passedSteps}/${stepsCount}`, 'text-gray-900'],
                ['Failures', String(failedSteps), failedSteps > 0 ? 'text-[#FF4D4D]' : 'text-gray-900'],
                ['Findings', String(findingsCount), findingsCount > 0 ? 'text-[#EAB508]' : 'text-gray-900'],
                ['Artifacts', String(artifactsCount), 'text-[#4B90FF]'],
              ] as const
            ).map(([label, value, valueClass], i) => (
              <span key={label} className="inline-flex items-baseline gap-1">
                {i > 0 && (
                  <span className="mr-0.5 text-[9px] text-gray-200 select-none" aria-hidden="true">
                    ·
                  </span>
                )}
                <span className="text-[8px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
                <span className={`text-xs font-bold tabular-nums ce-mono ${valueClass}`}>{value}</span>
              </span>
            ))}
            <span className="inline-flex items-baseline gap-1 shrink-0">
              <span className="mr-0.5 text-[9px] text-gray-200 select-none" aria-hidden="true">
                ·
              </span>
              <button
                type="button"
                onClick={() => setRunDetailsOpen(true)}
                className="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-700 shadow-sm transition-colors hover:border-[#4B90FF] hover:text-[#4B90FF]"
                aria-expanded={runDetailsOpen}
                aria-controls="run-details-panel"
              >
                <PanelRight size={11} className="text-[#4B90FF]" aria-hidden />
                Run Details
              </button>
            </span>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col justify-center self-stretch rounded-lg border border-gray-100 bg-white px-2 py-1.5 shadow-sm lg:min-w-[min(100%,28rem)]">
            <span className="sr-only">Playback</span>
            <div
              className="flex min-h-0 flex-nowrap items-center justify-end gap-1.5 overflow-x-auto"
              role="toolbar"
              aria-label="Playback controls"
            >
              <button
                type="button"
                disabled={!canPlayback || isPlaying || waitingForSteps}
                onClick={() => void handleStartPlayback()}
                title={
                  waitingForSteps
                    ? 'Loading steps…'
                    : !canPlayback
                      ? r.status === 'RECORDING'
                        ? 'Wait until recording finishes'
                        : stepsQueryErrorMessage
                          ? `Steps could not be loaded: ${stepsQueryErrorMessage}`
                          : 'No recorded steps'
                      : 'Replay recorded steps in a live browser preview'
                }
                className="flex shrink-0 items-center gap-1 px-2 py-1 border border-gray-200 text-gray-600 text-[11px] font-medium rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-gray-200 disabled:hover:text-gray-600"
              >
                <Play size={12} /> {waitingForSteps ? 'Loading…' : 'Play'}
              </button>
              {isPlaying && isPaused ? (
                <button
                  type="button"
                  onClick={() => void resumePlayback()}
                  className="flex shrink-0 items-center gap-1 px-2 py-1 border border-emerald-200 text-emerald-700 text-[11px] font-medium rounded-md hover:bg-emerald-50 transition-colors"
                  title="Resume playback"
                >
                  <Play size={12} className="fill-current" /> Resume
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!isPlaying}
                  onClick={() => void pausePlayback()}
                  className="flex shrink-0 items-center gap-1 px-2 py-1 border border-amber-200 text-amber-800 text-[11px] font-medium rounded-md hover:bg-amber-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:border-gray-100 disabled:text-gray-400 disabled:hover:bg-transparent"
                  title={isPlaying ? 'Pause playback' : 'Pause is available while playback is running'}
                >
                  <Pause size={12} /> Pause
                </button>
              )}
              <button
                type="button"
                disabled={!isPlaying}
                onClick={() => void stopPlayback()}
                className="flex shrink-0 items-center gap-1 px-2 py-1 border border-red-200 text-red-600 text-[11px] font-medium rounded-md hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Square size={12} /> Stop
              </button>
              <button
                type="button"
                disabled={!isPlaying}
                onClick={() => void restartPlayback()}
                className="flex shrink-0 items-center gap-1 px-2 py-1 border border-slate-200 text-slate-700 text-[11px] font-medium rounded-md hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Restart from the beginning with the same options"
              >
                <RotateCcw size={12} /> Restart
              </button>
              <button
                type="button"
                disabled={!isPlaying || !isPaused}
                onClick={() => void advancePlaybackOne()}
                className="flex shrink-0 items-center gap-1 px-2 py-1 border border-indigo-200 text-indigo-800 text-[11px] font-medium rounded-md hover:bg-indigo-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Run the next step, then pause again"
              >
                <StepForward size={11} />
                Next step
              </button>
              <span className="shrink-0 text-[10px] text-gray-400 pl-0.5">Run to seq</span>
              <input
                id="playback-advance-to-seq"
                type="number"
                min={0}
                placeholder="seq"
                value={playbackAdvanceToSeq}
                onChange={(e) => setPlaybackAdvanceToSeq(e.target.value)}
                disabled={!isPlaying || !isPaused}
                className="w-12 shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-800 tabular-nums bg-white disabled:opacity-50"
                title="Pause after this step sequence completes (inclusive)"
              />
              <button
                type="button"
                disabled={!isPlaying || !isPaused}
                onClick={() => {
                  const n = Number.parseInt(playbackAdvanceToSeq.trim(), 10);
                  if (!Number.isNaN(n) && n >= 0) void advancePlaybackTo(n);
                }}
                className="shrink-0 rounded border border-violet-200 px-2 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Go
              </button>
              <button
                type="button"
                disabled={!playbackSessionId}
                onClick={handleDetachPlayback}
                className="flex shrink-0 items-center gap-1 px-2 py-1 border border-gray-200 text-gray-600 text-[11px] font-medium rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ExternalLink size={12} /> Detach preview
              </button>
            </div>
          </div>
        </div>

        {targets.length > 0 && (
          <CompactStrip title="Targets" aria-label="Run targets">
            {targetsCompact}
          </CompactStrip>
        )}

        {tags.length > 0 && (
          <CompactStrip title="Tags" aria-label="Run tags">
            {tags.join(' · ')}
          </CompactStrip>
        )}
      </div>

      {/* Playback preview + recorded steps — wide preview left, narrower steps column right */}
      {recordedSteps.length > 0 && (
        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-stretch lg:gap-6">
          <div
            className={`min-w-0 flex-1 bg-white border border-gray-100 rounded-lg p-4 flex flex-col ${PLAYBACK_COL_HEIGHT}`}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <Play size={14} className="text-[#4B90FF]" />
                Live replay preview
              </p>
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                {playbackStatus === 'idle' ? 'Idle' : playbackStatus}
              </span>
            </div>
            <div className="relative flex-1 min-h-0 flex items-center justify-center bg-gray-50 rounded-md border border-gray-100 overflow-hidden">
              {(currentFrame || isPlaying) && (
                <canvas
                  ref={playbackCanvasRef}
                  className="max-h-full w-full max-w-full object-contain"
                  role="img"
                  aria-label="Playback preview"
                />
              )}
              {isPlaying && !currentFrame && !playbackError && (
                <div
                  className="absolute inset-0 flex items-center justify-center bg-gray-50/90 z-[1]"
                  role="status"
                  aria-live="polite"
                >
                  <p className="text-xs text-gray-600 px-6 text-center">Connecting to playback stream…</p>
                </div>
              )}
              {playbackError && (
                <div
                  className={`flex items-center justify-center p-4 z-[2] ${
                    currentFrame || isPlaying ? 'absolute inset-0 bg-red-50/95' : 'w-full min-h-[200px]'
                  }`}
                  role="alert"
                >
                  <p className="text-xs text-red-700 text-center max-w-md">{playbackError}</p>
                </div>
              )}
              {!currentFrame && !isPlaying && !playbackError && (
                <p className="text-xs text-gray-400 text-center px-6">
                  Press <span className="font-medium text-gray-600">Play</span> to run your saved steps in a new browser
                  session. Frames stream here in real time.
                </p>
              )}
            </div>
          </div>
          <div
            className={`w-full shrink-0 bg-white border border-gray-100 rounded-lg p-4 flex flex-col lg:w-[min(20rem,26%)] lg:min-w-[17rem] lg:max-w-sm ${PLAYBACK_COL_HEIGHT}`}
          >
            <p className="text-sm font-semibold text-gray-800 mb-3">
              Recorded steps
              <span className="ml-2 text-[10px] font-normal text-gray-400">({recordedSteps.length})</span>
            </p>
            <div className="overflow-y-auto flex-1 pr-1 -mr-1">
              {recordedSteps.map((step) => {
                const cp = runCheckpoints.find((c) => c.afterStepSequence === step.sequence);
                return (
                  <div key={step.id}>
                    <StepCard
                      ref={(el) => {
                        if (el) stepRefs.current.set(step.sequence, el);
                        else stepRefs.current.delete(step.sequence);
                      }}
                      sequence={step.sequence}
                      action={step.action}
                      instruction={step.instruction}
                      playwrightCode={step.playwrightCode}
                      origin={step.origin}
                      timestamp={step.timestamp}
                      metadata={step.metadata}
                      playbackHighlight={playbackToneForStep(
                        step.sequence,
                        showReplayChrome,
                        highlightSequence,
                        completedSequences,
                      )}
                      stepPlayback={
                        canShowStepActions
                          ? {
                              onPlayFromHere: () => void handleStepPlayback(step.sequence, 'from'),
                              onPlayThisStepOnly: () => void handleStepPlayback(step.sequence, 'only'),
                              disabled: isPlaying || !canPlayback,
                            }
                          : undefined
                      }
                      checkpointAfterStep={cp ?? undefined}
                      checkpointRunId={cp && id ? id : undefined}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <RunDetailsSlideOver
        open={runDetailsOpen}
        onClose={() => setRunDetailsOpen(false)}
        run={r}
        timelineParts={timelineCompactParts}
        findingsArr={findingsArr}
        artifactsCount={artifactsCount}
        canPlayback={canPlayback}
        isPlaying={isPlaying}
        playbackAutoClerkMode={playbackAutoClerkMode}
        setPlaybackAutoClerkMode={setPlaybackAutoClerkMode}
        playbackClerkOtpMode={playbackClerkOtpMode}
        setPlaybackClerkOtpMode={setPlaybackClerkOtpMode}
        playbackSkipUntilSeq={playbackSkipUntilSeq}
        setPlaybackSkipUntilSeq={setPlaybackSkipUntilSeq}
        playbackDelayMs={playbackDelayMs}
        setPlaybackDelayMs={setPlaybackDelayMs}
      />

      {showSessionRecordingCard && (
        <SessionRecordingModal
          open={sessionRecordingModalOpen}
          onClose={() => setSessionRecordingModalOpen(false)}
          runId={r.id}
        />
      )}
    </div>
  );
}
