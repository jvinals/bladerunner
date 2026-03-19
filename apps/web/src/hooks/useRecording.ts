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
}

export function useRecording(): UseRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [currentFrame, setCurrentFrame] = useState<string | null>(null);
  const [steps, setSteps] = useState<RecordedStep[]>([]);
  const [status, setStatus] = useState<string>('idle');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const connectSocket = useCallback((recordRunId: string) => {
    const socket = createRecordingSocket();

    socket.on('connect', () => {
      // #region agent log
      fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5f6bd9'},body:JSON.stringify({sessionId:'5f6bd9',location:'useRecording.ts:connect',message:'recording socket connected',data:{runId:recordRunId},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      socket.emit('join', { runId: recordRunId });
    });

    socket.on('connect_error', (err: Error) => {
      // #region agent log
      fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5f6bd9'},body:JSON.stringify({sessionId:'5f6bd9',location:'useRecording.ts:connect_error',message:'recording socket failed',data:{runId:recordRunId,error:String(err?.message)},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      console.error('[useRecording] Socket connect_error:', err);
    });

    let firstFrameLogged = false;
    socket.on('frame', (data: { runId: string; data: string }) => {
      if (data.runId === recordRunId) {
        if (!firstFrameLogged) {
          firstFrameLogged = true;
          // #region agent log
          fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5f6bd9'},body:JSON.stringify({sessionId:'5f6bd9',location:'useRecording.ts:first_frame',message:'first screencast frame',data:{runId:recordRunId,bytes:data.data?.length??0},timestamp:Date.now(),hypothesisId:'C'})}).catch(()=>{});
          // #endregion
        }
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
    if (socketRef.current) {
      socketRef.current.emit('leave', { runId });
      socketRef.current.disconnect();
      socketRef.current = null;
    }
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
  };
}
