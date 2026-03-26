export const OPTIMIZED_PROMPT_SCHEMA_VERSION = 1 as const;

export type OptimizedPromptActionType =
  | 'navigate'
  | 'open'
  | 'click'
  | 'input'
  | 'select'
  | 'search'
  | 'filter'
  | 'submit'
  | 'confirm'
  | 'toggle'
  | 'create'
  | 'update'
  | 'delete'
  | 'close'
  | 'expand'
  | 'collapse'
  | 'download'
  | 'upload'
  | 'other';

export type OptimizedPromptCompileSource = 'immediate' | 'recording_stop_refresh' | 'playback_fallback';

export type OptimizedPromptSpec = {
  step_intent_summary: string;
  canonical_playback_prompt: string;
  action_type: OptimizedPromptActionType;
  business_object: string | null;
  target_semantic_description: string;
  input_or_selection_value: string | null;
  preconditions: string[];
  expected_outcome: string[];
  disambiguation_hints: string[];
  do_not_depend_on: string[];
  uncertainty_notes: string[];
  confidence: number;
};

export type OptimizedPromptStored = OptimizedPromptSpec & {
  schemaVersion: typeof OPTIMIZED_PROMPT_SCHEMA_VERSION;
  generatedAt: string;
  source: OptimizedPromptCompileSource;
};

export type OptimizedPromptEvidenceRef = {
  schemaVersion: typeof OPTIMIZED_PROMPT_SCHEMA_VERSION;
  capturedAt: string;
  source: OptimizedPromptCompileSource;
  evidencePath: string;
  screenshotPath: string | null;
};

type MetadataRecord = Record<string, unknown>;

const ACTION_TYPES: ReadonlySet<OptimizedPromptActionType> = new Set([
  'navigate',
  'open',
  'click',
  'input',
  'select',
  'search',
  'filter',
  'submit',
  'confirm',
  'toggle',
  'create',
  'update',
  'delete',
  'close',
  'expand',
  'collapse',
  'download',
  'upload',
  'other',
]);

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanNullableString(value: unknown): string | null {
  const cleaned = cleanString(value);
  return cleaned ? cleaned : null;
}

function cleanStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanString(item))
    .filter((item) => item.length > 0);
}

export function parseOptimizedPromptSpec(raw: unknown): OptimizedPromptSpec {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Optimized prompt compiler returned a non-object JSON payload');
  }
  const o = raw as Record<string, unknown>;
  const actionType = cleanString(o.action_type).toLowerCase() as OptimizedPromptActionType;
  if (!ACTION_TYPES.has(actionType)) {
    throw new Error(`Optimized prompt compiler returned invalid action_type: ${String(o.action_type)}`);
  }
  const stepIntentSummary = cleanString(o.step_intent_summary);
  const canonicalPlaybackPrompt = cleanString(o.canonical_playback_prompt);
  const targetSemanticDescription = cleanString(o.target_semantic_description);
  if (!stepIntentSummary || !canonicalPlaybackPrompt || !targetSemanticDescription) {
    throw new Error('Optimized prompt compiler omitted required summary, prompt, or target description');
  }
  const rawConfidence =
    typeof o.confidence === 'number'
      ? o.confidence
      : typeof o.confidence === 'string'
        ? Number(o.confidence)
        : NaN;
  const confidence = Number.isFinite(rawConfidence)
    ? Math.max(0, Math.min(1, rawConfidence))
    : 0;
  return {
    step_intent_summary: stepIntentSummary,
    canonical_playback_prompt: canonicalPlaybackPrompt,
    action_type: actionType,
    business_object: cleanNullableString(o.business_object),
    target_semantic_description: targetSemanticDescription,
    input_or_selection_value: cleanNullableString(o.input_or_selection_value),
    preconditions: cleanStringList(o.preconditions),
    expected_outcome: cleanStringList(o.expected_outcome),
    disambiguation_hints: cleanStringList(o.disambiguation_hints),
    do_not_depend_on: cleanStringList(o.do_not_depend_on),
    uncertainty_notes: cleanStringList(o.uncertainty_notes),
    confidence,
  };
}

export function withOptimizedPromptSuccess(
  baseMetadata: MetadataRecord,
  optimizedPrompt: OptimizedPromptStored,
  evidence: OptimizedPromptEvidenceRef,
): MetadataRecord {
  return {
    ...baseMetadata,
    optimizedPrompt,
    optimizedPromptEvidence: evidence,
    lastOptimizedPromptAttemptAt: optimizedPrompt.generatedAt,
    lastOptimizedPromptSource: optimizedPrompt.source,
    lastOptimizedPromptError: null,
  };
}

export function withOptimizedPromptFailure(
  baseMetadata: MetadataRecord,
  source: OptimizedPromptCompileSource,
  message: string,
): MetadataRecord {
  return {
    ...baseMetadata,
    lastOptimizedPromptAttemptAt: new Date().toISOString(),
    lastOptimizedPromptSource: source,
    lastOptimizedPromptError: message.trim(),
  };
}

export function getOptimizedPromptStored(metadata: unknown): OptimizedPromptStored | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as MetadataRecord).optimizedPrompt;
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (o.schemaVersion !== OPTIMIZED_PROMPT_SCHEMA_VERSION) return null;
  try {
    const parsed = parseOptimizedPromptSpec(o);
    return {
      ...parsed,
      schemaVersion: OPTIMIZED_PROMPT_SCHEMA_VERSION,
      generatedAt: cleanString(o.generatedAt) || new Date(0).toISOString(),
      source: (cleanString(o.source) as OptimizedPromptCompileSource) || 'immediate',
    };
  } catch {
    return null;
  }
}

export function getOptimizedPromptEvidenceRef(metadata: unknown): OptimizedPromptEvidenceRef | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as MetadataRecord).optimizedPromptEvidence;
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const evidencePath = cleanString(o.evidencePath);
  if (o.schemaVersion !== OPTIMIZED_PROMPT_SCHEMA_VERSION || !evidencePath) return null;
  return {
    schemaVersion: OPTIMIZED_PROMPT_SCHEMA_VERSION,
    capturedAt: cleanString(o.capturedAt) || new Date(0).toISOString(),
    source: (cleanString(o.source) as OptimizedPromptCompileSource) || 'immediate',
    evidencePath,
    screenshotPath: cleanNullableString(o.screenshotPath),
  };
}
