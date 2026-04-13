/**
 * Renders children into a separate browser window via createPortal (same React tree).
 * Used so navigation JPEG streams can be moved to a second monitor without losing events.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const POPUP_FEATURES =
  'width=960,height=540,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface DetachedStreamPortalProps {
  open: boolean;
  /** Called when the user closes the popup or when docking from the main page. */
  onOpenChange: (open: boolean) => void;
  /** Window title bar text. */
  title: string;
  children: ReactNode;
}

export function DetachedStreamPortal({
  open,
  onOpenChange,
  title,
  children,
}: DetachedStreamPortalProps) {
  const [mountEl, setMountEl] = useState<HTMLElement | null>(null);
  const winRef = useRef<Window | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) {
      setMountEl(null);
      return;
    }

    const w = window.open('', '_blank', POPUP_FEATURES);
    if (!w) {
      onOpenChangeRef.current(false);
      setMountEl(null);
      return;
    }

    winRef.current = w;
    const safeTitle = escapeHtml(title);
    w.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    html, body { margin: 0; height: 100%; background: #0a0a0a; }
    #br-detach-root { min-height: 100%; padding: 10px; box-sizing: border-box; }
  </style>
</head>
<body>
  <div id="br-detach-root"></div>
</body>
</html>`);
    w.document.close();

    const root = w.document.getElementById('br-detach-root');
    setMountEl(root);

    const onBeforeUnload = () => {
      onOpenChangeRef.current(false);
    };
    w.addEventListener('beforeunload', onBeforeUnload);

    const poll = window.setInterval(() => {
      if (w.closed) {
        window.clearInterval(poll);
        onOpenChangeRef.current(false);
        setMountEl(null);
        winRef.current = null;
      }
    }, 400);

    return () => {
      window.clearInterval(poll);
      w.removeEventListener('beforeunload', onBeforeUnload);
      try {
        if (!w.closed) {
          w.close();
        }
      } catch {
        /* ignore */
      }
      winRef.current = null;
      setMountEl(null);
    };
  }, [open, title]);

  if (!open || !mountEl) {
    return null;
  }

  return createPortal(children, mountEl);
}
