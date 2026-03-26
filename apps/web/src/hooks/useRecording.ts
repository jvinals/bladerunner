import { useState, useCallback, useRef, useEffect } from 'react';
import { flushSync } from 'react-dom';
import type { Socket } from 'socket.io-client';
import { runsApi, type AutoClerkOtpUiMode, type StartRecordingBody } from '@/lib/api';
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
  origin: 'MANUAL' | 'AI_DRIVEN' | 'AI_PROMPT' | 'AUTOMATIC';
  timestamp: string;
  /** Optional JSON from API (e.g. `clerk_auto_sign_in` step). */
  metadata?: unknown;
  /** When true, playback skips this step. */
  excludedFromPlayback?: boolean;
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

/** From recording socket `aiPromptTestProgress` during `test-ai-step`. */
export type AiPromptTestProgressPayload = {
  runId: string;
  stepId: string;
  message: string;
  phase: 'capturing' | 'llm' | 'executing' | 'done' | 'error' | 'cancelled';
  /** True while Gemini vision stream is in progress (`rawResponse` / `thinking` are cumulative). */
  streamingPartial?: boolean;
  /** Model reasoning / chain-of-thought when the API returns it (AI prompt test). */
  thinking?: string;
  /** JPEG base64 sent to the vision model (AI prompt test), after capture. */
  screenshotBase64?: string;
  /** Instruction string for this test run. */
  promptSent?: string;
  /** Full user message sent to the vision LLM. */
  fullUserPrompt?: string;
  /** Raw assistant output (usually JSON). */
  rawResponse?: string;
  /** Generated Playwright before execution. */
  playwrightCode?: string;
  /** From failure-help LLM when Test fails. */
  suggestedPrompt?: string;
};

interface UseRecordingReturn {
  isRecording: boolean;
  runId: string | null;
  currentFrame: string | null;
  steps: RecordedStep[];
  status: string;
  startRecording: (input: StartRecordingBody) => Promise<void>;
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
  /** Latest AI prompt test progress for this recording run (filter by `stepId` in UI). Cleared on terminal phases / disconnect. */
  aiPromptTestProgress: AiPromptTestProgressPayload | null;
  clearAiPromptTestProgress: () => void;
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
  const [aiPromptTestProgress, setAiPromptTestProgress] = useState<AiPromptTestProgressPayload | null>(null);
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
      setAiPromptTestProgress(null);
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

    socket.on('aiPromptTestProgress', (payload: Record<string, unknown>) => {
      const runId = typeof payload.runId === 'string' ? payload.runId : '';
      if (runId !== recordRunId) return;
      const stepId = typeof payload.stepId === 'string' ? payload.stepId : '';
      const message = typeof payload.message === 'string' ? payload.message : '';
      const phase = payload.phase as AiPromptTestProgressPayload['phase'];
      if (!stepId || !message) return;
      setAiPromptTestProgress((prev) => {
        const sameStep = prev?.runId === runId && prev?.stepId === stepId;
        const streamingPartial = payload.streamingPartial === true;
        const pick = (key: keyof AiPromptTestProgressPayload): string | undefined => {
          const v = payload[key];
          if (typeof v === 'string' && v.trim()) return v.trim();
          if (sameStep) {
            const p = prev?.[key];
            if (typeof p === 'string' && p.trim()) return p.trim();
          }
          return undefined;
        };
        const thinking =
          streamingPartial && typeof payload.thinking === 'string'
            ? payload.thinking
            : pick('thinking');
        const screenshotBase64 = pick('screenshotBase64');
        const promptSent = pick('promptSent');
        const fullUserPrompt = pick('fullUserPrompt');
        const rawResponse =
          streamingPartial && typeof payload.rawResponse === 'string'
            ? payload.rawResponse
            : pick('rawResponse');
        const playwrightCode = pick('playwrightCode');
        const suggestedPrompt = pick('suggestedPrompt');
        const normalized: AiPromptTestProgressPayload = {
          runId,
          stepId,
          message,
          phase,
          streamingPartial,
          ...(thinking ? { thinking } : {}),
          ...(screenshotBase64 ? { screenshotBase64 } : {}),
          ...(promptSent ? { promptSent } : {}),
          ...(fullUserPrompt ? { fullUserPrompt } : {}),
          ...(rawResponse ? { rawResponse } : {}),
          ...(playwrightCode ? { playwrightCode } : {}),
          ...(suggestedPrompt ? { suggestedPrompt } : {}),
        };
        return normalized;
      });
    });

    socketRef.current = socket;
  }, []);

  const clearAiPromptTestProgress = useCallback(() => {
    setAiPromptTestProgress(null);
  }, []);

  const startRecording = useCallback(async (input: StartRecordingBody) => {
    const result = await runsApi.startRecording(input);
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
    setAiPromptTestProgress(null);
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
    aiPromptTestProgress,
    clearAiPromptTestProgress,
    clerkAutoSignIn,
    clerkAutoSigningIn,
    clerkAutoSignInError,
  };
}
