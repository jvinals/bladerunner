import { useState, useEffect, useRef, forwardRef, useCallback } from 'react';
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
  Copy,
  X,
} from 'lucide-react';
import { runsApi } from '@/lib/api';
import type { CheckpointData } from '@/components/ui/CheckpointDivider';

export type PlaybackHighlight = 'past' | 'current' | 'future';

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
  /** AI prompt step: PATCH + Test Step (requires active recording or playback session for test). */
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

/** From `RunStep.metadata.lastLlmTranscript` (AI prompt steps). */
function parseAiPromptLastLlmTranscript(metadata: unknown): {
  systemPrompt: string;
  userPrompt: string;
  rawResponse: string;
  visionAttached?: boolean;
  screenshotBase64?: string;
  capturedAt?: string;
  source?: string;
} | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const t = (metadata as Record<string, unknown>).lastLlmTranscript;
  if (!t || typeof t !== 'object') return null;
  const o = t as Record<string, unknown>;
  if (
    typeof o.systemPrompt !== 'string' ||
    typeof o.userPrompt !== 'string' ||
    typeof o.rawResponse !== 'string'
  ) {
    return null;
  }
  return {
    systemPrompt: o.systemPrompt,
    userPrompt: o.userPrompt,
    rawResponse: o.rawResponse,
    visionAttached: typeof o.visionAttached === 'boolean' ? o.visionAttached : undefined,
    screenshotBase64: typeof o.screenshotBase64 === 'string' && o.screenshotBase64.trim() ? o.screenshotBase64 : undefined,
    capturedAt: typeof o.capturedAt === 'string' ? o.capturedAt : undefined,
    source: typeof o.source === 'string' ? o.source : undefined,
  };
}

