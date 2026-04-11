/**
 * Interactive canvas that renders JPEG screencast frames from the remote
 * Playwright browser and captures user pointer/scroll events, translating
 * them to viewport-relative coordinates for the recording service.
 *
 * Key behaviours:
 * - Pointer clicks are forwarded as `sendClick(x, y)`.
 * - Wheel events are forwarded as `sendScroll(deltaX, deltaY)`, throttled
 *   at ~50ms to prevent WebSocket flooding from trackpad inertia.
 * - When the variable injection modal is open (`isInputModalOpen`), ALL
 *   keyboard and pointer events on the canvas are suppressed so the user
 *   cannot accidentally interact with the headless browser.
 * - `preventDefault` on wheel stops the host page from scrolling while
 *   hovering the canvas.
 */

import { useRef, useEffect, useCallback } from 'react';
import { clientToViewportCoords } from '@/lib/canvasViewport';

interface InteractiveCanvasStreamProps {
  frameDataUrl: string | null;
  /** Variable injection modal: suppress canvas pointer + global keyboard guard. */
  isInputModalOpen: boolean;
  /** Pause (or modal): block forwarding clicks/scroll to the remote browser. */
  blockCanvasInteraction: boolean;
  sendClick: (x: number, y: number) => void;
  sendScroll: (deltaX: number, deltaY: number) => void;
}

const SCROLL_THROTTLE_MS = 50;

export function InteractiveCanvasStream({
  frameDataUrl,
  isInputModalOpen,
  blockCanvasInteraction,
  sendClick,
  sendScroll,
}: InteractiveCanvasStreamProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastScrollTs = useRef(0);

  // -----------------------------------------------------------------------
  // Frame rendering
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
    };
    img.src = frameDataUrl;
  }, [frameDataUrl]);

  // -----------------------------------------------------------------------
  // Input guard: suppress all keyboard events when the modal is open
  // -----------------------------------------------------------------------

  useEffect(() => {
    if (!isInputModalOpen) return;
    const suppress = (e: KeyboardEvent) => {
      // Still block keys from reaching the page/canvas, but allow typing in the
      // Radix variable-injection dialog (and any focus inside `[role="dialog"]`).
      const t = e.target;
      if (t instanceof Element && t.closest('[role="dialog"]')) return;
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
      const { x, y } = clientToViewportCoords(canvas, e.clientX, e.clientY);
      sendClick(x, y);
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
  // Prevent passive wheel on the raw DOM node (React synthetic wheel is passive by default)
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
    <div className="relative w-full">
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
        <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
          Waiting for browser frame...
        </div>
      )}
    </div>
  );
}
