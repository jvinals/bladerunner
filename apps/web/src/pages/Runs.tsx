import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { runsApi } from '@/lib/api';
import { StepCard } from '@/components/ui/StepCard';
import { useRecording } from '@/hooks/useRecording';
import {
  useRemotePreviewCanvas,
  type RemotePreviewBridge,
} from '@/hooks/useRemotePreviewCanvas';
import {
  Search, Plus, Square, Send, ExternalLink, X, Play, ChevronDown,
} from 'lucide-react';

export default function RunsPage() {
  const { user } = useUser();
  const [search, setSearch] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [newPanelOpen, setNewPanelOpen] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [instructionText, setInstructionText] = useState('');
  const [isDetached, setIsDetached] = useState(false);
  const [isSendingInstruction, setIsSendingInstruction] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewFocusRef = useRef<HTMLDivElement>(null);
  const stepsEndRef = useRef<HTMLDivElement>(null);
  const detachedWindowRef = useRef<Window | null>(null);

  const {
    isRecording,
    runId,
    currentFrame,
    steps,
    status,
    startRecording,
    stopRecording,
    sendInstruction,
    loadRunSteps,
    sendRemotePointer,
    sendRemoteKey,
    sendRemoteTouch,
    sendRemoteClipboard,
    socketConnected,
  } = useRecording();

  const { data: runsData, isLoading, error, refetch } = useQuery({
    queryKey: ['runs', search],
    queryFn: () => runsApi.list(search ? { search } : undefined),
  });

  const runs = (runsData?.data || []) as Array<{
    id: string;
    name: string;
    url: string;
    status: string;
    stepsCount: number;
    createdAt: string;
  }>;

  useEffect(() => {
    if (stepsEndRef.current) {
      stepsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [steps.length]);

  useEffect(() => {
    if (!currentFrame || !canvasRef.current || isDetached) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
    };
    img.src = `data:image/jpeg;base64,${currentFrame}`;
  }, [currentFrame, isDetached]);

  const handleStartRecording = useCallback(async () => {
    if (!newUrl || !newName) return;
    try {
      await startRecording(newUrl, newName);
      setNewPanelOpen(false);
      setNewUrl('');
      setNewName('');
      refetch();
    } catch (err) {
      console.error('Failed to start recording:', err);
    }
  }, [newUrl, newName, startRecording, refetch]);

  const handleStopRecording = useCallback(async () => {
    await stopRecording();
    refetch();
  }, [stopRecording, refetch]);

  const userId = user?.id ?? '';

  const previewBridge = useMemo<RemotePreviewBridge>(
    () => ({
      pointer: (p) => sendRemotePointer(userId, p),
      key: (t, k) => sendRemoteKey(userId, t, k),
      touch: (type, touchPoints) => sendRemoteTouch(userId, { type, touchPoints }),
      clipboard: (action, text) => sendRemoteClipboard(userId, action, text),
      isConnected: () => socketConnected,
    }),
    [
      userId,
      sendRemotePointer,
      sendRemoteKey,
      sendRemoteTouch,
      sendRemoteClipboard,
      socketConnected,
    ],
  );

  const { canvasProps, previewProps } = useRemotePreviewCanvas(
    userId,
    canvasRef,
    previewFocusRef,
    previewBridge,
    { isActive: isRecording && !isDetached },
  );

  const handleSendInstruction = useCallback(async () => {
    if (!instructionText.trim() || isSendingInstruction) return;
    setIsSendingInstruction(true);
    try {
      await sendInstruction(instructionText.trim());
      setInstructionText('');
    } catch (err) {
      console.error('Instruction failed:', err);
    } finally {
      setIsSendingInstruction(false);
    }
  }, [instructionText, isSendingInstruction, sendInstruction]);

  const handleSelectRun = useCallback(async (id: string) => {
    setSelectedRunId(id);
    await loadRunSteps(id);
  }, [loadRunSteps]);

  const handleDetach = useCallback(() => {
    if (!runId) return;
    const w = window.open(`/preview/${runId}`, 'bladerunner-preview', 'width=1320,height=780');
    if (w) {
      detachedWindowRef.current = w;
      setIsDetached(true);
      const check = setInterval(() => {
        if (w.closed) {
          setIsDetached(false);
          detachedWindowRef.current = null;
          clearInterval(check);
        }
      }, 500);
    }
  }, [runId]);

  const handleReattach = useCallback(() => {
    if (detachedWindowRef.current && !detachedWindowRef.current.closed) {
      detachedWindowRef.current.close();
    }
    detachedWindowRef.current = null;
    setIsDetached(false);
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Preview Area */}
      <div className="flex-1 flex flex-col min-w-0 p-4">
        <div className="flex-1 relative bg-white border border-gray-100 rounded-lg overflow-hidden flex items-center justify-center">
          {isRecording && !isDetached ? (
            <>
              <div ref={previewFocusRef} {...previewProps}>
                <canvas
                  ref={canvasRef}
                  className="max-w-full max-h-full object-contain block touch-none cursor-crosshair select-none"
                  {...canvasProps}
                  role="img"
                  aria-label="Remote browser preview — click to interact"
                />
              </div>
              <p className="absolute bottom-2 left-2 right-2 text-center text-[10px] text-gray-400 pointer-events-none px-8">
                Mouse, touch (swipe/pinch), scroll wheel, double-click. Click preview to type;{' '}
                <kbd className="rounded border border-gray-200 bg-gray-50 px-0.5 font-mono text-[9px]">⌘/Ctrl+C/V/X</kbd>{' '}
                copy/paste/cut between remote and your clipboard.{' '}
                <kbd className="rounded border border-gray-200 bg-gray-50 px-0.5 font-mono text-[9px]">Esc</kbd> exits
                keyboard focus.
              </p>
              <button
                type="button"
                onClick={handleDetach}
                className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 bg-white/90 backdrop-blur border border-gray-200 rounded-md text-xs text-gray-600 hover:text-[#4B90FF] hover:border-[#4B90FF]/30 transition-all shadow-sm"
                title="Detach preview to new window"
              >
                <ExternalLink size={12} />
                Detach
              </button>
            </>
          ) : isDetached ? (
            <div className="text-center">
              <ExternalLink size={32} className="mx-auto mb-3 text-gray-300" />
              <p className="text-sm text-gray-500 mb-2">Preview detached to external window</p>
              <button
                onClick={handleReattach}
                className="text-xs text-[#4B90FF] font-medium hover:underline"
              >
                Reattach here
              </button>
            </div>
          ) : (
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-[#4B90FF]/10 to-[#4D65FF]/10 flex items-center justify-center">
                <Play size={24} className="text-[#4B90FF]" />
              </div>
              <p className="text-sm font-medium text-gray-700 mb-1">No active recording</p>
              <p className="text-xs text-gray-400">Click "New" to start recording a test run</p>
            </div>
          )}
        </div>
      </div>

      {/* Right Column */}
      <div className="w-96 flex-shrink-0 border-l border-gray-100 bg-white flex flex-col overflow-hidden">
        {/* Header Controls */}
        <div className="p-4 border-b border-gray-50 space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search runs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full border border-gray-200 rounded-md pl-8 pr-3 py-1.5 text-xs text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                  <X size={12} />
                </button>
              )}
            </div>

            {isRecording ? (
              <button
                onClick={handleStopRecording}
                className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 text-xs font-medium rounded-md hover:bg-red-100 transition-colors"
              >
                <Square size={12} />
                Stop
              </button>
            ) : (
              <button
                onClick={() => setNewPanelOpen(!newPanelOpen)}
                className="flex items-center gap-1 px-3 py-1.5 bg-[#4B90FF] text-white text-xs font-medium rounded-md hover:bg-blue-500 transition-colors"
              >
                <Plus size={12} />
                New
              </button>
            )}
          </div>

          {/* Run Picker */}
          {!isRecording && (
            <div className="relative">
              <select
                value={selectedRunId || ''}
                onChange={(e) => e.target.value && handleSelectRun(e.target.value)}
                className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-xs text-gray-600 appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF] bg-white"
              >
                <option value="">Select a run...</option>
                {isLoading ? (
                  <option disabled>Loading...</option>
                ) : (
                  runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.stepsCount} steps)
                    </option>
                  ))
                )}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            </div>
          )}
        </div>

        {/* New Run Sliding Panel */}
        <div
          className={`overflow-hidden transition-all duration-300 ease-out border-b border-gray-50 ${
            newPanelOpen ? 'max-h-[220px] opacity-100' : 'max-h-0 opacity-0'
          }`}
        >
          <div className="p-4 space-y-3">
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">
                App URL
              </label>
              <input
                type="url"
                placeholder="https://myapp.com"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-xs text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1 block">
                Test Name
              </label>
              <input
                type="text"
                placeholder="Login flow test"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-xs text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleStartRecording}
                disabled={!newUrl || !newName}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-[#4B90FF] text-white text-xs font-medium rounded-md hover:bg-blue-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play size={12} />
                Start Recording
              </button>
              <button
                onClick={() => setNewPanelOpen(false)}
                className="px-3 py-2 text-xs text-gray-500 hover:text-gray-700 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>

        {/* Steps List */}
        <div className="flex-1 overflow-y-auto p-4">
          {isRecording && (
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-[10px] font-semibold text-red-500 uppercase tracking-wider">
                Recording — {steps.length} steps
              </span>
            </div>
          )}

          {steps.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <p className="text-xs text-gray-400">
                {isRecording ? 'Waiting for actions...' : 'No steps to display'}
              </p>
            </div>
          ) : (
            <div>
              {steps.map((step) => (
                <StepCard
                  key={step.id}
                  sequence={step.sequence}
                  action={step.action}
                  instruction={step.instruction}
                  playwrightCode={step.playwrightCode}
                  origin={step.origin}
                  timestamp={step.timestamp}
                />
              ))}
              <div ref={stepsEndRef} />
            </div>
          )}
        </div>

        {/* Instruction Input (only during recording) */}
        {isRecording && (
          <div className="p-3 border-t border-gray-100 bg-gray-50/50">
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Type an instruction... (e.g. Click the login button)"
                value={instructionText}
                onChange={(e) => setInstructionText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendInstruction()}
                disabled={isSendingInstruction}
                className="flex-1 border border-gray-200 rounded-md px-3 py-2 text-xs text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4D65FF]/30 focus:border-[#4D65FF] disabled:opacity-50 bg-white"
              />
              <button
                onClick={handleSendInstruction}
                disabled={!instructionText.trim() || isSendingInstruction}
                className="p-2 bg-[#4D65FF] text-white rounded-md hover:bg-[#3d54e8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Send instruction"
              >
                <Send size={14} />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5 px-1">
              AI will interpret your instruction and execute the Playwright action
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
