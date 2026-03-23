import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import {
  runsApi,
  buildStartPlaybackBody,
  projectsApi,
  type ProjectDto,
  type AutoClerkOtpUiMode,
} from '@/lib/api';
import { StepCard } from '@/components/ui/StepCard';
import { SkipReplaySuggestionsModal } from '@/components/ui/SkipReplaySuggestionsModal';
import { useRecording } from '@/hooks/useRecording';
import { useSkipReplayAfterStepChange } from '@/hooks/useSkipReplayAfterStepChange';
import { usePlayback, type PlaybackProgressPayload } from '@/hooks/usePlayback';
import {
  effectivePlaybackHighlightSequence,
  playbackToneForStep,
  previousPlayThroughTarget,
} from '@/lib/playbackStepTone';
import {
  canPauseOrStopPlaybackDuringClerkStep,
  getClerkAutoSignInStepSequence,
} from '@/lib/clerkAutoSignInStep';
import {
  useRemotePreviewCanvas,
  type RemotePreviewBridge,
} from '@/hooks/useRemotePreviewCanvas';
import {
  Search, Plus, Square, Send, ExternalLink, X, Play, ChevronDown, LogIn, Trash2, Pause,
  RotateCcw, StepForward, StepBack, Sparkles, FlaskConical,
} from 'lucide-react';

