import { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, X } from 'lucide-react';

type Props = {
  b64: string;
  /** Radix overlay z-index (must sit above surrounding panels). */
  overlayClassName?: string;
  /** Dialog content z-index. */
  contentClassName?: string;
  modalTitle?: string;
  /** Applied to the thumbnail `<img>` (e.g. max height). */
  thumbnailImgClassName?: string;
};

/**
 * Thumbnail of the JPEG passed to the vision LLM; click opens full-size modal with copy.
 */
export function LlmVisionScreenshotPreview({
  b64,
  overlayClassName = 'z-[130]',
  contentClassName = 'z-[131]',
  modalTitle = 'LLM screenshot — full resolution',
  thumbnailImgClassName = 'mx-auto max-h-32 max-w-full h-auto w-auto object-contain object-top',
}: Props) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'copiedText' | 'error'>('idle');

  useEffect(() => {
    if (!zoomOpen) setCopyStatus('idle');
  }, [zoomOpen]);

  const copyLlmScreenshotToClipboard = useCallback(async () => {
    setCopyStatus('idle');
    try {
      const res = await fetch(`data:image/jpeg;base64,${b64}`);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/jpeg': blob })]);
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 2500);
    } catch {
      try {
        await navigator.clipboard.writeText(b64);
        setCopyStatus('copiedText');
        window.setTimeout(() => setCopyStatus('idle'), 3500);
      } catch {
        setCopyStatus('error');
        window.setTimeout(() => setCopyStatus('idle'), 3500);
      }
    }
  }, [b64]);

  return (
    <>
      <button
        type="button"
        onClick={() => setZoomOpen(true)}
        className="block w-full cursor-zoom-in rounded border border-gray-200 bg-gray-50/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/80"
        title="Open full-size screenshot"
      >
        <img
          src={`data:image/jpeg;base64,${b64}`}
          alt="Viewport screenshot sent to the vision model for this request"
          className={thumbnailImgClassName}
        />
      </button>
      <Dialog.Root open={zoomOpen} onOpenChange={setZoomOpen}>
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
                  onClick={() => void copyLlmScreenshotToClipboard()}
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
              Full JPEG at native pixel dimensions. Scroll to see the entire image. Use Copy image to place it on the
              clipboard.
            </Dialog.Description>
            <p className="border-b border-gray-800 px-4 py-2 text-[10px] text-gray-500">
              If image copy is blocked by the browser, the same button falls back to copying raw base64 text.
            </p>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              <img
                src={`data:image/jpeg;base64,${b64}`}
                alt="Full page screenshot sent to the vision model"
                className="block h-auto w-max max-w-none"
                draggable={false}
              />
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
