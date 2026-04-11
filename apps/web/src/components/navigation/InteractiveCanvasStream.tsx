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
  isInputModalOpen: boolean;
  sendClick: (x: number, y: number) => void;
  sendScroll: (deltaX: number, deltaY: number) => void;
}

const SCROLL_THROTTLE_MS = 50;

export function InteractiveCanvasStream({
  frameDataUrl,
  isInputModalOpen,
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
      if (isInputModalOpen) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { x, y } = clientToViewportCoords(canvas, e.clientX, e.clientY);
      sendClick(x, y);
    },
    [isInputModalOpen, sendClick],
  );

  // -----------------------------------------------------------------------
  // Scroll handler (throttled at ~50ms, preventDefault to block page scroll)
  // -----------------------------------------------------------------------

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (isInputModalOpen) return;
      const now = Date.now();
      if (now - lastScrollTs.current < SCROLL_THROTTLE_MS) return;
      lastScrollTs.current = now;
      sendScroll(e.deltaX, e.deltaY);
    },
    [isInputModalOpen, sendScroll],
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
          isInputModalOpen ? 'pointer-events-none opacity-70' : 'cursor-crosshair'
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
