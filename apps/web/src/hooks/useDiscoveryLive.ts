import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { createRecordingSocket } from '@/lib/recordingSocket';

/** Socket room id for project discovery live JPEG (matches API `discovery-${projectId}`). */
export function discoveryLiveRunId(projectId: string): string {
  return `discovery-${projectId}`;
}

type UseDiscoveryLiveOptions = {
  enabled: boolean;
};

/**
 * Live browser preview during Run app discovery (same recording gateway as evaluations; join `run:discovery-${projectId}`).
 */
export function useDiscoveryLive(projectId: string | undefined, options: UseDiscoveryLiveOptions) {
  const { enabled } = options;
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const clearFrame = useCallback(() => setFrameDataUrl(null), []);

  useEffect(() => {
    if (!projectId || !enabled) {
      setFrameDataUrl(null);
      setConnected(false);
      return;
    }

    const runId = discoveryLiveRunId(projectId);
    const socket = createRecordingSocket();
    socketRef.current = socket;

    const onConnect = () => {
      setConnected(true);
      socket.emit('join', { runId });
    };

    const onFrame = (payload: { runId: string; data: string }) => {
      if (payload.runId !== runId) return;
      setFrameDataUrl(`data:image/jpeg;base64,${payload.data}`);
    };

    socket.on('connect', onConnect);
    socket.on('frame', onFrame);
    socket.on('disconnect', () => setConnected(false));

    if (socket.connected) onConnect();

    return () => {
      try {
        socket.emit('leave', { runId });
      } catch {
        /* ignore */
      }
      socket.disconnect();
      socketRef.current = null;
      setFrameDataUrl(null);
      setConnected(false);
    };
  }, [projectId, enabled]);

  return { frameDataUrl, connected, clearFrame };
}
