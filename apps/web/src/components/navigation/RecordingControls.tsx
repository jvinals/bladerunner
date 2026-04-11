/**
 * Start / Stop recording buttons, connection status, and Export Skyvern JSON.
 */

import { Circle, Square, Download, Radio } from 'lucide-react';
import type { SkyvernWorkflow } from '@/hooks/useNavigationRecording';

interface RecordingControlsProps {
  isRecording: boolean;
  connected: boolean;
  skyvernWorkflow: SkyvernWorkflow | null;
  onStart: () => void;
  onStop: () => void;
  error: string | null;
}

function downloadJson(workflow: SkyvernWorkflow) {
  const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${workflow.title.replace(/\s+/g, '_').toLowerCase()}_workflow.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function RecordingControls({
  isRecording,
  connected,
  skyvernWorkflow,
  onStart,
  onStop,
  error,
}: RecordingControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!isRecording && !skyvernWorkflow && (
        <button
          type="button"
          disabled={!connected}
          onClick={onStart}
          className="inline-flex items-center gap-2 rounded-lg bg-red-500 text-white text-sm font-medium px-4 py-2 hover:bg-red-600 disabled:opacity-50"
        >
          <Circle size={16} className="fill-current" />
          Start Recording
        </button>
      )}

      {isRecording && (
        <button
          type="button"
          onClick={onStop}
          className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white text-sm font-medium px-4 py-2 hover:bg-gray-900"
        >
          <Square size={16} />
          Stop Recording
        </button>
      )}

      {skyvernWorkflow && (
        <button
          type="button"
          onClick={() => downloadJson(skyvernWorkflow)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#4B90FF] text-white text-sm font-medium px-4 py-2 hover:bg-[#3d7fe6]"
        >
          <Download size={16} />
          Export Skyvern JSON
        </button>
      )}

      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <Radio size={14} className={connected ? 'text-green-500' : 'text-amber-500'} />
        {connected ? 'Connected' : 'Connecting...'}
      </span>

      {isRecording && (
        <span className="inline-flex items-center gap-1.5 text-xs text-red-500 animate-pulse">
          <Circle size={8} className="fill-current" />
          Recording
        </span>
      )}

      {error && (
        <span className="text-xs text-red-600 bg-red-50 rounded-md px-2 py-1">{error}</span>
      )}
    </div>
  );
}
