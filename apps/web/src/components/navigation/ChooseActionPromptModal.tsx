/**
 * After "Improve with AI", pick Original vs Improved before applying to the action instruction.
 */

import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

type Tab = 'improved' | 'original';

export interface ChooseActionPromptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  originalText: string;
  improvedText: string;
  onCancel: () => void;
  onUse: (choice: Tab) => void;
}

export function ChooseActionPromptModal({
  open,
  onOpenChange,
  originalText,
  improvedText,
  onCancel,
  onUse,
}: ChooseActionPromptModalProps) {
  const [tab, setTab] = useState<Tab>('improved');

  useEffect(() => {
    if (open) setTab('improved');
  }, [open]);

  const preview = tab === 'improved' ? improvedText : originalText;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/40 data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[81] w-[min(100vw-1.5rem,28rem)] max-h-[min(90vh,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-4 shadow-lg focus:outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <Dialog.Title className="text-sm font-semibold text-gray-900">
                Choose your prompt
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-gray-500">
                Select which version of the prompt you&apos;d like to use for this step&apos;s Skyvern
                goal.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close"
                onClick={onCancel}
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="mt-4 flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 text-[11px] font-medium">
            <button
              type="button"
              className={`flex-1 rounded-md px-2 py-1.5 transition-colors ${
                tab === 'improved'
                  ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
              onClick={() => setTab('improved')}
            >
              Improved
            </button>
            <button
              type="button"
              className={`flex-1 rounded-md px-2 py-1.5 transition-colors ${
                tab === 'original'
                  ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
              onClick={() => setTab('original')}
            >
              Original
            </button>
          </div>

          <label className="mt-3 block">
            <span className="sr-only">Preview</span>
            <textarea
              readOnly
              value={preview}
              rows={8}
              className="w-full resize-y rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2 text-[11px] leading-relaxed text-gray-800"
            />
          </label>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-[#4B90FF] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#3a7ae0]"
              onClick={() => onUse(tab)}
            >
              Use this prompt
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
