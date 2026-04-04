import { useState, useEffect, useCallback, type ComponentType } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, X } from 'lucide-react';

/** Strip optional data-URL prefix and whitespace so we always feed raw base64 to atob / Blob. */
export function normalizeJpegBase64Payload(s: string): string {
  const t = s.trim();
  const m = /^data:image\/[^;]+;base64,(.*)$/is.exec(t);
  return (m ? m[1] : t).replace(/\s/g, '');
}

export type ViewportJpegPreviewIconButtonProps = {
  base64: string | undefined | null;
  modalTitle: string;
  /** Lucide icon for the trigger */
  icon: ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>;
  openLabel?: string;
  emptyLabel?: string;
  overlayClassName?: string;
  contentClassName?: string;
};

/**
 * Icon-only control that opens a modal with the viewport JPEG (base64) when present.
 */
export function ViewportJpegPreviewIconButton({
  base64,
  modalTitle,
  icon: Icon,
  openLabel = 'Preview viewport JPEG',
  emptyLabel = 'No viewport JPEG stored for this step',
  overlayClassName = 'z-[130]',
  contentClassName = 'z-[131]',
}: ViewportJpegPreviewIconButtonProps) {
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'copiedText' | 'error'>('idle');
  /** Blob URL for preview — avoids huge data: URLs and scales reliably in the modal. */
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const has = typeof base64 === 'string' && base64.length > 0;

  useEffect(() => {
    if (!open) setCopyStatus('idle');
  }, [open]);

  useEffect(() => {
    if (!open || !has || !base64) {
      setPreviewObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      return;
    }
    const normalized = normalizeJpegBase64Payload(base64);
    try {
      const bin = atob(normalized);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const blob = new Blob([u8], { type: 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      setPreviewObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
    } catch {
      setPreviewObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }
    return () => {
      setPreviewObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [open, has, base64]);

  // #region agent log
  useEffect(() => {
    if (!open || !has || !base64) return;
    const s = base64.trim();
    const startsWithDataUrl = /^data:image\/[^;]+;base64,/i.test(s);
    const normalized = normalizeJpegBase64Payload(base64);
    let jpegMagicHex = 'n/a';
    let decodeErr = false;
    try {
      const bin = atob(normalized);
      jpegMagicHex = [...bin.slice(0, 3)]
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join('');
    } catch {
      decodeErr = true;
    }
    fetch('http://127.0.0.1:7445/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ba63e6' },
      body: JSON.stringify({
        sessionId: 'ba63e6',
        hypothesisId: 'H4',
        location: 'ViewportJpegPreviewIconButton.tsx:modal_open',
        message: 'client viewport JPEG before img render',
        data: {
          base64OuterLen: s.length,
          startsWithDataUrl,
          jpegMagicHex,
          jpegLooksValid: jpegMagicHex === 'ffd8ff',
          decodeErr,
          hasNewlinesInPayload: /\r|\n/.test(base64),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
  }, [open, has, base64]);
  // #endregion

  const copyImage = useCallback(async () => {
    if (!has || !base64) return;
    setCopyStatus('idle');
    const payload = normalizeJpegBase64Payload(base64);
    try {
      const res = await fetch(`data:image/jpeg;base64,${payload}`);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/jpeg': blob })]);
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 2500);
    } catch {
      try {
        await navigator.clipboard.writeText(payload);
        setCopyStatus('copiedText');
        window.setTimeout(() => setCopyStatus('idle'), 3500);
      } catch {
        setCopyStatus('error');
        window.setTimeout(() => setCopyStatus('idle'), 3500);
      }
    }
  }, [base64, has]);

  const imgSrc = previewObjectUrl ?? (has && base64 ? `data:image/jpeg;base64,${normalizeJpegBase64Payload(base64)}` : '');

  return (
    <>
      <button
        type="button"
        disabled={!has}
        onClick={() => has && setOpen(true)}
        className="inline-flex shrink-0 items-center justify-center rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-[#4B90FF] disabled:cursor-not-allowed disabled:opacity-35"
        title={has ? openLabel : emptyLabel}
        aria-label={has ? openLabel : emptyLabel}
      >
        <Icon size={14} className="shrink-0" aria-hidden />
      </button>
      {has && (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className={`fixed inset-0 bg-black/85 ${overlayClassName}`} />
            <Dialog.Content
              className={`fixed left-1/2 top-1/2 flex max-h-[96vh] w-[min(98vw,1400px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-gray-700 bg-gray-950 p-0 shadow-2xl outline-none ${contentClassName}`}
            >
              <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
                <Dialog.Title className="text-sm font-semibold text-gray-100">{modalTitle}</Dialog.Title>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copyImage()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-100 hover:bg-gray-700"
                  >
                    <Copy size={14} className="opacity-90" aria-hidden />
                    {copyStatus === 'copied'
                      ? 'Copied image'
                      : copyStatus === 'copiedText'
                        ? 'Copied base64 text'
                        : copyStatus === 'error'
                          ? 'Copy failed'
                          : 'Copy image'}
                  </button>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
                      title="Close"
                    >
                      <X size={18} aria-hidden />
                    </button>
                  </Dialog.Close>
                </div>
              </div>
              <Dialog.Description className="sr-only">
                Full-page JPEG scaled to fit; scroll if needed. The model also receives SOM manifest and accessibility text.
              </Dialog.Description>
              <p className="border-b border-gray-800 px-4 py-2 text-[11px] leading-snug text-gray-400">
                Full-page capture (often very tall). Scaled to fit; scroll to pan. The codegen model also reads the Set-of-Marks
                manifest and accessibility tree in text — reasoning may cite those even if this JPEG looks sparse or light.
              </p>
              <div className="min-h-[min(70vh,720px)] min-w-0 flex-1 overflow-auto bg-[#262626] p-3">
                {imgSrc ? (
                  <img
                    src={imgSrc}
                    alt=""
                    className="mx-auto block h-auto max-h-[min(85vh,920px)] w-full max-w-full object-contain"
                    draggable={false}
                    onLoad={(e) => {
                      // #region agent log
                      const el = e.currentTarget;
                      fetch('http://127.0.0.1:7445/ingest/178741b1-421d-4e0d-a730-90b4f66ebe43', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ba63e6' },
                        body: JSON.stringify({
                          sessionId: 'ba63e6',
                          hypothesisId: 'H5-postfix',
                          location: 'ViewportJpegPreviewIconButton.tsx:img_onLoad',
                          message: 'JPEG rendered in modal',
                          data: {
                            naturalWidth: el.naturalWidth,
                            naturalHeight: el.naturalHeight,
                            usesBlobUrl: el.src.startsWith('blob:'),
                          },
                          timestamp: Date.now(),
                        }),
                      }).catch(() => {});
                      // #endregion
                    }}
                  />
                ) : null}
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}

/** Read persisted codegen viewport base64 from step JSON. */
export function getCodegenViewportJpegBase64(codegenInputJson: unknown): string | undefined {
  if (codegenInputJson == null || typeof codegenInputJson !== 'object') return undefined;
  const v = (codegenInputJson as Record<string, unknown>).viewportJpegBase64;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Read persisted after-step viewport base64 from analyzer input JSON. */
export function getAnalyzerViewportJpegBase64(analyzerInputJson: unknown): string | undefined {
  if (analyzerInputJson == null || typeof analyzerInputJson !== 'object') return undefined;
  const v = (analyzerInputJson as Record<string, unknown>).afterStepViewportJpegBase64;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Replace large base64 or long-text fields in a copy of step JSON for readable `JsonBlock` output. */
export function omitBinaryPreviewKeys(
  value: unknown,
  keys: string[],
  placeholder = '[viewport JPEG — use preview icon]',
): unknown {
  if (value == null || typeof value !== 'object') return value;
  const o = { ...(value as Record<string, unknown>) };
  for (const k of keys) {
    if (k in o) o[k] = placeholder;
  }
  return o;
}
