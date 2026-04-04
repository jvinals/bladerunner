import { useState, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, MessageSquareText, X } from 'lucide-react';

export type LlmPromptPreviewIconButtonProps = {
  system?: string | null;
  user?: string | null;
  modalTitle: string;
  /** Shown under the title (e.g. vision attachment note). */
  subtitle?: string;
  disabledReason?: string;
  overlayClassName?: string;
  contentClassName?: string;
};

/**
 * Icon that opens a modal with the exact system + user text sent to the LLM (vision is separate).
 */
export function LlmPromptPreviewIconButton({
  system,
  user,
  modalTitle,
  subtitle = 'The model also received one vision attachment: the full-page Set-of-Marks JPEG (use the image preview icon).',
  disabledReason = 'Exact prompt was not stored for this step (older runs).',
  overlayClassName = 'z-[220]',
  contentClassName = 'z-[221]',
}: LlmPromptPreviewIconButtonProps) {
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const has = Boolean((system?.trim() ?? '') || (user?.trim() ?? ''));

  useEffect(() => {
    if (!open) setCopyStatus('idle');
  }, [open]);

  const copyAll = useCallback(async () => {
    if (!has) return;
    const text = `--- SYSTEM ---\n${system ?? ''}\n\n--- USER ---\n${user ?? ''}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('copied');
      window.setTimeout(() => setCopyStatus('idle'), 2000);
    } catch {
      setCopyStatus('error');
      window.setTimeout(() => setCopyStatus('idle'), 2500);
    }
  }, [has, system, user]);

  return (
    <>
      <button
        type="button"
        disabled={!has}
        onClick={() => has && setOpen(true)}
        className="inline-flex shrink-0 items-center justify-center rounded p-0.5 text-gray-500 hover:bg-gray-100 hover:text-[#4B90FF] disabled:cursor-not-allowed disabled:opacity-35"
        title={has ? 'View exact LLM prompt (system + user)' : disabledReason}
        aria-label={has ? 'View exact LLM prompt (system + user)' : disabledReason}
      >
        <MessageSquareText size={14} className="shrink-0" aria-hidden />
      </button>
      {has && (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className={`fixed inset-0 bg-black/60 ${overlayClassName}`} />
            <Dialog.Content
              className={`fixed left-1/2 top-1/2 flex max-h-[90vh] w-[min(96vw,48rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-gray-200 bg-white p-0 shadow-xl outline-none ${contentClassName}`}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
                <div className="min-w-0">
                  <Dialog.Title className="text-sm font-semibold text-gray-900">{modalTitle}</Dialog.Title>
                  {subtitle ? <p className="mt-1 text-[11px] text-gray-500 leading-snug">{subtitle}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copyAll()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
                  >
                    <Copy size={14} aria-hidden />
                    {copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Copy failed' : 'Copy all'}
                  </button>
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
                      title="Close"
                    >
                      <X size={18} aria-hidden />
                    </button>
                  </Dialog.Close>
                </div>
              </div>
              <Dialog.Description className="sr-only">Full system and user prompt text sent to the language model.</Dialog.Description>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs">
                <div>
                  <p className="mb-1 font-semibold text-gray-700">System</p>
                  <pre className="max-h-[28vh] overflow-auto whitespace-pre-wrap break-words rounded border border-gray-100 bg-gray-50 p-2 font-mono text-[11px] text-gray-800">
                    {system?.trim() || '—'}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 font-semibold text-gray-700">User</p>
                  <pre className="max-h-[38vh] overflow-auto whitespace-pre-wrap break-words rounded border border-gray-100 bg-gray-50 p-2 font-mono text-[11px] text-gray-800">
                    {user?.trim() || '—'}
                  </pre>
                </div>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}

/** Read persisted `llmPrompts` from codegen or analyzer input JSON. */
export function getLlmPromptsFromStepJson(input: unknown): { system?: string; user?: string } | null {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) return null;
  const o = input as Record<string, unknown>;
  const p = o.llmPrompts;
  if (p == null || typeof p !== 'object' || Array.isArray(p)) return null;
  const r = p as Record<string, unknown>;
  const system = typeof r.system === 'string' ? r.system : undefined;
  const user = typeof r.user === 'string' ? r.user : undefined;
  if (!system && !user) return null;
  return { system, user };
}
