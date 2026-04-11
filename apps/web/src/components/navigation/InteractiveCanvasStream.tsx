/**
 * Interactive canvas that renders JPEG screencast frames from the remote
 * Playwright browser and captures user pointer/scroll events, translating
 * them to viewport-relative coordinates for the recording service.
 *
 * Key behaviours:
 * - Pointer clicks are forwarded as `sendClick` with bitmap coords and canvas size.
 * - Wheel events are forwarded as `sendScroll(deltaX, deltaY)`, throttled
 *   at ~50ms to prevent WebSocket flooding from trackpad inertia.
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
}

const SCROLL_THROTTLE_MS = 50;

export function InteractiveCanvasStream({
  frameDataUrl,
  isInputModalOpen,
  blockCanvasInteraction,
  proposedIntent,
  onConfirmIntent,
  onCancelIntent,
  sendClick,
  sendScroll,
}: InteractiveCanvasStreamProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastScrollTs = useRef(0);
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

  return (
    <div ref={wrapRef} className="relative w-full">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onWheel={handleWheel}
        className={`w-full rounded-lg border border-gray-200 bg-black ${
          blockCanvasInteraction ? 'pointer-events-none opacity-70' : 'cursor-crosshair'
        }`}
        style={{ aspectRatio: '16 / 9' }}
      />
      {!frameDataUrl && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm pointer-events-none">
          Waiting for browser frame...
        </div>
      )}
      {proposedIntent && fabPos && (
        <div
          className="absolute z-20 flex flex-wrap gap-2 items-center"
          style={{ left: fabPos.left, top: fabPos.top, maxWidth: 'calc(100% - 1rem)' }}
        >
          <button
            type="button"
            className="rounded-lg bg-emerald-600 text-white text-xs font-medium py-1.5 px-3 shadow-md hover:bg-emerald-700"
            onClick={onConfirmIntent}
          >
            Confirm &amp; click
          </button>
          <button
            type="button"
            className="rounded-lg border border-gray-300 bg-white text-gray-700 text-xs font-medium py-1.5 px-3 shadow-sm hover:bg-gray-50"
            onClick={onCancelIntent}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
