import { useState } from 'react';
import { ChevronDown, ChevronRight, Mouse, Type, Navigation, ScrollText, Pointer, Eye, Camera, CheckCircle, Clock, Sparkles, Hand } from 'lucide-react';

interface StepCardProps {
  sequence: number;
  action: string;
  instruction: string;
  playwrightCode: string;
  origin: 'MANUAL' | 'AI_DRIVEN';
  timestamp: string;
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

export function StepCard({ sequence, action, instruction, playwrightCode, origin, timestamp }: StepCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = ACTION_ICONS[action] || Hand;
  const isAI = origin === 'AI_DRIVEN';

  return (
    <div
      className={`group relative border-l-3 rounded-r-lg bg-white border border-gray-100 mb-2 transition-all duration-200 hover:shadow-sm ${
        isAI ? 'border-l-[#4D65FF]' : 'border-l-gray-300'
      }`}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <div
          className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
            isAI
              ? 'bg-[#4D65FF]/10 text-[#4D65FF]'
              : 'bg-gray-100 text-gray-500'
          }`}
        >
          {sequence}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Icon size={12} className="text-gray-400 flex-shrink-0" />
            <span className="text-[10px] text-gray-400 ce-mono">{formatTime(timestamp)}</span>
            <span
              className={`px-1.5 py-0 text-[9px] font-semibold rounded uppercase tracking-wider ${
                isAI
                  ? 'bg-[#4D65FF]/10 text-[#4D65FF]'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {isAI ? 'AI' : 'Manual'}
            </span>
          </div>
          <p className="text-xs text-gray-700 leading-relaxed">{instruction}</p>
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
}
