import { useState, useCallback, useRef, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import { runsApi, type StartPlaybackBody } from '@/lib/api';
import { createRecordingSocket } from '@/lib/recordingSocket';

export type PlaybackProgressPhase = 'before' | 'after' | 'error' | 'skipped';

export interface PlaybackProgressPayload {
  runId: string;
  playbackSessionId: string;
  sourceRunId: string;
  step: { id: string; sequence: number; action: string; instruction: string };
  phase: PlaybackProgressPhase;
  error?: string;
}

type PlaybackStatusPayload = {
  status: string;
  runId: string;
  sourceRunId?: string;
  error?: string;
};

export interface UsePlaybackReturn {
  playbackSessionId: string | null;
  sourceRunId: string | null;
  currentFrame: string | null;
  status: string;
  isPlaying: boolean;
  /** True when server reports `playback_paused` */
  isPaused: boolean;
  highlightSequence: number | null;
  completedSequences: Set<number>;
  playbackError: string | null;
  startPlayback: (runId: string, opts?: StartPlaybackBody) => Promise<void>;
  stopPlayback: () => Promise<void>;
  pausePlayback: () => Promise<void>;
  resumePlayback: () => Promise<void>;
  /** Paused only: run one step then pause again */
  advancePlaybackOne: () => Promise<void>;
  /** Paused only: run until step sequence completes, then pause */
  advancePlaybackTo: (stopAfterSequence: number) => Promise<void>;
  /** Stop and start a new session with the same options */
  restartPlayback: () => Promise<void>;
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
  const [isPaused, setIsPaused] = useState(false);
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

    const teardownAfterSocketFailure = (message: string) => {
      setPlaybackError(message);
      setIsPlaying(false);
      setIsPaused(false);
      setStatus('idle');
      disconnectSocket(socketRef, sessionId);
      activeSessionRef.current = null;
      setPlaybackSessionId(null);
      setSourceRunId(null);
    };

    socket.on('connect', () => {
      socket.emit('join', { runId: sessionId });
    });

    socket.on('connect_error', (err: Error) => {
      const msg = err?.message ? `Playback stream: ${err.message}` : 'Playback stream failed to connect';
      teardownAfterSocketFailure(msg);
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
      if (payload.phase === 'after' || payload.phase === 'skipped') {
        setCompletedSequences((prev) => new Set(prev).add(payload.step.sequence));
        setHighlightSequence(payload.step.sequence);
      }
      if (payload.phase === 'error' && payload.error) {
        setPlaybackError(payload.error);
      }
    });

    socket.on('status', (data: PlaybackStatusPayload) => {
      if (data.runId !== sessionId) return;
      // #region agent log
      fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5cf234' },
        body: JSON.stringify({
          sessionId: '5cf234',
          location: 'usePlayback.ts:socket.status',
          message: 'status event',
          data: { incoming: data.status },
          timestamp: Date.now(),
          hypothesisId: 'H4',
        }),
      }).catch(() => {});
      // #endregion
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
      setStatus(data.status);
      if (data.status === 'failed') {
        if (data.error) {
          setPlaybackError(data.error);
        }
        setIsPlaying(false);
        setIsPaused(false);
        disconnectSocket(socketRef, sessionId);
        activeSessionRef.current = null;
        setPlaybackSessionId(null);
        setSourceRunId(null);
        /* keep highlight + completed so the failed step stays visible */
        return;
      }
      if (data.status === 'completed' || data.status === 'stopped') {
        setIsPlaying(false);
        setIsPaused(false);
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
    async (runId: string, opts?: StartPlaybackBody) => {
      setPlaybackError(null);
      setCompletedSequences(new Set());
      setHighlightSequence(null);
      setCurrentFrame(null);
      setIsPaused(false);
      try {
        const result = await runsApi.startPlayback(runId, opts);
        setPlaybackSessionId(result.playbackSessionId);
        setSourceRunId(result.sourceRunId);
        setIsPlaying(true);
        setStatus('playback');
        bindSocket(result.playbackSessionId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setPlaybackError(msg);
        setIsPlaying(false);
        setIsPaused(false);
        setStatus('idle');
        setPlaybackSessionId(null);
        setSourceRunId(null);
      }
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
    setIsPaused(false);
    setStatus('stopped');
    setPlaybackSessionId(null);
    setSourceRunId(null);
    setHighlightSequence(null);
    setCompletedSequences(new Set());
  }, [playbackSessionId]);

  const pausePlayback = useCallback(async () => {
    const id = playbackSessionId;
    if (!id) return;
    try {
      await runsApi.pausePlayback(id);
    } catch {
      /* ignore */
    }
  }, [playbackSessionId]);

  const resumePlayback = useCallback(async () => {
    const id = playbackSessionId;
    if (!id) return;
    try {
      await runsApi.resumePlayback(id);
    } catch {
      /* ignore */
    }
  }, [playbackSessionId]);

  const advancePlaybackOne = useCallback(async () => {
    const id = playbackSessionId;
    if (!id) return;
    setPlaybackError(null);
    try {
      await runsApi.advancePlaybackOne(id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPlaybackError(msg);
    }
  }, [playbackSessionId]);

  const advancePlaybackTo = useCallback(async (stopAfterSequence: number) => {
    const id = playbackSessionId;
    if (!id) return;
    setPlaybackError(null);
    try {
      await runsApi.advancePlaybackTo(id, stopAfterSequence);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPlaybackError(msg);
    }
  }, [playbackSessionId]);

  const restartPlayback = useCallback(async () => {
    const id = playbackSessionId;
    if (!id) return;
    setPlaybackError(null);
    try {
      const result = await runsApi.restartPlayback(id);
      setPlaybackSessionId(result.playbackSessionId);
      setSourceRunId(result.sourceRunId);
      setIsPlaying(true);
      setIsPaused(false);
      setStatus('playback');
      setCompletedSequences(new Set());
      setHighlightSequence(null);
      setCurrentFrame(null);
      bindSocket(result.playbackSessionId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setPlaybackError(msg);
      setIsPlaying(false);
      setPlaybackSessionId(null);
      setSourceRunId(null);
    }
  }, [playbackSessionId, bindSocket]);

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

  useEffect(() => {
    // #region agent log
    fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '5cf234' },
      body: JSON.stringify({
        sessionId: '5cf234',
        location: 'usePlayback.ts:renderState',
        message: 'isPaused/status',
        data: { isPaused, status, isPlaying },
        timestamp: Date.now(),
        hypothesisId: 'H4',
      }),
    }).catch(() => {});
    // #endregion
  }, [isPaused, status, isPlaying]);

  return {
    playbackSessionId,
    sourceRunId,
    currentFrame,
    status,
    isPlaying,
    isPaused,
    highlightSequence,
    completedSequences,
    playbackError,
    startPlayback,
    stopPlayback,
    pausePlayback,
    resumePlayback,
    advancePlaybackOne,
    advancePlaybackTo,
    restartPlayback,
  };
}
