/**
 * Start / pause / resume / stop / cancel recording, export Skyvern JSON, status.
 */

import { Circle, Square, Download, Radio, Pause, Play, Ban, Sparkles, Loader2 } from 'lucide-react';
import type { SkyvernWorkflow } from '@/hooks/useNavigationRecording';

interface RecordingControlsProps {
  isRecording: boolean;
  isPaused: boolean;
  connected: boolean;
  skyvernWorkflow: SkyvernWorkflow | null;
  /** After stop: allow running LLM audit on the recorded timeline. */
  canRunSmartAudit?: boolean;
  auditRunning?: boolean;
  onRunSmartAudit?: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onCancel: () => void;
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
  isPaused,
  connected,
  skyvernWorkflow,
  canRunSmartAudit = false,
  auditRunning = false,
  onRunSmartAudit,
  onStart,
  onPause,
  onResume,
  onStop,
  onCancel,
  error,
}: RecordingControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!isRecording && (
        <button
          type="button"
          disabled={!connected}
          onClick={onStart}
          className="inline-flex items-center gap-2 rounded-lg bg-red-500 text-white text-sm font-medium px-4 py-2 hover:bg-red-600 disabled:opacity-50"
        >
          <Circle size={16} className="fill-current" />
          {skyvernWorkflow ? 'Record again' : 'Start Recording'}
        </button>
      )}

      {isRecording && !isPaused && (
        <button
          type="button"
          onClick={onPause}
          className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm font-medium px-4 py-2 hover:bg-amber-100"
        >
          <Pause size={16} />
          Pause
        </button>
      )}

      {isRecording && isPaused && (
        <button
          type="button"
          onClick={onResume}
          className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-900 text-sm font-medium px-4 py-2 hover:bg-emerald-100"
        >
          <Play size={16} className="fill-current" />
          Continue recording
        </button>
      )}

      {isRecording && (
        <>
          <button
            type="button"
            onClick={onStop}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-800 text-white text-sm font-medium px-4 py-2 hover:bg-gray-900"
          >
            <Square size={16} />
            Stop recording
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white text-red-700 text-sm font-medium px-4 py-2 hover:bg-red-50"
          >
            <Ban size={16} />
            Cancel
          </button>
        </>
      )}

      {skyvernWorkflow && (
        <>
          {canRunSmartAudit && onRunSmartAudit ? (
            <button
              type="button"
              disabled={!connected || auditRunning}
              onClick={onRunSmartAudit}
              className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 text-violet-900 text-sm font-medium px-4 py-2 hover:bg-violet-100 disabled:opacity-50"
            >
              {auditRunning ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Sparkles size={16} />
              )}
              {auditRunning ? 'Running audit…' : 'Run AI audit'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => downloadJson(skyvernWorkflow)}
            className="inline-flex items-center gap-2 rounded-lg bg-[#4B90FF] text-white text-sm font-medium px-4 py-2 hover:bg-[#3d7fe6]"
          >
            <Download size={16} />
            Export Skyvern JSON
          </button>
        </>
      )}

      <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
        <Radio size={14} className={connected ? 'text-green-500' : 'text-amber-500'} />
        {connected ? 'Connected' : 'Connecting...'}
      </span>

      {isRecording && !isPaused && (
        <span className="inline-flex items-center gap-1.5 text-xs text-red-500 animate-pulse">
          <Circle size={8} className="fill-current" />
          Recording
        </span>
      )}

      {isRecording && isPaused && (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 font-medium">
          <Pause size={12} />
          Paused
        </span>
      )}

      {error && (
        <span className="text-xs text-red-600 bg-red-50 rounded-md px-2 py-1">{error}</span>
      )}
    </div>
  );
}
