import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { createRecordingSocket } from '@/lib/recordingSocket';

export default function DetachedPreview() {
  const { runId } = useParams<{ runId: string }>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string>('connecting');

  useEffect(() => {
    if (!runId) return;

    const socket: Socket = createRecordingSocket();

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
    };
  }, [runId]);

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
      <div className="flex-1 flex items-center justify-center overflow-auto p-4">
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain rounded shadow-2xl"
        />
      </div>
    </div>
  );
}
