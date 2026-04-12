/**
 * Play mode: Skyvern workflow run with live frames (screenshot polling) and read-only action list.
 */

import { ExternalLink, Loader2, Play, Square, Radio, Video } from 'lucide-react';
import { InteractiveCanvasStream } from './InteractiveCanvasStream';
import { RecordedActionTimeline } from './RecordedActionTimeline';
import { useNavigationPlay } from '@/hooks/useNavigationPlay';
import type { RecordedNavigationAction } from '@/hooks/useNavigationRecording';

interface NavigationPlayWorkspaceProps {
  navId: string;
  persistedActions: RecordedNavigationAction[];
}

function noop() {}

export function NavigationPlayWorkspace({ navId, persistedActions }: NavigationPlayWorkspaceProps) {
  const {
    isPlaying,
    connected,
    frameDataUrl,
    playError,
    runStatus,
    skyvernRunId,
    playActiveSequence,
    appUrl,
    recordingUrl,
    startPlay,
    stopPlay,
  } = useNavigationPlay(
    navId,
    persistedActions.map((a) => a.sequence),
  );

  const canPlay = persistedActions.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canPlay || isPlaying}
          onClick={() => void startPlay()}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 text-white text-sm font-medium px-4 py-2 hover:bg-emerald-700 disabled:opacity-50"
        >
          <Play size={16} className="fill-current" />
          Play (Skyvern)
        </button>
        <button
          type="button"
          disabled={!isPlaying}
          onClick={() => void stopPlay()}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-300 text-gray-800 text-sm font-medium px-4 py-2 hover:bg-gray-50 disabled:opacity-50"
        >
          <Square size={16} />
          Stop
        </button>
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-500">
          <Radio size={14} className={connected ? 'text-green-500' : 'text-amber-500'} />
          {connected ? 'Socket connected' : 'Connecting…'}
        </span>
        {isPlaying && runStatus && (
          <span className="text-xs font-medium text-emerald-700">Run: {runStatus}</span>
        )}
        {skyvernRunId && (
          <span className="text-[10px] text-gray-400 font-mono truncate max-w-[200px]" title={skyvernRunId}>
            {skyvernRunId}
          </span>
        )}
        {appUrl && (
          <a
            href={appUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
          >
            <ExternalLink size={12} />
            Live view
          </a>
        )}
        {recordingUrl && (
          <a
            href={recordingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <Video size={12} />
            Recording
          </a>
        )}
      </div>
      {!canPlay && (
        <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
          Record at least one action before Play. Streams use Skyvern run screenshots when available.
        </p>
      )}
      {playError && (
        <p className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2 whitespace-pre-wrap">{playError}</p>
      )}

      <div className="flex gap-4">
        <div className="flex-1 min-w-0 relative">
          {isPlaying && !frameDataUrl && (
            <div className="absolute inset-0 flex items-center justify-center z-10 rounded-xl bg-white/80 border border-dashed border-gray-200">
              <div className="flex flex-col items-center gap-3 text-center px-6">
                <Loader2 className="animate-spin text-gray-400" size={22} />
                <span className="text-sm text-gray-500">
                  Skyvern is executing…
                </span>
                <span className="text-[11px] text-gray-400 max-w-xs leading-relaxed">
                  Screenshots appear when steps complete.
                  {appUrl && (
                    <>
                      {' '}
                      <a
                        href={appUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-indigo-500 hover:text-indigo-700 underline underline-offset-2"
                      >
                        Watch live on Skyvern
                      </a>
                    </>
                  )}
                </span>
              </div>
            </div>
          )}
          <InteractiveCanvasStream
            frameDataUrl={frameDataUrl}
            isInputModalOpen={false}
            blockCanvasInteraction
            proposedIntent={null}
            onConfirmIntent={noop}
            onCancelIntent={noop}
            sendClick={noop}
            sendScroll={noop}
          />
        </div>
        <div className="w-72 shrink-0 rounded-xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          <div className="px-3 py-2.5 border-b border-gray-100 shrink-0">
            <h3 className="text-xs font-semibold text-gray-700">Actions (read-only)</h3>
          </div>
          <RecordedActionTimeline
            actions={persistedActions}
            onUpdateAction={noop}
            readOnly
            highlightSequence={isPlaying ? playActiveSequence : null}
          />
        </div>
      </div>
    </div>
  );
}
