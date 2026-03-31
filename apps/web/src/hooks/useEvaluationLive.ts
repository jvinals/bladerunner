import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { createRecordingSocket } from '@/lib/recordingSocket';

export type EvaluationProgressPayload = {
  evaluationId: string;
  phase?: string;
  sequence?: number;
  thinking?: string;
  playwrightCode?: string;
  expectedOutcome?: string;
  decision?: string;
  goalProgress?: string;
  rationale?: string;
  question?: string;
  options?: string[];
  progressSummaryBefore?: string;
  pageUrl?: string;
  pageUrlAfter?: string;
  executionOk?: boolean;
  errorMessage?: string | null;
  [key: string]: unknown;
};

type UseEvaluationLiveOptions = {
  /** When false, socket is disconnected. */
  enabled: boolean;
  /** After meaningful progress, refetch evaluation detail. */
  onStale?: () => void;
};

export function useEvaluationLive(evaluationId: string | undefined, options: UseEvaluationLiveOptions) {
  const { enabled, onStale } = options;
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [lastProgress, setLastProgress] = useState<EvaluationProgressPayload | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const onStaleRef = useRef(onStale);
  onStaleRef.current = onStale;

  const clearFrame = useCallback(() => setFrameDataUrl(null), []);

  useEffect(() => {
    if (!evaluationId || !enabled) {
      setFrameDataUrl(null);
      setConnected(false);
      return;
    }

    const socket = createRecordingSocket();
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      socket.emit('join', { runId: evaluationId });
    };

    const onFrame = (payload: { runId: string; data: string }) => {
      if (payload.runId !== evaluationId) return;
      setFrameDataUrl(`data:image/jpeg;base64,${payload.data}`);
    };

    const onEvaluationProgress = (payload: EvaluationProgressPayload) => {
      if (payload.evaluationId !== evaluationId) return;
      setLastProgress(payload);
      const phase = payload.phase;
      if (
        phase === 'analyzed' ||
        phase === 'completed' ||
        phase === 'waiting_human' ||
        phase === 'executing' ||
        phase === 'paused_review'
      ) {
        onStaleRef.current?.();
      }
    };

    socket.on('connect', onConnect);
    socket.on('frame', onFrame);
    socket.on('evaluationProgress', onEvaluationProgress);
    socket.on('disconnect', () => setConnected(false));

    if (socket.connected) onConnect();

    return () => {
      try {
        socket.emit('leave', { runId: evaluationId });
      } catch {
        /* ignore */
      }
      socket.off('connect', onConnect);
      socket.off('frame', onFrame);
      socket.off('evaluationProgress', onEvaluationProgress);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [evaluationId, enabled]);

  return { frameDataUrl, lastProgress, connected, clearFrame };
}
