import { useState, useEffect, useRef, forwardRef, useCallback, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ChevronDown,
  ChevronRight,
  Mouse,
  Type,
  Navigation,
  ScrollText,
  Pointer,
  Eye,
  Camera,
  CheckCircle,
  Clock,
  Sparkles,
  Hand,
  RotateCcw,
  Play,
  FlaskConical,
  Wand2,
  Terminal,
  Loader2,
} from 'lucide-react';
import { runsApi } from '@/lib/api';
import type { CheckpointData } from '@/components/ui/CheckpointDivider';
import { AiPromptReviewModal } from '@/components/ui/AiPromptReviewModal';
import type { AiPromptTestProgressPayload } from '@/hooks/useRecording';
import { parseAiPromptLastLlmTranscript } from '@/lib/aiPromptLastLlmTranscript';
import { aiPromptCodegenOkForInstruction } from '@/lib/aiPromptStepMetadata';
import { buildAiPromptDrawerSections } from '@/lib/buildAiPromptDrawerSections';
import { parseOptimizedPromptStored } from '@/lib/optimizedPromptMetadata';
import { AiPromptProgressSections } from '@/components/ui/AiPromptProgressSections';

export type PlaybackHighlight = 'past' | 'current' | 'future';

export type PlaybackAiPromptIconPhase = 'idle' | 'busy' | 'done';

export type PlaybackAiPromptStatus = {
  ai: PlaybackAiPromptIconPhase;
  playwright: PlaybackAiPromptIconPhase;
};

interface StepCardProps {
  sequence: number;
  action: string;
  instruction: string;
  playwrightCode: string;
  origin: 'MANUAL' | 'AI_DRIVEN' | 'AI_PROMPT' | 'AUTOMATIC';
  timestamp: string;
  /** From API `RunStep.metadata` — used to flag single-step Clerk auto sign-in as **Automatic** when origin was stored as MANUAL. */
  metadata?: unknown;
  /** During test replay: visual emphasis synced with playback progress */
  playbackHighlight?: PlaybackHighlight;
  /** When set (e.g. during recording), show inline re-capture for this step */
  reRecord?: {
    onSubmit: (instruction: string) => Promise<void>;
    busy: boolean;
  };
  /** Completed-run playback: start live replay from this step, or only this step */
  stepPlayback?: {
    onPlayFromHere: () => void;
    onPlayThisStepOnly: () => void;
    disabled?: boolean;
  };
  /** AI prompt step: PATCH + Generate / Run / Reset (requires active recording or playback session for test). */
  aiPromptStep?: {
    runId: string;
    stepId: string;
    canTestLive: boolean;
    onUpdated: () => void;
  };
  /** After a successful instruction / AI mode save for this step (e.g. skip-replay suggestions). */
  onStepMutationSuccess?: (stepId: string) => void;
  /** When set, show a small “after step” checkpoint thumbnail on the right (no extra row). */
  checkpointAfterStep?: CheckpointData;
  /** Required with `checkpointAfterStep` to load the thumbnail */
  checkpointRunId?: string;
  /** Mark step to skip during playback (completed runs). */
  playbackExclusion?: {
    excluded: boolean;
    disabled?: boolean;
    onToggle: () => void;
  };
  /** Live replay: LLM vs Playwright progress for AI prompt steps only. */
  playbackAiPromptStatus?: PlaybackAiPromptStatus;
  /** Live AI prompt test progress for this step (recording or playback socket). */
  aiPromptLiveProgress?: AiPromptTestProgressPayload | null;
  /**
   * Recording/playback socket connected — when false, disable Generate / Run / Reset.
   * Omit or leave true when not applicable (backward compatible).
   */
  aiPromptSocketConnected?: boolean;
  /**
   * Live playback only: after a successful **Run on page** test (or internal full-pipeline flows like adopt), parent
   * advances the replay cursor (same as completing the step via the playback loop).
   */
  onAiPromptPlaybackRunSucceeded?: (stepSequence: number) => void;
}

