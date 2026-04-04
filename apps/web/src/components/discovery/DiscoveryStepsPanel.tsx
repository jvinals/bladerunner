import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Cog, Expand, Sparkles, X } from 'lucide-react';
import type { DiscoveryStepDto, ProjectDiscoveryStatus } from '@/lib/api';
import { ThinkingStructuredBlock } from '@/components/evaluation/evaluation-step-thinking';

function outcomeBadge(outcome: DiscoveryStepDto['outcome']) {
  if (outcome === 'success') return <span className="text-[10px] font-medium text-emerald-700">success</span>;
  if (outcome === 'failed') return <span className="text-[10px] font-medium text-red-700">failed</span>;
  if (outcome === 'blocked') return <span className="text-[10px] font-medium text-amber-800">blocked</span>;
  return null;
}

function StepIcon({ kind }: { kind: DiscoveryStepDto['kind'] }) {
  if (kind === 'llm_explore') {
    return <Sparkles className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />;
  }
  return <Cog className="h-4 w-4 shrink-0 text-amber-800" aria-hidden />;
}

function kindLabel(kind: DiscoveryStepDto['kind']): string {
  switch (kind) {
    case 'orchestrator_goto':
      return 'Orchestrator · load URL';
    case 'orchestrator_auth':
      return 'Orchestrator · sign-in';
    case 'llm_explore':
      return 'LLM explore';
    default:
      return kind;
  }
}

export function DiscoveryStepsPanel({
  steps,
  discoveryStatus,
}: {
  steps: DiscoveryStepDto[];
  discoveryStatus?: ProjectDiscoveryStatus;
}) {
  const [modalIdx, setModalIdx] = useState<number | null>(null);
  const active = discoveryStatus === 'queued' || discoveryStatus === 'running';
  if (steps.length === 0) {
    if (!active) return null;
    return (
      <div className="rounded-md border border-dashed border-gray-200 bg-gray-50/50 p-3">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Discovery steps</p>
        <p className="text-[11px] text-gray-500">
          Step timeline will appear here as navigation, sign-in, and exploration steps complete.
        </p>
      </div>
    );
  }

  const modalStep = modalIdx != null ? steps[modalIdx] : null;

  return (
    <>
      <div className="rounded-md border border-gray-200 bg-white p-3">
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Discovery steps</p>
        <p className="text-[11px] text-gray-500 mb-3">
          Timeline for the latest run (host navigation, sign-in, then LLM exploration). Expand a row for details.
        </p>
        <div className="flex flex-col border border-gray-100 rounded-md overflow-hidden divide-y divide-gray-100">
          {steps.map((st, idx) => (
            <div key={st.id} className="flex items-stretch bg-white">
              <details className="group min-w-0 flex-1">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm marker:content-none [&::-webkit-details-marker]:hidden hover:bg-gray-50/80">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <StepIcon kind={st.kind} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium text-gray-900">
                        {st.sequence}. {st.title}
                      </span>
                      <span className="block text-[10px] text-gray-500 mt-0.5">{kindLabel(st.kind)}</span>
                    </span>
                  </span>
                  {outcomeBadge(st.outcome)}
                </summary>
                <div className="border-t border-gray-50 bg-gray-50/50 px-3 py-2 pl-11 space-y-2 text-[11px]">
                  {st.kind === 'llm_explore' && st.thinkingStructured && Object.keys(st.thinkingStructured).length > 0 ? (
                    <div>
                      <span className="text-gray-500 font-medium block mb-1">Reasoning</span>
                      <ThinkingStructuredBlock
                        codegenOutputJson={{ thinkingStructured: st.thinkingStructured }}
                      />
                    </div>
                  ) : null}
                  {st.playwrightCode?.trim() ? (
                    <div>
                      <span className="text-gray-500 font-medium block mb-1">Playwright</span>
                      <pre className="font-mono text-[10px] bg-white border border-gray-100 rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-gray-800">
                        {st.playwrightCode}
                      </pre>
                    </div>
                  ) : null}
                  {st.error?.trim() ? <p className="text-red-600 leading-snug">{st.error}</p> : null}
                  <p className="text-[10px] text-gray-400">{st.createdAt}</p>
                </div>
              </details>
              <div className="flex shrink-0 items-center border-l border-gray-100 bg-gray-50/30 px-2">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-[10px] font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                  onClick={() => setModalIdx(idx)}
                  aria-label={`Open full discovery step ${st.sequence}`}
                >
                  <Expand size={14} className="shrink-0 text-gray-600" aria-hidden />
                  Full step
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog.Root open={modalIdx !== null} onOpenChange={(open) => !open && setModalIdx(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[200] bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[201] flex max-h-[90vh] w-[min(96vw,40rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-gray-200 bg-white p-0 shadow-xl outline-none">
            <div className="flex items-start justify-between gap-2 border-b border-gray-100 px-4 py-3">
              <Dialog.Title className="text-sm font-semibold text-gray-900 pr-2">
                {modalStep ? (
                  <>
                    Step {modalStep.sequence} · {kindLabel(modalStep.kind)}
                  </>
                ) : (
                  'Discovery step'
                )}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>
            <div className="overflow-y-auto px-4 py-3 text-xs space-y-3">
              {modalStep ? (
                <>
                  <p className="font-medium text-gray-900">{modalStep.title}</p>
                  {outcomeBadge(modalStep.outcome)}
                  {modalStep.kind === 'llm_explore' ? (
                    <div>
                      <span className="text-gray-500 font-medium block mb-1">Reasoning</span>
                      <ThinkingStructuredBlock
                        codegenOutputJson={
                          modalStep.thinkingStructured
                            ? { thinkingStructured: modalStep.thinkingStructured }
                            : null
                        }
                      />
                    </div>
                  ) : null}
                  {modalStep.playwrightCode?.trim() ? (
                    <div>
                      <span className="text-gray-500 font-medium block mb-1">Playwright</span>
                      <pre className="font-mono text-[11px] bg-gray-50 border border-gray-100 rounded p-2 whitespace-pre-wrap break-words">
                        {modalStep.playwrightCode}
                      </pre>
                    </div>
                  ) : null}
                  {modalStep.error?.trim() ? (
                    <p className="text-red-600 text-[11px] leading-relaxed">{modalStep.error}</p>
                  ) : null}
                  <div>
                    <span className="text-gray-500 font-medium block mb-1">Raw</span>
                    <pre className="font-mono text-[10px] bg-gray-50 border border-gray-100 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">
                      {JSON.stringify(modalStep, null, 2)}
                    </pre>
                  </div>
                </>
              ) : null}
            </div>
            <Dialog.Description className="sr-only">Full discovery step detail</Dialog.Description>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
