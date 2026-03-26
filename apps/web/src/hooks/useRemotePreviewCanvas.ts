import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import { clientToViewportCoords, pointerButtonToPlaywright } from '@/lib/canvasViewport';
import { normalizeWheelDelta } from '@/lib/wheelDelta';
import type {
  RemotePointerPayload,
  RemoteTouchPhase,
  RemoteTouchPoint,
} from '@/hooks/useRecording';

export type { RemoteTouchPhase, RemoteTouchPoint };

export type RemotePreviewBridge = {
  pointer: (payload: RemotePointerPayload) => void;
  key: (type: 'down' | 'up', key: string) => void;
  touch: (type: RemoteTouchPhase, touchPoints: RemoteTouchPoint[]) => void;
  clipboard: (action: 'paste' | 'pull' | 'cut', text?: string) => Promise<string | undefined>;
  isConnected: () => boolean;
};

function touchForce(t: object): number {
  const f = (t as { force?: number }).force;
  return typeof f === 'number' ? f : 1;
}

/** React's TouchList is not assignable to DOM TouchList for TS; iterate by index. */
function mapTouchesFromCanvas(
  canvas: HTMLCanvasElement,
  list: { length: number; item: (index: number) => { clientX: number; clientY: number; identifier: number; force?: number } | null },
): RemoteTouchPoint[] {
  const out: RemoteTouchPoint[] = [];
  for (let i = 0; i < list.length; i++) {
    const t = list.item(i);
    if (!t) continue;
    const { x, y } = clientToViewportCoords(canvas, t.clientX, t.clientY);
    out.push({ id: t.identifier, x, y, force: touchForce(t) });
  }
  return out;
}

/**
 * Shared pointer, touch, wheel, double-click, and keyboard/clipboard bridging for the screencast canvas.
 */
