/**
 * Custom hook for managing an interactive navigation recording session.
 *
 * Handles the full Socket.IO lifecycle: connect, join room, frame rendering,
 * action accumulation, input-prompt state for the variable injection modal,
 * and start/stop recording commands.
 *
 * Scroll is exposed as `sendScroll` but throttling is the caller's
 * responsibility (the InteractiveCanvasStream component throttles at ~50ms).
 * Pointer hover uses `sendPointerMove` (throttled on the canvas) for :hover popovers.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Socket } from 'socket.io-client';
import { createRecordingSocket } from '@/lib/recordingSocket';
import { navigationsApi, type NavigationDetailDto } from '@/lib/api';

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
  /** Current value in the remote field (for editing in the modal). */
  currentValue: string | null;
}

export interface RecordedNavigationAction {
  sequence: number;
  actionType: 'click' | 'type' | 'navigate' | 'variable_input' | 'prompt' | 'prompt_type';
  x: number | null;
  y: number | null;
  elementTag: string | null;
  elementId: string | null;
  elementText: string | null;
  ariaLabel: string | null;
  inputValue: string | null;
  inputMode: 'static' | 'variable' | null;
  pageUrl: string | null;
  /** Optional natural-language override for Skyvern `navigation_goal` when set. */
  actionInstruction?: string | null;
}

/** Align with `NavigationDetail.tsx` / API — used to restore the sidebar after a failed start. */
function mapDetailActionsToRecorded(
  rows: NavigationDetailDto['actions'],
): RecordedNavigationAction[] {
  return rows.map((a) => ({
    sequence: a.sequence,
    actionType: a.actionType as RecordedNavigationAction['actionType'],
    x: a.x,
    y: a.y,
    elementTag: a.elementTag,
    elementId: a.elementId,
    elementText: a.elementText,
    ariaLabel: a.ariaLabel,
    inputValue: a.inputValue,
    inputMode: (a.inputMode as RecordedNavigationAction['inputMode']) ?? null,
    pageUrl: a.pageUrl,
    actionInstruction: a.actionInstruction ?? null,
  }));
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
  /** Unique per open so the modal remounts with fresh local state. */
  openedAt: number;
  elementMeta: ElementMetadata;
}

/** Smart Audit suggestion for a step (keyed by `sequence` in UI state). */
export interface NavigationAuditSuggestion {
  warning: string;
  suggestedPrompt: string;
}

/** LLM proposal for live prompt injection (viewport box + label). */
export interface ProposedIntentState {
  targetBox: { x: number; y: number; width: number; height: number };
  semanticLabel: string;
  promptText: string;
}

const EMPTY_ELEMENT_META: ElementMetadata = {
  tag: 'input',
  id: null,
  type: null,
  name: null,
  placeholder: null,
  ariaLabel: null,
  textContent: null,
  isInput: true,
  currentValue: null,
};

