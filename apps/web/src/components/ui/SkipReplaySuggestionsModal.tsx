import { useEffect } from 'react';
import { X } from 'lucide-react';

export type SkipReplaySuggestionItem = { stepId: string; reason: string };

type StepLookup = { id: string; sequence: number; instruction: string };

export function SkipReplaySuggestionsModal({
  open,
  anchorStepId,
  suggestions,
  stepsForLookup,
  busy,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  anchorStepId: string | null;
  suggestions: SkipReplaySuggestionItem[];
  stepsForLookup: StepLookup[];
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onDismiss]);

  if (!open || suggestions.length === 0) return null;

  const byId = new Map(stepsForLookup.map((s) => [s.id, s]));

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="skip-replay-suggest-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
        aria-label="Dismiss"
        disabled={busy}
        onClick={onDismiss}
      />
      <div className="relative z-10 flex w-full max-w-lg max-h-[min(85vh,560px)] flex-col overflow-hidden rounded-xl border border-amber-200/80 bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-100/90 bg-amber-50/50 px-4 py-3">
          <h2 id="skip-replay-suggest-title" className="text-sm font-semibold text-amber-950">
            Mark following steps as Skip replay?
          </h2>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="shrink-0 rounded-md p-1.5 text-gray-500 transition-colors hover:bg-amber-100/80 hover:text-gray-800 disabled:opacity-40"
            aria-label="Close"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <p className="px-4 pt-3 text-[11px] text-gray-600 leading-snug">
          After your change to this step, these later steps may be redundant for replay. Confirm to mark them all as{' '}
          <span className="font-medium text-amber-900">Skip replay</span> (you can undo per step later).
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2 space-y-2">
          {suggestions.map((s) => {
            const row = byId.get(s.stepId);
            const label = row
              ? `Step ${row.sequence}: ${row.instruction.length > 120 ? `${row.instruction.slice(0, 117)}…` : row.instruction}`
              : s.stepId;
            return (
              <div
                key={s.stepId}
                className="rounded-lg border border-amber-100/90 bg-amber-50/30 px-3 py-2 text-[11px]"
              >
                <p className="font-medium text-gray-800 leading-snug">{label}</p>
                <p className="mt-1 text-gray-600 leading-snug">{s.reason}</p>
              </div>
            );
          })}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-amber-100/90 bg-amber-50/30 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onDismiss}
            className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[11px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            Dismiss
          </button>
          <button
            type="button"
            disabled={busy || !anchorStepId}
            onClick={onConfirm}
            className="rounded-md border border-amber-300 bg-amber-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-40"
          >
            {busy ? 'Applying…' : 'Confirm — skip replay for all'}
          </button>
        </div>
      </div>
    </div>
  );
}
