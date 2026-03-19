/** Convert wheel deltas to pixel deltas similar to Chromium for Playwright mouse.wheel. */
export function normalizeWheelDelta(e: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode'>): {
  deltaX: number;
  deltaY: number;
} {
  let dx = e.deltaX;
  let dy = e.deltaY;
  if (e.deltaMode === 1) {
    dx *= 16;
    dy *= 16;
  } else if (e.deltaMode === 2) {
    dx *= 100;
    dy *= 100;
  }
  return { deltaX: dx, deltaY: dy };
}
