/**
 * Interactive canvas that renders JPEG screencast frames from the remote
 * Playwright browser and captures user pointer/scroll events, translating
 * them to viewport-relative coordinates for the recording service.
 *
 * Key behaviours:
 * - Pointer clicks are forwarded as `sendClick` with bitmap coords and canvas size.
 * - Wheel events are forwarded as `sendScroll(deltaX, deltaY)`, throttled
 *   at ~50ms to prevent WebSocket flooding from trackpad inertia.
 * - Pointer moves are forwarded as `sendPointerMove` (when provided), throttled
 *   at ~32ms so remote CSS :hover / popovers track the cursor without flooding.
 * - When the variable injection modal is open (`isInputModalOpen`), ALL
 *   keyboard and pointer events on the canvas are suppressed so the user
 *   cannot accidentally interact with the headless browser.
 * - When `proposedIntent` is set (live prompt injection), draws a viewport box
 *   overlay and shows Confirm/Cancel; normal clicks/scroll are blocked by parent.
 * - `preventDefault` on wheel stops the host page from scrolling while
 *   hovering the canvas.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { clientToViewportCoords } from '@/lib/canvasViewport';
import {
  NAV_RECORDING_VIEWPORT_HEIGHT,
  NAV_RECORDING_VIEWPORT_WIDTH,
} from '@/lib/navigationRecordingViewport';
import type { ProposedIntentState } from '@/hooks/useNavigationRecording';

interface InteractiveCanvasStreamProps {
  frameDataUrl: string | null;
  /** Variable injection modal: suppress canvas pointer + global keyboard guard. */
  isInputModalOpen: boolean;
  /** Pause, modal, or proposed intent: block forwarding clicks/scroll to the remote browser. */
  blockCanvasInteraction: boolean;
  /** Live prompt injection overlay (viewport 1280×720 box). */
  proposedIntent: ProposedIntentState | null;
  onConfirmIntent: () => void;
  onCancelIntent: () => void;
  sendClick: (x: number, y: number, streamWidth: number, streamHeight: number) => void;
  sendScroll: (deltaX: number, deltaY: number) => void;
  /** Optional — navigation recording forwards moves for remote :hover; play UI omits. */
  sendPointerMove?: (x: number, y: number, streamWidth: number, streamHeight: number) => void;
  /**
   * Use inline layout only (no Tailwind). Required when rendered in a detached `window`
   * that does not load the app stylesheet.
   */
  embedWithoutAppStyles?: boolean;
}

const SCROLL_THROTTLE_MS = 50;
const POINTER_MOVE_THROTTLE_MS = 32;

