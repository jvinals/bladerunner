import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { createRecordingSocket } from '@/lib/recordingSocket';

/** Socket room id for project discovery live JPEG (matches API `discovery-${projectId}`). */
export function discoveryLiveRunId(projectId: string): string {
  return `discovery-${projectId}`;
}

export type DiscoveryLogLine = {
  at: string;
  message: string;
  detail?: Record<string, unknown>;
};

type UseDiscoveryLiveOptions = {
  enabled: boolean;
};

function formatLogTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** One log entry as a single line (timestamp — message [detail JSON]). */
export function formatDiscoveryLogSingleLine(
  line: DiscoveryLogLine,
  formatTime: (iso: string) => string,
): string {
  const msg = (line.message ?? '').replace(/\s+/g, ' ').trim();
  const detail =
    line.detail != null && Object.keys(line.detail).length > 0
      ? ` ${JSON.stringify(line.detail)}`
      : '';
  return `${formatTime(line.at)} — ${msg}${detail}`;
}

/**
 * Live browser preview + discovery agent log during Run app discovery (join `run:discovery-${projectId}`).
 */
export function useDiscoveryLive(projectId: string | undefined, options: UseDiscoveryLiveOptions) {
  const { enabled } = options;
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [logLines, setLogLines] = useState<DiscoveryLogLine[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const clearFrame = useCallback(() => setFrameDataUrl(null), []);

  useEffect(() => {
    if (!projectId || !enabled) {
      setFrameDataUrl(null);
      setConnected(false);
      setLogLines([]);
      return;
    }

    setLogLines([]);

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

    const onDiscoveryLog = (payload: DiscoveryLogLine & { projectId: string }) => {
      if (payload.projectId !== projectId) return;
      const { projectId: _p, ...line } = payload;
      setLogLines((prev) => [...prev, line]);
    };

    const onDiscoveryLogBatch = (payload: { projectId: string; lines: DiscoveryLogLine[] }) => {
      if (payload.projectId !== projectId) return;
      setLogLines(payload.lines ?? []);
    };

    socket.on('connect', onConnect);
    socket.on('frame', onFrame);
    socket.on('discoveryDebugLog', onDiscoveryLog);
    socket.on('discoveryDebugLogBatch', onDiscoveryLogBatch);
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
      setLogLines([]);
    };
  }, [projectId, enabled]);

  return { frameDataUrl, connected, clearFrame, logLines, formatLogTime };
}
