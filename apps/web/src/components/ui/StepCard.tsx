import { useState, forwardRef } from 'react';
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
} from 'lucide-react';

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

export const StepCard = forwardRef<HTMLDivElement, StepCardProps>(function StepCard(
  { sequence, action, instruction, playwrightCode, origin, timestamp, playbackHighlight, reRecord },
  ref,
) {
  const [expanded, setExpanded] = useState(false);
  const [reDraft, setReDraft] = useState('');
  const Icon = ACTION_ICONS[action] || Hand;
  const isAI = origin === 'AI_DRIVEN';
  const isAutomatic = origin === 'AUTOMATIC';

  const highlightClass = playbackHighlight ? HIGHLIGHT_RING[playbackHighlight] : '';

  const originBorder = isAutomatic
    ? 'border-l-teal-500'
    : isAI
      ? 'border-l-[#4D65FF]'
      : 'border-l-gray-300';
  const originBadgeBg = isAutomatic
    ? 'bg-teal-500/10 text-teal-700'
    : isAI
      ? 'bg-[#4D65FF]/10 text-[#4D65FF]'
      : 'bg-gray-100 text-gray-400';
  const originCircle = isAutomatic
    ? 'bg-teal-500/10 text-teal-700'
    : isAI
      ? 'bg-[#4D65FF]/10 text-[#4D65FF]'
      : 'bg-gray-100 text-gray-500';
  const originLabel = isAutomatic ? 'Automatic' : isAI ? 'AI' : 'Manual';

  return (
    <div
      ref={ref}
      className={`group relative border-l-3 rounded-r-lg bg-white border border-gray-100 mb-2 transition-all duration-200 hover:shadow-sm ${originBorder} ${highlightClass}`}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div
          className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${originCircle}`}
        >
          {sequence}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Icon size={12} className="text-gray-400 flex-shrink-0" />
            <span className="text-[10px] text-gray-400 ce-mono">{formatTime(timestamp)}</span>
            <span className={`px-1.5 py-0 text-[9px] font-semibold rounded uppercase tracking-wider ${originBadgeBg}`}>
              {originLabel}
            </span>
          </div>
          <p className="text-xs text-gray-700 leading-relaxed">{instruction}</p>
          {reRecord && (
            <div className="mt-2 flex flex-col gap-1.5">
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
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex-shrink-0 p-1 rounded hover:bg-gray-50 text-gray-300 hover:text-gray-500 transition-colors"
          title={expanded ? 'Hide code' : 'Show code'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-2.5 pt-0">
          <pre className="text-[11px] ce-mono bg-gray-50 rounded-md p-2.5 text-gray-600 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
            {playwrightCode}
          </pre>
        </div>
      )}
    </div>
  );
});
