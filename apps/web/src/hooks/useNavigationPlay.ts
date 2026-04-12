/**
 * Socket.IO room `run:play:{navId}` — Skyvern-driven play with frames from run screenshot polling.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createRecordingSocket } from '@/lib/recordingSocket';
import { navigationsApi } from '@/lib/api';
import type { Socket } from 'socket.io-client';

// #region agent log
const _navPlayIngest =
  'http://127.0.0.1:7445/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43';
function _navPlayClientLog(payload: Record<string, unknown>): void {
  void fetch(_navPlayIngest, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd7957e' },
    body: JSON.stringify({ sessionId: 'd7957e', timestamp: Date.now(), ...payload }),
  }).catch(() => {});
}
// #endregion

export interface UseNavigationPlayReturn {
  isPlaying: boolean;
  connected: boolean;
  frameDataUrl: string | null;
  playError: string | null;
  runStatus: string | null;
  skyvernRunId: string | null;
  /** Recorded action `sequence` for the workflow block Skyvern is on (or starting). */
  playActiveSequence: number | null;
  startPlay: (parameters?: Record<string, string>) => Promise<void>;
  stopPlay: () => Promise<void>;
}

export function useNavigationPlay(
  navId: string | undefined,
  /** Debug: persisted action `sequence` values — used only for NDJSON correlation (H4). */
  persistedSequences?: number[],
): UseNavigationPlayReturn {
  const queryClient = useQueryClient();
  const [isPlaying, setIsPlaying] = useState(false);
  const [connected, setConnected] = useState(false);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [skyvernRunId, setSkyvernRunId] = useState<string | null>(null);
  const [playActiveSequence, setPlayActiveSequence] = useState<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const lastRunUpdateSeqRef = useRef<number | null | undefined>(undefined);
  const firstFrameLoggedRef = useRef(false);
  const persistedSeqRef = useRef<number[] | undefined>(persistedSequences);
  persistedSeqRef.current = persistedSequences;

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
      // #region agent log
      _navPlayClientLog({
        hypothesisId: 'H1',
        location: 'useNavigationPlay.connect',
        message: 'socket connected + join',
        data: { roomId: roomId.slice(-24), navIdTail: navId.slice(-8) },
      });
      // #endregion
      void navigationsApi
        .recordingSession(navId)
        .then((s) => {
          if (s.playActive) {
            setIsPlaying(true);
            setRunStatus(s.playStatus ?? 'running');
            if (s.skyvernRunId) setSkyvernRunId(s.skyvernRunId);
            if (s.playActiveSequence !== undefined) setPlayActiveSequence(s.playActiveSequence);
          }
        })
        .catch(() => {});
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('frame', (payload: { runId: string; data: string; mime?: string }) => {
      if (payload.runId !== roomId) return;
      const mime =
        payload.mime && payload.mime.startsWith('image/') ? payload.mime : 'image/jpeg';
      setFrameDataUrl(`data:${mime};base64,${payload.data}`);
      // #region agent log
      if (!firstFrameLoggedRef.current) {
        firstFrameLoggedRef.current = true;
        _navPlayClientLog({
          hypothesisId: 'H5',
          location: 'useNavigationPlay.frame',
          message: 'first frame received',
          data: { runIdTail: payload.runId.slice(-24) },
        });
      }
      // #endregion
    });

    socket.on(
      'navPlay:started',
      (payload: { navId: string; skyvernRunId?: string; activeSequence?: number | null }) => {
        if (payload.navId !== navId) return;
        setIsPlaying(true);
        setPlayError(null);
        if (payload.skyvernRunId) setSkyvernRunId(payload.skyvernRunId);
        setRunStatus('running');
        if (payload.activeSequence !== undefined) setPlayActiveSequence(payload.activeSequence);
        // #region agent log
        _navPlayClientLog({
          hypothesisId: 'H1',
          location: 'useNavigationPlay.navPlay:started',
          message: 'socket navPlay started',
          data: {
            activeSequence: payload.activeSequence ?? null,
            skyvernTail: (payload.skyvernRunId ?? '').slice(-12),
          },
        });
        // #endregion
      },
    );

    socket.on(
      'navPlay:runUpdate',
      (payload: {
        navId: string;
        status?: string;
        failureReason?: string | null;
        activeSequence?: number | null;
      }) => {
        if (payload.navId !== navId) return;
        if (payload.status) setRunStatus(payload.status);
        if (payload.failureReason) setPlayError(payload.failureReason);
        if (payload.activeSequence !== undefined) setPlayActiveSequence(payload.activeSequence);
        // #region agent log
        if (
          payload.activeSequence !== undefined &&
          payload.activeSequence !== lastRunUpdateSeqRef.current
        ) {
          lastRunUpdateSeqRef.current = payload.activeSequence;
          _navPlayClientLog({
            hypothesisId: 'H1',
            location: 'useNavigationPlay.navPlay:runUpdate',
            message: 'socket run update',
            data: {
              activeSequence: payload.activeSequence,
              status: payload.status ?? null,
              seqMatchesPersisted:
                persistedSeqRef.current == null || payload.activeSequence == null
                  ? null
                  : persistedSeqRef.current.includes(payload.activeSequence),
            },
          });
        }
        // #endregion
      },
    );

    socket.on('navPlay:ended', (payload: { navId: string }) => {
      if (payload.navId !== navId) return;
      setIsPlaying(false);
      setRunStatus(null);
      setSkyvernRunId(null);
      setPlayActiveSequence(null);
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
      firstFrameLoggedRef.current = false;
      lastRunUpdateSeqRef.current = undefined;
      try {
        const res = await navigationsApi.playStart(navId, { parameters });
        // #region agent log
        _navPlayClientLog({
          hypothesisId: 'H1',
          location: 'useNavigationPlay.startPlay',
          message: 'playStart HTTP ok — client clears activeSequence next',
          data: {
            navIdTail: navId.slice(-8),
            skyvernTail: res.skyvernRunId.slice(-12),
            persistedSeqSample: persistedSeqRef.current?.slice(0, 12) ?? null,
          },
        });
        // #endregion
        setSkyvernRunId(res.skyvernRunId);
        setIsPlaying(true);
        setPlayActiveSequence(null);
      } catch (e) {
        // #region agent log
        _navPlayClientLog({
          hypothesisId: 'H3',
          location: 'useNavigationPlay.startPlay',
          message: 'playStart HTTP error',
          data: { err: (e instanceof Error ? e.message : String(e)).slice(0, 400) },
        });
        // #endregion
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
    setPlayActiveSequence(null);
  }, [navId]);

  return {
    isPlaying,
    connected,
    frameDataUrl,
    playError,
    runStatus,
    skyvernRunId,
    playActiveSequence,
    startPlay,
    stopPlay,
  };
}
