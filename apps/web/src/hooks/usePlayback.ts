import { useState, useCallback, useRef, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import { runsApi } from '@/lib/api';
import { createRecordingSocket } from '@/lib/recordingSocket';

export type PlaybackProgressPhase = 'before' | 'after' | 'error';

export interface PlaybackProgressPayload {
  runId: string;
  playbackSessionId: string;
  sourceRunId: string;
  step: { id: string; sequence: number; action: string; instruction: string };
  phase: PlaybackProgressPhase;
  error?: string;
}

export interface UsePlaybackReturn {
  playbackSessionId: string | null;
  sourceRunId: string | null;
  currentFrame: string | null;
  status: string;
  isPlaying: boolean;
  highlightSequence: number | null;
  completedSequences: Set<number>;
  playbackError: string | null;
  startPlayback: (runId: string, opts?: { delayMs?: number }) => Promise<void>;
  stopPlayback: () => Promise<void>;
}

function disconnectSocket(socketRef: MutableRefObject<Socket | null>, sessionId: string | null) {
  const s = socketRef.current;
  if (s && sessionId) {
    try {
      s.emit('leave', { runId: sessionId });
    } catch {
      /* ignore */
    }
    s.disconnect();
  }
  socketRef.current = null;
}

export function usePlayback(): UsePlaybackReturn {
  const [playbackSessionId, setPlaybackSessionId] = useState<string | null>(null);
  const [sourceRunId, setSourceRunId] = useState<string | null>(null);
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [highlightSequence, setHighlightSequence] = useState<number | null>(null);
  const [completedSequences, setCompletedSequences] = useState<Set<number>>(() => new Set());
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const activeSessionRef = useRef<string | null>(null);

  const bindSocket = useCallback((sessionId: string) => {
    disconnectSocket(socketRef, activeSessionRef.current);
    activeSessionRef.current = sessionId;

    const socket = createRecordingSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join', { runId: sessionId });
    });

    socket.on('frame', (data: { runId: string; data: string }) => {
      if (data.runId === sessionId) {
        setCurrentFrame(data.data);
      }
    });

    socket.on('playbackProgress', (payload: PlaybackProgressPayload) => {
      if (payload.runId !== sessionId && payload.playbackSessionId !== sessionId) return;

      if (payload.phase === 'before' || payload.phase === 'error') {
        setHighlightSequence(payload.step.sequence);
      }
      if (payload.phase === 'after') {
        setCompletedSequences((prev) => new Set(prev).add(payload.step.sequence));
        setHighlightSequence(payload.step.sequence);
      }
      if (payload.phase === 'error' && payload.error) {
        setPlaybackError(payload.error);
      }
    });

    socket.on('status', (data: { status: string; runId: string }) => {
      if (data.runId !== sessionId) return;
      setStatus(data.status);
      if (data.status === 'failed') {
        setIsPlaying(false);
        disconnectSocket(socketRef, sessionId);
        activeSessionRef.current = null;
        setPlaybackSessionId(null);
        setSourceRunId(null);
        /* keep highlight + completed so the failed step stays visible */
        return;
      }
      if (data.status === 'completed' || data.status === 'stopped') {
        setIsPlaying(false);
        disconnectSocket(socketRef, sessionId);
        activeSessionRef.current = null;
        setPlaybackSessionId(null);
        setSourceRunId(null);
        setHighlightSequence(null);
        setCompletedSequences(new Set());
      }
    });

    socket.on('disconnect', () => {
      /* keep state; user may see last frame */
    });
  }, []);

  const startPlayback = useCallback(
    async (runId: string, opts?: { delayMs?: number }) => {
      setPlaybackError(null);
      setCompletedSequences(new Set());
      setHighlightSequence(null);
      setCurrentFrame(null);
      const result = await runsApi.startPlayback(runId, opts);
      setPlaybackSessionId(result.playbackSessionId);
      setSourceRunId(result.sourceRunId);
      setIsPlaying(true);
      setStatus('playback');
      bindSocket(result.playbackSessionId);
    },
    [bindSocket],
  );

  const stopPlayback = useCallback(async () => {
    const id = playbackSessionId;
    if (!id) return;
    try {
      await runsApi.stopPlayback(id);
    } catch {
      /* still tear down locally */
    }
    disconnectSocket(socketRef, id);
    activeSessionRef.current = null;
    setIsPlaying(false);
    setStatus('stopped');
    setPlaybackSessionId(null);
    setSourceRunId(null);
    setHighlightSequence(null);
    setCompletedSequences(new Set());
  }, [playbackSessionId]);

  useEffect(() => {
    return () => {
      const id = activeSessionRef.current;
      if (id) {
        runsApi.stopPlayback(id).catch(() => {});
        disconnectSocket(socketRef, id);
        activeSessionRef.current = null;
      }
    };
  }, []);

  return {
    playbackSessionId,
    sourceRunId,
    currentFrame,
    status,
    isPlaying,
    highlightSequence,
    completedSequences,
    playbackError,
    startPlayback,
    stopPlayback,
  };
}