export default function RunsPage() {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const invalidateStepsAfterPlaybackStep = useCallback(
    (p: PlaybackProgressPayload) => {
      if ((p.phase === 'after' || p.phase === 'transcript') && p.sourceRunId) {
        void queryClient.invalidateQueries({ queryKey: ['run-steps', p.sourceRunId] });
        void queryClient.invalidateQueries({ queryKey: ['run', p.sourceRunId] });
      }
    },
    [queryClient],
  );
  const [search, setSearch] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [newPanelOpen, setNewPanelOpen] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newRunProjectId, setNewRunProjectId] = useState('');
  const [instructionText, setInstructionText] = useState('');
  const [playbackAutoClerkMode, setPlaybackAutoClerkMode] = useState<'default' | 'on' | 'off'>('on');
  const [playbackClerkOtpMode, setPlaybackClerkOtpMode] = useState<AutoClerkOtpUiMode>('mailslurp');
  const [recordingClerkOtpMode, setRecordingClerkOtpMode] = useState<AutoClerkOtpUiMode>('mailslurp');
  const [playbackDelayMs, setPlaybackDelayMs] = useState(600);
  const [playbackSkipUntilSeq, setPlaybackSkipUntilSeq] = useState('');
  const [playbackAdvanceToSeq, setPlaybackAdvanceToSeq] = useState('');
  const [stepsLoadError, setStepsLoadError] = useState<string | null>(null);
  const [isDetached, setIsDetached] = useState(false);
  const [isSendingInstruction, setIsSendingInstruction] = useState(false);
  const [reRecordBusyStepId, setReRecordBusyStepId] = useState<string | null>(null);
  const [reRecordError, setReRecordError] = useState<string | null>(null);
  const [aiStepModalOpen, setAiStepModalOpen] = useState(false);
  const [aiStepPrompt, setAiStepPrompt] = useState('');
  const [aiStepCreatedId, setAiStepCreatedId] = useState<string | null>(null);
  const [aiStepBusy, setAiStepBusy] = useState(false);
  const [aiStepError, setAiStepError] = useState<string | null>(null);
  const [playbackExclusionBusyStepId, setPlaybackExclusionBusyStepId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewFocusRef = useRef<HTMLDivElement>(null);
  /** Scrollable panel for the step list — scroll this only; avoid scrollIntoView (scrolls the window and shifts the preview). */
  const stepsListScrollRef = useRef<HTMLDivElement>(null);
  const detachedWindowRef = useRef<Window | null>(null);
  /** Latest recording run id for delete mutation (avoids stale closure in onSuccess). */
  const recordingRunIdRef = useRef<string | null>(null);

  const {
    isRecording,
    runId,
    currentFrame: recordFrame,
    steps,
    status,
    startRecording,
    stopRecording,
    sendInstruction,
    reRecordStep,
    loadRunSteps,
    clearLoadedRun,
    resetRecordingAfterRemoteDelete,
    sendRemotePointer,
    sendRemoteKey,
    sendRemoteTouch,
    sendRemoteClipboard,
    socketConnected,
    clerkAutoSignIn,
    clerkAutoSigningIn,
    clerkAutoSignInError,
  } = useRecording();

  recordingRunIdRef.current = runId;

  const {
    playbackSessionId,
    sourceRunId: playbackSourceRunId,
    currentFrame: playFrame,
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
    advancePlaybackPrevious,
    advancePlaybackTo,
    restartPlayback,
  } = usePlayback({ onPlaybackProgress: invalidateStepsAfterPlaybackStep });

  const stepRefsPlayback = useRef<Map<number, HTMLDivElement | null>>(new Map());
  const detachedPlaybackWindowRef = useRef<Window | null>(null);

  const { data: runsData, isLoading, error, refetch } = useQuery({
    queryKey: ['runs', search],
    queryFn: () => runsApi.list(search ? { search } : undefined),
  });

  const { data: projectsList = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  });

  const deleteRunMutation = useMutation({
    mutationFn: (id: string) => runsApi.deleteRun(id),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['recent-runs'] });
      queryClient.invalidateQueries({ queryKey: ['home-runs-table'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
      if (recordingRunIdRef.current === deletedId) {
        resetRecordingAfterRemoteDelete();
      }
      setSelectedRunId(null);
      setStepsLoadError(null);
      clearLoadedRun();
    },
  });

  const runs = (runsData?.data || []) as Array<{
    id: string;
    name: string;
    url: string;
    status: string;
    stepsCount: number;
    createdAt: string;
    project?: { id: string; name: string; kind: string } | null;
  }>;

  const selectedRun = selectedRunId ? runs.find((r) => r.id === selectedRunId) : undefined;
  const effectiveRunId = isRecording ? runId : selectedRunId;
  const {
    skipReplayModalOpen,
    skipReplayAnchorStepId,
    skipReplaySuggestions,
    skipReplayBusy,
    promptAfterStepChange,
    dismissSkipReplayModal,
    confirmSkipReplaySuggestions,
  } = useSkipReplayAfterStepChange({ runId: effectiveRunId ?? undefined, queryClient });
  const canPlaybackSelected =
    !!selectedRunId &&
    steps.length > 0 &&
    !!selectedRun &&
    selectedRun.status !== 'RECORDING' &&
    !isRecording;
  const canShowStepActions =
    steps.length > 0 &&
    (!!effectiveRunId);
  const clerkAutoSignInSequence = useMemo(
    () => getClerkAutoSignInStepSequence(steps),
    [steps],
  );
  const canPauseOrStopDuringPlayback = useMemo(
    () => canPauseOrStopPlaybackDuringClerkStep(clerkAutoSignInSequence, completedSequences),
    [clerkAutoSignInSequence, completedSequences],
  );
  const showReplayChrome =
    isPlaying || playbackStatus === 'playback' || (playbackStatus === 'failed' && !!playbackError);

  const effectiveHighlightSequence = useMemo(
    () => effectivePlaybackHighlightSequence(highlightSequence, completedSequences, steps),
    [highlightSequence, completedSequences, steps],
  );

  const canPlaybackPreviousStep = useMemo(() => {
    if (!isPlaying || !isPaused || steps.length === 0) return false;
    const nextSeq = effectivePlaybackHighlightSequence(highlightSequence, completedSequences, steps);
    if (nextSeq == null) return false;
    return previousPlayThroughTarget(completedSequences, nextSeq) != null;
  }, [isPlaying, isPaused, highlightSequence, completedSequences, steps]);

  useEffect(() => {
    if (isPlaying || playbackSessionId != null) return;
    setPlaybackAdvanceToSeq('');
  }, [isPlaying, playbackSessionId]);

  useEffect(() => {
    const panel = stepsListScrollRef.current;
    if (!panel || steps.length === 0) return;
    panel.scrollTop = panel.scrollHeight;
  }, [steps.length]);

  useEffect(() => {
    if (isDetached) return;
    const frame = isRecording ? recordFrame : playFrame;
    if (!frame || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${frame}`;
  }, [recordFrame, playFrame, isRecording, isDetached]);

  useEffect(() => {
    if (effectiveHighlightSequence == null) return;
    const el = stepRefsPlayback.current.get(effectiveHighlightSequence);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [effectiveHighlightSequence]);

  const handleStartRecording = useCallback(async () => {
    if (!newUrl || !newName) return;
    try {
      await startRecording(newUrl, newName, newRunProjectId || undefined);
      setNewPanelOpen(false);
      setNewUrl('');
      setNewName('');
      setNewRunProjectId('');
      refetch();
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  }, [newUrl, newName, newRunProjectId, startRecording, refetch]);

  const handleDeleteSelectedRun = useCallback(() => {
    if (!selectedRunId || !selectedRun) return;
    const msg =
      selectedRun.status === 'RECORDING'
        ? `Delete “${selectedRun.name}”? This will end the active recording and remove the run permanently.`
        : `Delete run “${selectedRun.name}”? This cannot be undone.`;
    if (!window.confirm(msg)) return;
    deleteRunMutation.mutate(selectedRunId);
  }, [selectedRunId, selectedRun, deleteRunMutation]);

  const handleStopRecording = useCallback(async () => {
    await stopRecording();
    refetch();
  }, [stopRecording, refetch]);

  const userId = user?.id ?? '';

  const previewBridge = useMemo<RemotePreviewBridge>(
    () => ({
      pointer: (p) => sendRemotePointer(userId, p),
      key: (t, k) => sendRemoteKey(userId, t, k),
      touch: (type, touchPoints) => sendRemoteTouch(userId, { type, touchPoints }),
      clipboard: (action, text) => sendRemoteClipboard(userId, action, text),
      isConnected: () => socketConnected,
    }),
    [
      userId,
      sendRemotePointer,
      sendRemoteKey,
      sendRemoteTouch,
      sendRemoteClipboard,
      socketConnected,
    ],
  );

  const { canvasProps, previewProps } = useRemotePreviewCanvas(
    userId,
    canvasRef,
    previewFocusRef,
    previewBridge,
    { isActive: isRecording && !isDetached && !isPlaying },
  );

  const handleStartPlaybackRuns = useCallback(async () => {
    if (!selectedRunId || !canPlaybackSelected) return;
    try {
      const skipRaw = playbackSkipUntilSeq.trim();
      const skipNum = skipRaw === '' ? undefined : Number.parseInt(skipRaw, 10);
      await startPlayback(
        selectedRunId,
        buildStartPlaybackBody({
          delayMs: playbackDelayMs,
          autoClerkMode: playbackAutoClerkMode,
          clerkOtpMode: playbackClerkOtpMode,
          skipUntilSequence:
            skipNum !== undefined && !Number.isNaN(skipNum) && skipNum >= 0 ? skipNum : undefined,
        }),
      );
    } catch (err) {
      console.error('Playback failed to start:', err);
    }
  }, [
    selectedRunId,
    canPlaybackSelected,
    startPlayback,
    playbackAutoClerkMode,
    playbackClerkOtpMode,
    playbackSkipUntilSeq,
    playbackDelayMs,
  ]);

  const handleStepPlaybackRuns = useCallback(
    async (sequence: number, mode: 'from' | 'only') => {
      if (!selectedRunId || !canPlaybackSelected) return;
      if (isPlaying) await stopPlayback();
      try {
        await startPlayback(
          selectedRunId,
          buildStartPlaybackBody({
            delayMs: playbackDelayMs,
            autoClerkMode: playbackAutoClerkMode,
            clerkOtpMode: playbackClerkOtpMode,
            skipUntilSequence: sequence,
            ...(mode === 'only' ? { playThroughSequence: sequence } : {}),
          }),
        );
      } catch (err) {
        console.error('Step playback failed:', err);
      }
    },
    [
      selectedRunId,
      canPlaybackSelected,
      isPlaying,
      stopPlayback,
      startPlayback,
      playbackAutoClerkMode,
      playbackClerkOtpMode,
      playbackDelayMs,
    ],
  );

  const canEditPlaybackExclusionRuns = !!effectiveRunId;

  const handleTogglePlaybackExclusionRuns = useCallback(
    async (stepId: string, next: boolean) => {
      if (!effectiveRunId) return;
      setPlaybackExclusionBusyStepId(stepId);
      try {
        await runsApi.patchRunStep(effectiveRunId, stepId, { excludedFromPlayback: next });
        await queryClient.invalidateQueries({ queryKey: ['run-steps', effectiveRunId] });
        await queryClient.invalidateQueries({ queryKey: ['run', effectiveRunId] });
        await queryClient.invalidateQueries({ queryKey: ['runs'] });
        await loadRunSteps(effectiveRunId);
      } catch (e) {
        console.error('Failed to update step skip flag', e);
      } finally {
        setPlaybackExclusionBusyStepId(null);
      }
    },
    [effectiveRunId, queryClient, loadRunSteps],
  );

  const { data: runCheckpointsRuns = [] } = useQuery({
    queryKey: ['run-checkpoints', effectiveRunId],
    queryFn: () => runsApi.getCheckpoints(effectiveRunId!),
    enabled: !!effectiveRunId && canShowStepActions,
    refetchInterval: isRecording ? 3000 : false,
  });

  const handleDetachPlaybackRuns = useCallback(() => {
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

  const handleSendInstruction = useCallback(async () => {
    if (!instructionText.trim() || isSendingInstruction) return;
    setIsSendingInstruction(true);
    try {
      const step = await sendInstruction(instructionText.trim());
      setInstructionText('');
      if (step?.id) void promptAfterStepChange(step.id);
    } catch (err) {
      console.error('Instruction failed:', err);
    } finally {
      setIsSendingInstruction(false);
    }
  }, [instructionText, isSendingInstruction, sendInstruction, promptAfterStepChange]);

  const handleReRecordStep = useCallback(
    async (stepId: string, instruction: string) => {
      setReRecordBusyStepId(stepId);
      setReRecordError(null);
      try {
        const step = await reRecordStep(stepId, instruction);
        if (step?.id) void promptAfterStepChange(step.id);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setReRecordError(msg);
        console.error('Re-record step failed:', err);
      } finally {
        setReRecordBusyStepId(null);
      }
    },
    [reRecordStep, promptAfterStepChange],
  );

  const openAiStepModal = useCallback(() => {
    setAiStepPrompt('');
    setAiStepCreatedId(null);
    setAiStepError(null);
    setAiStepModalOpen(true);
  }, []);

  const closeAiStepModalDone = useCallback(() => {
    setAiStepModalOpen(false);
    setAiStepPrompt('');
    setAiStepCreatedId(null);
    setAiStepError(null);
  }, []);

  const closeAiStepModalCancel = useCallback(async () => {
    if (aiStepBusy) return;
    const rid = runId;
    const sid = aiStepCreatedId;
    if (sid && rid) {
      setAiStepBusy(true);
      try {
        await runsApi.deleteLastRunStepDuringRecording(rid, sid);
        await loadRunSteps(rid);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setAiStepError(msg);
        setAiStepBusy(false);
        return;
      }
      setAiStepBusy(false);
    }
    setAiStepModalOpen(false);
    setAiStepPrompt('');
    setAiStepCreatedId(null);
    setAiStepError(null);
  }, [aiStepBusy, aiStepCreatedId, runId, loadRunSteps]);

  useEffect(() => {
    if (!aiStepModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !aiStepBusy) void closeAiStepModalCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [aiStepModalOpen, aiStepBusy, closeAiStepModalCancel]);

  const handleAiStepAddRow = useCallback(async () => {
    if (!runId || !aiStepPrompt.trim() || aiStepBusy) return;
    setAiStepBusy(true);
    setAiStepError(null);
    try {
      const res = await runsApi.appendAiPromptStepRecording(runId, { instruction: aiStepPrompt.trim() });
      const step = res.step as { id: string };
      setAiStepCreatedId(step.id);
      void promptAfterStepChange(step.id);
      void queryClient.invalidateQueries({ queryKey: ['run-steps', runId] });
      void queryClient.invalidateQueries({ queryKey: ['run', runId] });
      await loadRunSteps(runId);
    } catch (e) {
      setAiStepError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiStepBusy(false);
    }
  }, [runId, aiStepPrompt, aiStepBusy, loadRunSteps, queryClient, promptAfterStepChange]);

  const handleAiStepTest = useCallback(async () => {
    if (!runId || !aiStepCreatedId || aiStepBusy) return;
    setAiStepBusy(true);
    setAiStepError(null);
    try {
      const res = await runsApi.testAiPromptStep(runId, aiStepCreatedId, {
        instruction: aiStepPrompt.trim(),
      });
      if (!res.ok) throw new Error(res.error || 'Test failed');
      void queryClient.invalidateQueries({ queryKey: ['run-steps', runId] });
      await loadRunSteps(runId);
    } catch (e) {
      setAiStepError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiStepBusy(false);
    }
  }, [runId, aiStepCreatedId, aiStepPrompt, aiStepBusy, loadRunSteps, queryClient]);

  const handleAiStepReset = useCallback(async () => {
    if (!runId || !aiStepCreatedId || aiStepBusy) return;
    setAiStepBusy(true);
    setAiStepError(null);
    try {
      await runsApi.resetAiPromptTest(runId, aiStepCreatedId);
    } catch (e) {
      setAiStepError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiStepBusy(false);
    }
  }, [runId, aiStepCreatedId, aiStepBusy]);

  const handleAiStepSavePrompt = useCallback(async () => {
    if (!runId || !aiStepCreatedId || !aiStepPrompt.trim() || aiStepBusy) return;
    setAiStepBusy(true);
    setAiStepError(null);
    try {
      await runsApi.patchRunStep(runId, aiStepCreatedId, { instruction: aiStepPrompt.trim() });
      void queryClient.invalidateQueries({ queryKey: ['run-steps', runId] });
      await loadRunSteps(runId);
    } catch (e) {
      setAiStepError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiStepBusy(false);
    }
  }, [runId, aiStepCreatedId, aiStepPrompt, aiStepBusy, loadRunSteps, queryClient]);

  const handleSelectRun = useCallback(async (id: string) => {
    setSelectedRunId(id);
    setStepsLoadError(null);
    try {
      await loadRunSteps(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setStepsLoadError(msg);
    }
  }, [loadRunSteps]);

  const handleDetach = useCallback(() => {
    if (!runId) return;
    const url = `${window.location.origin}/preview/${runId}`;
    const w = window.open(url, 'bladerunner-preview', 'width=1320,height=780');
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
  }, [runId]);

  const handleReattach = useCallback(() => {
    if (detachedWindowRef.current && !detachedWindowRef.current.closed) {
      detachedWindowRef.current.close();
    }
    detachedWindowRef.current = null;
    setIsDetached(false);
  }, []);

  return (
    <div className="flex flex-1 min-h-0 w-full overflow-hidden">
      {/* Preview Area — min-h-0 so canvas area does not stretch with right column height */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 p-4 overflow-hidden">
        <div className="flex-1 min-h-0 relative bg-white border border-gray-100 rounded-lg overflow-hidden flex items-center justify-center">
          {isRecording && !isDetached ? (
            <>
              <div ref={previewFocusRef} {...previewProps}>
                <canvas
                  ref={canvasRef}
                  className="max-w-full max-h-full object-contain block touch-none cursor-crosshair select-none"
                  {...canvasProps}
                  role="img"
                  aria-label="Remote browser preview — click to interact"
                />
              </div>
              <p className="absolute bottom-2 left-2 right-2 text-center text-[10px] text-gray-400 pointer-events-none px-8">
                Mouse, touch (swipe/pinch), scroll wheel, double-click. Click preview to type;{' '}
                <kbd className="rounded border border-gray-200 bg-gray-50 px-0.5 font-mono text-[9px]">⌘/Ctrl+C/V/X</kbd>{' '}
                copy/paste/cut between remote and your clipboard.{' '}
                <kbd className="rounded border border-gray-200 bg-gray-50 px-0.5 font-mono text-[9px]">Esc</kbd> exits
                keyboard focus.
              </p>
              <button
                type="button"
                onClick={handleDetach}
                className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 bg-white/90 backdrop-blur border border-gray-200 rounded-md text-xs text-gray-600 hover:text-[#4B90FF] hover:border-[#4B90FF]/30 transition-all shadow-sm"
                title="Detach preview to new window"
              >
                <ExternalLink size={12} />
                Detach
              </button>
            </>
          ) : (isPlaying || playFrame || playbackError) && !isDetached ? (
            <div className="relative w-full h-full min-h-[200px] flex items-center justify-center">
              {(isPlaying || playFrame) && (
                <canvas
                  ref={canvasRef}
                  className="max-w-full max-h-full object-contain block bg-gray-50"
                  role="img"
                  aria-label="Playback preview — recorded run replay"
                />
              )}
              {isPlaying && !playFrame && !playbackError && (
                <div
                  className="absolute inset-0 flex items-center justify-center bg-gray-50/90 z-[1]"
                  role="status"
                  aria-live="polite"
                >
                  <p className="text-sm text-gray-600 px-6 text-center">Connecting to playback stream…</p>
                </div>
              )}
              {playbackError && (
                <div
                  className={`flex items-center justify-center p-6 z-[2] ${
                    isPlaying || playFrame ? 'absolute inset-0 bg-red-50/95' : 'w-full min-h-[200px]'
                  }`}
                  role="alert"
                >
                  <p className="text-sm text-red-700 text-center max-w-md">{playbackError}</p>
                </div>
              )}
              {(isPlaying || playFrame) && !playbackError && (
                <p className="absolute bottom-2 left-2 right-2 text-center text-[10px] text-gray-400 pointer-events-none px-8 z-[3]">
                  Replaying saved steps — read-only preview. Use <strong>Stop</strong> to end playback.
                </p>
              )}
              {playbackSessionId && !playbackError && (
                <button
                  type="button"
                  onClick={handleDetachPlaybackRuns}
                  className="absolute top-3 right-3 z-[3] flex items-center justify-center p-2 bg-white/90 backdrop-blur border border-gray-200 rounded-md text-xs text-gray-600 hover:text-[#4B90FF] hover:border-[#4B90FF]/30 transition-all shadow-sm"
                  title="Open playback in a new window"
                  aria-label="Open playback in a new window"
                >
                  <ExternalLink size={12} aria-hidden />
                </button>
              )}
            </div>
          ) : isDetached ? (
            <div className="text-center">
              <ExternalLink size={32} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm text-gray-500 mb-2">Preview detached to external window</p>
              <button
                onClick={handleReattach}
                className="text-xs text-[#4B90FF] font-medium hover:underline"
              >
                Reattach here
              </button>
            </div>
          ) : (
            <div className="text-center px-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#4B90FF]/10 to-[#4D65FF]/10 flex items-center justify-center">
                <Play size={24} className="text-[#4B90FF]" />
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">No active recording</p>
              <p className="text-xs text-gray-400 max-w-xs mx-auto">
                Click <strong>New</strong> to record, or select a run and press <strong>Play</strong> to replay its steps
                in the preview.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Right Column — bounded to viewport; steps scroll inside */}
      <div className="w-96 flex-shrink-0 h-full min-h-0 border-l border-gray-100 bg-white flex flex-col overflow-hidden">
        {/* Header Controls */}
        <div className="p-4 border-b border-gray-50 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search runs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full border border-gray-200 rounded-md pl-8 pr-3 py-1.5 text-xs text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                  <X size={12} />
                </button>
              )}
            </div>

            {isRecording ? (
              <button
                onClick={handleStopRecording}
                className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 text-xs font-medium rounded-md hover:bg-red-100 transition-colors"
              >
                <Square size={12} />
                Stop
              </button>
            ) : isPlaying ? (
              <div className="flex flex-col items-end gap-1 shrink-0 max-w-[min(100%,20rem)]">
                <div className="flex flex-wrap items-center gap-1.5 justify-end">
                  {isPaused ? (
                    <button
                      type="button"
                      onClick={() => void resumePlayback()}
                      className="flex items-center gap-1 px-3 py-1.5 bg-emerald-50 text-emerald-700 text-xs font-medium rounded-md hover:bg-emerald-100 transition-colors"
                      title="Resume playback"
                    >
                      <Play size={12} className="fill-current" />
                      Resume
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!canPauseOrStopDuringPlayback}
                      onClick={() => void pausePlayback()}
                      className="flex items-center gap-1 px-3 py-1.5 bg-amber-50 text-amber-800 text-xs font-medium rounded-md hover:bg-amber-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={
                        !canPauseOrStopDuringPlayback
                          ? 'Wait until automatic Clerk sign-in has finished'
                          : 'Pause playback'
                      }
                    >
                      <Pause size={12} />
                      Pause
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!canPauseOrStopDuringPlayback}
                    onClick={() => void stopPlayback()}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 text-xs font-medium rounded-md hover:bg-red-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={
                      !canPauseOrStopDuringPlayback
                        ? 'Wait until automatic Clerk sign-in has finished'
                        : 'Stop playback'
                    }
                  >
                    <Square size={12} />
                    Stop
                  </button>
                  <button
                    type="button"
                    onClick={() => void restartPlayback()}
                    className="flex items-center gap-1 px-3 py-1.5 border border-slate-200 text-slate-700 text-xs font-medium rounded-md hover:bg-slate-50 transition-colors"
                    title="Restart from the beginning with the same options"
                  >
                    <RotateCcw size={12} />
                    Restart
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewPanelOpen(!newPanelOpen)}
                    disabled={isPlaying}
                    className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 text-gray-400 text-xs font-medium rounded-md cursor-not-allowed opacity-50"
                    title="Stop playback before starting a new recording"
                  >
                    <Plus size={12} />
                    New
                  </button>
                </div>
                {isPaused && (
                  <div className="flex flex-wrap items-center gap-1.5 justify-end w-full">
                    <button
                      type="button"
                      disabled={!canPlaybackPreviousStep}
                      onClick={() => void advancePlaybackPrevious(steps)}
                      className="flex w-[4.5rem] shrink-0 justify-center items-center gap-0.5 px-1.5 py-1 border border-indigo-200 text-indigo-800 text-[10px] font-medium rounded-md hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="Replay from the start and pause after the previous completed step"
                    >
                      <StepBack size={10} />
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => void advancePlaybackOne()}
                      className="flex w-[4.5rem] shrink-0 justify-center items-center gap-0.5 px-1.5 py-1 border border-indigo-200 text-indigo-800 text-[10px] font-medium rounded-md hover:bg-indigo-50"
                      title="Run the next step, then pause again"
                    >
                      <StepForward size={10} />
                      Next
                    </button>
                    <input
                      type="number"
                      min={0}
                      placeholder="seq"
                      value={playbackAdvanceToSeq}
                      onChange={(e) => setPlaybackAdvanceToSeq(e.target.value)}
                      className="w-12 border border-gray-200 rounded px-1.5 py-0.5 text-[11px] tabular-nums"
                      title="Pause after this step sequence (inclusive)"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const n = Number.parseInt(playbackAdvanceToSeq.trim(), 10);
                        if (!Number.isNaN(n) && n >= 0) void advancePlaybackTo(n);
                      }}
                      className="px-2 py-1 border border-violet-200 text-violet-800 text-[11px] font-medium rounded-md hover:bg-violet-50"
                    >
                      Run to
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setNewPanelOpen(!newPanelOpen)}
                className="flex items-center gap-1 px-3 py-1.5 bg-[#4B90FF] text-white text-xs font-medium rounded-md hover:bg-blue-500 transition-colors"
              >
                <Plus size={12} />
                New
              </button>
            )}
          </div>

          {/* Run Picker */}
          {!isRecording && (
            <div className="flex gap-2 items-center">
              <div className="relative flex-1 min-w-0">
                <select
                  value={selectedRunId || ''}
                  onChange={(e) => e.target.value && handleSelectRun(e.target.value)}
                  className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-xs text-gray-600 appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF] bg-white"
                >
                  <option value="">Select a run...</option>
                  {isLoading ? (
                    <option disabled>Loading...</option>
                  ) : (
                    runs.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.status === 'RECORDING' ? '* ' : ''}
                        {r.name} ({r.stepsCount} steps)
                      </option>
                    ))
                  )}
                </select>
                <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
              {selectedRunId && selectedRun && (
                <button
                  type="button"
                  title={
                    selectedRun.status === 'RECORDING'
                      ? 'Delete run (ends recording)'
                      : 'Delete this run'
                  }
                  disabled={deleteRunMutation.isPending}
                  onClick={() => void handleDeleteSelectedRun()}
                  className="shrink-0 p-1.5 rounded-md border border-red-100 text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          )}

          {!isRecording && stepsLoadError && (
            <p className="mb-2 text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">
              Could not load steps: {stepsLoadError}
            </p>
          )}

          {!isRecording && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Playback</p>
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
                <label htmlFor="runs-playback-clerk" className="whitespace-nowrap">
                  Automatic Clerk sign-in
                </label>
                <select
                  id="runs-playback-clerk"
                  value={playbackAutoClerkMode}
                  onChange={(e) => setPlaybackAutoClerkMode(e.target.value as 'default' | 'on' | 'off')}
                  disabled={isPlaying}
                  title="Automatic server-side Clerk sign-in during playback"
                  className="flex-1 min-w-[120px] border border-gray-200 rounded-md px-2 py-1 text-[11px] text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 disabled:opacity-50"
                >
                  <option value="default">Automatic — server default</option>
                  <option value="on">Automatic — on</option>
                  <option value="off">Automatic — off</option>
                </select>
                <label htmlFor="runs-playback-clerk-otp" className="whitespace-nowrap">
                  Automatic Clerk OTP
                </label>
                <select
                  id="runs-playback-clerk-otp"
                  value={playbackClerkOtpMode}
                  onChange={(e) => setPlaybackClerkOtpMode(e.target.value as AutoClerkOtpUiMode)}
                  disabled={isPlaying}
                  title="How to complete email verification when automatic Clerk sign-in runs"
                  className="flex-1 min-w-[140px] border border-gray-200 rounded-md px-2 py-1 text-[11px] text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 disabled:opacity-50"
                >
                  <option value="default">OTP: server default</option>
                  <option value="clerk_test_email">OTP: test email (424242)</option>
                  <option value="mailslurp">OTP: MailSlurp inbox</option>
                </select>
                <label htmlFor="runs-playback-skip" className="whitespace-nowrap">
                  Skip seq &lt;
                </label>
                <input
                  id="runs-playback-skip"
                  type="number"
                  min={0}
                  placeholder="—"
                  value={playbackSkipUntilSeq}
                  onChange={(e) => setPlaybackSkipUntilSeq(e.target.value)}
                  disabled={isPlaying}
                  className="w-14 border border-gray-200 rounded-md px-1.5 py-1 text-[11px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 disabled:opacity-50"
                  title="Skip steps with sequence strictly less than this"
                />
                <label htmlFor="runs-playback-delay" className="whitespace-nowrap ml-1">
                  Delay
                </label>
                <input
                  id="runs-playback-delay"
                  type="range"
                  min={0}
                  max={5000}
                  step={50}
                  value={playbackDelayMs}
                  onChange={(e) => setPlaybackDelayMs(Number(e.target.value))}
                  disabled={isPlaying}
                  className="w-20 sm:w-28 accent-[#4B90FF] disabled:opacity-50"
                  title="Delay between steps (ms). Fixed for the session once Play starts."
                />
                <span className="text-[10px] text-gray-500 tabular-nums w-10">{playbackDelayMs}ms</span>
              </div>
            <div className="flex gap-2 w-full">
              <button
                type="button"
                aria-disabled={!canPlaybackSelected || isPlaying}
                onClick={() => void handleStartPlaybackRuns()}
                title={
                  !selectedRunId
                    ? 'Select a run first'
                    : selectedRun?.status === 'RECORDING'
                      ? 'Wait until recording finishes'
                      : steps.length === 0
                        ? 'This run has no steps yet'
                        : 'Replay this run in the preview'
                }
                className={`flex-1 min-w-0 flex items-center justify-center gap-2 px-3 py-2.5 bg-[#56A34A] text-white text-xs font-semibold rounded-md hover:bg-green-600 transition-colors shadow-sm ${
                  !canPlaybackSelected || isPlaying ? 'opacity-40 cursor-not-allowed' : ''
                }`}
              >
                <Play size={14} className="fill-white" />
                Play
              </button>
              {canPlaybackSelected && !isPlaying && (
                <button
                  type="button"
                  disabled
                  className="shrink-0 flex items-center justify-center gap-1.5 px-3 py-2.5 border border-gray-200 text-gray-400 text-xs font-medium rounded-md cursor-not-allowed opacity-60"
                  title="Pause appears after you start playback"
                >
                  <Pause size={14} />
                  Pause
                </button>
              )}
            </div>
            </div>
          )}
        </div>

        {/* New Run Sliding Panel */}
        <div
          className={`overflow-hidden transition-all duration-300 ease-out border-b border-gray-50 ${
            newPanelOpen ? 'max-h-[420px] opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="p-4 space-y-3">
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">
                Project (optional)
              </label>
              <select
                value={newRunProjectId}
                onChange={(e) => {
                  const id = e.target.value;
                  setNewRunProjectId(id);
                  const p = (projectsList as ProjectDto[]).find((x) => x.id === id);
                  if (p?.url) setNewUrl(p.url);
                }}
                className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]"
              >
                <option value="">— None —</option>
                {(projectsList as ProjectDto[]).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.kind})
                  </option>
                ))}
              </select>
              <p className="text-[9px] text-gray-400 mt-1">
                Manage projects under <span className="font-medium">Projects</span> in the sidebar. Selecting a web project fills the URL.
              </p>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">
                App URL
              </label>
              <input
                type="url"
                placeholder="https://myapp.com"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-xs text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">
                Test Name
              </label>
              <input
                type="text"
                placeholder="Login flow test"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-xs text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleStartRecording}
                disabled={!newUrl || !newName}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#4B90FF] text-white text-xs font-medium rounded-md hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play size={12} />
                Start Recording
              </button>
              <button
                onClick={() => setNewPanelOpen(false)}
                className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>

        {/* Steps List */}
        <div ref={stepsListScrollRef} className="flex-1 overflow-y-auto p-4">
          {isRecording && (
            <div className="space-y-2 mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">
                    Recording — {steps.length} steps
                  </span>
                </div>
                <button
                  type="button"
                  disabled={!socketConnected || !runId || aiStepBusy}
                  onClick={openAiStepModal}
                  title={
                    !socketConnected
                      ? 'Wait for preview connection'
                      : 'Add a step that uses an AI prompt at playback'
                  }
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-teal-200 bg-teal-50/80 text-[10px] font-medium text-teal-800 hover:bg-teal-100/80 disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Sparkles size={12} />
                  Add AI Step
                </button>
              </div>
              <button
                type="button"
                disabled={clerkAutoSigningIn || !socketConnected}
                onClick={() => void clerkAutoSignIn(recordingClerkOtpMode)}
                title={
                  !socketConnected
                    ? 'Wait for preview connection'
                    : 'Run Clerk auto sign-in using API credentials (test email or MailSlurp)'
                }
                className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 border border-[#4B90FF]/40 bg-[#4B90FF]/5 text-[#4D65FF] text-[11px] font-medium rounded-md hover:bg-[#4B90FF]/10 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <LogIn size={12} />
                {clerkAutoSigningIn ? 'Signing in…' : 'Sign in automatically'}
              </button>
              {clerkAutoSigningIn && (
                <div
                  role="status"
                  aria-live="polite"
                  className="text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded-md px-2 py-1.5 leading-snug"
                >
                  Running Clerk sign-in in the <strong>remote browser</strong> (server + Playwright). Test-email mode uses
                  code <strong>424242</strong> (no inbox). MailSlurp mode can take <strong>1–2 minutes</strong> waiting for
                  email.
                </div>
              )}
              {clerkAutoSignInError && (
                <p className="text-[10px] text-red-600 bg-red-50 border border-red-100 rounded-md px-2 py-1.5 leading-snug">
                  {clerkAutoSignInError}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
                <label htmlFor="runs-recording-clerk-otp" className="whitespace-nowrap">
                  Clerk OTP
                </label>
                <select
                  id="runs-recording-clerk-otp"
                  value={recordingClerkOtpMode}
                  onChange={(e) => setRecordingClerkOtpMode(e.target.value as AutoClerkOtpUiMode)}
                  disabled={clerkAutoSigningIn}
                  className="flex-1 min-w-[140px] border border-gray-200 rounded-md px-2 py-1 text-[11px] text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 disabled:opacity-50"
                >
                  <option value="default">Server default</option>
                  <option value="clerk_test_email">Test email (424242)</option>
                  <option value="mailslurp">MailSlurp inbox</option>
                </select>
              </div>
              <p className="text-[9px] text-gray-400 leading-snug">
                Set <span className="font-mono">E2E_CLERK_USER_EMAIL</span> with <span className="font-mono">+clerk_test</span>{' '}
                for test-email mode (no real email). Navigate to Clerk sign-in in the preview, then click above.
              </p>
            </div>
          )}

          {!isRecording && isPlaying && (
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-[#56A34A] animate-pulse" />
              <span className="text-[10px] font-semibold text-[#56A34A] uppercase tracking-wider">
                Playing back — {steps.length} steps
              </span>
            </div>
          )}

          {playbackError && (
            <p className="mb-3 text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-md px-2 py-1.5">
              {playbackError}
            </p>
          )}
          {reRecordError && (
            <p className="mb-3 text-[11px] text-red-600 bg-red-50 border border-red-100 rounded-md px-2 py-1.5" role="alert">
              {reRecordError}
            </p>
          )}
          {steps.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <p className="text-xs text-gray-400">
                {isRecording
                  ? 'Waiting for actions...'
                  : selectedRunId
                    ? 'No steps for this run — pick another run or record a new one'
                    : 'Select a run to see steps, or start a new recording'}
              </p>
            </div>
          ) : (
            <div>
              {steps.map((step) => {
                const cp = runCheckpointsRuns.find(
                  (c) => c.afterStepSequence === step.sequence,
                );
                return (
                  <div key={step.id}>
                    <StepCard
                      ref={(el) => {
                        if (el) stepRefsPlayback.current.set(step.sequence, el);
                        else stepRefsPlayback.current.delete(step.sequence);
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
                        effectiveHighlightSequence,
                        completedSequences,
                      )}
                      reRecord={
                        isRecording
                          ? {
                              busy: reRecordBusyStepId === step.id,
                              onSubmit: (instr) => handleReRecordStep(step.id, instr),
                            }
                          : undefined
                      }
                      stepPlayback={
                        canShowStepActions
                          ? {
                              onPlayFromHere: () => void handleStepPlaybackRuns(step.sequence, 'from'),
                              onPlayThisStepOnly: () => void handleStepPlaybackRuns(step.sequence, 'only'),
                              disabled: isPlaying || isRecording || !canPlaybackSelected,
                            }
                          : undefined
                      }
                      checkpointAfterStep={cp ?? undefined}
                      checkpointRunId={cp && effectiveRunId ? effectiveRunId : undefined}
                      aiPromptStep={
                        effectiveRunId && step.runId === effectiveRunId
                          ? {
                              runId: effectiveRunId,
                              stepId: step.id,
                              canTestLive:
                                (isRecording && runId === effectiveRunId) ||
                                (!!playbackSessionId &&
                                  playbackSourceRunId === effectiveRunId),
                              onUpdated: () => {
                                void queryClient.invalidateQueries({
                                  queryKey: ['run-steps', effectiveRunId],
                                });
                                void queryClient.invalidateQueries({
                                  queryKey: ['run', effectiveRunId],
                                });
                                if (isRecording && runId === effectiveRunId) {
                                  void loadRunSteps(effectiveRunId);
                                }
                              },
                            }
                          : undefined
                      }
                      playbackExclusion={
                        canEditPlaybackExclusionRuns && step.runId === effectiveRunId
                          ? {
                              excluded: !!step.excludedFromPlayback,
                              disabled: playbackExclusionBusyStepId === step.id,
                              onToggle: () =>
                                void handleTogglePlaybackExclusionRuns(
                                  step.id,
                                  !step.excludedFromPlayback,
                                ),
                            }
                          : undefined
                      }
                      onStepMutationSuccess={promptAfterStepChange}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Instruction Input (only during recording) */}
        {isRecording && (
          <div className="p-3 border-t border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Type an instruction... (e.g. Click the login button)"
                value={instructionText}
                onChange={(e) => setInstructionText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendInstruction()}
                disabled={isSendingInstruction}
                className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4D65FF]/30 focus:border-[#4D65FF] disabled:opacity-50 bg-white"
              />
              <button
                onClick={handleSendInstruction}
                disabled={!instructionText.trim() || isSendingInstruction}
                className="p-2 bg-[#4D65FF] text-white rounded-md hover:bg-[#3d54e8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Send instruction"
              >
                <Send size={14} />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5 px-1">
              AI will interpret your instruction and execute the Playwright action
            </p>
          </div>
        )}
      </div>

      {aiStepModalOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="runs-ai-step-title"
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
            aria-label="Dismiss"
            disabled={aiStepBusy}
            onClick={() => void closeAiStepModalCancel()}
          />
          <div className="relative w-full max-w-md rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
            <h2 id="runs-ai-step-title" className="text-sm font-semibold text-gray-900">
              Add AI prompt step
            </h2>
            <p className="text-[10px] text-gray-500 mt-1 mb-2 leading-snug">
              Playback runs the LLM with your prompt each time (stored Playwright is for debug only). Reset restores
              the browser to before the last Test, or to the checkpoint after the previous step if you have not tested
              yet.
            </p>
            <textarea
              value={aiStepPrompt}
              onChange={(e) => setAiStepPrompt(e.target.value)}
              rows={4}
              disabled={aiStepBusy}
              placeholder="Describe what to do on the page at this step…"
              className="w-full border border-gray-200 rounded-md px-2 py-1.5 text-[11px] text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 disabled:opacity-50"
            />
            {aiStepError && (
              <p className="mt-2 text-[10px] text-red-600 bg-red-50 border border-red-100 rounded px-2 py-1" role="alert">
                {aiStepError}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={aiStepBusy || !aiStepPrompt.trim() || !!aiStepCreatedId}
                onClick={() => void handleAiStepAddRow()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-[#4B90FF]/40 bg-[#4B90FF]/5 text-[10px] font-medium text-[#2563EB] disabled:opacity-40 disabled:pointer-events-none"
              >
                Add step
              </button>
              <button
                type="button"
                disabled={aiStepBusy || !aiStepCreatedId || !socketConnected}
                onClick={() => void handleAiStepSavePrompt()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-teal-300 text-[10px] font-medium text-teal-800 hover:bg-teal-100/50 disabled:opacity-40 disabled:pointer-events-none"
              >
                Save prompt
              </button>
              <button
                type="button"
                disabled={aiStepBusy || !aiStepCreatedId || !socketConnected}
                title="Run LLM once on the live browser (uses textarea text)"
                onClick={() => void handleAiStepTest()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 bg-white text-[10px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
              >
                <FlaskConical size={12} />
                Test
              </button>
              <button
                type="button"
                disabled={aiStepBusy || !aiStepCreatedId || !socketConnected}
                title="Undo Test side effects (or restore prior checkpoint)"
                onClick={() => void handleAiStepReset()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-[10px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
              >
                <RotateCcw size={12} />
                Reset
              </button>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                disabled={aiStepBusy}
                onClick={() => void closeAiStepModalCancel()}
                className="px-3 py-1.5 text-[11px] text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={aiStepBusy}
                onClick={closeAiStepModalDone}
                className="px-3 py-1.5 text-[11px] font-medium text-white bg-[#4B90FF] rounded-md hover:bg-blue-500 disabled:opacity-40"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <SkipReplaySuggestionsModal
        open={skipReplayModalOpen}
        anchorStepId={skipReplayAnchorStepId}
        suggestions={skipReplaySuggestions}
        stepsForLookup={steps.map((s) => ({
          id: s.id,
          sequence: s.sequence,
          instruction: s.instruction,
        }))}
        busy={skipReplayBusy}
        onConfirm={() => void confirmSkipReplaySuggestions()}
        onDismiss={dismissSkipReplayModal}
      />
    </div>
  );
}
