/**
 * Broad provider catalog: routing + env var documentation.
 * Runtime chat uses native Gemini, Anthropic, or OpenAI-compatible (incl. OpenRouter, Ollama, Groq, …).
 */

export type LlmProviderProtocol = 'gemini_native' | 'anthropic_native' | 'openai_compatible';

export interface LlmProviderDefinition {
  id: string;
  label: string;
  /** Short group for Settings UI */
  category: 'first_party' | 'aggregator' | 'local' | 'cloud';
  protocol: LlmProviderProtocol;
  /** Default OpenAI-compatible chat base URL (no trailing slash). Ollama uses /v1 on this host. */
  defaultBaseUrl?: string;
  /** Env var for API key (optional for Ollama local). */
  envApiKey?: string;
  /** Env var for base URL override (Ollama, custom endpoints). */
  envBaseUrl?: string;
  /** OpenRouter-specific: send HTTP-Referer / X-Title */
  openRouterStyle?: boolean;
  /** Assume chat + vision via OpenAI-style multimodal when not Gemini. */
  supportsVisionDefault: boolean;
  /** Public docs */
  docsUrl?: string;
}

export const LLM_PROVIDER_REGISTRY: LlmProviderDefinition[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    category: 'first_party',
    protocol: 'gemini_native',
    envApiKey: 'GEMINI_API_KEY',
    supportsVisionDefault: true,
    docsUrl: 'https://ai.google.dev/',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    category: 'first_party',
    protocol: 'openai_compatible',
    envApiKey: 'OPENAI_API_KEY',
    defaultBaseUrl: 'https://api.openai.com/v1',
    supportsVisionDefault: true,
    docsUrl: 'https://platform.openai.com/docs',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    category: 'first_party',
    protocol: 'anthropic_native',
    envApiKey: 'ANTHROPIC_API_KEY',
    supportsVisionDefault: true,
    docsUrl: 'https://docs.anthropic.com/',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    category: 'aggregator',
    protocol: 'openai_compatible',
    envApiKey: 'OPENROUTER_API_KEY',
    envBaseUrl: 'OPENROUTER_BASE_URL',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    openRouterStyle: true,
    supportsVisionDefault: true,
    docsUrl: 'https://openrouter.ai/docs',
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    category: 'local',
    protocol: 'openai_compatible',
    envBaseUrl: 'OLLAMA_BASE_URL',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    supportsVisionDefault: true,
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
  },
  {
    id: 'groq',
    label: 'Groq',
    category: 'cloud',
    protocol: 'openai_compatible',
    envApiKey: 'GROQ_API_KEY',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    supportsVisionDefault: false,
    docsUrl: 'https://console.groq.com/docs',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    category: 'cloud',
    protocol: 'openai_compatible',
    envApiKey: 'CEREBRAS_API_KEY',
    envBaseUrl: 'CEREBRAS_BASE_URL',
    defaultBaseUrl: 'https://api.cerebras.ai/v1',
    supportsVisionDefault: false,
    docsUrl: 'https://inference-docs.cerebras.ai/',
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    category: 'cloud',
    protocol: 'openai_compatible',
    envApiKey: 'MINIMAX_API_KEY',
    envBaseUrl: 'MINIMAX_BASE_URL',
    defaultBaseUrl: 'https://api.minimax.io/v1',
    supportsVisionDefault: false,
    docsUrl: 'https://platform.minimax.io/docs/api-reference/text-openai-api',
  },
  {
    id: 'kimi',
    label: 'Kimi',
    category: 'cloud',
    protocol: 'openai_compatible',
    envApiKey: 'MOONSHOT_API_KEY',
    envBaseUrl: 'MOONSHOT_BASE_URL',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    supportsVisionDefault: false,
    docsUrl: 'https://platform.moonshot.cn/docs/api/chat',
  },
  {
    id: 'qwen',
    label: 'Qwen',
    category: 'cloud',
    protocol: 'openai_compatible',
    envApiKey: 'DASHSCOPE_API_KEY',
    envBaseUrl: 'DASHSCOPE_BASE_URL',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    supportsVisionDefault: true,
    docsUrl: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
  },
  {
    id: 'together',
    label: 'Together AI',
    category: 'cloud',
    protocol: 'openai_compatible',
    envApiKey: 'TOGETHER_API_KEY',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    supportsVisionDefault: true,
    docsUrl: 'https://docs.together.ai/',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    category: 'cloud',
    protocol: 'openai_compatible',
    envApiKey: 'FIREWORKS_API_KEY',
    defaultBaseUrl: 'https://api.fireworks.ai/inference/v1',
    supportsVisionDefault: true,
    docsUrl: 'https://docs.fireworks.ai/',
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    category: 'cloud',
    protocol: 'openai_compatible',
    envApiKey: 'MISTRAL_API_KEY',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    supportsVisionDefault: true,
    docsUrl: 'https://docs.mistral.ai/',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    category: 'cloud',
    protocol: 'openai_compatible',
    envApiKey: 'DEEPSEEK_API_KEY',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    supportsVisionDefault: false,
    docsUrl: 'https://api-docs.deepseek.com/',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    category: 'cloud',
    protocol: 'openai_compatible',
    envApiKey: 'PERPLEXITY_API_KEY',
    defaultBaseUrl: 'https://api.perplexity.ai',
    supportsVisionDefault: false,
    docsUrl: 'https://docs.perplexity.ai/',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    category: 'cloud',
    protocol: 'openai_compatible',
    envApiKey: 'XAI_API_KEY',
    defaultBaseUrl: 'https://api.x.ai/v1',
    supportsVisionDefault: true,
    docsUrl: 'https://docs.x.ai/',
  },
  {
    id: 'cohere',
    label: 'Cohere',
    category: 'cloud',
    protocol: 'openai_compatible',
    envApiKey: 'COHERE_API_KEY',
    defaultBaseUrl: 'https://api.cohere.ai/v1',
    supportsVisionDefault: false,
    docsUrl: 'https://docs.cohere.com/',
  },
  {
    id: 'azure_openai',
    label: 'Azure OpenAI',
    category: 'cloud',
    protocol: 'openai_compatible',
    envApiKey: 'AZURE_OPENAI_API_KEY',
    envBaseUrl: 'AZURE_OPENAI_ENDPOINT',
    supportsVisionDefault: true,
    docsUrl: 'https://learn.microsoft.com/azure/ai-services/openai/',
  },
];

const byId = new Map(LLM_PROVIDER_REGISTRY.map((p) => [p.id, p]));

export function getProviderDefinition(id: string): LlmProviderDefinition | undefined {
  return byId.get(id);
}

export function isRegisteredProviderId(id: string): boolean {
  return byId.has(id);
}

export function isGeminiNative(id: string): boolean {
  return getProviderDefinition(id)?.protocol === 'gemini_native';
}

export function isAnthropicNative(id: string): boolean {
  return getProviderDefinition(id)?.protocol === 'anthropic_native';
}

export function isOpenAiCompatible(id: string): boolean {
  return getProviderDefinition(id)?.protocol === 'openai_compatible';
}

export function supportsVisionByDefault(id: string): boolean {
  return getProviderDefinition(id)?.supportsVisionDefault ?? false;
}
