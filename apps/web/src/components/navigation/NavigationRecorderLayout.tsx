/**
 * Top-level layout for the navigation recording experience.
 *
 * Composes InteractiveCanvasStream (main area), RecordedActionTimeline
 * (right sidebar), RecordingControls (above canvas), and the
 * VariableInjectionModal (overlay when an input field is detected).
 */

import { useEffect } from 'react';
import { useUser } from '@clerk/react';
import { useNavigationRecording } from '@/hooks/useNavigationRecording';
import { InteractiveCanvasStream } from './InteractiveCanvasStream';
import { RecordedActionTimeline } from './RecordedActionTimeline';
import { RecordingControls } from './RecordingControls';
import { VariableInjectionModal } from './VariableInjectionModal';
import { CustomPromptInput } from './CustomPromptInput';

interface NavigationRecorderLayoutProps {
  navId: string;
  /** Base URL for this navigation — used to show default Skyvern goals in the timeline. */
  navigationUrl: string;
  /** Fires when a recording session is active (start … stop/cancel) so parents can guard UI (e.g. workspace drawer). */
  onSessionActivityChange?: (isRecording: boolean) => void;
}

export function NavigationRecorderLayout({
  navId,
  navigationUrl,
  onSessionActivityChange,
}: NavigationRecorderLayoutProps) {
  const { user } = useUser();
  const userId = user?.id ?? '';

  const {
    isRecording,
    isPaused,
    connected,
    frameDataUrl,
    actions,
    inputPrompt,
    isInputModalOpen,
    proposedIntent,
    skyvernWorkflow,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
    sendClick,
    sendScroll,
    resolveInput,
    dismissInputPrompt,
    analyzePrompt,
    confirmIntent,
    cancelIntent,
    updateRecordedAction,
    auditSuggestions,
    auditRunning,
    runSmartAudit,
    acceptAuditSuggestion,
    rejectAuditSuggestion,
    error,
  } = useNavigationRecording(navId, userId);

  useEffect(() => {
    onSessionActivityChange?.(isRecording);
  }, [isRecording, onSessionActivityChange]);

  const canRunSmartAudit = Boolean(
    skyvernWorkflow && actions.length > 0 && !isRecording,
  );

  return (
    <div className="space-y-4">
      <RecordingControls
        isRecording={isRecording}
        isPaused={isPaused}
        connected={connected}
        skyvernWorkflow={skyvernWorkflow}
        canRunSmartAudit={canRunSmartAudit}
        auditRunning={auditRunning}
        onRunSmartAudit={runSmartAudit}
        onStart={startRecording}
        onPause={pauseRecording}
        onResume={resumeRecording}
        onStop={stopRecording}
        onCancel={cancelRecording}
        error={error}
      />

      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          <InteractiveCanvasStream
            frameDataUrl={frameDataUrl}
            isInputModalOpen={isInputModalOpen}
            blockCanvasInteraction={isInputModalOpen || isPaused || proposedIntent !== null}
            proposedIntent={proposedIntent}
            onConfirmIntent={confirmIntent}
            onCancelIntent={cancelIntent}
            sendClick={sendClick}
            sendScroll={sendScroll}
          />
        </div>

        <div className="w-72 shrink-0 rounded-xl border border-gray-200 bg-white overflow-hidden flex flex-col">
          <CustomPromptInput
            disabled={!isRecording || !connected || isPaused}
            onAnalyze={analyzePrompt}
          />
          <div className="px-3 py-2.5 border-b border-gray-100 shrink-0">
            <h3 className="text-xs font-semibold text-gray-700">
              Recorded Actions ({actions.length})
            </h3>
          </div>
          <RecordedActionTimeline
            navigationId={navId}
            navigationUrl={navigationUrl}
            actions={actions}
            onUpdateAction={updateRecordedAction}
            auditSuggestions={auditSuggestions}
            onAcceptAuditSuggestion={acceptAuditSuggestion}
            onRejectAuditSuggestion={rejectAuditSuggestion}
          />
        </div>
      </div>

      {inputPrompt && (
        <VariableInjectionModal
          key={inputPrompt.openedAt}
          prompt={inputPrompt}
          onResolve={resolveInput}
          onDismiss={dismissInputPrompt}
        />
      )}
    </div>
  );
}