const ACTION_ICONS: Record<string, typeof Mouse> = {
  CLICK: Mouse,
  TYPE: Type,
  NAVIGATE: Navigation,
  SCROLL: ScrollText,
  HOVER: Pointer,
  SELECT: Eye,
  SCREENSHOT: Camera,
  ASSERT: CheckCircle,
  WAIT: Clock,
  CUSTOM: Sparkles,
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const HIGHLIGHT_RING: Record<PlaybackHighlight, string> = {
  current: 'ring-2 ring-[#4B90FF] ring-offset-2 ring-offset-white shadow-md',
  past: 'opacity-55',
  future: 'opacity-90',
};

function ReviewList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-1 text-[10px] leading-snug text-gray-700">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-1.5">
          <span className="mt-[2px] text-gray-400">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function playbackAiPromptPhaseClass(phase: PlaybackAiPromptIconPhase): string {
  if (phase === 'idle') return 'text-gray-300';
  if (phase === 'busy') return 'playback-ai-pw-blink';
  return 'text-blue-600';
}

function PlaybackAiPromptIcons({ status }: { status: PlaybackAiPromptStatus }) {
  return (
    <span className="inline-flex items-center gap-0.5 shrink-0" aria-hidden>
      <span className="inline-flex" title="LLM">
        <Sparkles size={11} className={playbackAiPromptPhaseClass(status.ai)} strokeWidth={2} />
      </span>
      <span className="inline-flex" title="Playwright">
        <Terminal size={11} className={playbackAiPromptPhaseClass(status.playwright)} strokeWidth={2} />
      </span>
    </span>
  );
}

function AfterStepThumbnail({ runId, checkpoint }: { runId: string; checkpoint: CheckpointData }) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!checkpoint.thumbnailPath) {
      setThumbUrl(null);
      return;
    }
    let cancelled = false;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setThumbUrl(null);
    runsApi.getCheckpointThumbnailUrl(runId, checkpoint.id).then((url) => {
      if (cancelled || !url) return;
      urlRef.current = url;
      setThumbUrl(url);
    });
    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [runId, checkpoint.id, checkpoint.thumbnailPath]);

  const title = checkpoint.label?.trim() || `After step ${checkpoint.afterStepSequence}`;

  return (
    <div
      className="flex-shrink-0 self-center h-8 w-14 rounded overflow-hidden border border-gray-100 bg-gray-50 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.03)]"
      title={title}
    >
      {thumbUrl ? (
        <img src={thumbUrl} alt={title} className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full flex items-center justify-center bg-gray-50/80">
          <Camera size={12} className="text-gray-200" aria-hidden />
        </div>
      )}
    </div>
  );
}

