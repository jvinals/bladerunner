import { useState, useCallback, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import type { Socket } from 'socket.io-client';
import { runsApi, type AutoClerkOtpUiMode } from '@/lib/api';
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
  origin: 'MANUAL' | 'AI_DRIVEN' | 'AUTOMATIC';
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
  startRecording: (url: string, name: string, projectId?: string) => Promise<void>;
  stopRecording: () => Promise<void>;
  sendInstruction: (instruction: string) => Promise<RecordedStep | null>;
  /** Replace an existing step by re-running a natural-language instruction (active recording only). */
  reRecordStep: (stepId: string, instruction: string) => Promise<RecordedStep | null>;
  loadRunSteps: (runId: string) => Promise<void>;
  /** Clear loaded run/steps when not actively recording (e.g. after delete). */
  clearLoadedRun: () => void;
  /** Server deleted the run or aborted session; reset local recording state without calling stop API. */
  resetRecordingAfterRemoteDelete: () => void;
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
  /** One-shot Clerk auto sign-in on the remote page (API env). Pass OTP mode or `default` for server env. */
  clerkAutoSignIn: (otpMode?: AutoClerkOtpUiMode) => Promise<void>;
  clerkAutoSigningIn: boolean;
  clerkAutoSignInError: string | null;
}

export function useRecording(): UseRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  const [status, setStatus] = useState<string>('idle');
  const [socketConnected, setSocketConnected] = useState(false);
  const [clerkAutoSigningIn, setClerkAutoSigningIn] = useState(false);
  const [clerkAutoSignInError, setClerkAutoSignInError] = useState<string | null>(null);
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
      /** Sync steps after join — socket `step` events may have fired before this client entered the room. */
      void (async () => {
        try {
          const rows = (await runsApi.getSteps(recordRunId)) as RecordedStep[];
          setSteps(rows);
        } catch {
          /* ignore */
        }
      })();
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
        setSteps((prev) => {
          const idx = prev.findIndex((s) => s.id === data.step.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = data.step;
            return next;
          }
          return [...prev, data.step];
        });
      }
    });

    socket.on('status', (data: { status: string; runId: string }) => {
      if (data.runId === recordRunId) {
        setStatus(data.status);
        if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
          setIsRecording(false);
        }
      }
    });

    socketRef.current = socket;
  }, []);

  const startRecording = useCallback(async (url: string, name: string, projectId?: string) => {
    const result = await runsApi.startRecording({
      name,
      url,
      ...(projectId ? { projectId } : {}),
    });
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
    /** Do not clear currentFrame here — it wipes frames that arrived before React flushes; preview syncs via socket + connect refetch. */
    setIsRecording(true);
    setStatus('recording');
    setClerkAutoSignInError(null);
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

  const reRecordStep = useCallback(async (stepId: string, instruction: string): Promise<RecordedStep | null> => {
    if (!runId) return null;
    const result = await runsApi.reRecordStep(runId, stepId, instruction);
    return result.step as RecordedStep;
  }, [runId]);

  const loadRunSteps = useCallback(async (loadRunId: string) => {
    const stepsData = await runsApi.getSteps(loadRunId);
    setSteps(stepsData as RecordedStep[]);
    setRunId(loadRunId);
  }, []);

  const clearLoadedRun = useCallback(() => {
    if (isRecording) return;
    setSteps([]);
    setRunId(null);
    activeRunIdRef.current = null;
  }, [isRecording]);

  const resetRecordingAfterRemoteDelete = useCallback(() => {
    const id = activeRunIdRef.current ?? runId;
    activeRunIdRef.current = null;
    if (socketRef.current) {
      if (id) socketRef.current.emit('leave', { runId: id });
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setSocketConnected(false);
    setIsRecording(false);
    setStatus('idle');
    setRunId(null);
    setSteps([]);
    setCurrentFrame(null);
    setClerkAutoSignInError(null);
  }, [runId]);

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

  const clerkAutoSignIn = useCallback(async (otpMode: AutoClerkOtpUiMode = 'default') => {
    if (!runId) return;
    /** Paint loading state before the long server+Playwright await (H1: avoids perceived UI freeze). */
    flushSync(() => {
      setClerkAutoSignInError(null);
      setClerkAutoSigningIn(true);
    });
    try {
      const body =
        otpMode === 'default' ? {} : { clerkOtpMode: otpMode as 'clerk_test_email' | 'mailslurp' };
      await runsApi.clerkAutoSignInRecording(runId, body);
      try {
        const synced = (await runsApi.getSteps(runId)) as RecordedStep[];
        setSteps(synced);
      } catch {
        /* ignore */
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setClerkAutoSignInError(msg);
    } finally {
      setClerkAutoSigningIn(false);
    }
  }, [runId]);

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
    reRecordStep,
    loadRunSteps,
    clearLoadedRun,
    resetRecordingAfterRemoteDelete,
    sendRemotePointer,
    sendRemoteKey,
    sendRemoteTouch,
    sendRemoteClipboard,
    socketConnected,
    clerkAutoSignIn,
    clerkAutoSigningIn,
    clerkAutoSignInError,
  };
}
