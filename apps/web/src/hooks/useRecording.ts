import { useState, useCallback, useRef, useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { runsApi } from '@/lib/api';
import { createRecordingSocket } from '@/lib/recordingSocket';

export interface RecordedStep {
  id: string;
  runId: string;
  sequence: number;
  action: string;
  selector?: string;
  value?: string;
  instruction: string;
  playwrightCode: string;
  origin: 'MANUAL' | 'AI_DRIVEN';
  timestamp: string;
}

export type RemotePointerPayload = {
  kind: 'move' | 'down' | 'up' | 'wheel' | 'dblclick';
  x?: number;
  y?: number;
  button?: 'left' | 'right' | 'middle';
  deltaX?: number;
  deltaY?: number;
};

export type RemoteTouchPhase = 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel';

export type RemoteTouchPoint = { id: number; x: number; y: number; force?: number };

interface UseRecordingReturn {
  isRecording: boolean;
  runId: string | null;
  currentFrame: string | null;
  steps: RecordedStep[];
  status: string;
  startRecording: (url: string, name: string) => Promise<void>;
  stopRecording: () => Promise<void>;
  sendInstruction: (instruction: string) => Promise<RecordedStep | null>;
  loadRunSteps: (runId: string) => Promise<void>;
  /** Forward pointer events to the remote Playwright page (requires active socket + run). */
  sendRemotePointer: (userId: string, payload: RemotePointerPayload) => void;
  /** Forward keyboard to the remote page (preview must be focused). */
  sendRemoteKey: (userId: string, type: 'down' | 'up', key: string) => void;
  /** Touch / swipe / pinch (CDP) — use with passive: false touch handlers on the canvas. */
  sendRemoteTouch: (
    userId: string,
    payload: { type: RemoteTouchPhase; touchPoints: RemoteTouchPoint[] },
  ) => void;
  /** Clipboard bridge: paste text into remote, or pull/cut selection to return text (async ack). */
  sendRemoteClipboard: (
    userId: string,
    action: 'paste' | 'pull' | 'cut',
    text?: string,
  ) => Promise<string | undefined>;
  /** True when the recording socket is connected (for UI / clipboard). */
  socketConnected: boolean;
}

export function useRecording(): UseRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  const [status, setStatus] = useState<string>('idle');
  const [socketConnected, setSocketConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  /** Set synchronously when a recording starts so pointer/key work before React re-renders. */
  const activeRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const connectSocket = useCallback((recordRunId: string) => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    const socket = createRecordingSocket();

    socket.on('connect', () => {
      setSocketConnected(true);
      socket.emit('join', { runId: recordRunId });
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('connect_error', (err: Error) => {
      setSocketConnected(false);
      console.error('[useRecording] Socket connect_error:', err);
    });

    socket.on('frame', (data: { runId: string; data: string }) => {
      if (data.runId === recordRunId) {
        setCurrentFrame(data.data);
      }
    });

    socket.on('step', (data: { runId: string; step: RecordedStep }) => {
      if (data.runId === recordRunId) {
        setSteps((prev) => [...prev, data.step]);
      }
    });

    socket.on('status', (data: { status: string; runId: string }) => {
      if (data.runId === recordRunId) {
        setStatus(data.status);
        if (data.status === 'completed' || data.status === 'failed') {
          setIsRecording(false);
        }
      }
    });

    socketRef.current = socket;
  }, []);

  const startRecording = useCallback(async (url: string, name: string) => {
    const result = await runsApi.startRecording({ name, url });
    activeRunIdRef.current = result.runId;
    connectSocket(result.runId);
    let initialSteps: RecordedStep[] = [];
    try {
      initialSteps = (await runsApi.getSteps(result.runId)) as RecordedStep[];
    } catch {
      /* steps may still arrive via socket */
    }
    setRunId(result.runId);
    setSteps(initialSteps);
    setCurrentFrame(null);
    setIsRecording(true);
    setStatus('recording');
  }, [connectSocket]);

  const stopRecording = useCallback(async () => {
    if (!runId) return;
    await runsApi.stopRecording(runId);
    activeRunIdRef.current = null;
    if (socketRef.current) {
      socketRef.current.emit('leave', { runId });
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setSocketConnected(false);
    setIsRecording(false);
    setStatus('completed');
    setCurrentFrame(null);
  }, [runId]);

  const sendInstruction = useCallback(async (instruction: string): Promise<RecordedStep | null> => {
    if (!runId) return null;
    const result = await runsApi.instruct(runId, instruction);
    return result.step as RecordedStep;
  }, [runId]);

  const loadRunSteps = useCallback(async (loadRunId: string) => {
    const stepsData = await runsApi.getSteps(loadRunId);
    setSteps(stepsData as RecordedStep[]);
    setRunId(loadRunId);
  }, []);

  const sendRemotePointer = useCallback((userId: string, payload: RemotePointerPayload) => {
    const id = activeRunIdRef.current ?? runId;
    const s = socketRef.current;
    if (!id || !s?.connected) return;
    s.emit('pointer', { runId: id, userId, ...payload });
  }, [runId]);

  const sendRemoteKey = useCallback((userId: string, type: 'down' | 'up', key: string) => {
    const id = activeRunIdRef.current ?? runId;
    const s = socketRef.current;
    if (!id || !s?.connected) return;
    s.emit('key', { runId: id, userId, type, key });
  }, [runId]);

  const sendRemoteTouch = useCallback(
    (userId: string, payload: { type: RemoteTouchPhase; touchPoints: RemoteTouchPoint[] }) => {
      const id = activeRunIdRef.current ?? runId;
      const s = socketRef.current;
      if (!id || !s?.connected) return;
      s.emit('touch', { runId: id, userId, type: payload.type, touchPoints: payload.touchPoints });
    },
    [runId],
  );

  const sendRemoteClipboard = useCallback(
    (userId: string, action: 'paste' | 'pull' | 'cut', text?: string): Promise<string | undefined> => {
      const id = activeRunIdRef.current ?? runId;
      const s = socketRef.current;
      if (!id || !s?.connected) return Promise.resolve(undefined);
      return new Promise((resolve) => {
        s.emit(
          'clipboard',
          { runId: id, userId, action, text },
          (res: { ok?: boolean; text?: string }) => {
            resolve(res?.text);
          },
        );
      });
    },
    [runId],
  );

  return {
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
  };
}
