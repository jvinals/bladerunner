import { Cog, Loader2, Image, ScanSearch, Sparkles } from 'lucide-react';
import type { EvaluationStepDto } from '@/lib/api';
import {
  hasCodegenThinkingDisplay,
  normalizeEvaluationStepKind,
  ThinkingStructuredBlock,
} from '@/components/evaluation/evaluation-step-thinking';
import { LlmPromptPreviewIconButton, getLlmPromptsFromStepJson } from '@/components/evaluation/LlmPromptPreviewIconButton';
import type { EvaluationProgressPayload } from '@/hooks/useEvaluationLive';
import {
  ViewportJpegPreviewIconButton,
  getAnalyzerViewportJpegBase64,
  getCodegenViewportJpegBase64,
  omitBinaryPreviewKeys,
} from '@/components/ui/ViewportJpegPreviewIconButton';

export type TimelineViewMode = 'stacked' | 'parallel';

const NESTED_MODAL_Z = { overlayClassName: 'z-[220]', contentClassName: 'z-[221]' } as const;

function JsonBlock({ value }: { value: unknown }) {
  if (value == null || (typeof value === 'object' && value !== null && Object.keys(value as object).length === 0)) {
    return <span className="text-gray-400 text-xs">—</span>;
  }
  return (
    <pre className="text-[11px] font-mono bg-gray-50 border border-gray-100 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-gray-800">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function PendingPanel({ label }: { label: string }) {
  return (
    <div
      className="flex min-h-[72px] items-center justify-center gap-2 rounded border border-dashed border-gray-200 bg-gray-50/90 text-gray-500"
      role="status"
      aria-busy
    >
      <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
      <span className="text-xs">{label}</span>
    </div>
  );
}

function analyzerSectionPendingLabel(phase: string | undefined): string {
  if (phase === 'proposing') return 'Waiting for codegen step…';
  return 'Analyzer model running…';
}

export function getLiveLoadingFlags(
  st: EvaluationStepDto,
  lastProgress: EvaluationProgressPayload | null,
): {
  codegenInputs: boolean;
  codegenOutputs: boolean;
  analyzerInputs: boolean;
  analyzerOutputs: boolean;
} {
  if (normalizeEvaluationStepKind(st) !== 'llm') {
    return { codegenInputs: false, codegenOutputs: false, analyzerInputs: false, analyzerOutputs: false };
  }
  if (
    lastProgress == null ||
    lastProgress.sequence == null ||
    lastProgress.sequence !== st.sequence
  ) {
    return { codegenInputs: false, codegenOutputs: false, analyzerInputs: false, analyzerOutputs: false };
  }
  const phase = String(lastProgress.phase ?? '');
  const hasCodegenIn = st.codegenInputJson != null;
  const hasCodegenOut = st.codegenOutputJson != null;
  const hasAnalyzerIn = st.analyzerInputJson != null;
  const hasAnalyzerOut = st.analyzerOutputJson != null;

  if (phase === 'proposing') {
    return {
      codegenInputs: !hasCodegenIn,
      codegenOutputs: !hasCodegenOut,
      analyzerInputs: !hasAnalyzerIn,
      analyzerOutputs: !hasAnalyzerOut,
    };
  }
  if (phase === 'executing') {
    return {
      codegenInputs: !hasCodegenIn,
      codegenOutputs: !hasCodegenOut,
      analyzerInputs: !hasAnalyzerIn,
      analyzerOutputs: !hasAnalyzerOut,
    };
  }
  if (phase === 'analyzing') {
    return {
      codegenInputs: false,
      codegenOutputs: false,
      analyzerInputs: !hasAnalyzerIn,
      analyzerOutputs: !hasAnalyzerOut,
    };
  }
  return { codegenInputs: false, codegenOutputs: false, analyzerInputs: false, analyzerOutputs: false };
}

type EvaluationStepCardProps = {
  st: EvaluationStepDto;
  idx: number;
  selectedStepIdx: number;
  lastProgress: EvaluationProgressPayload | null;
  layout: TimelineViewMode;
  /** Timeline: fixed-height cards in scroll area. Modal: scrollable single column in a dialog. */
  embedMode?: 'timeline' | 'modal';
};

export function EvaluationStepCard({
  st,
  idx,
  selectedStepIdx,
  lastProgress,
  layout,
  embedMode = 'timeline',
}: EvaluationStepCardProps) {
  const nestedZ = embedMode === 'modal' ? NESTED_MODAL_Z : {};
  const stepKind = normalizeEvaluationStepKind(st);
  const load = getLiveLoadingFlags(st, lastProgress);
  const codegenPrompts = getLlmPromptsFromStepJson(st.codegenInputJson);
  const analyzerPrompts = getLlmPromptsFromStepJson(st.analyzerInputJson);
  const showCodegenFromLive =
    load.codegenOutputs &&
    lastProgress?.sequence === st.sequence &&
    lastProgress.phase === 'executing' &&
    (lastProgress.thinking || lastProgress.playwrightCode || lastProgress.expectedOutcome);

  const outerClass =
    embedMode === 'modal'
      ? 'w-full rounded-lg border border-gray-200 bg-white p-3 text-sm flex flex-col min-h-0'
      : layout === 'stacked'
        ? `snap-center shrink-0 min-w-0 h-[1200px] flex-[0_0_calc(50%-0.5rem)] rounded-lg border p-3 text-sm ${
            selectedStepIdx === idx ? 'border-[#4B90FF] ring-1 ring-[#4B90FF]/30' : 'border-gray-200'
          }`
        : `w-full min-w-[100%] shrink-0 snap-center snap-always flex flex-col h-[1200px] overflow-y-auto rounded-lg border p-3 text-sm ${
            selectedStepIdx === idx ? 'border-[#4B90FF] ring-1 ring-[#4B90FF]/30' : 'border-gray-200'
          }`;

  if (stepKind !== 'llm') {
    return (
      <div className={outerClass}>
        <div className="flex items-start justify-between gap-2 mb-2 shrink-0">
          <div className="flex items-start gap-2 min-w-0">
            <Cog className="h-4 w-4 shrink-0 text-amber-800 mt-0.5" aria-hidden />
            <div className="min-w-0">
              <span className="font-semibold text-gray-900">Step {st.sequence}</span>
              {st.stepTitle ? <p className="text-xs text-gray-600 mt-0.5">{st.stepTitle}</p> : null}
              <p className="text-[10px] uppercase tracking-wide text-amber-900/80 mt-1">
                {stepKind === 'orchestrator_navigate' ? 'Orchestrator · load URL' : 'Orchestrator · sign-in'}
              </p>
            </div>
          </div>
          {st.decision ? (
            <span className="text-[10px] uppercase tracking-wide text-gray-500 shrink-0">{st.decision}</span>
          ) : null}
        </div>
        <div className="space-y-3 text-xs min-h-0 flex-1 overflow-y-auto">
          {st.proposedCode?.trim() ? (
            <div>
              <span className="text-gray-500 font-medium block mb-1">Playwright / host action</span>
              <pre className="text-[11px] font-mono bg-gray-50 border border-gray-100 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-gray-800">
                {st.proposedCode}
              </pre>
            </div>
          ) : null}
          {st.actualOutcome?.trim() ? (
            <div>
              <span className="text-gray-500 font-medium block mb-1">Outcome</span>
              <p className="text-gray-800 leading-relaxed">{st.actualOutcome}</p>
            </div>
          ) : null}
          {st.errorMessage?.trim() ? (
            <p className="text-red-600 text-[11px] leading-snug">{st.errorMessage}</p>
          ) : null}
          {st.codegenOutputJson != null ? (
            <details className="rounded border border-gray-100 bg-gray-50/80">
              <summary className="cursor-pointer px-2 py-1.5 text-[10px] font-medium text-gray-600">
                Raw codegen metadata
              </summary>
              <div className="border-t border-gray-100 p-2">
                <JsonBlock value={st.codegenOutputJson} />
              </div>
            </details>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={outerClass}>
      <div className="flex items-start justify-between gap-2 mb-2 shrink-0">
        <div className="flex items-start gap-2 min-w-0">
          <Sparkles className="h-4 w-4 shrink-0 text-violet-600 mt-0.5" aria-hidden />
          <div>
            <span className="font-semibold text-gray-900">Step {st.sequence}</span>
            {st.stepTitle ? <p className="text-xs text-gray-600 mt-0.5">{st.stepTitle}</p> : null}
          </div>
        </div>
        {st.decision ? (
          <span className="text-[10px] uppercase tracking-wide text-gray-500 shrink-0">{st.decision}</span>
        ) : lastProgress?.sequence === st.sequence && lastProgress.phase ? (
          <span
            className="text-[10px] uppercase tracking-wide text-[#4B90FF] shrink-0 max-w-[120px] truncate"
            title={String(lastProgress.phase)}
          >
            {String(lastProgress.phase).replace(/_/g, ' ')}
          </span>
        ) : null}
      </div>
      <div className="space-y-3 text-xs min-h-0 flex-1 overflow-y-auto">
        <div>
          <span className="text-gray-500 font-medium block mb-1">Activity log before this step</span>
          <div className="max-h-24 overflow-y-auto rounded border border-gray-100 bg-gray-50/80 p-2 font-mono text-gray-700 whitespace-pre-wrap">
            {st.progressSummaryBefore?.trim() || '(empty)'}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-gray-500 font-medium">Codegen inputs (LLM)</span>
            <div className="flex shrink-0 items-center gap-0.5">
              <LlmPromptPreviewIconButton
                system={codegenPrompts?.system}
                user={codegenPrompts?.user}
                modalTitle="Codegen — exact LLM prompt"
                {...nestedZ}
              />
              <ViewportJpegPreviewIconButton
                base64={getCodegenViewportJpegBase64(st.codegenInputJson)}
                icon={Image}
                modalTitle="Codegen — full-page Set-of-Marks JPEG sent to the model"
                openLabel="Preview JPEG sent to the codegen model"
                emptyLabel="No stored viewport JPEG (older runs did not persist it)"
                {...nestedZ}
              />
            </div>
          </div>
          {load.codegenInputs ? (
            <PendingPanel
              label={
                lastProgress?.phase === 'proposing' ? 'Capturing inputs for codegen…' : 'Loading codegen inputs…'
              }
            />
          ) : (
            <JsonBlock
              value={omitBinaryPreviewKeys(
                omitBinaryPreviewKeys(
                  omitBinaryPreviewKeys(st.codegenInputJson, ['viewportJpegBase64']),
                  ['somManifest', 'accessibilitySnapshot'],
                  '[omitted — long text; see LLM inputs]',
                ),
                ['llmPrompts'],
                '[omitted — use prompt icon]',
              )}
            />
          )}
        </div>
        <div>
          {load.codegenOutputs ? (
            showCodegenFromLive ? (
              <JsonBlock
                value={{
                  thinking: lastProgress.thinking,
                  playwrightCode: lastProgress.playwrightCode,
                  expectedOutcome: lastProgress.expectedOutcome,
                }}
              />
            ) : lastProgress?.phase === 'proposing' ? (
              <PendingPanel label="Queued: codegen runs after page capture (SOM, accessibility)…" />
            ) : (
              <PendingPanel label="Codegen model running…" />
            )
          ) : (
            <>
              <ThinkingStructuredBlock codegenOutputJson={st.codegenOutputJson} showSectionTitle />
              {!hasCodegenThinkingDisplay(st.codegenOutputJson) ? (
                <JsonBlock value={st.codegenOutputJson} />
              ) : null}
            </>
          )}
        </div>
        <div>
          <span className="text-gray-500 font-medium block mb-1">Codegen outputs (JSON)</span>
          {load.codegenOutputs ? (
            <PendingPanel label="Waiting for codegen JSON…" />
          ) : (
            <JsonBlock value={st.codegenOutputJson} />
          )}
        </div>
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-gray-500 font-medium">Analyzer inputs</span>
            <div className="flex shrink-0 items-center gap-0.5">
              <LlmPromptPreviewIconButton
                system={analyzerPrompts?.system}
                user={analyzerPrompts?.user}
                modalTitle="Analyzer — exact LLM prompt"
                {...nestedZ}
              />
              <ViewportJpegPreviewIconButton
                base64={getAnalyzerViewportJpegBase64(st.analyzerInputJson)}
                icon={ScanSearch}
                modalTitle="Analyzer — after-step full-page Set-of-Marks JPEG"
                openLabel="Preview after-step JPEG sent to the analyzer"
                emptyLabel="No stored after-step JPEG (step not analyzed yet or older runs)"
                {...nestedZ}
              />
            </div>
          </div>
          {load.analyzerInputs ? (
            <PendingPanel label={analyzerSectionPendingLabel(lastProgress?.phase)} />
          ) : (
            <JsonBlock
              value={omitBinaryPreviewKeys(
                omitBinaryPreviewKeys(
                  omitBinaryPreviewKeys(st.analyzerInputJson, ['afterStepViewportJpegBase64']),
                  ['somManifest', 'accessibilitySnapshot'],
                  '[omitted — long text; see LLM inputs]',
                ),
                ['llmPrompts'],
                '[omitted — use prompt icon]',
              )}
            />
          )}
        </div>
        <div>
          <span className="text-gray-500 font-medium block mb-1">Analyzer outputs</span>
          {load.analyzerOutputs ? (
            <PendingPanel label={analyzerSectionPendingLabel(lastProgress?.phase)} />
          ) : (
            <JsonBlock value={st.analyzerOutputJson} />
          )}
        </div>
      </div>
    </div>
  );
}