const HIGHLIGHT_RING: Record<PlaybackHighlight, string> = {
  current: 'ring-2 ring-[#4B90FF] ring-offset-2 ring-offset-white shadow-md',
  past: 'opacity-55',
  future: 'opacity-90',
};

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
  const [aiPromptScreenshotZoomOpen, setAiPromptScreenshotZoomOpen] = useState(false);
  const [screenshotCopyStatus, setScreenshotCopyStatus] = useState<'idle' | 'copied' | 'copiedText' | 'error'>('idle');

  useEffect(() => {
    setPromptDraft(instruction);
  }, [instruction]);

  useEffect(() => {
    if (!aiPromptLlmOpen) {
      setAiPromptScreenshotZoomOpen(false);
    }
  }, [aiPromptLlmOpen]);

  useEffect(() => {
    if (!aiPromptScreenshotZoomOpen) {
      setScreenshotCopyStatus('idle');
    }
  }, [aiPromptScreenshotZoomOpen]);

  const copyLlmScreenshotToClipboard = useCallback(async (b64: string) => {
    setScreenshotCopyStatus('idle');
    try {
      const res = await fetch(`data:image/jpeg;base64,${b64}`);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/jpeg': blob })]);
      setScreenshotCopyStatus('copied');
      window.setTimeout(() => setScreenshotCopyStatus('idle'), 2500);
    } catch {
      try {
        await navigator.clipboard.writeText(b64);
        setScreenshotCopyStatus('copiedText');
        window.setTimeout(() => setScreenshotCopyStatus('idle'), 3500);
      } catch {
        setScreenshotCopyStatus('error');
        window.setTimeout(() => setScreenshotCopyStatus('idle'), 3500);
      }
    }
  }, []);

  const Icon = ACTION_ICONS[action] || Hand;
  const isAiPromptStep =
    origin === 'AI_PROMPT' ||
    (metadata &&
      typeof metadata === 'object' &&
      (metadata as { kind?: string }).kind === 'ai_prompt_step');
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
  const lastLlmTranscript = isAiPromptStep ? parseAiPromptLastLlmTranscript(metadata) : null;

  return (
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
              <>
                <Dialog.Root open={aiPromptLlmOpen} onOpenChange={setAiPromptLlmOpen}>
                  <Dialog.Trigger asChild>
                    <button
                      type="button"
                      title="View exact LLM prompt and response"
                      className={`text-[8px] font-semibold uppercase tracking-wider ${originBadgeBg} border-0 p-0 font-inherit cursor-pointer hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/80 rounded-full`}
                    >
                      {originLabel}
                    </button>
                  </Dialog.Trigger>
                  <Dialog.Portal>
                    <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/45" />
                    <Dialog.Content className="fixed left-1/2 top-1/2 z-[101] flex max-h-[85vh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-gray-200 bg-white p-4 shadow-xl outline-none">
                      <Dialog.Title className="text-sm font-semibold text-gray-900">AI prompt — LLM transcript</Dialog.Title>
                      <Dialog.Description className="sr-only">
                        Exact system prompt, user prompt, and raw model response from the last test or playback run.
                      </Dialog.Description>
                      {lastLlmTranscript?.screenshotBase64 ? (
                        <div className="mt-2 space-y-1.5">
                          <div className="text-[10px] font-semibold text-gray-600">Screenshot sent to the LLM (JPEG)</div>
                          <p className="text-[9px] text-gray-500">Click the preview for full size, scroll, and copy.</p>
                          <div className="max-h-[min(50vh,420px)] overflow-auto rounded border border-gray-200 bg-gray-50 p-1">
                            <button
                              type="button"
                              onClick={() => setAiPromptScreenshotZoomOpen(true)}
                              className="block w-full cursor-zoom-in rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/80"
                              title="Open full-size screenshot"
                            >
                              <img
                                src={`data:image/jpeg;base64,${lastLlmTranscript.screenshotBase64}`}
                                alt="Page screenshot as attached to the vision model for this request"
                                className="mx-auto max-w-full h-auto"
                              />
                            </button>
                          </div>
                        </div>
                      ) : lastLlmTranscript?.visionAttached ? (
                      <p className="mt-2 text-[10px] leading-snug text-amber-900/90 rounded bg-amber-50 px-2 py-1.5 border border-amber-100">
                        A JPEG screenshot was attached to this LLM request, but it was not stored in this transcript (re-run
                        Test step or playback to capture it).
                      </p>
                    ) : null}
                    {lastLlmTranscript?.capturedAt ? (
                      <p className="mt-2 text-[10px] text-gray-500">
                        Last captured {new Date(lastLlmTranscript.capturedAt).toLocaleString()}
                        {lastLlmTranscript.source ? ` (${lastLlmTranscript.source})` : ''}
                      </p>
                    ) : null}
                    {!lastLlmTranscript ? (
                      <p className="mt-3 text-sm text-gray-600">
                        No transcript yet. Run Test step or playback once to capture the exact prompt and response.
                      </p>
                    ) : (
                      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto text-left">
                        <div>
                          <div className="mb-1 text-[10px] font-semibold text-gray-600">System prompt</div>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-100 bg-gray-50 p-2 font-mono text-[10px] leading-snug text-gray-800">
                            {lastLlmTranscript.systemPrompt}
                          </pre>
                        </div>
                        <div>
                          <div className="mb-1 text-[10px] font-semibold text-gray-600">User prompt</div>
                          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-100 bg-gray-50 p-2 font-mono text-[10px] leading-snug text-gray-800">
                            {lastLlmTranscript.userPrompt}
                          </pre>
                        </div>
                        <div>
                          <div className="mb-1 text-[10px] font-semibold text-gray-600">Raw response</div>
                          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-gray-100 bg-gray-50 p-2 font-mono text-[10px] leading-snug text-gray-800">
                            {lastLlmTranscript.rawResponse}
                          </pre>
                        </div>
                      </div>
                    )}
                      <div className="mt-4 flex justify-end border-t border-gray-100 pt-3">
                        <Dialog.Close asChild>
                          <button
                            type="button"
                            className="rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-200"
                          >
                            Close
                          </button>
                        </Dialog.Close>
                      </div>
                    </Dialog.Content>
                  </Dialog.Portal>
                </Dialog.Root>
                {lastLlmTranscript?.screenshotBase64 ? (
                  <Dialog.Root open={aiPromptScreenshotZoomOpen} onOpenChange={setAiPromptScreenshotZoomOpen}>
                    <Dialog.Portal>
                      <Dialog.Overlay className="fixed inset-0 z-[110] bg-black/85" />
                      <Dialog.Content className="fixed left-1/2 top-1/2 z-[111] flex max-h-[96vh] w-[min(98vw,1400px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-gray-700 bg-gray-950 p-0 shadow-2xl outline-none">
                        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
                          <Dialog.Title className="text-sm font-semibold text-gray-100">
                            LLM screenshot — full resolution
                          </Dialog.Title>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => copyLlmScreenshotToClipboard(lastLlmTranscript.screenshotBase64!)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-100 hover:bg-gray-700"
                            >
                              <Copy size={14} className="opacity-90" aria-hidden />
                              {screenshotCopyStatus === 'copied'
                                ? 'Copied image'
                                : screenshotCopyStatus === 'copiedText'
                                  ? 'Copied base64 text'
                                  : screenshotCopyStatus === 'error'
                                    ? 'Copy failed'
                                    : 'Copy image'}
                            </button>
                            <Dialog.Close asChild>
                              <button
                                type="button"
                                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
                                title="Close"
                              >
                                <X size={18} aria-hidden />
                              </button>
                            </Dialog.Close>
                          </div>
                        </div>
                        <Dialog.Description className="sr-only">
                          Full JPEG at native pixel dimensions. Scroll to see the entire image. Use Copy image to place it on
                          the clipboard.
                        </Dialog.Description>
                        <p className="border-b border-gray-800 px-4 py-2 text-[10px] text-gray-500">
                          If image copy is blocked by the browser, the same button falls back to copying raw base64 text.
                        </p>
                        <div className="min-h-0 flex-1 overflow-auto p-3">
                          <img
                            src={`data:image/jpeg;base64,${lastLlmTranscript.screenshotBase64}`}
                            alt="Full page screenshot sent to the vision model"
                            className="block w-max max-w-none h-auto"
                            draggable={false}
                          />
                        </div>
                      </Dialog.Content>
                    </Dialog.Portal>
                  </Dialog.Root>
                ) : null}
              </>
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
                      disabled={aiBusy || !promptDraft.trim() || promptDraft.trim() === instruction}
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
                      disabled={aiBusy || !aiPromptStep.canTestLive}
                      title={
                        aiPromptStep.canTestLive
                          ? 'Run LLM + vision on the current browser page'
                          : 'Start recording or playback for this run to test'
                      }
                      onClick={() => {
                        setAiBusy(true);
                        setAiError(null);
                        void runsApi
                          .testAiPromptStep(aiPromptStep.runId, aiPromptStep.stepId, {
                            instruction: promptDraft.trim(),
                          })
                          .then((res) => {
                            if (!res.ok) throw new Error(res.error || 'Test failed');
                            aiPromptStep.onUpdated();
                          })
                          .catch((e) => {
                            setAiError(e instanceof Error ? e.message : String(e));
                          })
                          .finally(() => setAiBusy(false));
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 bg-white text-[10px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    >
                      <FlaskConical size={12} />
                      {aiBusy ? 'Testing…' : 'Test step'}
                    </button>
                    <button
                      type="button"
                      disabled={aiBusy}
                      onClick={() => {
                        setAiBusy(true);
                        setAiError(null);
                        void runsApi
                          .patchRunStep(aiPromptStep.runId, aiPromptStep.stepId, { aiPromptMode: false })
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
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-gray-200 text-[10px] font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-40"
                    >
                      Revert to Playwright
                    </button>
                  </div>
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
              {aiError && (
                <p className="text-[10px] text-red-600 bg-red-50 border border-red-100 rounded px-1.5 py-1" role="alert">
                  {aiError}
                </p>
              )}
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
  );
});
