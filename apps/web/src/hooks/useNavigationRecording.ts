/**
 * Custom hook for managing an interactive navigation recording session.
 *
 * Handles the full Socket.IO lifecycle: connect, join room, frame rendering,
 * action accumulation, input-prompt state for the variable injection modal,
 * and start/stop recording commands.
 *
 * Scroll is exposed as `sendScroll` but throttling is the caller's
 * responsibility (the InteractiveCanvasStream component throttles at ~50ms).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { createRecordingSocket } from '@/lib/recordingSocket';

// ---------------------------------------------------------------------------
// Shared types (mirrored from backend; keep in sync)
// ---------------------------------------------------------------------------

export interface ElementMetadata {
  tag: string;
  id: string | null;
  type: string | null;
  name: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
  textContent: string | null;
  isInput: boolean;
}

export interface RecordedNavigationAction {
  sequence: number;
  actionType: 'click' | 'type' | 'navigate' | 'variable_input';
  x: number | null;
  y: number | null;
  elementTag: string | null;
  elementId: string | null;
  elementText: string | null;
  ariaLabel: string | null;
  inputValue: string | null;
  inputMode: 'static' | 'variable' | null;
  pageUrl: string | null;
}

export interface SkyvernWorkflow {
  workflow_id: string;
  title: string;
  parameters: Array<{ key: string; parameter_type: string; default_value: string }>;
  blocks: Array<{
    block_type: string;
    label: string;
    url?: string;
    action_type?: string;
    text?: string;
  }>;
}

export interface InputPromptState {
  x: number;
  y: number;
  elementMeta: ElementMetadata;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseNavigationRecordingReturn {
  isRecording: boolean;
  connected: boolean;
  frameDataUrl: string | null;
  actions: RecordedNavigationAction[];
  inputPrompt: InputPromptState | null;
  /** True when the variable injection modal should be visible and the canvas must suppress input. */
  isInputModalOpen: boolean;
  skyvernWorkflow: SkyvernWorkflow | null;
  startRecording: () => void;
  stopRecording: () => void;
  /** Send a click at viewport coordinates. No-op while the input modal is open. */
  sendClick: (x: number, y: number) => void;
  /** Ephemeral scroll — caller should throttle at ~50ms. */
  sendScroll: (deltaX: number, deltaY: number) => void;
  resolveInput: (mode: 'static' | 'variable', value: string) => void;
  dismissInputPrompt: () => void;
  error: string | null;
}

export function useNavigationRecording(
  navId: string | undefined,
  userId: string,
): UseNavigationRecordingReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [connected, setConnected] = useState(false);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [actions, setActions] = useState<RecordedNavigationAction[]>([]);
  const [inputPrompt, setInputPrompt] = useState<InputPromptState | null>(null);
  const [skyvernWorkflow, setSkyvernWorkflow] = useState<SkyvernWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);

  // -----------------------------------------------------------------------
  // Socket lifecycle
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!navId) return;

    const socket = createRecordingSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join', { runId: navId });
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('frame', (payload: { runId: string; data: string }) => {
      if (payload.runId !== navId) return;
      setFrameDataUrl(`data:image/jpeg;base64,${payload.data}`);
    });

    socket.on('nav:sessionStarted', (payload: { navId: string }) => {
      if (payload.navId !== navId) return;
      setIsRecording(true);
      setActions([]);
      setSkyvernWorkflow(null);
      setError(null);
    });

    socket.on(
      'nav:actionRecorded',
      (payload: { navId: string; action: RecordedNavigationAction }) => {
        if (payload.navId !== navId) return;
        setActions((prev) => [...prev, payload.action]);
      },
    );

    socket.on(
      'nav:inputDetected',
      (payload: { navId: string; x: number; y: number; elementMeta: ElementMetadata }) => {
        if (payload.navId !== navId) return;
        setInputPrompt({ x: payload.x, y: payload.y, elementMeta: payload.elementMeta });
      },
    );

    socket.on(
      'nav:sessionEnded',
      (payload: {
        navId: string;
        actions: RecordedNavigationAction[];
        skyvernWorkflow: SkyvernWorkflow | null;
      }) => {
        if (payload.navId !== navId) return;
        setIsRecording(false);
        setActions(payload.actions);
        setSkyvernWorkflow(payload.skyvernWorkflow);
        setFrameDataUrl(null);
      },
    );

    socket.on('nav:error', (payload: { navId: string; error: string }) => {
      if (payload.navId !== navId) return;
      setError(payload.error);
    });

    return () => {
      socket.emit('leave', { runId: navId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [navId]);

  // -----------------------------------------------------------------------
  // Commands
  // -----------------------------------------------------------------------

  const startRecording = useCallback(() => {
    if (!navId || !socketRef.current?.connected) return;
    setError(null);
    socketRef.current.emit('nav:startRecording', { navId, userId });
  }, [navId, userId]);

  const stopRecording = useCallback(() => {
    if (!navId || !socketRef.current?.connected) return;
    socketRef.current.emit('nav:stopRecording', { navId, userId });
  }, [navId, userId]);

  const sendClick = useCallback(
    (x: number, y: number) => {
      if (!navId || !socketRef.current?.connected) return;
      if (inputPrompt !== null) return;
      socketRef.current.emit('nav:click', { navId, userId, x, y });
    },
    [navId, userId, inputPrompt],
  );

  const sendScroll = useCallback(
    (deltaX: number, deltaY: number) => {
      if (!navId || !socketRef.current?.connected) return;
      socketRef.current.emit('nav:scroll', { navId, userId, deltaX, deltaY });
    },
    [navId, userId],
  );

  const resolveInput = useCallback(
    (mode: 'static' | 'variable', value: string) => {
      if (!navId || !socketRef.current?.connected) return;
      socketRef.current.emit('nav:inputResolve', { navId, userId, mode, value });
      setInputPrompt(null);
    },
    [navId, userId],
  );

  const dismissInputPrompt = useCallback(() => {
    setInputPrompt(null);
  }, []);

  return {
    isRecording,
    connected,
    frameDataUrl,
    actions,
    inputPrompt,
    isInputModalOpen: inputPrompt !== null,
    skyvernWorkflow,
    startRecording,
    stopRecording,
    sendClick,
    sendScroll,
    resolveInput,
    dismissInputPrompt,
    error,
  };
}
