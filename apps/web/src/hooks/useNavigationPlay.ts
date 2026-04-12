/**
 * Socket.IO room `run:play:{navId}` — Skyvern-driven play with frames from run screenshot polling.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createRecordingSocket } from '@/lib/recordingSocket';
import { navigationsApi } from '@/lib/api';
import type { Socket } from 'socket.io-client';

export interface UseNavigationPlayReturn {
  isPlaying: boolean;
  connected: boolean;
  frameDataUrl: string | null;
  playError: string | null;
  runStatus: string | null;
  skyvernRunId: string | null;
  startPlay: (parameters?: Record<string, string>) => Promise<void>;
  stopPlay: () => Promise<void>;
}

export function useNavigationPlay(navId: string | undefined): UseNavigationPlayReturn {
  const queryClient = useQueryClient();
  const [isPlaying, setIsPlaying] = useState(false);
  const [connected, setConnected] = useState(false);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [skyvernRunId, setSkyvernRunId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const roomIdRef = useRef<string | null>(null);

  const playRoomId = useCallback((id: string) => `play:${id}`, []);

  useEffect(() => {
    if (!navId) return;

    const socket = createRecordingSocket();
    socketRef.current = socket;
    const roomId = playRoomId(navId);
    roomIdRef.current = roomId;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join', { runId: roomId });
      void navigationsApi
        .recordingSession(navId)
        .then((s) => {
          if (s.playActive) {
            setIsPlaying(true);
            setRunStatus(s.playStatus ?? 'running');
            if (s.skyvernRunId) setSkyvernRunId(s.skyvernRunId);
          }
        })
        .catch(() => {});
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('frame', (payload: { runId: string; data: string }) => {
      if (payload.runId !== roomId) return;
      setFrameDataUrl(`data:image/jpeg;base64,${payload.data}`);
    });

    socket.on('navPlay:started', (payload: { navId: string; skyvernRunId?: string }) => {
      if (payload.navId !== navId) return;
      setIsPlaying(true);
      setPlayError(null);
      if (payload.skyvernRunId) setSkyvernRunId(payload.skyvernRunId);
      setRunStatus('running');
    });

    socket.on(
      'navPlay:runUpdate',
      (payload: { navId: string; status?: string; failureReason?: string | null }) => {
        if (payload.navId !== navId) return;
        if (payload.status) setRunStatus(payload.status);
        if (payload.failureReason) setPlayError(payload.failureReason);
      },
    );

    socket.on('navPlay:ended', (payload: { navId: string }) => {
      if (payload.navId !== navId) return;
      setIsPlaying(false);
      setRunStatus(null);
      setSkyvernRunId(null);
      void queryClient.invalidateQueries({ queryKey: ['navigation', navId] });
    });

    return () => {
      socket.emit('leave', { runId: roomId });
      socket.disconnect();
      socketRef.current = null;
      roomIdRef.current = null;
    };
  }, [navId, playRoomId, queryClient]);

  const startPlay = useCallback(
    async (parameters?: Record<string, string>) => {
      if (!navId) return;
      setPlayError(null);
      try {
        const res = await navigationsApi.playStart(navId, { parameters });
        setSkyvernRunId(res.skyvernRunId);
        setIsPlaying(true);
      } catch (e) {
        setPlayError(e instanceof Error ? e.message : String(e));
        setIsPlaying(false);
      }
    },
    [navId],
  );

  const stopPlay = useCallback(async () => {
    if (!navId) return;
    try {
      await navigationsApi.playStop(navId);
    } catch (e) {
      setPlayError(e instanceof Error ? e.message : String(e));
    }
    setIsPlaying(false);
    setFrameDataUrl(null);
    setRunStatus(null);
    setSkyvernRunId(null);
  }, [navId]);

  return {
    isPlaying,
    connected,
    frameDataUrl,
    playError,
    runStatus,
    skyvernRunId,
    startPlay,
    stopPlay,
  };
}
