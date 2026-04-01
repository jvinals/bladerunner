import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { createRecordingSocket } from '@/lib/recordingSocket';
import { discoveryLiveRunId } from '@/hooks/useDiscoveryLive';

/**
 * Full-window live JPEG stream for project discovery (join `run:discovery-${projectId}`).
 */
export default function DetachedDiscoveryPreview() {
  const { projectId } = useParams<{ projectId: string }>();
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!projectId) return;

    const runId = discoveryLiveRunId(projectId);
    const socket = createRecordingSocket();

    const onConnect = () => {
      setConnected(true);
      socket.emit('join', { runId });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', () => setConnected(false));

    socket.on('frame', (payload: { runId: string; data: string }) => {
      if (payload.runId !== runId) return;
      setFrameDataUrl(`data:image/jpeg;base64,${payload.data}`);
    });

    if (socket.connected) onConnect();

    return () => {
      try {
        socket.emit('leave', { runId });
      } catch {
        /* ignore */
      }
      socket.disconnect();
    };
  }, [projectId]);

  return (
    <div className="w-screen h-screen bg-gray-900 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-3">
          <span className="text-[#4B90FF] font-bold text-sm">Bladerunner</span>
          <span className="text-gray-400 text-xs">Detached discovery preview</span>
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
            alt="Discovery browser stream"
            className="max-w-full max-h-full object-contain rounded shadow-2xl"
          />
        ) : (
          <p className="text-sm text-gray-500 text-center px-6">
            Waiting for frames… Run app discovery from Projects if the stream has not begun.
          </p>
        )}
      </div>
      <p className="text-[10px] text-gray-500 text-center px-4 py-2 border-t border-gray-800">
        Read-only stream · controls stay on the Projects page
      </p>
    </div>
  );
}