export function useRemotePreviewCanvas(
  userId: string,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  previewFocusRef: RefObject<HTMLDivElement | null>,
  bridge: RemotePreviewBridge,
  options: { isActive: boolean },
) {
  const { isActive } = options;
  const [remoteKeysEnabled, setRemoteKeysEnabled] = useState(false);
  const lastMoveTsRef = useRef(0);
  const activeTouchesRef = useRef<Map<number, { x: number; y: number; force: number }>>(new Map());

  useEffect(() => {
    if (!isActive) {
      setRemoteKeysEnabled(false);
      activeTouchesRef.current.clear();
    }
  }, [isActive]);

  const forwardPointer = useCallback(
    (kind: Extract<RemotePointerPayload['kind'], 'move' | 'down' | 'up' | 'dblclick'>, e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!userId || !canvasRef.current || e.pointerType === 'touch') return;
      const { x, y } = clientToViewportCoords(canvasRef.current, e.clientX, e.clientY);
      const button = pointerButtonToPlaywright(e.button);
      bridge.pointer({ kind, x, y, button });
    },
    [userId, bridge, canvasRef],
  );

  const forwardWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!userId || !canvasRef.current) return;
      const { x, y } = clientToViewportCoords(canvasRef.current, e.clientX, e.clientY);
      const { deltaX, deltaY } = normalizeWheelDelta(e);
      bridge.pointer({ kind: 'wheel', x, y, deltaX, deltaY });
    },
    [userId, bridge, canvasRef],
  );

  const emitTouch = useCallback(
    (type: RemoteTouchPhase, touchPoints: RemoteTouchPoint[]) => {
      if (!userId || !bridge.isConnected()) return;
      bridge.touch(type, touchPoints);
    },
    [userId, bridge],
  );

  const onCanvasPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === 'touch') return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setRemoteKeysEnabled(true);
      previewFocusRef.current?.focus({ preventScroll: true });
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        const mapped = clientToViewportCoords(canvas, e.clientX, e.clientY);
        const topEl = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
        // #region agent log
        fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e7bf9'},body:JSON.stringify({sessionId:'8e7bf9',runId:'recording-interaction',hypothesisId:'H1-H3-H5',location:'useRemotePreviewCanvas.ts:onCanvasPointerDown',message:'Canvas pointer down forwarded',data:{pointerType:e.pointerType,button:e.button,clientX:Math.round(e.clientX),clientY:Math.round(e.clientY),mappedX:Math.round(mapped.x),mappedY:Math.round(mapped.y),canvasLeft:Math.round(rect.left),canvasTop:Math.round(rect.top),canvasWidth:Math.round(rect.width),canvasHeight:Math.round(rect.height),bitmapWidth:canvas.width,bitmapHeight:canvas.height,elementFromPointTag:topEl?.tagName ?? null,elementFromPointClass:topEl?.className ?? null,previewFocused:document.activeElement===previewFocusRef.current},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
      forwardPointer('down', e);
    },
    [forwardPointer, previewFocusRef],
  );

  const onCanvasPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === 'touch') return;
      const now = performance.now();
      if (now - lastMoveTsRef.current < 12) return;
      lastMoveTsRef.current = now;
      forwardPointer('move', e);
    },
    [forwardPointer],
  );

  const onCanvasPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === 'touch') return;
      e.preventDefault();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      forwardPointer('up', e);
    },
    [forwardPointer],
  );

  const onCanvasDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!userId || !canvasRef.current) return;
      e.preventDefault();
      const { x, y } = clientToViewportCoords(canvasRef.current, e.clientX, e.clientY);
      bridge.pointer({ kind: 'dblclick', x, y, button: 'left' });
    },
    [userId, bridge, canvasRef],
  );

  const onCanvasWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (canvas) {
        const mapped = clientToViewportCoords(canvas, e.clientX, e.clientY);
        const norm = normalizeWheelDelta(e);
        // #region agent log
        fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e7bf9'},body:JSON.stringify({sessionId:'8e7bf9',runId:'recording-interaction',hypothesisId:'H2-H3',location:'useRemotePreviewCanvas.ts:onCanvasWheel',message:'Canvas wheel forwarded',data:{clientX:Math.round(e.clientX),clientY:Math.round(e.clientY),mappedX:Math.round(mapped.x),mappedY:Math.round(mapped.y),deltaX:Math.round(norm.deltaX),deltaY:Math.round(norm.deltaY),remoteKeysEnabled},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
      }
      forwardWheel(e);
    },
    [forwardWheel, canvasRef, remoteKeysEnabled],
  );

  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas || !userId) return;
      setRemoteKeysEnabled(true);
      previewFocusRef.current?.focus({ preventScroll: true });
      const map = activeTouchesRef.current;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches.item(i)!;
        const { x, y } = clientToViewportCoords(canvas, t.clientX, t.clientY);
        map.set(t.identifier, { x, y, force: touchForce(t) });
      }
      emitTouch('touchStart', mapTouchesFromCanvas(canvas, e.touches));
    },
    [userId, canvasRef, previewFocusRef, emitTouch],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas || !userId) return;
      const map = activeTouchesRef.current;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches.item(i)!;
        const { x, y } = clientToViewportCoords(canvas, t.clientX, t.clientY);
        map.set(t.identifier, { x, y, force: touchForce(t) });
      }
      emitTouch('touchMove', mapTouchesFromCanvas(canvas, e.touches));
    },
    [userId, canvasRef, emitTouch],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas || !userId) return;
      const map = activeTouchesRef.current;
      for (let i = 0; i < e.changedTouches.length; i++) {
        map.delete(e.changedTouches.item(i)!.identifier);
      }
      emitTouch('touchEnd', mapTouchesFromCanvas(canvas, e.touches));
    },
    [userId, canvasRef, emitTouch],
  );

  const onTouchCancel = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas || !userId) return;
      activeTouchesRef.current.clear();
      emitTouch('touchCancel', []);
    },
    [userId, canvasRef, emitTouch],
  );

  const onPreviewKeyDown = useCallback(
    async (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!userId || !remoteKeysEnabled || !bridge.isConnected()) {
        // #region agent log
        fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e7bf9'},body:JSON.stringify({sessionId:'8e7bf9',runId:'recording-interaction',hypothesisId:'H4',location:'useRemotePreviewCanvas.ts:onPreviewKeyDown',message:'Preview keydown ignored',data:{key:e.key,remoteKeysEnabled,isConnected:bridge.isConnected(),userPresent:!!userId},timestamp:Date.now()})}).catch(()=>{});
        // #endregion
        return;
      }

      // #region agent log
      fetch('http://127.0.0.1:7686/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8e7bf9'},body:JSON.stringify({sessionId:'8e7bf9',runId:'recording-interaction',hypothesisId:'H4',location:'useRemotePreviewCanvas.ts:onPreviewKeyDown',message:'Preview keydown forwarded',data:{key:e.key,ctrlKey:e.ctrlKey,metaKey:e.metaKey,repeat:e.repeat},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      if (e.key === 'Escape') {
        e.preventDefault();
        setRemoteKeysEnabled(false);
        (e.currentTarget as HTMLDivElement).blur();
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'v') {
        e.preventDefault();
        try {
          const text = await navigator.clipboard.readText();
          if (text) await bridge.clipboard('paste', text);
        } catch {
          /* permission denied */
        }
        return;
      }
      if (mod && k === 'c') {
        e.preventDefault();
        try {
          const text = await bridge.clipboard('pull');
          if (text) await navigator.clipboard.writeText(text);
        } catch {
          /* ignore */
        }
        return;
      }
      if (mod && k === 'x') {
        e.preventDefault();
        try {
          const text = await bridge.clipboard('cut');
          if (text) await navigator.clipboard.writeText(text);
        } catch {
          /* ignore */
        }
        return;
      }

      if (e.repeat && e.key.length === 1) return;
      e.preventDefault();
      bridge.key('down', e.key);
    },
    [userId, remoteKeysEnabled, bridge],
  );

  const onPreviewKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!userId || !remoteKeysEnabled || !bridge.isConnected()) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && (k === 'v' || k === 'c' || k === 'x')) return;
      e.preventDefault();
      bridge.key('up', e.key);
    },
    [userId, remoteKeysEnabled, bridge],
  );

  return {
    remoteKeysEnabled,
    setRemoteKeysEnabled,
    canvasProps: {
      style: { touchAction: 'none' as const },
      onPointerDown: onCanvasPointerDown,
      onPointerMove: onCanvasPointerMove,
      onPointerUp: onCanvasPointerUp,
      onPointerCancel: onCanvasPointerUp,
      onDoubleClick: onCanvasDoubleClick,
      onWheel: onCanvasWheel,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel,
    },
    previewProps: {
      tabIndex: 0 as const,
      onKeyDown: onPreviewKeyDown,
      onKeyUp: onPreviewKeyUp,
      className:
        'relative max-w-full max-h-full outline-none focus-visible:ring-2 focus-visible:ring-[#4B90FF]/50 rounded',
    },
  };
}
