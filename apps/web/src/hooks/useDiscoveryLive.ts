import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { createRecordingSocket } from '@/lib/recordingSocket';

/** Socket room id for project discovery live JPEG (matches API `discovery-${projectId}`). */
export function discoveryLiveRunId(projectId: string): string {
  return `discovery-${projectId}`;
}

/** Mirrors API `DiscoveryLlmExchangePayload` (project discovery LLM calls). */
export type DiscoveryLlmLogDetail = {
  kind: 'explore' | 'final';
  usageKey: 'project_discovery';
  sent: {
    systemPrompt: string;
    systemPromptTruncated?: boolean;
    userPrompt: string;
    userPromptTruncated?: boolean;
    hasImage: boolean;
    imageBase64?: string;
    imageTruncated?: boolean;
    imageOmittedDueToSize?: boolean;
    imageSizeChars?: number;
  };
  received: {
    content: string;
    contentTruncated?: boolean;
    thinking?: string;
  };
};

export type DiscoveryLogLine = {
  at: string;
  message: string;
  detail?: Record<string, unknown> & { llm?: DiscoveryLlmLogDetail };
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
  const llm = line.detail?.llm;
  if (llm) {
    return `${formatTime(line.at)} — ${msg} · expand row for SENT / RECEIVED`;
  }
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
  const [navigationMermaid, setNavigationMermaid] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const clearFrame = useCallback(() => setFrameDataUrl(null), []);

  useEffect(() => {
    if (!projectId || !enabled) {
      setFrameDataUrl(null);
      setConnected(false);
      setLogLines([]);
      setNavigationMermaid(null);
      return;
    }

    setLogLines([]);
    setNavigationMermaid(null);

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

    const onDiscoveryMermaid = (payload: { projectId: string; mermaid: string }) => {
      if (payload.projectId !== projectId) return;
      setNavigationMermaid(payload.mermaid ?? null);
    };

    socket.on('connect', onConnect);
    socket.on('frame', onFrame);
    socket.on('discoveryDebugLog', onDiscoveryLog);
    socket.on('discoveryDebugLogBatch', onDiscoveryLogBatch);
    socket.on('discoveryNavigationMermaid', onDiscoveryMermaid);
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
      setNavigationMermaid(null);
    };
  }, [projectId, enabled]);

  return { frameDataUrl, connected, clearFrame, logLines, formatLogTime, navigationMermaid };
}