export const StepCard = forwardRef<HTMLDivElement, StepCardProps>(function StepCard(
  {
    sequence,
    action,
    instruction,
    playwrightCode,
    origin,
    timestamp,
    metadata,
    playbackHighlight,
    reRecord,
    stepPlayback,
    aiPromptStep,
    checkpointAfterStep,
    checkpointRunId,
    playbackExclusion,
    onStepMutationSuccess,
    playbackAiPromptStatus,
    aiPromptLiveProgress = null,
    aiPromptSocketConnected = true,
    onAiPromptPlaybackRunSucceeded,
  },
  ref,
) {
  /** Collapsed by default: playback actions, re-record, Playwright code */
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reDraft, setReDraft] = useState('');
  const [promptDraft, setPromptDraft] = useState(instruction);
  const [enableAiDraft, setEnableAiDraft] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showEnableAi, setShowEnableAi] = useState(false);
  const [aiPromptLlmOpen, setAiPromptLlmOpen] = useState(false);
  /** Structured failure from API (LLM explanation + suggested prompt). */
  const [aiTestFailureDialog, setAiTestFailureDialog] = useState<{
    error: string;
    explanation: string;
    suggestedPrompt: string;
  } | null>(null);

  useEffect(() => {
    setPromptDraft(instruction);
  }, [instruction]);

  const adoptSuggestedAiPrompt = useCallback(async () => {
    if (!aiPromptStep || !aiTestFailureDialog) return;
    const next = aiTestFailureDialog.suggestedPrompt.trim();
    if (!next) return;
    setAiBusy(true);
    setAiError(null);
    try {
      await runsApi.patchRunStep(aiPromptStep.runId, aiPromptStep.stepId, { instruction: next });
      setPromptDraft(next);
      await runsApi.resetAiPromptTest(aiPromptStep.runId, aiPromptStep.stepId);
      const res = await runsApi.testAiPromptStep(aiPromptStep.runId, aiPromptStep.stepId, {
        instruction: next,
        phase: 'full',
      });
      setAiTestFailureDialog(null);
      if (res.cancelled) return;
      if (!res.ok) {
        if (res.failureHelp) {
          setAiTestFailureDialog({
            error: res.error || 'Test failed',
            explanation: res.failureHelp.explanation,
            suggestedPrompt: res.failureHelp.suggestedPrompt,
          });
        } else {
          setAiError(res.error || 'Test failed');
        }
        return;
      }
      aiPromptStep.onUpdated();
      onAiPromptPlaybackRunSucceeded?.(sequence);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }, [aiPromptStep, aiTestFailureDialog, sequence, onAiPromptPlaybackRunSucceeded]);

  const aiPromptDrawerSections = useMemo(
    () =>
      buildAiPromptDrawerSections({
        cached: parseAiPromptLastLlmTranscript(metadata),
        metaPw: playwrightCode.trim(),
        live: aiPromptLiveProgress,
        busyWithNoLive: aiBusy && !aiPromptLiveProgress,
      }),
    [metadata, playwrightCode, aiPromptLiveProgress, aiBusy],
  );

  const canRunPlaywrightOnPage = aiPromptCodegenOkForInstruction(metadata, promptDraft.trim());
  const optimizedPrompt = useMemo(() => parseOptimizedPromptStored(metadata), [metadata]);

  const runAiPromptPhase = useCallback(
    async (phase: 'generate' | 'run' | 'full') => {
      if (!aiPromptStep) return;
      setAiBusy(true);
      setAiError(null);
      setAiTestFailureDialog(null);
      try {
        const res = await runsApi.testAiPromptStep(aiPromptStep.runId, aiPromptStep.stepId, {
          instruction: promptDraft.trim(),
          phase,
        });
        if (res.cancelled) return;
        if (!res.ok) {
          if (res.failureHelp) {
            setAiTestFailureDialog({
              error: res.error || 'Test failed',
              explanation: res.failureHelp.explanation,
              suggestedPrompt: res.failureHelp.suggestedPrompt,
            });
          } else {
            setAiError(res.error || 'Test failed');
          }
          return;
        }
        aiPromptStep.onUpdated();
        if (phase === 'run' || phase === 'full') {
          onAiPromptPlaybackRunSucceeded?.(sequence);
        }
      } catch (e) {
        setAiError(e instanceof Error ? e.message : String(e));
      } finally {
        setAiBusy(false);
      }
    },
    [aiPromptStep, promptDraft, sequence, onAiPromptPlaybackRunSucceeded],
  );

  const handleAiPromptReset = useCallback(async () => {
    if (!aiPromptStep || aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    try {
      await runsApi.resetAiPromptTest(aiPromptStep.runId, aiPromptStep.stepId);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }, [aiPromptStep, aiBusy]);

  const aiRemoteActionsDisabled =
    aiBusy || !aiPromptStep?.canTestLive || !aiPromptSocketConnected;

  const Icon = ACTION_ICONS[action] || Hand;
  const metadataKind =
    metadata && typeof metadata === 'object' ? ((metadata as { kind?: string }).kind ?? null) : null;
  const isAiPromptStep = origin === 'AI_PROMPT';
  const isAILlmGenerated = origin === 'AI_DRIVEN' && !isAiPromptStep;
  const isClerkAutoSignInStep =
    (metadata &&
      typeof metadata === 'object' &&
      (metadata as { kind?: string }).kind === 'clerk_auto_sign_in') ||
    /^\s*Automatic Clerk sign-in/i.test(instruction);
  const showAsAutomatic = origin === 'AUTOMATIC' || isClerkAutoSignInStep;

  const highlightClass = playbackHighlight ? HIGHLIGHT_RING[playbackHighlight] : '';

  const originBorder = showAsAutomatic
    ? 'border-l-[#4B90FF]'
    : isAiPromptStep
      ? 'border-l-teal-500'
      : isAILlmGenerated
        ? 'border-l-[#4D65FF]'
        : 'border-l-gray-300';
  const originBadgeBg = showAsAutomatic
    ? 'rounded-full px-2 py-0.5 bg-[#4B90FF] text-white shadow-sm'
    : isAiPromptStep
      ? 'rounded-full px-2 py-0.5 bg-emerald-600 text-white shadow-sm'
      : isAILlmGenerated
        ? 'rounded-full px-2 py-0.5 bg-[#4D65FF]/10 text-[#4D65FF]'
        : 'rounded-full px-2 py-0.5 bg-gray-100 text-gray-400';
  const originCircle = showAsAutomatic
    ? 'bg-[#4B90FF]/15 text-[#2563EB]'
    : isAiPromptStep
      ? 'bg-teal-500/10 text-teal-700'
      : isAILlmGenerated
        ? 'bg-[#4D65FF]/10 text-[#4D65FF]'
        : 'bg-gray-100 text-gray-500';
  const originLabel = isAiPromptStep
    ? 'AI prompt'
    : isAILlmGenerated
      ? 'AI'
      : showAsAutomatic
        ? 'Automatic'
        : 'Manual';

  const showAfterThumb = checkpointAfterStep && checkpointRunId;

  return (
    <>
    <div
      ref={ref}
      className={`group relative border-l-3 rounded-r-lg bg-white border border-gray-100 mb-1.5 transition-all duration-200 hover:shadow-sm ${originBorder} ${highlightClass} ${
        playbackExclusion?.excluded ? 'ring-1 ring-amber-200/90 bg-amber-50/40' : ''
      }`}
    >
      <div
        className={`flex items-start gap-2 px-2 ${
          !detailsOpen ? 'max-h-[80px] min-h-0 overflow-hidden py-1' : 'py-1.5'
        }`}
      >
        <div
          className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${originCircle}`}
        >
          {sequence}
        </div>

        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <div
            className={`flex items-center gap-1 flex-wrap flex-shrink-0 ${!detailsOpen ? 'mb-0' : 'mb-0.5'}`}
          >
            <Icon size={11} className="text-gray-400 flex-shrink-0" />
            <span className="text-[9px] text-gray-400 ce-mono">{formatTime(timestamp)}</span>
            {playbackAiPromptStatus && <PlaybackAiPromptIcons status={playbackAiPromptStatus} />}
            {playbackExclusion && (
              <label
                className="inline-flex items-center gap-0.5 shrink-0 cursor-pointer select-none"
                title="Skip this step during playback (step stays in the list)"
              >
                <input
                  type="checkbox"
                  className="h-2.5 w-2.5 rounded border-amber-300 text-amber-600 focus:ring-amber-500/30"
                  checked={playbackExclusion.excluded}
                  disabled={playbackExclusion.disabled}
                  onChange={() => playbackExclusion.onToggle()}
                />
                <span className="text-[8px] font-medium text-amber-900/80">Skip replay</span>
              </label>
            )}
            {isAiPromptStep ? (
              <AiPromptReviewModal
                open={aiPromptLlmOpen}
                onOpenChange={setAiPromptLlmOpen}
                metadata={metadata}
                trigger={
                  <button
                    type="button"
                    title="View exact LLM prompt and response"
                    className={`text-[8px] font-semibold uppercase tracking-wider ${originBadgeBg} border-0 p-0 font-inherit cursor-pointer hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/80 rounded-full`}
                  >
                    {originLabel}
                  </button>
                }
              />
            ) : (
              <span className={`text-[8px] font-semibold uppercase tracking-wider ${originBadgeBg}`}>
                {originLabel}
              </span>
            )}
          </div>
          <p
            className={`text-[11px] leading-snug min-w-0 ${
              !detailsOpen ? 'line-clamp-1' : ''
            } ${
              playbackExclusion?.excluded ? 'text-gray-400 line-through decoration-gray-300/90' : 'text-gray-700'
            }`}
            title={!detailsOpen && instruction.length > 80 ? instruction : undefined}
          >
            {isAiPromptStep ? (
              <>
                Prompt: {instruction}
              </>
            ) : (
              instruction
            )}
          </p>
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            className={`inline-flex shrink-0 items-center gap-1 text-[9px] font-medium text-[#4D65FF] hover:text-[#3d54e8] hover:underline ${
              !detailsOpen ? 'mt-0.5' : 'mt-1'
            }`}
          >
            {detailsOpen ? (
              <>
                <ChevronDown size={12} className="flex-shrink-0" />
                Hide step details
              </>
            ) : (
              <>
                <ChevronRight size={12} className="flex-shrink-0" />
                Show step details
              </>
            )}
          </button>
        </div>

        {showAfterThumb && (
          <AfterStepThumbnail runId={checkpointRunId} checkpoint={checkpointAfterStep} />
        )}
      </div>

      {detailsOpen && (
        <div className="px-2 pb-2 pt-0 border-t border-gray-50">
          {stepPlayback && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={stepPlayback.disabled}
                onClick={() => stepPlayback.onPlayFromHere()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[#4B90FF]/40 bg-[#4B90FF]/5 text-[10px] font-medium text-[#2563EB] hover:bg-[#4B90FF]/10 disabled:opacity-40 disabled:pointer-events-none"
                title="Live replay: skip earlier steps and run from this one"
              >
                <Play size={12} />
                Play from here
              </button>
              <button
                type="button"
                disabled={stepPlayback.disabled}
                onClick={() => stepPlayback.onPlayThisStepOnly()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-gray-200 text-[10px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
                title="Live replay: run only this step’s Playwright code"
              >
                This step only
              </button>
            </div>
          )}
          {reRecord && (
            <div className="mb-2 flex flex-col gap-1.5">
              <input
                type="text"
                value={reDraft}
                onChange={(e) => setReDraft(e.target.value)}
                placeholder="Re-record this step (instruction)…"
                disabled={reRecord.busy}
                className="w-full border border-gray-200 rounded-md px-2 py-1 text-[11px] text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#4D65FF]/40 disabled:opacity-50"
              />
              <button
                type="button"
                disabled={!reDraft.trim() || reRecord.busy}
                onClick={() => void reRecord.onSubmit(reDraft.trim()).then(() => setReDraft(''))}
                className="self-start inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-[10px] font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
              >
                <RotateCcw size={12} />
                {reRecord.busy ? 'Re-recording…' : 'Re-record step'}
              </button>
            </div>
          )}
          {aiPromptStep && !isClerkAutoSignInStep && (
            <div className="mb-2 rounded-md border border-teal-100 bg-teal-50/40 p-2 space-y-2">
              <p className="text-[9px] font-semibold uppercase tracking-wide text-teal-700">
                AI prompt step
              </p>
              {isAiPromptStep ? (
                <>
                  <p className="text-[9px] text-gray-500 leading-snug">
                    <strong>Save prompt</strong> updates stored text. <strong>Generate</strong> runs vision + codegen.{' '}
                    <strong>Run on page</strong> executes generated Playwright on the live browser (after a successful
                    Generate for this exact text). <strong>Reset</strong> undoes test side effects.
                  </p>
                  <textarea
                    value={promptDraft}
                    onChange={(e) => setPromptDraft(e.target.value)}
                    rows={3}
                    disabled={aiBusy}
                    className="w-full border border-teal-200/80 rounded-md px-2 py-1.5 text-[11px] text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-teal-500/40 disabled:opacity-50"
                    placeholder="Describe what to do on the page at this step…"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      disabled={
                        aiBusy ||
                        !promptDraft.trim() ||
                        promptDraft.trim() === instruction ||
                        !aiPromptSocketConnected
                      }
                      onClick={() => {
                        setAiBusy(true);
                        setAiError(null);
                        void runsApi
                          .patchRunStep(aiPromptStep.runId, aiPromptStep.stepId, {
                            instruction: promptDraft.trim(),
                          })
                          .then(() => {
                            aiPromptStep.onUpdated();
                            onStepMutationSuccess?.(aiPromptStep.stepId);
                          })
                          .catch((e) => {
                            setAiError(e instanceof Error ? e.message : String(e));
                          })
                          .finally(() => setAiBusy(false));
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-teal-300 text-[10px] font-medium text-teal-800 hover:bg-teal-100/50 disabled:opacity-40"
                    >
                      Save prompt
                    </button>
                    <button
                      type="button"
                      disabled={aiRemoteActionsDisabled || !promptDraft.trim()}
                      title="Vision + LLM: generate Playwright only (does not run on the page yet)"
                      onClick={() => void runAiPromptPhase('generate')}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 bg-white text-[10px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <FlaskConical size={12} />
                      Generate
                    </button>
                    <button
                      type="button"
                      disabled={
                        aiRemoteActionsDisabled ||
                        !promptDraft.trim() ||
                        !canRunPlaywrightOnPage
                      }
                      title={
                        canRunPlaywrightOnPage
                          ? 'Run the generated Playwright on the live browser'
                          : 'Generate Playwright for this prompt first (same text as the last successful codegen)'
                      }
                      onClick={() => void runAiPromptPhase('run')}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 bg-white text-[10px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <Play size={12} />
                      Run on page
                    </button>
                    <button
                      type="button"
                      disabled={aiRemoteActionsDisabled}
                      title="Undo test side effects (or restore prior checkpoint)"
                      onClick={() => void handleAiPromptReset()}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-[10px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:pointer-events-none"
                    >
                      <RotateCcw size={12} />
                      Reset
                    </button>
                  </div>
                  {aiBusy ? (
                    <div
                      className="mt-2 flex items-stretch gap-2 rounded border border-teal-100 bg-teal-50/50 px-2 py-1.5"
                      role="status"
                      aria-live="polite"
                    >
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin self-center text-teal-600" aria-hidden />
                      <p
                        className="min-w-0 flex-1 text-[10px] text-gray-800 leading-snug"
                        title={aiPromptLiveProgress?.message ?? undefined}
                      >
                        {aiPromptLiveProgress?.message || 'Starting test…'}
                      </p>
                    </div>
                  ) : null}
                  <AiPromptProgressSections sections={aiPromptDrawerSections} className="mt-2 space-y-3" />
                </>
              ) : (
                <>
                  {!showEnableAi ? (
                    <button
                      type="button"
                      disabled={aiBusy}
                      onClick={() => {
                        setShowEnableAi(true);
                        setEnableAiDraft(instruction);
                      }}
                      className="text-[10px] font-medium text-teal-700 hover:underline"
                    >
                      Use AI prompt for this step (playback uses LLM + live page)
                    </button>
                  ) : (
                    <div className="space-y-1.5">
                      <textarea
                        value={enableAiDraft}
                        onChange={(e) => setEnableAiDraft(e.target.value)}
                        rows={3}
                        disabled={aiBusy}
                        className="w-full border border-teal-200/80 rounded-md px-2 py-1.5 text-[11px] text-gray-800 focus:outline-none focus:ring-1 focus:ring-teal-500/40"
                        placeholder="Prompt for this step…"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          disabled={aiBusy || !enableAiDraft.trim()}
                          onClick={() => {
                            setAiBusy(true);
                            setAiError(null);
                            void runsApi
                              .patchRunStep(aiPromptStep.runId, aiPromptStep.stepId, {
                                instruction: enableAiDraft.trim(),
                                aiPromptMode: true,
                              })
                              .then(() => {
                                setShowEnableAi(false);
                                aiPromptStep.onUpdated();
                                onStepMutationSuccess?.(aiPromptStep.stepId);
                              })
                              .catch((e) => {
                                setAiError(e instanceof Error ? e.message : String(e));
                              })
                              .finally(() => setAiBusy(false));
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-teal-400 bg-teal-600/90 text-white text-[10px] font-medium hover:bg-teal-600 disabled:opacity-40"
                        >
                          Save as AI prompt step
                        </button>
                        <button
                          type="button"
                          disabled={aiBusy}
                          onClick={() => setShowEnableAi(false)}
                          className="text-[10px] text-gray-500 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
              {aiError && !aiTestFailureDialog && (
                <p className="text-[10px] text-red-600 bg-red-50 border border-red-100 rounded px-1.5 py-1" role="alert">
                  {aiError}
                </p>
              )}
            </div>
          )}
          {optimizedPrompt && (
            <div className="mb-2 rounded-md border border-violet-200 bg-violet-50/40 p-2.5">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-violet-700">
                  Optimized prompt
                </p>
                <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide text-violet-700">
                  Review only
                </span>
                <span className="rounded-full bg-white/90 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide text-violet-700/80">
                  {Math.round(optimizedPrompt.confidence * 100)}% confidence
                </span>
              </div>
              <div className="space-y-2">
                <div>
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                    Canonical playback prompt
                  </p>
                  <pre className="whitespace-pre-wrap break-words rounded-md border border-violet-100 bg-white/90 px-2 py-1.5 text-[11px] leading-relaxed text-gray-800">
                    {optimizedPrompt.canonical_playback_prompt}
                  </pre>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                      Intent summary
                    </p>
                    <p className="text-[10px] leading-snug text-gray-700">
                      {optimizedPrompt.step_intent_summary}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                      Semantic target
                    </p>
                    <p className="text-[10px] leading-snug text-gray-700">
                      {optimizedPrompt.target_semantic_description}
                    </p>
                  </div>
                </div>
                {(optimizedPrompt.business_object || optimizedPrompt.input_or_selection_value) && (
                  <div className="grid gap-2 md:grid-cols-2">
                    {optimizedPrompt.business_object && (
                      <div>
                        <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                          Business object
                        </p>
                        <p className="text-[10px] leading-snug text-gray-700">
                          {optimizedPrompt.business_object}
                        </p>
                      </div>
                    )}
                    {optimizedPrompt.input_or_selection_value && (
                      <div>
                        <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                          Input / selection value
                        </p>
                        <p className="text-[10px] leading-snug text-gray-700">
                          {optimizedPrompt.input_or_selection_value}
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {optimizedPrompt.preconditions.length > 0 && (
                  <div>
                    <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                      Preconditions
                    </p>
                    <ReviewList items={optimizedPrompt.preconditions} />
                  </div>
                )}
                {optimizedPrompt.expected_outcome.length > 0 && (
                  <div>
                    <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                      Expected outcome
                    </p>
                    <ReviewList items={optimizedPrompt.expected_outcome} />
                  </div>
                )}
                {optimizedPrompt.disambiguation_hints.length > 0 && (
                  <div>
                    <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                      Disambiguation hints
                    </p>
                    <ReviewList items={optimizedPrompt.disambiguation_hints} />
                  </div>
                )}
                {optimizedPrompt.do_not_depend_on.length > 0 && (
                  <div>
                    <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                      Do not depend on
                    </p>
                    <ReviewList items={optimizedPrompt.do_not_depend_on} />
                  </div>
                )}
                {optimizedPrompt.uncertainty_notes.length > 0 && (
                  <div>
                    <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-gray-500">
                      Uncertainty notes
                    </p>
                    <ReviewList items={optimizedPrompt.uncertainty_notes} />
                  </div>
                )}
              </div>
            </div>
          )}
          <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
            {isAiPromptStep ? 'Last generated / stored Playwright (debug)' : 'Playwright code'}
          </p>
          <pre className="text-[11px] ce-mono bg-gray-50 rounded-md p-2.5 text-gray-600 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
            {playwrightCode}
          </pre>
        </div>
      )}
    </div>

    <Dialog.Root open={!!aiTestFailureDialog} onOpenChange={(open) => !open && setAiTestFailureDialog(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[102] bg-black/45" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[103] flex max-h-[85vh] w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-xl outline-none">
          <Dialog.Title className="text-sm font-semibold text-gray-900">Test failed</Dialog.Title>
          <Dialog.Description className="sr-only">
            Explanation and suggested prompt from the model. You can adopt the suggested prompt to replace yours and re-run the test.
          </Dialog.Description>
          {aiTestFailureDialog && (
            <>
              <p className="mt-1 text-[10px] text-red-700/90 font-mono leading-snug break-words border border-red-100 bg-red-50/80 rounded px-2 py-1.5">
                {aiTestFailureDialog.error}
              </p>
              <div className="mt-3 space-y-1.5">
                <p className="text-[10px] font-semibold text-gray-600">What went wrong</p>
                <div className="max-h-[min(40vh,240px)] overflow-y-auto rounded border border-gray-100 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {aiTestFailureDialog.explanation}
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                <p className="text-[10px] font-semibold text-gray-600">Suggested prompt</p>
                <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded border border-teal-100 bg-teal-50/50 px-2 py-1.5 font-mono text-[10px] text-gray-800 leading-snug">
                  {aiTestFailureDialog.suggestedPrompt}
                </pre>
              </div>
              <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-gray-100 pt-3">
                <Dialog.Close asChild>
                  <button
                    type="button"
                    className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Close
                  </button>
                </Dialog.Close>
                <button
                  type="button"
                  disabled={aiBusy || !aiPromptSocketConnected}
                  onClick={() => void adoptSuggestedAiPrompt()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-teal-500 bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700 disabled:opacity-40"
                >
                  <Wand2 size={14} aria-hidden />
                  Adopt this prompt
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    </>
  );
});
