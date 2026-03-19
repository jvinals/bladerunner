import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useUser } from '@clerk/react';
import type { Socket } from 'socket.io-client';
import { createRecordingSocket } from '@/lib/recordingSocket';
import type {
  RemotePointerPayload,
  RemoteTouchPhase,
  RemoteTouchPoint,
} from '@/hooks/useRecording';
import {
  useRemotePreviewCanvas,
  type RemotePreviewBridge,
} from '@/hooks/useRemotePreviewCanvas';

export default function DetachedPreview() {
  const { runId } = useParams<{ runId: string }>();
  const { user } = useUser();
  const userId = user?.id ?? '';
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewFocusRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string>('connecting');

  useEffect(() => {
    if (!runId) return;

    const socket: Socket = createRecordingSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setStatus('connected');
      socket.emit('join', { runId });
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setStatus('disconnected');
    });

    socket.on('frame', (data: { runId: string; data: string }) => {
      if (data.runId !== runId || !canvasRef.current) return;
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

    socket.on('status', (data: { status: string }) => {
      setStatus(data.status);
    });

    return () => {
      socket.emit('leave', { runId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [runId]);

  const emitPointer = useCallback(
    (payload: RemotePointerPayload) => {
      if (!runId || !userId || !socketRef.current?.connected) return;
      socketRef.current.emit('pointer', { runId, userId, ...payload });
    },
    [runId, userId],
  );

  const emitKey = useCallback(
    (type: 'down' | 'up', key: string) => {
      if (!runId || !userId || !socketRef.current?.connected) return;
      socketRef.current.emit('key', { runId, userId, type, key });
    },
    [runId, userId],
  );

  const emitTouch = useCallback(
    (type: RemoteTouchPhase, touchPoints: RemoteTouchPoint[]) => {
      if (!runId || !userId || !socketRef.current?.connected) return;
      socketRef.current.emit('touch', { runId, userId, type, touchPoints });
    },
    [runId, userId],
  );

  const emitClipboard = useCallback(
    (action: 'paste' | 'pull' | 'cut', text?: string): Promise<string | undefined> => {
      if (!runId || !userId || !socketRef.current?.connected) return Promise.resolve(undefined);
      return new Promise((resolve) => {
        socketRef.current!.emit(
          'clipboard',
          { runId, userId, action, text },
          (res: { ok?: boolean; text?: string }) => resolve(res?.text),
        );
      });
    },
    [runId, userId],
  );

  const previewBridge = useMemo<RemotePreviewBridge>(
    () => ({
      pointer: emitPointer,
      key: emitKey,
      touch: emitTouch,
      clipboard: emitClipboard,
      isConnected: () => !!socketRef.current?.connected,
    }),
    [emitPointer, emitKey, emitTouch, emitClipboard],
  );

  const { canvasProps, previewProps } = useRemotePreviewCanvas(
    userId,
    canvasRef,
    previewFocusRef,
    previewBridge,
    { isActive: !!runId && connected },
  );

  return (
    <div className="w-screen h-screen bg-gray-900 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-[#4B90FF] font-bold text-sm">Bladerunner</span>
          <span className="text-gray-400 text-xs">Detached Preview</span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              connected ? 'bg-green-400' : 'bg-red-400'
            }`}
          />
          <span className="text-xs text-gray-400 capitalize">{status}</span>
        </div>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center overflow-auto p-4 gap-2">
        <div ref={previewFocusRef} {...previewProps}>
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-full object-contain rounded shadow-2xl block touch-none cursor-crosshair select-none"
            {...canvasProps}
            role="img"
            aria-label="Remote browser preview"
          />
        </div>
        <p className="text-[10px] text-gray-500 text-center max-w-md px-4">
          Mouse, touch (swipe/pinch), scroll, double-click. Click preview to type; ⌘/Ctrl+C/V/X copy, paste, cut. Esc
          exits keyboard focus.
        </p>
      </div>
    </div>
  );
}