export function InteractiveCanvasStream({
  frameDataUrl,
  isInputModalOpen,
  blockCanvasInteraction,
  proposedIntent,
  onConfirmIntent,
  onCancelIntent,
  sendClick,
  sendScroll,
  sendPointerMove,
  embedWithoutAppStyles = false,
}: InteractiveCanvasStreamProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastScrollTs = useRef(0);
  const lastPointerMoveTs = useRef(0);
  const [fabPos, setFabPos] = useState<{ left: number; top: number } | null>(null);

  // -----------------------------------------------------------------------
  // Frame + proposed intent overlay (bitmap space)
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!frameDataUrl || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      const wrap = wrapRef.current;
      if (proposedIntent) {
        const { targetBox } = proposedIntent;
        const sx = (targetBox.x * canvas.width) / NAV_RECORDING_VIEWPORT_WIDTH;
        const sy = (targetBox.y * canvas.height) / NAV_RECORDING_VIEWPORT_HEIGHT;
        const sw = (targetBox.width * canvas.width) / NAV_RECORDING_VIEWPORT_WIDTH;
        const sh = (targetBox.height * canvas.height) / NAV_RECORDING_VIEWPORT_HEIGHT;
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 4;
        ctx.strokeRect(sx, sy, sw, sh);
        if (wrap) {
          const cRect = canvas.getBoundingClientRect();
          const wRect = wrap.getBoundingClientRect();
          const scaleX = cRect.width / canvas.width;
          const scaleY = cRect.height / canvas.height;
          const pad = 8;
          setFabPos({
            left: cRect.left - wRect.left + sx * scaleX,
            top: cRect.top - wRect.top + (sy + sh + pad) * scaleY,
          });
        }
      } else {
        setFabPos(null);
      }
    };
    img.src = frameDataUrl;
  }, [frameDataUrl, proposedIntent]);

  // -----------------------------------------------------------------------
  // Input guard: suppress all keyboard events when the modal is open
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!isInputModalOpen) return;
    const suppress = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof Element &&
        (t.closest('[role="dialog"]') || t.closest('[data-bladerunner-variable-injection-modal]'))
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', suppress, true);
    window.addEventListener('keyup', suppress, true);
    window.addEventListener('keypress', suppress, true);
    return () => {
      window.removeEventListener('keydown', suppress, true);
      window.removeEventListener('keyup', suppress, true);
      window.removeEventListener('keypress', suppress, true);
    };
  }, [isInputModalOpen]);

  // -----------------------------------------------------------------------
  // Click handler
  // -----------------------------------------------------------------------

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (blockCanvasInteraction) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width <= 0 || canvas.height <= 0) return;
      const { x, y } = clientToViewportCoords(canvas, e.clientX, e.clientY);
      sendClick(x, y, canvas.width, canvas.height);
    },
    [blockCanvasInteraction, sendClick],
  );

  // -----------------------------------------------------------------------
  // Scroll handler (throttled at ~50ms, preventDefault to block page scroll)
  // -----------------------------------------------------------------------

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (blockCanvasInteraction) return;
      const now = Date.now();
      if (now - lastScrollTs.current < SCROLL_THROTTLE_MS) return;
      lastScrollTs.current = now;
      sendScroll(e.deltaX, e.deltaY);
    },
    [blockCanvasInteraction, sendScroll],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!sendPointerMove) return;
      if (blockCanvasInteraction) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width <= 0 || canvas.height <= 0) return;
      const now = Date.now();
      if (now - lastPointerMoveTs.current < POINTER_MOVE_THROTTLE_MS) return;
      lastPointerMoveTs.current = now;
      const { x, y } = clientToViewportCoords(canvas, e.clientX, e.clientY);
      sendPointerMove(x, y, canvas.width, canvas.height);
    },
    [blockCanvasInteraction, sendPointerMove],
  );

  // -----------------------------------------------------------------------
  // Prevent passive wheel on the raw DOM node
  // -----------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => e.preventDefault();
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const wrapClass = embedWithoutAppStyles ? undefined : 'relative w-full';
  const wrapStyle = embedWithoutAppStyles
    ? ({ position: 'relative' as const, width: '100%' })
    : undefined;

  const canvasClass = embedWithoutAppStyles
    ? undefined
    : `w-full rounded-lg border border-gray-200 bg-black ${
        blockCanvasInteraction ? 'pointer-events-none opacity-70' : 'cursor-crosshair'
      }`;

  const canvasStyle = embedWithoutAppStyles
    ? {
        width: '100%',
        display: 'block' as const,
        aspectRatio: '16 / 9',
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        background: '#000',
        pointerEvents: (blockCanvasInteraction ? 'none' : 'auto') as 'none' | 'auto',
        opacity: blockCanvasInteraction ? 0.7 : 1,
        cursor: blockCanvasInteraction ? 'default' : 'crosshair',
      }
    : { aspectRatio: '16 / 9' };

  const waitingOverlayClass = embedWithoutAppStyles ? undefined : 'absolute inset-0 flex items-center justify-center text-gray-500 text-sm pointer-events-none';
  const waitingOverlayStyle = embedWithoutAppStyles
    ? {
        position: 'absolute' as const,
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#6b7280',
        fontSize: 14,
        pointerEvents: 'none' as const,
      }
    : undefined;

  const fabWrapClass = embedWithoutAppStyles ? undefined : 'absolute z-20 flex flex-wrap gap-2 items-center';
  const fabWrapStyle =
    proposedIntent && fabPos
      ? embedWithoutAppStyles
        ? {
            position: 'absolute' as const,
            zIndex: 20,
            display: 'flex',
            flexWrap: 'wrap' as const,
            gap: 8,
            alignItems: 'center',
            left: fabPos.left,
            top: fabPos.top,
            maxWidth: 'calc(100% - 1rem)',
          }
        : { left: fabPos.left, top: fabPos.top, maxWidth: 'calc(100% - 1rem)' }
      : undefined;

  const btnPrimaryStyle = embedWithoutAppStyles
    ? {
        borderRadius: 8,
        background: '#059669',
        color: '#fff',
        fontSize: 12,
        fontWeight: 500,
        padding: '6px 12px',
        border: 'none',
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.15)',
      }
    : undefined;
  const btnSecondaryStyle = embedWithoutAppStyles
    ? {
        borderRadius: 8,
        border: '1px solid #d1d5db',
        background: '#fff',
        color: '#374151',
        fontSize: 12,
        fontWeight: 500,
        padding: '6px 12px',
        cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
      }
    : undefined;

  return (
    <div ref={wrapRef} className={wrapClass} style={wrapStyle}>
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onPointerMove={sendPointerMove ? handlePointerMove : undefined}
        onWheel={handleWheel}
        className={canvasClass}
        style={canvasStyle}
      />
      {!frameDataUrl && (
        <div className={waitingOverlayClass} style={waitingOverlayStyle}>
          Waiting for browser frame...
        </div>
      )}
      {proposedIntent && fabPos && (
        <div className={fabWrapClass} style={fabWrapStyle}>
          <button
            type="button"
            className={embedWithoutAppStyles ? undefined : 'rounded-lg bg-emerald-600 text-white text-xs font-medium py-1.5 px-3 shadow-md hover:bg-emerald-700'}
            style={btnPrimaryStyle}
            onClick={onConfirmIntent}
          >
            Confirm &amp; click
          </button>
          <button
            type="button"
            className={embedWithoutAppStyles ? undefined : 'rounded-lg border border-gray-300 bg-white text-gray-700 text-xs font-medium py-1.5 px-3 shadow-sm hover:bg-gray-50'}
            style={btnSecondaryStyle}
            onClick={onCancelIntent}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
