import type { ReactNode } from 'react';
import { ChevronRight, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { EvaluationStepDto } from '@/lib/api';
import type { EvaluationProgressPayload } from '@/hooks/useEvaluationLive';

const PLACEHOLDER_PREFIX = '__pending__';

function parseCodegenJson(st: EvaluationStepDto): { stepTitle?: string; playwrightCode?: string } {
  const raw = st.codegenOutputJson;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  return {
    stepTitle: typeof o.stepTitle === 'string' ? o.stepTitle : undefined,
    playwrightCode: typeof o.playwrightCode === 'string' ? o.playwrightCode : undefined,
  };
}

function parseAnalyzerInput(st: EvaluationStepDto): {
  executionOk?: boolean;
  errorMessage?: string | null;
} {
  const raw = st.analyzerInputJson;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const executionOk = o.executionOk === true ? true : o.executionOk === false ? false : undefined;
  const errorMessage =
    typeof o.errorMessage === 'string' ? o.errorMessage : o.errorMessage === null ? null : undefined;
  return { executionOk, errorMessage };
}

/** Step finished when analyzer output persisted (orchestrator writes last). */
function isStepThinkingComplete(st: EvaluationStepDto): boolean {
  return st.analyzerOutputJson != null;
}

/**
 * Spinner while codegen/analyzer pipeline still running for this step (aligns with step card loading rules).
 */
function isThinkingRowInProgress(st: EvaluationStepDto, lastProgress: EvaluationProgressPayload | null): boolean {
  if (st.id.startsWith(PLACEHOLDER_PREFIX)) return true;
  if (isStepThinkingComplete(st)) return false;
  if (lastProgress == null || lastProgress.sequence == null || lastProgress.sequence !== st.sequence) {
    return false;
  }
  const phase = String(lastProgress.phase ?? '');
  return phase === 'proposing' || phase === 'executing' || phase === 'analyzing';
}

function displayTitle(st: EvaluationStepDto): string {
  const { stepTitle: fromJson } = parseCodegenJson(st);
  if (fromJson?.trim()) return fromJson.trim();
  if (st.stepTitle?.trim()) return st.stepTitle.trim();
  return `Step ${st.sequence}`;
}

function displayPlaywrightCode(st: EvaluationStepDto): string {
  const { playwrightCode } = parseCodegenJson(st);
  if (playwrightCode?.trim()) return playwrightCode.trim();
  return st.proposedCode?.trim() ?? '';
}

function displayError(st: EvaluationStepDto): string | null {
  const { executionOk, errorMessage: fromAnalyzer } = parseAnalyzerInput(st);
  if (executionOk !== false) return null;
  if (typeof fromAnalyzer === 'string' && fromAnalyzer.trim()) return fromAnalyzer.trim();
  if (st.errorMessage?.trim()) return st.errorMessage.trim();
  return null;
}

function formatDuration(stepDurationMs: number | null | undefined): string | null {
  if (stepDurationMs == null || !Number.isFinite(stepDurationMs) || stepDurationMs < 0) return null;
  const s = stepDurationMs / 1000;
  const rounded = s >= 10 ? s.toFixed(0) : s.toFixed(1);
  return `(${rounded}s)`;
}

type Props = {
  steps: EvaluationStepDto[];
  lastProgress: EvaluationProgressPayload | null;
};

export function ThinkingProcessPanel({ steps, lastProgress }: Props) {
  if (steps.length === 0) {
    return (
      <p className="text-xs text-gray-500 px-4 py-3 border-t border-gray-100">
        No steps yet. Start the run to see codegen and analyzer progress here.
      </p>
    );
  }

  return (
    <div className="divide-y divide-gray-100">
      {steps.map((st) => {
        const complete = isStepThinkingComplete(st);
        const inProgress = isThinkingRowInProgress(st, lastProgress);
        const title = displayTitle(st);
        const code = displayPlaywrightCode(st);
        const { executionOk } = parseAnalyzerInput(st);
        const err = displayError(st);
        const dur = formatDuration(st.stepDurationMs);

        let leftIcon: ReactNode;
        if (!complete && inProgress) {
          leftIcon = <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#4B90FF]" aria-hidden />;
        } else if (complete) {
          if (executionOk === true) {
            leftIcon = <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />;
          } else if (executionOk === false) {
            leftIcon = <XCircle className="h-4 w-4 shrink-0 text-red-600" aria-hidden />;
          } else {
            leftIcon = <CheckCircle2 className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />;
          }
        } else {
          leftIcon = <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#4B90FF]" aria-hidden />;
        }

        return (
          <details key={st.id} className="group">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm marker:content-none [&::-webkit-details-marker]:hidden hover:bg-gray-50/80">
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {leftIcon}
                <span className="min-w-0 flex-1 truncate text-gray-900" title={title}>
                  {title}
                </span>
              </span>
              {complete && dur ? (
                <span className="shrink-0 text-xs tabular-nums text-gray-500">{dur}</span>
              ) : null}
              <ChevronRight
                size={16}
                className="shrink-0 text-gray-400 transition-transform group-open:rotate-90"
                aria-hidden
              />
            </summary>
            <div className="border-t border-gray-50 bg-gray-50/50 px-4 py-2 pl-11">
              <p
                className="truncate font-mono text-[11px] leading-relaxed text-gray-700"
                title={code || '(no code)'}
              >
                {code || '—'}
              </p>
              {err ? <p className="mt-1.5 text-xs leading-snug text-red-600">{err}</p> : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}
