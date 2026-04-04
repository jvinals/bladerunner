import type { EvaluationStepDto, EvaluationStepKindApi } from '@/lib/api';

const STRUCTURED_LABELS: { key: keyof NonNullable<ReturnType<typeof parseThinkingStructured>>; label: string }[] = [
  { key: 'observation', label: 'Observation' },
  { key: 'needsToDoAndWhy', label: 'What to do and why' },
  { key: 'priorFailuresIfAny', label: 'Prior failures (if any)' },
  { key: 'actionNowAndWhy', label: 'Action now and why' },
  { key: 'playwrightWhy', label: 'Playwright rationale' },
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

export function ThinkingStructuredBlock({ codegenOutputJson }: { codegenOutputJson: unknown }) {
  const structured = parseThinkingStructured(codegenOutputJson);
  const legacy = parseLegacyThinkingString(codegenOutputJson);
  if (structured) {
    const hasAny = STRUCTURED_LABELS.some(({ key }) => structured[key]?.trim());
    if (!hasAny && !legacy) return <span className="text-gray-400 text-xs">—</span>;
    return (
      <div className="space-y-2">
        {STRUCTURED_LABELS.map(({ key, label }) => {
          const text = structured[key]?.trim();
          if (!text) return null;
          return (
            <details key={key} className="group rounded border border-gray-100 bg-white">
              <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] font-medium text-gray-600 marker:content-none [&::-webkit-details-marker]:hidden">
                <span className="group-open:text-[#4B90FF]">{label}</span>
              </summary>
              <p className="border-t border-gray-50 px-2 py-2 text-[11px] leading-relaxed text-gray-800 whitespace-pre-wrap">
                {text}
              </p>
            </details>
          );
        })}
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
      <pre className="text-[11px] font-mono bg-gray-50 border border-gray-100 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-gray-800">
        {legacy}
      </pre>
    );
  }
  return null;
}
