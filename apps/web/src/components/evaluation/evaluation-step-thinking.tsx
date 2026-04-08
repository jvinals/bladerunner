import { Check, Loader2 } from 'lucide-react';
import type { EvaluationStepDto, EvaluationStepKindApi } from '@/lib/api';

/** Maps API `thinkingStructured` keys to copy shown under “Codegen output — thinking”. */
export const THINKING_STRUCTURED_LABELS: {
  key: keyof NonNullable<ReturnType<typeof parseThinkingStructured>>;
  label: string;
}[] = [
  { key: 'observation', label: 'Description of what the model sees' },
  { key: 'needsToDoAndWhy', label: 'What it thinks it needs to do, and why' },
  { key: 'priorFailuresIfAny', label: 'Whether it failed before, and if so, why' },
  { key: 'actionNowAndWhy', label: 'The action it wants to take now, and why' },
  {
    key: 'playwrightWhy',
    label:
      'The Playwright code for that action, and why (including prior failures, retries, and locator choices)',
  },
];

export function normalizeEvaluationStepKind(st: EvaluationStepDto): EvaluationStepKindApi {
  return st.stepKind ?? 'llm';
}

export type ThinkingStructuredFields = {
  observation: string;
  needsToDoAndWhy: string;
  priorFailuresIfAny: string;
  actionNowAndWhy: string;
  playwrightWhy: string;
};

function thinkingFieldsHaveContent(f: ThinkingStructuredFields): boolean {
  return Object.values(f).some((v) => v.trim().length > 0);
}

/** Parse legacy single-string `thinking` with "Observation:" / "What to do and why:" / … prose blocks. */
export function parseLegacyThinkingProseToStructured(thinking: string): ThinkingStructuredFields | null {
  const t = thinking.trim();
  if (!t) return null;
  const headers: { key: keyof ThinkingStructuredFields; needle: string }[] = [
    { key: 'observation', needle: 'Observation:' },
    { key: 'needsToDoAndWhy', needle: 'What to do and why:' },
    { key: 'priorFailuresIfAny', needle: 'Prior failures:' },
    { key: 'actionNowAndWhy', needle: 'Action now:' },
    { key: 'playwrightWhy', needle: 'Playwright rationale:' },
  ];
  const hits: { key: keyof ThinkingStructuredFields; index: number; headerLen: number }[] = [];
  for (const { key, needle } of headers) {
    const i = t.indexOf(needle);
    if (i >= 0) hits.push({ key, index: i, headerLen: needle.length });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.index - b.index);
  const out: ThinkingStructuredFields = {
    observation: '',
    needsToDoAndWhy: '',
    priorFailuresIfAny: '',
    actionNowAndWhy: '',
    playwrightWhy: '',
  };
  for (let i = 0; i < hits.length; i++) {
    const { key, index, headerLen } = hits[i];
    const start = index + headerLen;
    const end = i + 1 < hits.length ? hits[i + 1].index : t.length;
    out[key] = t.slice(start, end).trim();
  }
  if (!thinkingFieldsHaveContent(out)) return null;
  return out;
}

/**
 * Shape for **Codegen outputs (JSON)** display: `thinking` as a structured object (not one long string).
 * Prefers `thinkingStructured`; otherwise parses legacy `thinking` prose.
 */
export function buildCodegenOutputJsonForDisplay(codegenOutputJson: unknown): unknown {
  if (!codegenOutputJson || typeof codegenOutputJson !== 'object' || Array.isArray(codegenOutputJson)) {
    return codegenOutputJson;
  }
  const o = { ...(codegenOutputJson as Record<string, unknown>) };
  const ts = parseThinkingStructured(o);
  if (ts && thinkingFieldsHaveContent(ts)) {
    o.thinking = { ...ts };
    delete o.thinkingStructured;
    return o;
  }
  if (typeof o.thinking === 'string') {
    const parsed = parseLegacyThinkingProseToStructured(o.thinking);
    if (parsed && thinkingFieldsHaveContent(parsed)) {
      o.thinking = parsed;
      return o;
    }
  }
  return o;
}

export function parseThinkingStructured(
  codegenOutputJson: unknown,
): ThinkingStructuredFields | null {
  if (!codegenOutputJson || typeof codegenOutputJson !== 'object' || Array.isArray(codegenOutputJson)) {
    return null;
  }
  const o = codegenOutputJson as Record<string, unknown>;
  const raw = o.thinkingStructured;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ts = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  return {
    observation: str(ts.observation),
    needsToDoAndWhy: str(ts.needsToDoAndWhy),
    priorFailuresIfAny: str(ts.priorFailuresIfAny),
    actionNowAndWhy: str(ts.actionNowAndWhy),
    playwrightWhy: str(ts.playwrightWhy),
  };
}

export function hasCodegenThinkingDisplay(codegenOutputJson: unknown): boolean {
  return Boolean(parseThinkingStructured(codegenOutputJson) || parseLegacyThinkingString(codegenOutputJson));
}

