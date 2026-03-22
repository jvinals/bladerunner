import { useState, useEffect, useRef, forwardRef } from 'react';
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
} from 'lucide-react';
import { runsApi } from '@/lib/api';
import type { CheckpointData } from '@/components/ui/CheckpointDivider';

export type PlaybackHighlight = 'past' | 'current' | 'future';

interface StepCardProps {
  sequence: number;
  action: string;
  instruction: string;
  playwrightCode: string;
  origin: 'MANUAL' | 'AI_DRIVEN' | 'AUTOMATIC';
  timestamp: string;
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
  /** When set, show a small “after step” checkpoint thumbnail on the right (no extra row). */
  checkpointAfterStep?: CheckpointData;
  /** Required with `checkpointAfterStep` to load the thumbnail */
  checkpointRunId?: string;
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
    playbackHighlight,
    reRecord,
    stepPlayback,
    checkpointAfterStep,
    checkpointRunId,
  },
  ref,
) {
  /** Collapsed by default: playback actions, re-record, Playwright code */
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reDraft, setReDraft] = useState('');
  const Icon = ACTION_ICONS[action] || Hand;
  const isAI = origin === 'AI_DRIVEN';
  const isAutomatic = origin === 'AUTOMATIC';

  const highlightClass = playbackHighlight ? HIGHLIGHT_RING[playbackHighlight] : '';

  const originBorder = isAutomatic
    ? 'border-l-[#4B90FF]'
    : isAI
      ? 'border-l-[#4D65FF]'
      : 'border-l-gray-300';
  const originBadgeBg = isAutomatic
    ? 'rounded-full px-2 py-0.5 bg-[#4B90FF] text-white shadow-sm'
    : isAI
      ? 'rounded-full px-2 py-0.5 bg-[#4D65FF]/10 text-[#4D65FF]'
      : 'rounded-full px-2 py-0.5 bg-gray-100 text-gray-400';
  const originCircle = isAutomatic
    ? 'bg-[#4B90FF]/15 text-[#2563EB]'
    : isAI
      ? 'bg-[#4D65FF]/10 text-[#4D65FF]'
      : 'bg-gray-100 text-gray-500';
  const originLabel = isAutomatic ? 'Automatic' : isAI ? 'AI' : 'Manual';

  const showAfterThumb = checkpointAfterStep && checkpointRunId;

  return (
    <div
      ref={ref}
      className={`group relative border-l-3 rounded-r-lg bg-white border border-gray-100 mb-1.5 transition-all duration-200 hover:shadow-sm ${originBorder} ${highlightClass}`}
    >
      <div className="flex items-start gap-2 px-2 py-1.5">
        <div
          className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold ${originCircle}`}
        >
          {sequence}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 mb-0.5 flex-wrap">
            <Icon size={11} className="text-gray-400 flex-shrink-0" />
            <span className="text-[9px] text-gray-400 ce-mono">{formatTime(timestamp)}</span>
            <span className={`text-[8px] font-semibold uppercase tracking-wider ${originBadgeBg}`}>
              {originLabel}
            </span>
          </div>
          <p className="text-[11px] text-gray-700 leading-snug">{instruction}</p>
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            className="mt-1 inline-flex items-center gap-1 text-[9px] font-medium text-[#4D65FF] hover:text-[#3d54e8] hover:underline"
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
          <p className="text-[9px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Playwright code</p>
          <pre className="text-[11px] ce-mono bg-gray-50 rounded-md p-2.5 text-gray-600 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
            {playwrightCode}
          </pre>
        </div>
      )}
    </div>
  );
});
