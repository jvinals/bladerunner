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

export function parseThinkingStructured(
  codegenOutputJson: unknown,
): {
  observation: string;
  needsToDoAndWhy: string;
  priorFailuresIfAny: string;
  actionNowAndWhy: string;
  playwrightWhy: string;
} | null {
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
