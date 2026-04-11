/**
 * Modal presented when the user clicks an input field during navigation recording.
 *
 * Two choices:
 * 1. **Static text** -- literal value typed into the field during recording.
 * 2. **Dynamic variable** -- a `{{variable_name}}` placeholder compiled into
 *    the Skyvern workflow so the value is injected at execution time.
 */

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Type, Variable } from 'lucide-react';
import type { InputPromptState } from '@/hooks/useNavigationRecording';

interface VariableInjectionModalProps {
  prompt: InputPromptState;
  onResolve: (mode: 'static' | 'variable', value: string) => void;
  onDismiss: () => void;
}

export function VariableInjectionModal({
  prompt,
  onResolve,
  onDismiss,
}: VariableInjectionModalProps) {
  const [tab, setTab] = useState<'static' | 'variable'>('static');
  const [staticValue, setStaticValue] = useState('');
  const [variableName, setVariableName] = useState('');

  const m = prompt.elementMeta;
  const label =
    (m?.ariaLabel && String(m.ariaLabel)) ||
    (m?.placeholder && String(m.placeholder)) ||
    (m?.name && String(m.name)) ||
    (m?.id && String(m.id)) ||
    (m?.textContent && String(m.textContent).slice(0, 80)) ||
    `${m?.tag ?? 'input'} field`;

  const canSubmit =
    tab === 'static' ? staticValue.trim().length > 0 : variableName.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    if (tab === 'static') {
      onResolve('static', staticValue.trim());
    } else {
      onResolve('variable', variableName.trim().replace(/^\{+|\}+$/g, ''));
    }
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[201] w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-0 shadow-xl outline-none">
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-3">
            <Dialog.Title className="text-sm font-semibold text-gray-900">
              Input: {label}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-5 py-4 space-y-4">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTab('static')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  tab === 'static'
                    ? 'bg-[#4B90FF]/10 text-[#4B90FF] border border-[#4B90FF]/30'
                    : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Type size={14} />
                Static text
              </button>
              <button
                type="button"
                onClick={() => setTab('variable')}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  tab === 'variable'
                    ? 'bg-violet-50 text-violet-700 border border-violet-200'
                    : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Variable size={14} />
                Dynamic variable
              </button>
            </div>

            {tab === 'static' ? (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Text to type into the field
                </label>
                <textarea
                  autoFocus
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm min-h-[72px] focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                  value={staticValue}
                  onChange={(e) => setStaticValue(e.target.value)}
                  placeholder="e.g. john@example.com"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && canSubmit) { e.preventDefault(); handleSubmit(); } }}
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Variable name (no {'{{ }}'} needed)
                </label>
                <input
                  autoFocus
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-300"
                  value={variableName}
                  onChange={(e) => setVariableName(e.target.value)}
                  placeholder="e.g. patient_name"
                  onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) { e.preventDefault(); handleSubmit(); } }}
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Will be compiled as <code className="text-violet-600">{`{{${variableName || '...'}}}`}</code> in the Skyvern workflow.
                </p>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
            <button
              type="button"
              className="text-sm text-gray-500 px-3 py-1.5"
              onClick={onDismiss}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={handleSubmit}
              className="rounded-lg bg-[#4B90FF] text-white text-sm font-medium px-4 py-1.5 disabled:opacity-50"
            >
              Confirm
            </button>
          </div>

          <Dialog.Description className="sr-only">
            Choose whether to input static text or a dynamic variable placeholder for this field.
          </Dialog.Description>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
