import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { createRecordingSocket } from '@/lib/recordingSocket';
import { runsApi } from '@/lib/api';
import { Pause, Play, RotateCcw, Square, StepForward } from 'lucide-react';

/**
 * Detached window for live test replay preview.
 * Open with `/playback/:playbackSessionId` after starting playback from run detail.
 */
export default function DetachedPlayback() {
  const { playbackSessionId: routePlaybackId } = useParams<{ playbackSessionId: string }>();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string>('connecting');
  const [isPaused, setIsPaused] = useState(false);
  const [activeStepSequence, setActiveStepSequence] = useState<number | null>(null);
  const [advanceToSeq, setAdvanceToSeq] = useState('');
  const [playbackSessionId, setPlaybackSessionId] = useState(routePlaybackId ?? '');

  useEffect(() => {
    setPlaybackSessionId(routePlaybackId ?? '');
  }, [routePlaybackId]);

  useEffect(() => {
    if (!playbackSessionId) return;

    const socket: Socket = createRecordingSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setStatus('connected');
      socket.emit('join', { runId: playbackSessionId });
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setStatus('disconnected');
    });

    socket.on('frame', (data: { runId: string; data: string }) => {
      if (data.runId !== playbackSessionId || !canvasRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;

      const img = new Image();
      img.onload = () => {
        canvasRef.current!.width = img.width;
        canvasRef.current!.height = img.height;
        ctx.drawImage(img, 0, 0);
      };
      img.src = `data:image/jpeg;base64,${data.data}`;
    });

    socket.on(
      'playbackProgress',
      (payload: {
        runId?: string;
        playbackSessionId?: string;
        step: { sequence: number };
        phase: string;
      }) => {
        const rid = payload.runId ?? payload.playbackSessionId;
        if (rid !== playbackSessionId) return;
        if (payload.phase === 'before' || payload.phase === 'error') {
          setActiveStepSequence(payload.step.sequence);
        }
      },
    );

    socket.on('status', (data: { status: string; runId?: string }) => {
      if (data.runId && data.runId !== playbackSessionId) return;
      if (data.status === 'playback_paused') {
        setIsPaused(true);
        setStatus('playback_paused');
        return;
      }
      if (data.status === 'playback') {
        setIsPaused(false);
        setStatus('playback');
        return;
      }
      setIsPaused(false);
      setStatus(data.status);
    });

    return () => {
      socket.emit('leave', { runId: playbackSessionId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [playbackSessionId]);

  const handlePause = () => {
    if (!playbackSessionId) return;
    void runsApi.pausePlayback(playbackSessionId);
  };

  const handleResume = () => {
    if (!playbackSessionId) return;
    void runsApi.resumePlayback(playbackSessionId);
  };

  const handleStop = () => {
    if (!playbackSessionId) return;
    void runsApi.stopPlayback(playbackSessionId);
  };

  const handleRestart = async () => {
    if (!playbackSessionId) return;
    try {
      const next = await runsApi.restartPlayback(playbackSessionId);
      if (next?.playbackSessionId) {
        setPlaybackSessionId(next.playbackSessionId);
        navigate(`/playback/${next.playbackSessionId}`, { replace: true });
      }
    } catch {
      /* ignore */
    }
  };

  const handleAdvanceOne = () => {
    if (!playbackSessionId) return;
    void runsApi.advancePlaybackOne(playbackSessionId);
  };

  const handleAdvanceTo = () => {
    if (!playbackSessionId) return;
    const n = Number.parseInt(advanceToSeq.trim(), 10);
    if (Number.isNaN(n) || n < 0) return;
    void runsApi.advancePlaybackTo(playbackSessionId, n);
  };

  const terminal =
    status === 'disconnected' || status === 'completed' || status === 'stopped' || status === 'failed';
  const showControls = playbackSessionId && !terminal;

  return (
    <div className="w-screen h-screen bg-gray-900 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[#4B90FF] font-bold text-sm shrink-0">Bladerunner</span>
          <span className="text-gray-400 text-xs truncate">Playback preview</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {showControls && (
            <div className="flex flex-wrap items-center gap-1.5">
              {isPaused ? (
                <button
                  type="button"
                  onClick={handleResume}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-emerald-600/90 text-white text-[11px] font-medium hover:bg-emerald-500"
                  title="Resume until end"
                >
                  <Play size={12} className="fill-white" />
                  Resume
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handlePause}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-amber-600/90 text-white text-[11px] font-medium hover:bg-amber-500"
                  title="Pause"
                >
                  <Pause size={12} />
                  Pause
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleRestart()}
                className="flex items-center gap-1 px-2 py-1 rounded bg-slate-600/90 text-white text-[11px] font-medium hover:bg-slate-500"
                title="Stop and restart from the beginning with the same options"
              >
                <RotateCcw size={12} />
                Restart
              </button>
              <button
                type="button"
                onClick={handleStop}
                className="flex items-center gap-1 px-2 py-1 rounded bg-red-600/80 text-white text-[11px] font-medium hover:bg-red-500"
                title="Stop playback"
              >
                <Square size={12} />
                Stop
              </button>
            </div>
          )}
          {showControls && isPaused && (
            <div className="flex flex-wrap items-center gap-1.5 border-l border-gray-600 pl-2 ml-1">
              <button
                type="button"
                onClick={handleAdvanceOne}
                className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-600/90 text-white text-[11px] font-medium hover:bg-indigo-500"
                title="Run the next step, then pause again"
              >
                <StepForward size={12} />
                Next step
              </button>
              <button
                type="button"
                onClick={handleAdvanceTo}
                className="flex items-center gap-1 px-2 py-1 rounded bg-violet-600/90 text-white text-[11px] font-medium hover:bg-violet-500"
                title="Run until this step sequence completes, then pause"
              >
                Run to seq
              </button>
              <input
                type="number"
                min={0}
                placeholder="seq"
                value={advanceToSeq}
                onChange={(e) => setAdvanceToSeq(e.target.value)}
                className="w-14 rounded border border-gray-600 bg-gray-900 px-1.5 py-0.5 text-[11px] text-gray-100 tabular-nums"
                title="Step sequence to pause after (inclusive)"
              />
            </div>
          )}
          <div className="flex items-center gap-2 shrink-0">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-xs text-gray-400 capitalize">{status}</span>
            {activeStepSequence != null && (
              <span className="text-[10px] text-gray-500 tabular-nums">step {activeStepSequence}</span>
            )}
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center overflow-auto p-4">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain rounded shadow-2xl block bg-black/40"
          role="img"
          aria-label="Playback browser preview"
        />
        <p className="text-[10px] text-gray-500 text-center max-w-md px-4 mt-3">
          Read-only replay of your recorded steps. When paused, use <strong className="text-gray-400">Next step</strong>{' '}
          or <strong className="text-gray-400">Run to seq</strong> to continue under control. Close this window when
          finished.
        </p>
      </div>
    </div>
  );
}