export function parseLegacyThinkingString(codegenOutputJson: unknown): string | null {
  if (!codegenOutputJson || typeof codegenOutputJson !== 'object' || Array.isArray(codegenOutputJson)) {
    return null;
  }
  const o = codegenOutputJson as Record<string, unknown>;
  if (typeof o.thinking === 'string' && o.thinking.trim()) return o.thinking.trim();
  return null;
}

export type ThinkingStructuredBlockProps = {
  codegenOutputJson: unknown;
  /** Accordion (step card / modal) vs stacked rows (Thinking Process panel). */
  layout?: 'accordion' | 'stacked';
  /** Stacked: show all five rows with — when empty. Accordion: omit empty rows unless placeholder. */
  emptyFieldMode?: 'hide' | 'placeholder';
  /** Show “Codegen output — thinking” above the subitems. */
  showSectionTitle?: boolean;
};

/** Green dots + short connectors for completed thinking substeps (header row). */
export function ThinkingHeaderSubstepProgress({ completedCount }: { completedCount: number }) {
  if (completedCount <= 0) return null;
  return (
    <span className="flex items-center gap-0.5 shrink-0" aria-hidden>
      {Array.from({ length: completedCount }, (_, i) => (
        <span key={i} className="flex items-center gap-0.5">
          {i > 0 ? <span className="h-0.5 w-1.5 rounded-[1px] bg-[#4CAF50]" /> : null}
          <span className="h-2 w-2 rounded-full bg-[#4CAF50]" />
        </span>
      ))}
    </span>
  );
}

export type ThinkingStructuredPlanRowsProps = {
  codegenOutputJson: unknown;
  /** True while codegen has not returned JSON for this step yet (e.g. proposing placeholder). */
  codegenPending: boolean;
  /** True while this step’s LLM pipeline is still running (matches Thinking process panel rules). */
  thinkingPipelineInProgress: boolean;
  /** True when analyzer output is persisted (step “thinking” finished). */
  stepThinkingComplete: boolean;
  /** Socket phase when this row is the live step; used to treat proposing-without-json as substep 0 loading. */
  livePhase: string | undefined;
};

/**
 * Sequential “plan” substeps for codegen thinking: each row has its own loader or green check;
 * completed rows use grey + strikethrough; future rows stay hidden until active.
 */
