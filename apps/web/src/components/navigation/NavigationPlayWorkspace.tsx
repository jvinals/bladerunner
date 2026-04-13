/**
 * Play mode: Skyvern workflow run with live frames (screenshot polling) and action list
 * (read-only detail while a run is active; edit Skyvern goals / Improve with AI when idle).
 */

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { navigationsApi, type NavigationDetailDto } from '@/lib/api';
import { ExternalLink, FileJson, Loader2, Play, Square, Radio, Video } from 'lucide-react';
import { DetachedStreamPortal } from './DetachedStreamPortal';
import { InteractiveCanvasStream } from './InteractiveCanvasStream';
import { RecordedActionTimeline } from './RecordedActionTimeline';
import { StreamDetachToolbar } from './StreamDetachToolbar';
import { SkyvernWorkflowPreviewModal } from './SkyvernWorkflowPreviewModal';
import { useNavigationPlay } from '@/hooks/useNavigationPlay';
import type { RecordedNavigationAction } from '@/hooks/useNavigationRecording';

interface NavigationPlayWorkspaceProps {
  navId: string;
  persistedActions: RecordedNavigationAction[];
  /** Navigation entry URL — used for default Skyvern goal strings in the read-only step detail. */
  navigationUrl: string;
  /** When false, step delete is disabled (e.g. navigation running / review). */
  canDeleteActions?: boolean;
}

function mapDetailActionsToRecorded(rows: NavigationDetailDto['actions']): RecordedNavigationAction[] {
  return rows.map((a) => ({
    sequence: a.sequence,
    actionType: a.actionType as RecordedNavigationAction['actionType'],
    x: a.x,
    y: a.y,
    elementTag: a.elementTag,
    elementId: a.elementId,
    elementText: a.elementText,
    ariaLabel: a.ariaLabel,
    inputValue: a.inputValue,
    inputMode: (a.inputMode as RecordedNavigationAction['inputMode']) ?? null,
    pageUrl: a.pageUrl,
    actionInstruction: a.actionInstruction ?? null,
  }));
}

function noop() {}

export function NavigationPlayWorkspace({
  navId,
  persistedActions,
  navigationUrl,
  canDeleteActions = true,
}: NavigationPlayWorkspaceProps) {
  const queryClient = useQueryClient();
  const [workflowPreviewOpen, setWorkflowPreviewOpen] = useState(false);
  const [streamDetached, setStreamDetached] = useState(false);
  const [playActions, setPlayActions] = useState(persistedActions);

  useEffect(() => {
    setPlayActions(persistedActions);
  }, [persistedActions]);

  const onUpdatePlayAction = useCallback(
    (sequence: number, updates: Partial<RecordedNavigationAction>) => {
      setPlayActions((prev) =>
        prev.map((a) => (a.sequence === sequence ? { ...a, ...updates } : a)),
      );
      if (updates.actionInstruction !== undefined && navId) {
        void navigationsApi
          .patchActionInstruction(navId, sequence, {
            actionInstruction: updates.actionInstruction ?? null,
          })
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: ['navigation', navId] });
          })
          .catch(() => {
            /* keep local state; user can retry */
          });
      }
    },
    [navId, queryClient],
  );

  const deletePlayAction = useCallback(
    (sequence: number) => {
      if (
        !window.confirm(
          'Delete this step? Remaining steps will be renumbered. This cannot be undone.',
        )
      ) {
        return;
      }
      void navigationsApi
        .deleteAction(navId, sequence)
        .then((detail) => {
          setPlayActions(mapDetailActionsToRecorded(detail.actions));
          void queryClient.invalidateQueries({ queryKey: ['navigation', navId] });
          void queryClient.invalidateQueries({ queryKey: ['navigations'] });
        })
        .catch(() => {
          /* API surfaces via global handler / toast if configured */
        });
    },
    [navId, queryClient],
  );

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
  } = useNavigationPlay(navId);

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
        <button
          type="button"
          disabled={!canPlay}
          onClick={() => setWorkflowPreviewOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50/80 text-indigo-900 text-sm font-medium px-4 py-2 hover:bg-indigo-100/80 disabled:opacity-50"
        >
          <FileJson size={16} />
          Preview workflow
        </button>
        <SkyvernWorkflowPreviewModal
          navId={navId}
          open={workflowPreviewOpen}
          onOpenChange={setWorkflowPreviewOpen}
        />
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
        <div className="flex-1 min-w-0 flex min-h-0 flex-col">
          <StreamDetachToolbar
            detached={streamDetached}
            onDetach={() => setStreamDetached(true)}
            onDock={() => setStreamDetached(false)}
            disabled={!canPlay && !isPlaying}
          />
          {!streamDetached ? (
            <div className="relative min-h-[180px] flex-1">
              {isPlaying && !frameDataUrl && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-white/80 border border-dashed border-gray-200">
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
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/90 px-4 py-14 text-center text-sm text-slate-600">
              Live stream is in a separate window. Use <span className="font-medium">Dock stream</span> above
              to show it here again.
            </div>
          )}
          <DetachedStreamPortal
            open={streamDetached}
            onOpenChange={setStreamDetached}
            title="Navigation play — live stream"
          >
            <InteractiveCanvasStream
              frameDataUrl={frameDataUrl}
              isInputModalOpen={false}
              blockCanvasInteraction
              proposedIntent={null}
              onConfirmIntent={noop}
              onCancelIntent={noop}
              sendClick={noop}
              sendScroll={noop}
              embedWithoutAppStyles
            />
          </DetachedStreamPortal>
        </div>
        <div className="w-72 shrink-0 rounded-xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          <div className="px-3 py-2.5 border-b border-gray-100 shrink-0">
            <h3 className="text-xs font-semibold text-gray-700">Actions</h3>
            <p className="mt-0.5 text-[10px] text-gray-500 leading-snug">
              {isPlaying
                ? 'Expand for step context while the run is active.'
                : 'Expand to edit Skyvern goals, overrides, or Improve with AI.'}
            </p>
          </div>
          <RecordedActionTimeline
            navigationId={navId}
            actions={playActions}
            onUpdateAction={onUpdatePlayAction}
            onDeleteAction={deletePlayAction}
            deleteActionDisabled={isPlaying || !canDeleteActions}
            readOnly
            readOnlyInteractive
            playInstructionEditing={!isPlaying}
            navigationUrl={navigationUrl}
            highlightSequence={isPlaying ? playActiveSequence : null}
          />
        </div>
      </div>
    </div>
  );
}