function normalizeElementMeta(raw: ElementMetadata | null | undefined): ElementMetadata {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_ELEMENT_META };
  const cv = raw.currentValue;
  return {
    ...EMPTY_ELEMENT_META,
    ...raw,
    tag: typeof raw.tag === 'string' && raw.tag.length > 0 ? raw.tag : EMPTY_ELEMENT_META.tag,
    currentValue: typeof cv === 'string' ? cv : cv == null ? null : String(cv),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseNavigationRecordingReturn {
  isRecording: boolean;
  /** Recording session is active but interaction is frozen (browser stays open). */
  isPaused: boolean;
  connected: boolean;
  frameDataUrl: string | null;
  actions: RecordedNavigationAction[];
  inputPrompt: InputPromptState | null;
  /** True when the variable injection modal should be visible and the canvas must suppress input. */
  isInputModalOpen: boolean;
  /** Live prompt injection: proposed click region after Analyze (viewport1280×720 space). */
  proposedIntent: ProposedIntentState | null;
  skyvernWorkflow: SkyvernWorkflow | null;
  startRecording: () => void;
  stopRecording: () => void;
  pauseRecording: () => void;
  resumeRecording: () => void;
  cancelRecording: () => void;
  /** Send a click: bitmap coords (x,y) and JPEG/canvas size (stream) for viewport mapping. */
  sendClick: (x: number, y: number, streamWidth: number, streamHeight: number) => void;
  /** Ephemeral scroll — caller should throttle at ~50ms. */
  sendScroll: (deltaX: number, deltaY: number) => void;
  /** Ephemeral pointer position for remote :hover — caller should throttle. */
  sendPointerMove: (x: number, y: number, streamWidth: number, streamHeight: number) => void;
  resolveInput: (mode: 'static' | 'variable', value: string) => void;
  dismissInputPrompt: () => void;
  analyzePrompt: (text: string) => void;
  confirmIntent: () => void;
  cancelIntent: () => void;
  /** Refine timeline: patch one action in local state (e.g. static vs variable). */
  updateRecordedAction: (sequenceId: number, updates: Partial<RecordedNavigationAction>) => void;
  /** Smart Audit: LLM suggestions keyed by action sequence. */
  auditSuggestions: Record<number, NavigationAuditSuggestion>;
  auditRunning: boolean;
  runSmartAudit: () => void;
  acceptAuditSuggestion: (sequenceId: number) => void;
  rejectAuditSuggestion: (sequenceId: number) => void;
  /** Remove a step (live session via socket, or persisted navigation via REST). */
  deleteRecordedAction: (sequenceId: number) => void;
  error: string | null;
}

export function useNavigationRecording(
  navId: string | undefined,
  userId: string,
): UseNavigationRecordingReturn {
  const queryClient = useQueryClient();
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
  const [actions, setActions] = useState<RecordedNavigationAction[]>([]);
  const [inputPrompt, setInputPrompt] = useState<InputPromptState | null>(null);
  const [proposedIntent, setProposedIntent] = useState<ProposedIntentState | null>(null);
  const [skyvernWorkflow, setSkyvernWorkflow] = useState<SkyvernWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [auditSuggestions, setAuditSuggestions] = useState<
    Record<number, NavigationAuditSuggestion>
  >({});
  const [auditRunning, setAuditRunning] = useState(false);

  const isRecordingRef = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const pendingPromptTextRef = useRef<string>('');
  /** Must stay in sync with `actions` without waiting for `useEffect` — Stop emits this on the same tick as edits. */
  const actionsRef = useRef<RecordedNavigationAction[]>([]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

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
      void navigationsApi
        .recordingSession(navId)
        .then((s) => {
          if (s.recordingActive) {
            setIsRecording(true);
            setIsPaused(s.recordingPaused);
          }
        })
        .catch(() => {});
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('frame', (payload: { runId: string; data: string }) => {
      if (payload.runId !== navId) return;
      setFrameDataUrl(`data:image/jpeg;base64,${payload.data}`);
    });

    socket.on('nav:sessionStarted', (payload: { navId: string }) => {
      if (payload.navId !== navId) return;
      setIsRecording(true);
      setIsPaused(false);
      /** Do not clear `actions` here: the server emits `nav:actionRecorded` (initial navigate) before
       * this event; clearing would wipe that step. The list is reset in `startRecording` instead. */
      setSkyvernWorkflow(null);
      setError(null);
      setProposedIntent(null);
      setAuditSuggestions({});
      setAuditRunning(false);
      pendingPromptTextRef.current = '';
    });

    socket.on('nav:recordingPaused', (payload: { navId: string; paused: boolean }) => {
      if (payload.navId !== navId) return;
      setIsPaused(payload.paused);
      if (payload.paused) {
        setInputPrompt(null);
        setProposedIntent(null);
        pendingPromptTextRef.current = '';
      }
    });

    socket.on(
      'nav:actionRecorded',
      (payload: { navId: string; action: RecordedNavigationAction }) => {
        if (payload.navId !== navId) return;
        setActions((prev) => {
          const next = [...prev, payload.action];
          actionsRef.current = next;
          return next;
        });
      },
    );

    socket.on(
      'nav:actionsReplaced',
      (payload: { navId: string; actions: RecordedNavigationAction[] }) => {
        if (payload.navId !== navId) return;
        actionsRef.current = payload.actions;
        setActions(payload.actions);
        setAuditSuggestions({});
      },
    );

    socket.on(
      'nav:intentProposed',
      (payload: {
        navId: string;
        targetBox: ProposedIntentState['targetBox'];
        semanticLabel: string;
      }) => {
        if (payload.navId !== navId) return;
        setProposedIntent({
          targetBox: payload.targetBox,
          semanticLabel: payload.semanticLabel,
          promptText: pendingPromptTextRef.current,
        });
      },
    );

    socket.on(
      'nav:inputDetected',
      (payload: { navId: string; x: number; y: number; elementMeta?: ElementMetadata | null }) => {
        if (payload.navId !== navId) return;
        setProposedIntent(null);
        pendingPromptTextRef.current = '';
        const elementMeta = normalizeElementMeta(payload.elementMeta);
        setInputPrompt({
          x: payload.x,
          y: payload.y,
          openedAt: Date.now(),
          elementMeta,
        });
      },
    );

    socket.on(
      'nav:sessionEnded',
      (payload: {
        navId: string;
        actions: RecordedNavigationAction[];
        skyvernWorkflow: SkyvernWorkflow | null;
        cancelled?: boolean;
      }) => {
        if (payload.navId !== navId) return;
        setIsRecording(false);
        setIsPaused(false);
        setInputPrompt(null);
        setProposedIntent(null);
        pendingPromptTextRef.current = '';
        actionsRef.current = payload.actions;
        setActions(payload.actions);
        setSkyvernWorkflow(payload.skyvernWorkflow);
        setFrameDataUrl(null);
        setAuditSuggestions({});
        setAuditRunning(false);
        void queryClient.invalidateQueries({ queryKey: ['navigation', navId] });
        void queryClient.invalidateQueries({ queryKey: ['navigations'] });
      },
    );

    socket.on(
      'nav:auditResults',
      (payload: {
        navId: string;
        suggestions: Array<{ sequence: number; warning: string; suggestedPrompt: string }>;
      }) => {
        if (payload.navId !== navId) return;
        const next: Record<number, NavigationAuditSuggestion> = {};
        for (const s of payload.suggestions ?? []) {
          const seq = Number(s.sequence);
          if (!Number.isFinite(seq)) continue;
          next[seq] = { warning: s.warning, suggestedPrompt: s.suggestedPrompt };
        }
        setAuditSuggestions(next);
        setAuditRunning(false);
      },
    );

    socket.on('nav:error', (payload: { navId: string; error: string }) => {
      if (payload.navId !== navId) return;
      setError(payload.error);
      setAuditRunning(false);
      /** Failed start: we already cleared actions in `startRecording` but never got `nav:sessionStarted`. */
      if (!isRecordingRef.current && navId) {
        const cached = queryClient.getQueryData<NavigationDetailDto>(['navigation', navId]);
        if (cached?.actions?.length) {
          const next = mapDetailActionsToRecorded(cached.actions);
          actionsRef.current = next;
          setActions(next);
        }
      }
    });

    return () => {
      socket.emit('leave', { runId: navId });
      socket.disconnect();
      socketRef.current = null;
    };
  }, [navId, queryClient]);

  // -----------------------------------------------------------------------
  // Commands
  // -----------------------------------------------------------------------

  const startRecording = useCallback(() => {
    if (!navId || !socketRef.current?.connected) return;
    setError(null);
    actionsRef.current = [];
    setActions([]);
    setSkyvernWorkflow(null);
    setProposedIntent(null);
    setAuditSuggestions({});
    setAuditRunning(false);
    pendingPromptTextRef.current = '';
    socketRef.current.emit('nav:startRecording', { navId, userId });
  }, [navId, userId]);

  const stopRecording = useCallback(() => {
    if (!navId || !socketRef.current?.connected) return;
    const socket = socketRef.current;
    const payload = () => ({
      navId,
      userId,
      /** Clone so the payload is plain JSON for Socket.IO (no accidental non-enumerable fields). */
      actions: actionsRef.current.map((a) => ({ ...a })),
    });
    /** Defer past the current frame so focus moves / last controlled-input commits land in `actionsRef`. */
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!socket.connected) return;
        socket.emit('nav:stopRecording', payload());
      });
    });
  }, [navId, userId]);

  const updateRecordedAction = useCallback(
    (sequenceId: number, updates: Partial<RecordedNavigationAction>) => {
      setActions((prev) => {
        const next = prev.map((a) =>
          a.sequence === sequenceId ? { ...a, ...updates } : a,
        );
        actionsRef.current = next;
        return next;
      });
      if (
        updates.actionInstruction !== undefined &&
        navId &&
        !isRecordingRef.current
      ) {
        void navigationsApi
          .patchActionInstruction(navId, sequenceId, {
            actionInstruction: updates.actionInstruction ?? null,
          })
          .catch(() => {
            /* Row may not exist in DB until recording is saved */
          });
      }
    },
    [navId],
  );

  const pauseRecording = useCallback(() => {
    if (!navId || !socketRef.current?.connected) return;
    socketRef.current.emit('nav:pause', { navId, userId, paused: true });
  }, [navId, userId]);

  const resumeRecording = useCallback(() => {
    if (!navId || !socketRef.current?.connected) return;
    socketRef.current.emit('nav:pause', { navId, userId, paused: false });
  }, [navId, userId]);

  const cancelRecording = useCallback(() => {
    if (!navId || !socketRef.current?.connected) return;
    if (
      !window.confirm(
        'Cancel this recording? The browser session will close and recorded steps will not be saved.',
      )
    ) {
      return;
    }
    socketRef.current.emit('nav:cancelRecording', { navId, userId });
  }, [navId, userId]);

  const sendClick = useCallback(
    (x: number, y: number, streamWidth: number, streamHeight: number) => {
      if (!navId || !socketRef.current?.connected) return;
      if (inputPrompt !== null) return;
      if (proposedIntent !== null) return;
      if (isPaused) return;
      socketRef.current.emit('nav:click', {
        navId,
        userId,
        x,
        y,
        streamWidth,
        streamHeight,
      });
    },
    [navId, userId, inputPrompt, proposedIntent, isPaused],
  );

  const sendScroll = useCallback(
    (deltaX: number, deltaY: number) => {
      if (!navId || !socketRef.current?.connected) return;
      if (isPaused) return;
      if (proposedIntent !== null) return;
      socketRef.current.emit('nav:scroll', { navId, userId, deltaX, deltaY });
    },
    [navId, userId, isPaused, proposedIntent],
  );

  const sendPointerMove = useCallback(
    (x: number, y: number, streamWidth: number, streamHeight: number) => {
      if (!navId || !socketRef.current?.connected) return;
      if (!isRecording) return;
      if (inputPrompt !== null) return;
      if (proposedIntent !== null) return;
      if (isPaused) return;
      socketRef.current.emit('nav:pointerMove', {
        navId,
        userId,
        x,
        y,
        streamWidth,
        streamHeight,
      });
    },
    [navId, userId, isRecording, inputPrompt, proposedIntent, isPaused],
  );

  const resolveInput = useCallback(
    (mode: 'static' | 'variable', value: string) => {
      if (!navId || !socketRef.current?.connected) return;
      if (isPaused) return;
      socketRef.current.emit('nav:inputResolve', { navId, userId, mode, value });
      setInputPrompt(null);
    },
    [navId, userId, isPaused],
  );

  const dismissInputPrompt = useCallback(() => {
    setInputPrompt(null);
  }, []);

  const analyzePrompt = useCallback(
    (text: string) => {
      if (!navId || !socketRef.current?.connected) return;
      if (!isRecording || isPaused) return;
      pendingPromptTextRef.current = text;
      socketRef.current.emit('nav:analyzeCustomPrompt', {
        navId,
        userId,
        promptText: text,
      });
    },
    [navId, userId, isRecording, isPaused],
  );

  const confirmIntent = useCallback(() => {
    if (!navId || !socketRef.current?.connected) return;
    if (!proposedIntent || isPaused) return;
    const { targetBox, promptText } = proposedIntent;
    const x = Math.round(targetBox.x + targetBox.width / 2);
    const y = Math.round(targetBox.y + targetBox.height / 2);
    socketRef.current.emit('nav:confirmIntent', {
      navId,
      userId,
      x,
      y,
      promptText,
    });
    setProposedIntent(null);
    pendingPromptTextRef.current = '';
  }, [navId, userId, proposedIntent, isPaused]);

  const cancelIntent = useCallback(() => {
    setProposedIntent(null);
    pendingPromptTextRef.current = '';
  }, []);

  const runSmartAudit = useCallback(() => {
    if (!navId || !socketRef.current?.connected) return;
    if (actionsRef.current.length === 0) return;
    setError(null);
    setAuditRunning(true);
    socketRef.current.emit('nav:requestAudit', {
      navId,
      userId,
      actions: actionsRef.current.map((a) => ({ ...a })),
      skyvernWorkflow: skyvernWorkflow ?? undefined,
    });
  }, [navId, userId, skyvernWorkflow]);

  const acceptAuditSuggestion = useCallback(
    (sequenceId: number) => {
      const sug = auditSuggestions[sequenceId];
      if (!sug) return;
      const prevAction = actionsRef.current.find((a) => a.sequence === sequenceId);
      if (!prevAction) return;
      const t = prevAction.actionType;
      const nextType: RecordedNavigationAction['actionType'] =
        t === 'type' || t === 'variable_input' || t === 'prompt_type'
          ? 'prompt_type'
          : 'prompt';
      const nextInputValue = sug.suggestedPrompt;
      const nextInputMode = 'variable' as const;

      setActions((prev) => {
        const next = prev.map((a) => {
          if (a.sequence !== sequenceId) return a;
          return {
            ...a,
            actionType: nextType,
            inputValue: nextInputValue,
            inputMode: nextInputMode,
          };
        });
        actionsRef.current = next;
        return next;
      });
      setAuditSuggestions((s) => {
        const { [sequenceId]: _removed, ...rest } = s;
        return rest;
      });

      if (navId && !isRecordingRef.current) {
        void navigationsApi
          .patchActionInstruction(navId, sequenceId, {
            actionType: nextType,
            inputValue: nextInputValue,
            inputMode: nextInputMode,
          })
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: ['navigation', navId] });
            void queryClient.invalidateQueries({ queryKey: ['navigations'] });
          })
          .catch((e) => {
            setError(e instanceof Error ? e.message : 'Could not save audit change');
          });
      }
    },
    [auditSuggestions, navId, queryClient],
  );

  const rejectAuditSuggestion = useCallback((sequenceId: number) => {
    setAuditSuggestions((s) => {
      if (!(sequenceId in s)) return s;
      const { [sequenceId]: _removed, ...rest } = s;
      return rest;
    });
  }, []);

  const deleteRecordedAction = useCallback(
    (sequenceId: number) => {
      if (!navId) return;
      if (
        !window.confirm(
          'Delete this step? Remaining steps will be renumbered. This cannot be undone.',
        )
      ) {
        return;
      }
      setError(null);

      if (isRecordingRef.current && socketRef.current?.connected) {
        socketRef.current.emit('nav:deleteAction', { navId, userId, sequence: sequenceId });
        return;
      }

      void navigationsApi
        .deleteAction(navId, sequenceId)
        .then((detail) => {
          const next = mapDetailActionsToRecorded(detail.actions);
          actionsRef.current = next;
          setActions(next);
          void queryClient.invalidateQueries({ queryKey: ['navigation', navId] });
          void queryClient.invalidateQueries({ queryKey: ['navigations'] });
        })
        .catch((e) => {
          setError(e instanceof Error ? e.message : 'Could not delete step');
        });
    },
    [navId, userId, isPaused, queryClient],
  );

  return {
    isRecording,
    isPaused,
    connected,
    frameDataUrl,
    actions,
    inputPrompt,
    isInputModalOpen: inputPrompt !== null,
    proposedIntent,
    skyvernWorkflow,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    cancelRecording,
    sendClick,
    sendScroll,
    sendPointerMove,
    resolveInput,
    dismissInputPrompt,
    analyzePrompt,
    confirmIntent,
    cancelIntent,
    updateRecordedAction,
    auditSuggestions,
    auditRunning,
    runSmartAudit,
    acceptAuditSuggestion,
    rejectAuditSuggestion,
    deleteRecordedAction,
    error,
  };
}