export function ThinkingStructuredPlanRows({
  codegenOutputJson,
  codegenPending,
  thinkingPipelineInProgress,
  stepThinkingComplete,
  livePhase,
}: ThinkingStructuredPlanRowsProps) {
  const structured = parseThinkingStructured(codegenOutputJson);
  const legacy = parseLegacyThinkingString(codegenOutputJson);
  const labels = THINKING_STRUCTURED_LABELS;
  const proposingWait = codegenPending && thinkingPipelineInProgress && livePhase === 'proposing';

  if (proposingWait && !structured && !legacy) {
    const { label } = labels[0];
    return (
      <div className="space-y-1.5 pl-0.5">
        <div className="flex gap-2">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4B90FF]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold leading-snug text-gray-900">{label}</p>
            <p className="mt-0.5 text-[11px] text-gray-500">Waiting for codegen…</p>
          </div>
        </div>
      </div>
    );
  }

  if (structured) {
    const texts = labels.map(({ key }) => structured[key]?.trim() ?? '');
    let firstIncomplete = 5;
    for (let i = 0; i < texts.length; i++) {
      if (!texts[i]) {
        firstIncomplete = i;
        break;
      }
    }
    const allFilled = firstIncomplete === 5;

    const rows = labels.map(({ key, label }, i) => {
      const body = texts[i];

      type RowMode = 'hidden' | 'done' | 'loading';
      let mode: RowMode;
      if (stepThinkingComplete) {
        mode = 'done';
      } else if (!thinkingPipelineInProgress) {
        mode = i < firstIncomplete ? 'done' : 'hidden';
      } else if (!allFilled) {
        if (i < firstIncomplete) mode = 'done';
        else if (i === firstIncomplete) mode = 'loading';
        else mode = 'hidden';
      } else {
        mode = 'done';
      }

      if (mode === 'hidden') return null;

      const muted = mode === 'done';
      const icon = muted ? (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#4CAF50]" aria-hidden>
          <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
        </span>
      ) : (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#4B90FF]" aria-hidden />
      );

      const textClass = muted ? 'text-[#9E9E9E]' : 'text-[#212121]';
      const displayBody = body || (mode === 'loading' ? '…' : '—');

      return (
        <div key={key} className="flex gap-2">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
          <div className="min-w-0 flex-1">
            <p className={`text-[10px] font-semibold leading-snug ${textClass}`}>{label}</p>
            <p className={`mt-0.5 text-[11px] leading-relaxed whitespace-pre-wrap ${textClass}`}>{displayBody}</p>
          </div>
        </div>
      );
    });

    return <div className="space-y-2">{rows}</div>;
  }

  if (legacy) {
    const done = stepThinkingComplete || !thinkingPipelineInProgress;
    const textClass = done ? 'text-[#9E9E9E]' : 'text-[#212121]';
    return (
      <div className="space-y-1.5 pl-0.5">
        <div className="flex gap-2">
          {done ? (
            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[#4CAF50]" aria-hidden>
              <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />
            </span>
          ) : (
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[#4B90FF]" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-[10px] font-semibold leading-snug ${textClass}`}>Codegen thinking</p>
            <pre
              className={`mt-0.5 text-[11px] leading-relaxed whitespace-pre-wrap break-words font-sans ${textClass}`}
            >
              {legacy}
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return <span className="text-gray-400 text-xs">—</span>;
}

/** Exported for the panel header: number of completed thinking substeps (green dots). */
export function countThinkingHeaderDots(args: {
  codegenOutputJson: unknown;
  codegenPending: boolean;
  thinkingPipelineInProgress: boolean;
  stepThinkingComplete: boolean;
  livePhase: string | undefined;
}): number {
  const structured = parseThinkingStructured(args.codegenOutputJson);
  const legacy = parseLegacyThinkingString(args.codegenOutputJson);
  const proposingWait =
    args.codegenPending && args.thinkingPipelineInProgress && args.livePhase === 'proposing';

  if (proposingWait && !structured && !legacy) return 0;
  if (legacy) return args.stepThinkingComplete || !args.thinkingPipelineInProgress ? 1 : 0;
  if (!structured) return 0;

  const labels = THINKING_STRUCTURED_LABELS;
  const texts = labels.map(({ key }) => structured[key]?.trim() ?? '');
  let firstIncomplete = 5;
  for (let i = 0; i < texts.length; i++) {
    if (!texts[i]) {
      firstIncomplete = i;
      break;
    }
  }
  const allFilled = firstIncomplete === 5;
  const filledCount = texts.filter((t) => t.length > 0).length;

  if (args.stepThinkingComplete) {
    return allFilled ? 5 : Math.min(5, filledCount);
  }
  if (!args.thinkingPipelineInProgress) {
    return Math.min(5, filledCount);
  }
  if (!allFilled) {
    return firstIncomplete;
  }
  return 5;
}

export function ThinkingStructuredBlock({
  codegenOutputJson,
  layout = 'accordion',
  emptyFieldMode = 'hide',
  showSectionTitle = false,
}: ThinkingStructuredBlockProps) {
  const structured = parseThinkingStructured(codegenOutputJson);
  const legacy = parseLegacyThinkingString(codegenOutputJson);

  if (structured && layout === 'stacked') {
    const labels = THINKING_STRUCTURED_LABELS;
    const hasAny = labels.some(({ key }) => structured[key]?.trim());
    if (emptyFieldMode !== 'placeholder' && !hasAny && !legacy) {
      return <span className="text-gray-400 text-xs">—</span>;
    }
    return (
      <div className="space-y-2">
        {showSectionTitle ? (
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Codegen output — thinking</p>
        ) : null}
        <div className="space-y-2 rounded border border-gray-100 bg-white p-2">
          {labels.map(({ key, label }) => {
            const text = structured[key]?.trim();
            const showRow = emptyFieldMode === 'placeholder' ? true : Boolean(text);
            if (!showRow) return null;
            const body = text || (emptyFieldMode === 'placeholder' ? '—' : '');
            return (
              <div key={key} className="border-b border-gray-50 pb-2 last:border-b-0 last:pb-0">
                <p className="text-[10px] font-semibold text-gray-600 leading-snug">{label}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-gray-800 whitespace-pre-wrap">{body}</p>
              </div>
            );
          })}
        </div>
        {!hasAny && legacy ? (
          <pre className="text-[11px] font-mono bg-gray-50 border border-gray-100 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-gray-800">
            {legacy}
          </pre>
        ) : null}
      </div>
    );
  }

  if (structured) {
    const labels = THINKING_STRUCTURED_LABELS;
    const hasAny = labels.some(({ key }) => structured[key]?.trim());
    if (!hasAny && !legacy) return <span className="text-gray-400 text-xs">—</span>;
    return (
      <div className="space-y-2">
        {showSectionTitle ? (
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Codegen output — thinking</p>
        ) : null}
        <div className="space-y-2">
          {labels.map(({ key, label }) => {
            const text = structured[key]?.trim();
            const showRow = emptyFieldMode === 'placeholder' ? true : Boolean(text);
            if (!showRow) return null;
            const body = text || (emptyFieldMode === 'placeholder' ? '—' : '');
            return (
              <details key={key} className="group rounded border border-gray-100 bg-white">
                <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] font-medium text-gray-600 marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="group-open:text-[#4B90FF]">{label}</span>
                </summary>
                <p className="border-t border-gray-50 px-2 py-2 text-[11px] leading-relaxed text-gray-800 whitespace-pre-wrap">
                  {body}
                </p>
              </details>
            );
          })}
        </div>
        {!hasAny && legacy ? (
          <pre className="text-[11px] font-mono bg-gray-50 border border-gray-100 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-gray-800">
            {legacy}
          </pre>
        ) : null}
      </div>
    );
  }
  if (legacy) {
    return (
      <div className="space-y-1">
        {showSectionTitle ? (
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Codegen output — thinking</p>
        ) : null}
        <pre className="text-[11px] font-mono bg-gray-50 border border-gray-100 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-gray-800">
          {legacy}
        </pre>
      </div>
    );
  }
  return null;
}
