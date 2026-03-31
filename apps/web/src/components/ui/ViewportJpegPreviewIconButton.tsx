import { useState, useEffect, useCallback, type ComponentType } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, X } from 'lucide-react';

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
  const has = typeof base64 === 'string' && base64.length > 0;

  useEffect(() => {
    if (!open) setCopyStatus('idle');
  }, [open]);

  const copyImage = useCallback(async () => {
    if (!has) return;
    setCopyStatus('idle');
    try {
      const res = await fetch(`data:image/jpeg;base64,${base64}`);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/jpeg': blob })]);
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 2500);
    } catch {
      try {
        await navigator.clipboard.writeText(base64);
        setCopyStatus('copiedText');
        window.setTimeout(() => setCopyStatus('idle'), 3500);
      } catch {
        setCopyStatus('error');
        window.setTimeout(() => setCopyStatus('idle'), 3500);
      }
    }
  }, [base64, has]);

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
                Full JPEG at native pixel dimensions. Scroll to see the entire image.
              </Dialog.Description>
              <div className="min-h-0 flex-1 overflow-auto p-3">
                <img
                  src={`data:image/jpeg;base64,${base64}`}
                  alt=""
                  className="block h-auto w-max max-w-none"
                  draggable={false}
                />
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

/** Replace large base64 fields in a copy of step JSON for readable `JsonBlock` output. */
export function omitBinaryPreviewKeys(value: unknown, keys: string[]): unknown {
  if (value == null || typeof value !== 'object') return value;
  const o = { ...(value as Record<string, unknown>) };
  for (const k of keys) {
    if (k in o) o[k] = '[viewport JPEG — use preview icon]';
  }
  return o;
}
