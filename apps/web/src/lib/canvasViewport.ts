/** Map client coordinates to canvas bitmap coordinates (Playwright viewport space). */
export function clientToViewportCoords(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return { x: 0, y: 0 };
  }
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  return {
    x: Math.max(0, Math.min(x, canvas.width - 1)),
    y: Math.max(0, Math.min(y, canvas.height - 1)),
  };
}

export function pointerButtonToPlaywright(button: number): 'left' | 'right' | 'middle' {
  if (button === 2) return 'right';
  if (button === 1) return 'middle';
  return 'left';
}
