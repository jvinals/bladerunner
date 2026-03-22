import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useRef, useEffect, useCallback, useState, useMemo } from 'react';
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
  Clock, CheckCircle, XCircle, AlertTriangle, Eye,
  Camera, FileText, Activity, Play, Square, ExternalLink,
  Film, Pause, RotateCcw, StepForward, X, SlidersHorizontal,
} from 'lucide-react';

const PLATFORM_ICONS: Record<string, typeof Monitor> = {
  desktop: Monitor,
  mobile: Smartphone,
  pwa: Globe,
};

const SEVERITY_STYLES: Record<string, { bg: string; text: string; icon: typeof AlertTriangle }> = {
  critical: { bg: 'bg-red-50', text: 'text-[#FF4D4D]', icon: XCircle },
  warning: { bg: 'bg-yellow-50', text: 'text-[#EAB508]', icon: AlertTriangle },
  info: { bg: 'bg-blue-50', text: 'text-[#4B90FF]', icon: Eye },
  suggestion: { bg: 'bg-gray-50', text: 'text-gray-500', icon: Eye },
};

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
  const [playbackSettingsOpen, setPlaybackSettingsOpen] = useState(false);
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

  /** Full-width, single-column layout while a live playback session is active (no sidebar / split columns). */
  const playbackLayoutActive = isPlaying;

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

  const PlatformIcon = PLATFORM_ICONS[r.platform] || Monitor;

  return (
    <div
      className={`flex-1 min-h-0 overflow-y-auto py-8 px-6 lg:px-10 ${
        playbackLayoutActive ? 'w-full max-w-none' : 'max-w-6xl'
      }`}
    >
      {/* Back link */}
      <Link to="/runs" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-[#4B90FF] transition-colors mb-6">
        <ArrowLeft size={14} />
        Back to Runs
      </Link>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8">
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
        <div className="flex flex-col gap-2 items-end w-full lg:w-auto">
          <span className="sr-only">Playback</span>
          <div className="flex flex-wrap items-center justify-end gap-2 w-full">
            <button
              type="button"
              aria-disabled={!canPlayback || isPlaying}
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
              className={`flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF] transition-colors ${
                !canPlayback || isPlaying ? 'opacity-40 cursor-not-allowed' : ''
              }`}
            >
              <Play size={13} /> {waitingForSteps ? 'Loading…' : 'Play'}
            </button>
            {canPlayback && !isPlaying && (
              <button
                type="button"
                disabled
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-100 text-gray-400 text-xs font-medium rounded-md cursor-not-allowed opacity-60"
                title="Pause appears after you start playback"
              >
                <Pause size={13} /> Pause
              </button>
            )}
            {isPlaying &&
              (isPaused ? (
                <button
                  type="button"
                  onClick={() => void resumePlayback()}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-emerald-200 text-emerald-700 text-xs font-medium rounded-md hover:bg-emerald-50 transition-colors"
                  title="Resume playback"
                >
                  <Play size={13} className="fill-current" /> Resume
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void pausePlayback()}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-amber-200 text-amber-800 text-xs font-medium rounded-md hover:bg-amber-50 transition-colors"
                  title="Pause playback"
                >
                  <Pause size={13} /> Pause
                </button>
              ))}
            <button
              type="button"
              onClick={() => setPlaybackSettingsOpen((o) => !o)}
              aria-expanded={playbackSettingsOpen}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 border text-xs font-medium rounded-md transition-colors ${
                playbackSettingsOpen
                  ? 'border-[#4B90FF] bg-[#4B90FF]/5 text-[#2563EB]'
                  : 'border-gray-200 text-gray-600 hover:border-[#4B90FF]/40 hover:text-[#4B90FF]'
              }`}
            >
              <SlidersHorizontal size={13} aria-hidden />
              Playback settings
            </button>
          </div>

          {playbackSettingsOpen && (
            <div className="w-full max-w-md rounded-lg border border-gray-200 bg-gray-50/80 p-3 text-left shadow-sm">
              {canPlayback && !isPlaying && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                  <label htmlFor="run-playback-clerk" className="whitespace-nowrap">
                    Automatic Clerk sign-in
                  </label>
                  <select
                    id="run-playback-clerk"
                    value={playbackAutoClerkMode}
                    onChange={(e) => setPlaybackAutoClerkMode(e.target.value as 'default' | 'on' | 'off')}
                    className="border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                    title="Automatic server-side Clerk sign-in during playback"
                  >
                    <option value="default">Automatic — server default</option>
                    <option value="on">Automatic — on</option>
                    <option value="off">Automatic — off</option>
                  </select>
                  <label htmlFor="run-playback-clerk-otp" className="whitespace-nowrap">
                    Automatic Clerk OTP
                  </label>
                  <select
                    id="run-playback-clerk-otp"
                    value={playbackClerkOtpMode}
                    onChange={(e) => setPlaybackClerkOtpMode(e.target.value as AutoClerkOtpUiMode)}
                    title="How to complete email verification when automatic Clerk sign-in runs"
                    className="border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                  >
                    <option value="default">OTP: server default</option>
                    <option value="clerk_test_email">OTP: test email (424242)</option>
                    <option value="mailslurp">OTP: MailSlurp inbox</option>
                  </select>
                  <label htmlFor="run-playback-skip" className="whitespace-nowrap">
                    Skip seq &lt;
                  </label>
                  <input
                    id="run-playback-skip"
                    type="number"
                    min={0}
                    placeholder="—"
                    value={playbackSkipUntilSeq}
                    onChange={(e) => setPlaybackSkipUntilSeq(e.target.value)}
                    className="w-16 border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                    title="Skip steps with sequence strictly less than this (legacy runs)"
                  />
                  <label htmlFor="run-playback-delay" className="whitespace-nowrap">
                    Delay
                  </label>
                  <input
                    id="run-playback-delay"
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
              {isPlaying && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void stopPlayback()}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-red-200 text-red-600 text-xs font-medium rounded-md hover:bg-red-50 transition-colors"
                  >
                    <Square size={13} /> Stop
                  </button>
                  <button
                    type="button"
                    onClick={() => void restartPlayback()}
                    className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-700 text-xs font-medium rounded-md hover:bg-slate-50 transition-colors"
                    title="Restart from the beginning with the same options"
                  >
                    <RotateCcw size={13} /> Restart
                  </button>
                  {playbackSessionId && (
                    <button
                      type="button"
                      onClick={handleDetachPlayback}
                      className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF] transition-colors"
                    >
                      <ExternalLink size={13} /> Detach preview
                    </button>
                  )}
                </div>
              )}
              {isPlaying && isPaused && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
                  <button
                    type="button"
                    onClick={() => void advancePlaybackOne()}
                    className="flex items-center gap-1 px-2.5 py-1 border border-indigo-200 text-indigo-800 text-[11px] font-medium rounded-md hover:bg-indigo-50 transition-colors"
                    title="Run the next step, then pause again"
                  >
                    <StepForward size={12} />
                    Next step
                  </button>
                  <span className="text-[10px] text-gray-400">Run to seq</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="seq"
                    value={playbackAdvanceToSeq}
                    onChange={(e) => setPlaybackAdvanceToSeq(e.target.value)}
                    className="w-14 border border-gray-200 rounded-md px-2 py-1 text-[11px] text-gray-800 tabular-nums bg-white"
                    title="Pause after this step sequence completes (inclusive)"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const n = Number.parseInt(playbackAdvanceToSeq.trim(), 10);
                      if (!Number.isNaN(n) && n >= 0) void advancePlaybackTo(n);
                    }}
                    className="px-2.5 py-1 border border-violet-200 text-violet-800 text-[11px] font-medium rounded-md hover:bg-violet-50 transition-colors"
                  >
                    Go
                  </button>
                </div>
              )}
              {!canPlayback && !isPlaying && (
                <p className="text-[11px] text-gray-500">
                  Playback options apply when this run has recorded steps and is not actively recording.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {stepsQueryErrorMessage && (
        <p className="mb-4 text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-md px-2 py-1.5" role="alert">
          Could not load steps for playback: {stepsQueryErrorMessage}
        </p>
      )}

      {/* Metrics cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <div className="bg-white border border-gray-100 rounded-lg p-4">
          <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Duration</p>
          <p className="text-lg font-bold text-gray-800 ce-mono">
            {r.durationMs ? formatDuration(r.durationMs) : '—'}
          </p>
        </div>
        <div className="bg-white border border-gray-100 rounded-lg p-4">
          <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Steps</p>
          <p className="text-lg font-bold text-gray-800">
            {passedSteps}/{stepsCount}
          </p>
        </div>
        <div className="bg-white border border-gray-100 rounded-lg p-4">
          <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Failures</p>
          <p className={`text-lg font-bold ${failedSteps > 0 ? 'text-[#FF4D4D]' : 'text-gray-800'}`}>
            {failedSteps}
          </p>
        </div>
        <div className="bg-white border border-gray-100 rounded-lg p-4">
          <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Findings</p>
          <p className={`text-lg font-bold ${findingsCount > 0 ? 'text-[#EAB508]' : 'text-gray-800'}`}>
            {findingsCount}
          </p>
        </div>
        <div className="bg-white border border-gray-100 rounded-lg p-4">
          <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">Artifacts</p>
          <p className="text-lg font-bold text-[#4B90FF]">{artifactsCount}</p>
        </div>
      </div>

      {/* Playback preview + recorded steps */}
      {recordedSteps.length > 0 && (
        <div
          className={`mb-8 grid gap-6 ${
            playbackLayoutActive ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-2'
          }`}
        >
          <div className="bg-white border border-gray-100 rounded-lg p-4 min-h-[240px] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                <Play size={14} className="text-[#4B90FF]" />
                Live replay preview
              </p>
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                {playbackStatus === 'idle' ? 'Idle' : playbackStatus}
              </span>
            </div>
            <div className="relative flex-1 flex items-center justify-center bg-gray-50 rounded-md border border-gray-100 min-h-[200px] overflow-hidden">
              {(currentFrame || isPlaying) && (
                <canvas
                  ref={playbackCanvasRef}
                  className={`max-w-full object-contain ${
                    playbackLayoutActive ? 'max-h-[min(560px,65vh)]' : 'max-h-[min(420px,50vh)]'
                  }`}
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
            className={`bg-white border border-gray-100 rounded-lg p-4 flex flex-col ${
              playbackLayoutActive ? 'max-h-[min(640px,75vh)]' : 'max-h-[min(520px,70vh)]'
            }`}
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

      {showSessionRecordingCard && (
        <SessionRecordingModal
          open={sessionRecordingModalOpen}
          onClose={() => setSessionRecordingModalOpen(false)}
          runId={r.id}
        />
      )}

      <div
        className={`grid gap-6 ${
          playbackLayoutActive ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3'
        }`}
      >
        {/* Left: Targets & Timeline */}
        <div className={playbackLayoutActive ? 'space-y-6' : 'lg:col-span-2 space-y-6'}>
          {/* Targets */}
          {targets.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-lg p-5">
              <p className="text-sm font-semibold text-gray-800 mb-4">Targets</p>
              <div className="space-y-3">
                {targets.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div className="flex items-center gap-3">
                      <Monitor size={14} className="text-gray-400" />
                      <div>
                        <p className="text-sm text-gray-700 font-medium">{t.deviceName}</p>
                        <p className="text-[11px] text-gray-400">
                          {t.browserOrApp} · {t.resolution} · {t.os}
                        </p>
                      </div>
                    </div>
                    <StatusBadge status={t.status} size="sm" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline placeholder */}
          <div className="bg-white border border-gray-100 rounded-lg p-5">
            <p className="text-sm font-semibold text-gray-800 mb-4">Timeline</p>
            <div className="space-y-4">
              {[
                { time: r.createdAt, event: 'Run created', icon: Activity, color: '#4B90FF' },
                ...(r.startedAt ? [{ time: r.startedAt, event: 'Execution started', icon: Clock, color: '#4B90FF' }] : []),
                ...(r.completedAt
                  ? [{ time: r.completedAt, event: r.status === 'passed' ? 'Run completed successfully' : r.status === 'failed' ? 'Run completed with failures' : 'Run completed — needs review', icon: r.status === 'passed' ? CheckCircle : r.status === 'failed' ? XCircle : AlertTriangle, color: r.status === 'passed' ? '#56A34A' : r.status === 'failed' ? '#FF4D4D' : '#EAB508' }]
                  : []),
              ].map((entry, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5" style={{ background: `${entry.color}15` }}>
                    <entry.icon size={12} style={{ color: entry.color }} />
                  </div>
                  <div>
                    <p className="text-sm text-gray-700">{entry.event}</p>
                    <p className="text-[11px] text-gray-400">{new Date(entry.time).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Artifacts placeholder */}
          <div className="bg-white border border-gray-100 rounded-lg p-5">
            <p className="text-sm font-semibold text-gray-800 mb-4">Artifacts</p>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              {Array.from({ length: Math.min(artifactsCount, 6) }).map((_, i) => (
                <div key={i} className="border border-gray-100 rounded-md p-3 hover:border-[#4B90FF]/30 transition-colors cursor-pointer">
                  <div className="flex items-center gap-2 mb-2">
                    {i % 3 === 0 ? <Camera size={13} className="text-[#4B90FF]" /> : <FileText size={13} className="text-gray-400" />}
                    <span className="text-xs font-medium text-gray-600 truncate">
                      {i % 3 === 0 ? `screenshot_step_${i + 1}.png` : i % 3 === 1 ? `trace_${i + 1}.json` : `log_${i + 1}.txt`}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400">
                    {i % 3 === 0 ? 'Screenshot' : i % 3 === 1 ? 'Performance trace' : 'Console log'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Findings & Tags */}
        <div className="space-y-6">
          {/* Findings */}
          <div className="bg-white border border-gray-100 rounded-lg p-5">
            <p className="text-sm font-semibold text-gray-800 mb-4">
              Findings
              {findingsArr.length > 0 && (
                <span className="ml-2 px-2 py-0.5 bg-[#EAB508]/10 text-[#EAB508] text-[10px] font-semibold rounded-full">
                  {findingsArr.length}
                </span>
              )}
            </p>
            {findingsArr.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No findings for this run</p>
            ) : (
              <div className="space-y-3">
                {findingsArr.map((f) => {
                  const sev = SEVERITY_STYLES[f.severity] || SEVERITY_STYLES.info;
                  const SevIcon = sev.icon;
                  return (
                    <div key={f.id} className={`${sev.bg} rounded-md p-3`}>
                      <div className="flex items-start gap-2">
                        <SevIcon size={13} className={`${sev.text} mt-0.5 shrink-0`} />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-gray-700">{f.title}</p>
                          <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{f.description}</p>
                          {f.suggestion && (
                            <p className="text-[10px] text-[#4B90FF] mt-1.5 font-medium">
                              💡 {f.suggestion}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <span className="px-1.5 py-0 text-[9px] text-gray-400 bg-white/80 rounded font-medium capitalize">
                              {f.category.replace('_', ' ')}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {formatRelativeTime(f.createdAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="bg-white border border-gray-100 rounded-lg p-5">
              <p className="text-sm font-semibold text-gray-800 mb-3">Tags</p>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span key={tag} className="px-2.5 py-1 text-xs text-gray-500 bg-gray-50 rounded-full border border-gray-100 font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Run Info */}
          <div className="bg-white border border-gray-100 rounded-lg p-5">
            <p className="text-sm font-semibold text-gray-800 mb-3">Details</p>
            <dl className="space-y-2.5">
              {[
                { label: 'Run ID', value: r.id },
                { label: 'Platform', value: r.platform },
                { label: 'Triggered by', value: r.triggeredBy },
                { label: 'Created', value: new Date(r.createdAt).toLocaleString() },
                ...(r.startedAt ? [{ label: 'Started', value: new Date(r.startedAt).toLocaleString() }] : []),
                ...(r.completedAt ? [{ label: 'Completed', value: new Date(r.completedAt).toLocaleString() }] : []),
              ].map((item) => (
                <div key={item.label} className="flex justify-between">
                  <dt className="text-[11px] text-gray-400">{item.label}</dt>
                  <dd className="text-[11px] text-gray-600 ce-mono text-right max-w-[60%] truncate">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
