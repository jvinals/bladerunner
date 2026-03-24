import type { ConfigService } from '@nestjs/config';

/** Distinct LLM call sites; add keys here and wire LlmService + Settings UI. */
export const LLM_USAGE_KEYS = [
  'playwright_codegen',
  'playwright_verify',
  'action_to_instruction',
  'explain_ai_prompt_failure',
  'suggest_skip_after_change',
] as const;

export type LlmUsageKey = (typeof LLM_USAGE_KEYS)[number];

export type LlmProviderId = 'gemini' | 'openai' | 'anthropic' | 'openrouter';

export type LlmPreferenceEntry = {
  provider: LlmProviderId;
  /** Provider-specific model id (e.g. OpenRouter slug, OpenAI id, Gemini id). */
  model: string;
};

export type UserLlmPreferencesPayload = {
  usage?: Partial<Record<LlmUsageKey, LlmPreferenceEntry>>;
  /** Extra model ids shown in Settings combobox (user favorites). */
  userModelPresets?: string[];
};

export const LLM_USAGE_LABELS: Record<LlmUsageKey, string> = {
  playwright_codegen: 'Generate Playwright from vision (AI prompt / instruct)',
  playwright_verify: 'DOM verify pass (after draft Playwright codegen)',
  action_to_instruction: 'Recording — action to instruction + snippet',
  explain_ai_prompt_failure: 'Explain AI prompt test failure + suggested prompt',
  suggest_skip_after_change: 'Suggest steps to skip after step change',
};

export const LLM_USAGE_SUPPORTS_VISION: Record<LlmUsageKey, boolean> = {
  playwright_codegen: true,
  playwright_verify: false,
  action_to_instruction: false,
  explain_ai_prompt_failure: true,
  suggest_skip_after_change: false,
};

/** Curated quick-pick model ids per provider (extend anytime). */
export const LLM_PROVIDER_CATALOG: Record<
  LlmProviderId,
  { label: string; suggestedModels: string[] }
> = {
  gemini: {
    label: 'Google Gemini',
    suggestedModels: ['gemini-3-flash-preview', 'gemini-2.0-flash', 'gemini-2.5-pro-preview-06-05'],
  },
  openai: {
    label: 'OpenAI',
    suggestedModels: ['gpt-5.4-mini', 'gpt-4.1', 'gpt-4o', 'o4-mini'],
  },
  anthropic: {
    label: 'Anthropic',
    suggestedModels: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022'],
  },
  openrouter: {
    label: 'OpenRouter',
    suggestedModels: [
      'minimax/minimax-m2.5',
      'openai/gpt-4o',
      'anthropic/claude-3.5-sonnet',
      'google/gemini-2.0-flash-001',
    ],
  },
};

function legacyGeneralProvider(config: ConfigService): LlmProviderId {
  const p = config.get<string>('LLM_PROVIDER', 'openai')?.trim().toLowerCase();
  if (p === 'anthropic') return 'anthropic';
  if (p === 'openai') return 'openai';
  return 'openai';
}

function legacyGeneralModel(config: ConfigService): string {
  const prov = legacyGeneralProvider(config);
  if (prov === 'anthropic') {
    return config.get<string>('ANTHROPIC_MODEL', 'claude-sonnet-4-20250514')?.trim() || 'claude-sonnet-4-20250514';
  }
  return config.get<string>('OPENAI_MODEL', 'gpt-5.4-mini')?.trim() || 'gpt-5.4-mini';
}

/** Env-only defaults when the user has no DB row or no entry for a usage key. */
export function getDefaultPreferenceForUsage(config: ConfigService, usage: LlmUsageKey): LlmPreferenceEntry {
  const geminiModel =
    config.get<string>('GEMINI_INSTRUCTION_MODEL')?.trim() || 'gemini-3-flash-preview';
  const general: LlmPreferenceEntry = {
    provider: legacyGeneralProvider(config),
    model: legacyGeneralModel(config),
  };

  switch (usage) {
    case 'playwright_codegen':
    case 'playwright_verify':
      return { provider: 'gemini', model: geminiModel };
    case 'action_to_instruction':
    case 'explain_ai_prompt_failure':
    case 'suggest_skip_after_change':
      return { ...general };
    default:
      return general;
  }
}

export function isValidProviderId(v: string): v is LlmProviderId {
  return v === 'gemini' || v === 'openai' || v === 'anthropic' || v === 'openrouter';
}

export function isValidUsageKey(v: string): v is LlmUsageKey {
  return (LLM_USAGE_KEYS as readonly string[]).includes(v);
}

const MAX_MODEL_LEN = 256;

export function sanitizeModelId(raw: string): string {
  return raw.trim().slice(0, MAX_MODEL_LEN);
}
