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

export type EvaluationDebugLogLine = {
  at: string;
  message: string;
  detail?: Record<string, unknown>;
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
  const [evaluationTrace, setEvaluationTrace] = useState<EvaluationDebugLogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const onStaleRef = useRef(onStale);
  onStaleRef.current = onStale;

  const clearFrame = useCallback(() => setFrameDataUrl(null), []);

  useEffect(() => {
    if (!evaluationId || !enabled) {
      setFrameDataUrl(null);
      setEvaluationTrace([]);
      setConnected(false);
      return;
    }

    setEvaluationTrace([]);

    const socket = createRecordingSocket();
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      // #region agent log
      fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '3619df' },
        body: JSON.stringify({
          sessionId: '3619df',
          hypothesisId: 'H1-verify',
          location: 'useEvaluationLive.ts:onConnect',
          message: 'recording socket connected and joining room',
          data: { evaluationId, enabled: true },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion
      socket.emit('join', { runId: evaluationId });
    };

    const onFrame = (payload: { runId: string; data: string }) => {
      if (payload.runId !== evaluationId) return;
      setFrameDataUrl(`data:image/jpeg;base64,${payload.data}`);
    };

    const onEvaluationDebugLog = (payload: EvaluationDebugLogLine & { evaluationId: string }) => {
      if (payload.evaluationId !== evaluationId) return;
      const { evaluationId: _e, ...line } = payload;
      setEvaluationTrace((prev) => [...prev, line]);
    };

    const onEvaluationDebugLogBatch = (payload: { evaluationId: string; lines: EvaluationDebugLogLine[] }) => {
      if (payload.evaluationId !== evaluationId) return;
      setEvaluationTrace(payload.lines ?? []);
    };

    const onEvaluationProgress = (payload: EvaluationProgressPayload) => {
      if (payload.evaluationId !== evaluationId) return;
      setLastProgress(payload);
      const phase = payload.phase;
      if (
        phase === 'proposing' ||
        phase === 'analyzing' ||
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
    socket.on('evaluationDebugLog', onEvaluationDebugLog);
    socket.on('evaluationDebugLogBatch', onEvaluationDebugLogBatch);
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
      socket.off('evaluationDebugLog', onEvaluationDebugLog);
      socket.off('evaluationDebugLogBatch', onEvaluationDebugLogBatch);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [evaluationId, enabled]);

  return { frameDataUrl, lastProgress, evaluationTrace, connected, clearFrame };
}
