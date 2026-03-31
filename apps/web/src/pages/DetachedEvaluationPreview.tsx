import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createRecordingSocket } from '@/lib/recordingSocket';

/**
 * Full-window live JPEG stream for an autonomous evaluation (same socket room as inline preview:
 * `join` with `runId` = evaluation id).
 */
export default function DetachedEvaluationPreview() {
  const { evaluationId } = useParams<{ evaluationId: string }>();
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!evaluationId) return;

    const socket = createRecordingSocket();

    const onConnect = () => {
      setConnected(true);
      socket.emit('join', { runId: evaluationId });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', () => setConnected(false));

    socket.on('frame', (payload: { runId: string; data: string }) => {
      if (payload.runId !== evaluationId) return;
      setFrameDataUrl(`data:image/jpeg;base64,${payload.data}`);
    });

    if (socket.connected) onConnect();

    return () => {
      try {
        socket.emit('leave', { runId: evaluationId });
      } catch {
        /* ignore */
      }
      socket.disconnect();
    };
  }, [evaluationId]);

  return (
    <div className="w-screen h-screen bg-gray-900 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-[#4B90FF] font-bold text-sm">Bladerunner</span>
          <span className="text-gray-400 text-xs">Detached evaluation preview</span>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-xs text-gray-400">{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center overflow-auto p-4">
        {frameDataUrl ? (
          <img
            src={frameDataUrl}
            alt="Evaluation browser stream"
            className="max-w-full max-h-full object-contain rounded shadow-2xl"
          />
        ) : (
          <p className="text-sm text-gray-500 text-center px-6">
            Waiting for frames… Start or resume the evaluation if the stream has not begun.
          </p>
        )}
      </div>
      <p className="text-[10px] text-gray-500 text-center px-4 py-2 border-t border-gray-800">
        Read-only stream · autonomous run controls stay in the main window
      </p>
    </div>
  );
}
