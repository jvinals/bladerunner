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

export type OptimizedPromptStored = {
  schemaVersion: 1;
  generatedAt: string;
  source: string;
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
  return cleaned || null;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item)).filter(Boolean);
}

export function parseOptimizedPromptStored(metadata: unknown): OptimizedPromptStored | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const prompt = (metadata as Record<string, unknown>).optimizedPrompt;
  if (!prompt || typeof prompt !== 'object') return null;
  const o = prompt as Record<string, unknown>;
  if (o.schemaVersion !== 1) return null;

  const stepIntentSummary = cleanString(o.step_intent_summary);
  const canonicalPlaybackPrompt = cleanString(o.canonical_playback_prompt);
  const targetSemanticDescription = cleanString(o.target_semantic_description);
  const actionType = cleanString(o.action_type).toLowerCase() as OptimizedPromptActionType;
  if (
    !stepIntentSummary ||
    !canonicalPlaybackPrompt ||
    !targetSemanticDescription ||
    !ACTION_TYPES.has(actionType)
  ) {
    return null;
  }

  const rawConfidence =
    typeof o.confidence === 'number'
      ? o.confidence
      : typeof o.confidence === 'string'
        ? Number(o.confidence)
        : NaN;

  return {
    schemaVersion: 1,
    generatedAt: cleanString(o.generatedAt),
    source: cleanString(o.source),
    step_intent_summary: stepIntentSummary,
    canonical_playback_prompt: canonicalPlaybackPrompt,
    action_type: actionType,
    business_object: cleanNullableString(o.business_object),
    target_semantic_description: targetSemanticDescription,
    input_or_selection_value: cleanNullableString(o.input_or_selection_value),
    preconditions: cleanStringArray(o.preconditions),
    expected_outcome: cleanStringArray(o.expected_outcome),
    disambiguation_hints: cleanStringArray(o.disambiguation_hints),
    do_not_depend_on: cleanStringArray(o.do_not_depend_on),
    uncertainty_notes: cleanStringArray(o.uncertainty_notes),
    confidence: Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0,
  };
}
