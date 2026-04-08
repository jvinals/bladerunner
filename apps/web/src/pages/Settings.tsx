import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Settings as SettingsIcon, Globe, Bot, Bell, Server,
  ExternalLink, Check, ChevronRight, Sparkles, PlugZap, RefreshCcw, ShieldCheck, KeyRound, BrainCircuit, Eye, Database, CircleCheckBig,
} from 'lucide-react';
import { settingsApi } from '../lib/api';

const TABS = [
  { id: 'workspace', label: 'Workspace', icon: SettingsIcon },
  { id: 'ai', label: 'AI / LLM', icon: Sparkles },
  { id: 'integrations', label: 'Integrations', icon: Globe },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'environments', label: 'Environments', icon: Server },
] as const;

const LLM_USAGE_ROWS: { key: string; label: string }[] = [
  { key: 'playwright_codegen', label: 'Generate Playwright from vision (AI prompt / instruct)' },
  { key: 'playwright_verify', label: 'DOM verify pass (after draft codegen)' },
  { key: 'action_to_instruction', label: 'Recording — action to instruction' },
  { key: 'optimized_prompt', label: 'Optimized Prompt' },
  { key: 'ai_visual_id', label: 'AI Visual ID' },
  { key: 'explain_ai_prompt_failure', label: 'Explain AI prompt test failure' },
  { key: 'suggest_skip_after_change', label: 'Suggest steps to skip after edit' },
  { key: 'evaluation_planner', label: 'Evaluation — plan exploration (high-level)' },
  { key: 'evaluation_codegen', label: 'Evaluation — propose Playwright step from screenshot' },
  { key: 'evaluation_analyzer', label: 'Evaluation — analyze result and decide next action' },
  { key: 'evaluation_human_question', label: 'Evaluation — phrase human verification question' },
  { key: 'evaluation_report', label: 'Evaluation — final app report' },
  { key: 'project_discovery', label: 'Project — app discovery (initial map + summary)' },
];

type LlmProviderCapability = {
  configured: boolean;
  source: 'env' | 'db' | 'mixed' | 'none';
  hasApiKey: boolean;
  hasBaseUrl: boolean;
  envApiKey?: string;
  envBaseUrl?: string;
  docsUrl?: string;
};

type LlmCap = {
  encryptionConfigured: boolean;
  providers: Record<string, LlmProviderCapability>;
};

type LlmProviderDefinition = {
  id: string;
  label: string;
  category: 'first_party' | 'aggregator' | 'local' | 'cloud';
  protocol: 'gemini_native' | 'anthropic_native' | 'openai_compatible';
  defaultBaseUrl?: string;
  envApiKey?: string;
  envBaseUrl?: string;
  supportsVisionDefault: boolean;
  docsUrl?: string;
};

type LlmProviderCredentialView = {
  apiKeyMasked?: string;
  baseUrl?: string;
};

type LlmModelDetail = {
  providerId: string;
  modelId: string;
  title: string;
  description: string;
  thinkingType: string;
  capabilities: string[];
  supportsVision: boolean;
  contextWindow?: number;
  pricingSummary?: string;
  accuracySummary: string;
  metadataSource: 'openrouter' | 'provider_api' | 'static' | 'fallback';
};

type ProviderModelRow = {
  id: string;
  launchDate: string | null;
};

type ProviderDraft = {
  apiKey: string;
  baseUrl: string;
  clearApiKey: boolean;
};

function providerState(caps: LlmCap | null, provider: string): LlmProviderCapability | null {
  return caps?.providers?.[provider] ?? null;
}

function providerListStatus(
  capability: LlmProviderCapability | null,
  test: { loading?: boolean; ok?: boolean; message?: string } | undefined,
): {
  dotClass: string;
  label: string;
  toneClass: string;
} {
  if (test?.loading) {
    return {
      dotClass: 'bg-amber-400',
      label: 'testing',
      toneClass: 'text-amber-600',
    };
  }
  if (test?.ok === false) {
    return {
      dotClass: 'bg-red-500',
      label: 'test failed',
      toneClass: 'text-red-600',
    };
  }
  if (test?.ok === true) {
    return {
      dotClass: 'bg-[#56A34A]',
      label: 'connected',
      toneClass: 'text-[#2f7a3c]',
    };
  }
  if (capability?.configured) {
    return {
      dotClass: 'bg-[#56A34A]',
      label: capability.source,
      toneClass: 'text-gray-400',
    };
  }
  return {
    dotClass: 'bg-gray-300',
    label: 'not configured',
    toneClass: 'text-gray-400',
  };
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<string>('workspace');

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 lg:px-10 py-8 max-w-[1580px]">
      {/* Header */}
      <div className="mb-8">
        <p className="ce-section-label mb-2">Settings</p>
        <h1 className="text-2xl font-bold text-gray-900">Workspace Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your workspace configuration, integrations, and agents</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Settings nav */}
        <nav className="lg:w-48 shrink-0">
          <ul className="space-y-0.5">
            {TABS.map((tab) => (
              <li key={tab.id}>
                <button
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2.5 w-full text-left text-sm px-3 py-2 rounded-md transition-colors ${
                    activeTab === tab.id
                      ? 'bg-blue-50 text-[#4B90FF] font-medium'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                  }`}
                >
                  <tab.icon size={14} className={activeTab === tab.id ? 'text-[#4B90FF]' : 'text-gray-400'} />
                  {tab.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {activeTab === 'workspace' && <WorkspaceSettings />}
          {activeTab === 'ai' && <AiLlmSettings />}
          {activeTab === 'integrations' && <IntegrationsSettings />}
          {activeTab === 'agents' && <AgentsSettings />}
          {activeTab === 'notifications' && <NotificationsSettings />}
          {activeTab === 'environments' && <EnvironmentsSettings />}
        </div>
      </div>
    </div>
  );
}

function AiLlmSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Record<string, { provider: string; model: string }>>({});
  const [caps, setCaps] = useState<LlmCap | null>(null);
  const [providerDefs, setProviderDefs] = useState<LlmProviderDefinition[]>([]);
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({});
  const [testState, setTestState] = useState<Record<string, { loading?: boolean; ok?: boolean; message?: string }>>({});
  const [selectedReview, setSelectedReview] = useState<{ providerId: string; modelId: string } | null>(null);
  const [modelDetail, setModelDetail] = useState<LlmModelDetail | null>(null);
  const [modelDetailLoading, setModelDetailLoading] = useState(false);
  const [providerModelRows, setProviderModelRows] = useState<Record<string, ProviderModelRow[]>>({});
  const [catalog, setCatalog] = useState<
    Record<string, { label: string; suggestedModels: string[]; models: string[] }>
  >({});
  const providerOptions = providerDefs.map((p) => p.id);
  const selectedProviderId = selectedReview?.providerId ?? providerOptions[0] ?? '';
  const selectedProvider = providerDefs.find((p) => p.id === selectedProviderId) ?? providerDefs[0] ?? null;
  const selectedProviderState = selectedProvider ? providerState(caps, selectedProvider.id) : null;
  const selectedProviderDraft =
    selectedProvider && providerDrafts[selectedProvider.id]
      ? providerDrafts[selectedProvider.id]
      : { apiKey: '', baseUrl: selectedProvider?.defaultBaseUrl ?? '', clearApiKey: false };
  const selectedProviderStatus = selectedProvider ? testState[selectedProvider.id] : undefined;
  const selectedProviderModels = selectedProvider
    ? providerModelRows[selectedProvider.id] ??
      (catalog[selectedProvider.id]?.models ?? catalog[selectedProvider.id]?.suggestedModels ?? []).map((id) => ({
        id,
        launchDate: null,
      }))
    : [];
  const selectedProviderModelId =
    selectedProvider && selectedReview?.providerId === selectedProvider.id
      ? selectedReview.modelId
      : selectedProviderModels[0]?.id ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    settingsApi
      .get()
      .then((data) => {
        if (cancelled) return;
        const d = data as {
          llm?: {
            usage: Record<string, { provider: string; model: string }>;
            capabilities: LlmCap;
            providerDefinitions: LlmProviderDefinition[];
            providerCredentials: Record<string, LlmProviderCredentialView>;
            providerCatalog: Record<
              string,
              { label: string; suggestedModels: string[]; models: string[] }
            >;
          };
        };
        if (d.llm?.usage) setUsage({ ...d.llm.usage });
        if (d.llm?.capabilities) setCaps(d.llm.capabilities);
        if (d.llm?.providerDefinitions) setProviderDefs(d.llm.providerDefinitions);
        if (d.llm?.providerCatalog) setCatalog(d.llm.providerCatalog);
        if (d.llm?.providerCatalog) {
          setProviderModelRows(
            Object.fromEntries(
              Object.entries(d.llm.providerCatalog).map(([providerId, provider]) => [
                providerId,
                (provider.models ?? []).map((id) => ({ id, launchDate: null })),
              ]),
            ),
          );
        }
        if (d.llm?.providerCredentials) {
          setProviderDrafts(
            Object.fromEntries(
              Object.entries(d.llm.providerCredentials).map(([providerId, cred]) => [
                providerId,
                {
                  apiKey: '',
                  baseUrl: cred.baseUrl ?? '',
                  clearApiKey: false,
                },
              ]),
            ),
          );
        }
        const firstUsage = d.llm?.usage ? Object.values(d.llm.usage)[0] : undefined;
        if (firstUsage?.provider && firstUsage?.model) {
          setSelectedReview({ providerId: firstUsage.provider, modelId: firstUsage.model });
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load settings');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedReview?.providerId || !selectedReview?.modelId) {
      setModelDetail(null);
      return;
    }
    let cancelled = false;
    setModelDetailLoading(true);
    settingsApi
      .getModelDetail(selectedReview.providerId, selectedReview.modelId)
      .then((detail) => {
        if (!cancelled) setModelDetail(detail as LlmModelDetail);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setModelDetail(null);
          setError(e instanceof Error ? e.message : 'Failed to load model detail');
        }
      })
      .finally(() => {
        if (!cancelled) setModelDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedReview]);

  useEffect(() => {
    if (!selectedProvider || providerModelRows[selectedProvider.id]?.length) return;
    void refreshProviderModels(selectedProvider.id);
  }, [selectedProvider?.id]);

  const updateRow = (key: string, field: 'provider' | 'model', value: string) => {
    setUsage((prev) => {
      if (field === 'provider') {
        const p = value;
        const first =
          catalog[p]?.suggestedModels?.[0] ?? catalog[p]?.models?.[0] ?? '';
        setSelectedReview(first ? { providerId: p, modelId: first } : null);
        return {
          ...prev,
          [key]: { provider: p, model: first },
        };
      }
      setSelectedReview({ providerId: prev[key]?.provider ?? 'gemini', modelId: value });
      return {
        ...prev,
        [key]: {
          provider: prev[key]?.provider ?? 'gemini',
          model: value,
        },
      };
    });
  };

  const updateProviderDraft = (providerId: string, patch: Partial<ProviderDraft>) => {
    setProviderDrafts((prev) => ({
      ...prev,
      [providerId]: {
        apiKey: prev[providerId]?.apiKey ?? '',
        baseUrl: prev[providerId]?.baseUrl ?? '',
        clearApiKey: prev[providerId]?.clearApiKey ?? false,
        ...patch,
      },
    }));
  };

  const selectProvider = (providerId: string) => {
    const first =
      usage.playwright_codegen?.provider === providerId
        ? usage.playwright_codegen?.model
        : catalog[providerId]?.suggestedModels?.[0] ?? catalog[providerId]?.models?.[0] ?? '';
    setSelectedReview(first ? { providerId, modelId: first } : { providerId, modelId: '' });
  };

  const refreshProviderModels = async (providerId: string) => {
    setTestState((prev) => ({ ...prev, [providerId]: { loading: true, message: 'Refreshing models…' } }));
    try {
      const out = await settingsApi.getProviderModels(providerId);
      setProviderModelRows((prev) => ({ ...prev, [providerId]: out.models }));
      setCatalog((prev) => ({
        ...prev,
        [providerId]: {
          label: prev[providerId]?.label ?? providerDefs.find((p) => p.id === providerId)?.label ?? providerId,
          suggestedModels: prev[providerId]?.suggestedModels ?? [],
          models: out.models.map((model) => model.id),
        },
      }));
      setTestState((prev) => ({ ...prev, [providerId]: { ok: true, message: `${out.models.length} models loaded` } }));
    } catch (e: unknown) {
      setTestState((prev) => ({
        ...prev,
        [providerId]: { ok: false, message: e instanceof Error ? e.message : 'Failed to load models' },
      }));
    }
  };

  const testConnection = async (providerId: string) => {
    setTestState((prev) => ({ ...prev, [providerId]: { loading: true, message: 'Testing connection…' } }));
    try {
      const draft = providerDrafts[providerId];
      const out = await settingsApi.testProviderConnection(providerId, {
        model: selectedReview?.providerId === providerId ? selectedReview.modelId : undefined,
        apiKey: draft?.apiKey ?? '',
        baseUrl: draft?.baseUrl ?? '',
      });
      setTestState((prev) => ({
        ...prev,
        [providerId]: {
          ok: out.ok,
          message: out.ok ? `Connected in ${out.latencyMs}ms via ${out.source}` : out.error ?? 'Connection failed',
        },
      }));
    } catch (e: unknown) {
      setTestState((prev) => ({
        ...prev,
        [providerId]: { ok: false, message: e instanceof Error ? e.message : 'Connection failed' },
      }));
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const providerCredentials = Object.fromEntries(
        Object.entries(providerDrafts).map(([providerId, draft]) => [
          providerId,
          {
            ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : draft.clearApiKey ? { apiKey: null } : {}),
            baseUrl: draft.baseUrl.trim(),
          },
        ]),
      );
      await settingsApi.update({ llm: { usage, providerCredentials } });
      const fresh = (await settingsApi.get()) as {
        llm?: {
          capabilities: LlmCap;
          providerCredentials: Record<string, LlmProviderCredentialView>;
          providerCatalog: Record<string, { label: string; suggestedModels: string[]; models: string[] }>;
        };
      };
      if (fresh.llm?.capabilities) setCaps(fresh.llm.capabilities);
      if (fresh.llm?.providerCatalog) setCatalog(fresh.llm.providerCatalog);
      if (fresh.llm?.providerCatalog) {
        setProviderModelRows(
          Object.fromEntries(
            Object.entries(fresh.llm.providerCatalog).map(([providerId, provider]) => [
              providerId,
              (provider.models ?? []).map((id) => ({ id, launchDate: null })),
            ]),
          ),
        );
      }
      if (fresh.llm?.providerCredentials) {
        setProviderDrafts((prev) =>
          Object.fromEntries(
            Object.entries(fresh.llm?.providerCredentials ?? {}).map(([providerId, cred]) => [
              providerId,
              {
                apiKey: '',
                baseUrl: prev[providerId]?.baseUrl ?? cred.baseUrl ?? '',
                clearApiKey: false,
              },
            ]),
          ),
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-gray-100 rounded-lg p-6 text-sm text-gray-500">Loading AI settings…</div>
    );
  }

  if (providerDefs.length === 0) {
    return (
      <div className="space-y-3">
        {error && (
          <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{error}</div>
        )}
        <div className="bg-amber-50 border border-amber-100 rounded-lg p-6 text-sm text-gray-800">
          <p className="font-medium text-gray-900">AI settings could not be loaded</p>
          <p className="mt-2 text-gray-600">
            The API returned no provider definitions (empty catalog). Usually the API is still starting, the request
            failed, or you are not authenticated. Ensure the API is listening on port 3001, refresh after it finishes
            booting, and stay signed in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-3">{error}</div>
      )}
      <div data-ai-llm-grid className="grid grid-cols-1 min-[1850px]:grid-cols-[minmax(0,1.4fr)_23rem] gap-6 items-start">
        <div data-ai-llm-providers-pane className="space-y-6 min-w-0">
          <div className="bg-white border border-gray-100 rounded-2xl p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Models by task</h3>
              </div>
              <div className="rounded-full border border-gray-200 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-gray-500">
                {providerOptions.length} providers
              </div>
            </div>
            <div data-ai-llm-usage-table className="mt-3 overflow-hidden rounded-xl border border-gray-100">
              <div className="grid grid-cols-[minmax(0,1.35fr)_9rem_minmax(0,1fr)_8rem] items-center gap-2 border-b border-gray-100 bg-[#fafcff] px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                <span>Task</span>
                <span>Provider</span>
                <span>Model</span>
                <span>Connection</span>
              </div>
              {LLM_USAGE_ROWS.map((row) => {
                const u = usage[row.key];
                const prov = u?.provider ?? providerOptions[0] ?? 'gemini';
                const listed = catalog[prov]?.models ?? catalog[prov]?.suggestedModels ?? [];
                const cur = u?.model?.trim() ?? '';
                const modelOptions = cur && !listed.includes(cur) ? [cur, ...listed] : listed;
                const state = providerState(caps, prov);
                return (
                  <div
                    key={row.key}
                    className="grid grid-cols-[minmax(0,1.35fr)_9rem_minmax(0,1fr)_8rem] items-center gap-2 border-b border-gray-100 bg-white px-3 py-1.5 last:border-b-0"
                  >
                    <p className="truncate text-[12px] text-gray-800" title={row.label}>
                      {row.label}
                    </p>
                    <label className="block min-w-0">
                      <select
                        value={prov}
                        onChange={(e) => updateRow(row.key, 'provider', e.target.value)}
                        className="w-full min-w-0 rounded-md border border-gray-200 px-1.5 py-1 text-[11px] text-gray-800 bg-white"
                      >
                        {providerOptions.map((p) => (
                          <option key={p} value={p}>
                            {catalog[p]?.label ?? providerDefs.find((d) => d.id === p)?.label ?? p}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block min-w-0">
                      <select
                        value={modelOptions.includes(cur) ? cur : modelOptions[0] ?? ''}
                        onChange={(e) => updateRow(row.key, 'model', e.target.value)}
                        className="w-full min-w-0 rounded-md border border-gray-200 px-1.5 py-1 text-[11px] text-gray-800 font-mono bg-white"
                        title={cur || 'Model id'}
                      >
                        {modelOptions.length === 0 ? (
                          <option value="">No models yet</option>
                        ) : (
                          modelOptions.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))
                        )}
                      </select>
                    </label>
                    <p
                      className={`truncate text-[11px] ${
                        state?.configured ? 'text-[#2f7a3c] font-medium' : 'text-amber-700 font-medium'
                      }`}
                      title={state?.configured ? `Ready (${state.source})` : 'Not configured'}
                    >
                      {state?.configured ? `Ready (${state.source})` : 'Not configured'}
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#4B90FF] text-white text-xs font-medium rounded-md hover:bg-blue-500 transition-colors disabled:opacity-50"
              >
                <Check size={14} /> {saving ? 'Saving…' : 'Save LLM settings'}
              </button>
            </div>
          </div>

          <div className="bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)] border border-[#dfeafb] rounded-2xl p-6 shadow-[0_24px_80px_-48px_rgba(75,144,255,0.45)]">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start">
              <div className="min-w-0">
                <p className="text-[11px] tracking-[0.18em] uppercase text-[#4B90FF] font-semibold">AI control plane</p>
                <h3 className="mt-2 text-lg font-semibold text-gray-900">Providers and credentials</h3>
                <p className="mt-2 text-sm text-gray-500 max-w-2xl">
                  Pick a provider from the list, then configure its secrets, test connectivity, and inspect the model
                  characteristics for the current selection.
                </p>
              </div>
              <div className="rounded-2xl border border-[#dbe7ff] bg-[#f6faff] px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.16em] text-[#4B90FF] font-semibold">Secrets at rest</p>
                <p className={`mt-1 text-sm font-medium ${caps?.encryptionConfigured ? 'text-[#2a6a37]' : 'text-amber-700'}`}>
                  {caps?.encryptionConfigured ? 'Encrypted in DB' : 'Encryption key missing'}
                </p>
                {!caps?.encryptionConfigured && (
                  <p className="mt-2 text-xs text-amber-800 leading-relaxed">
                    To <span className="font-medium">persist</span> keys in the database, the API needs{' '}
                    <span className="font-mono">LLM_CREDENTIALS_ENCRYPTION_KEY</span> (run{' '}
                    <span className="font-mono">openssl rand -base64 32</span> in the repo or apps/api{' '}
                    <span className="font-mono">.env</span>), then restart the API. The OpenRouter field above is your
                    provider key — separate from this server secret.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
              <div className="rounded-2xl border border-gray-100 bg-white/85 p-2">
                <div className="space-y-1">
                  {providerDefs.map((provider) => {
                    const state = providerState(caps, provider.id);
                    const test = testState[provider.id];
                    const listStatus = providerListStatus(state, test);
                    const active = provider.id === selectedProviderId;
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => selectProvider(provider.id)}
                        className={`w-full rounded-xl px-3 py-3 text-left transition-colors ${
                          active
                            ? 'bg-[#edf5ff] text-[#1f4f98] shadow-[inset_0_0_0_1px_rgba(75,144,255,0.15)]'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">{provider.label}</span>
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${listStatus.dotClass}`}
                          />
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.14em]">
                          <span className={active ? 'text-[#4B90FF]' : 'text-gray-400'}>{provider.category}</span>
                          <span className={active ? 'text-[#4B90FF]' : 'text-gray-300'}>•</span>
                          <span className={active ? 'text-[#4B90FF]' : listStatus.toneClass}>
                            {listStatus.label}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {selectedProvider && (
                <div
                  data-provider-card
                  data-provider-id={selectedProvider.id}
                  className="rounded-2xl border border-gray-100 bg-white/92 p-5 overflow-hidden"
                >
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] xl:items-start">
                    <div className="space-y-5 min-w-0">
                      <div className="space-y-4 min-w-0">
                        <div className="space-y-2 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-2 text-base font-semibold text-gray-900">
                              <PlugZap size={15} className="text-[#4B90FF] shrink-0" />
                              {selectedProvider.label}
                            </span>
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-gray-600">
                              {selectedProvider.category}
                            </span>
                            <span className="rounded-full bg-[#eef5ff] px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[#3a6fcb]">
                              {selectedProvider.protocol.replace('_', ' ')}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                            <span
                              className={
                                selectedProviderState?.configured
                                  ? 'text-[#2a6a37] font-medium'
                                  : 'text-amber-700 font-medium'
                              }
                            >
                              {selectedProviderState?.configured
                                ? `Configured via ${selectedProviderState.source}`
                                : 'Not configured'}
                            </span>
                            {selectedProvider.docsUrl && (
                              <a
                                href={selectedProvider.docsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[#4B90FF] hover:underline"
                              >
                                Docs <ExternalLink size={12} />
                              </a>
                            )}
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-500 leading-relaxed">
                          Test uses the API key and Base URL in the fields below (including text you have not saved
                          yet). Use <span className="font-medium text-gray-700">Save credentials</span> or{' '}
                          <span className="font-medium text-gray-700">Save LLM settings</span> at the top to persist
                          them.
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void save()}
                            disabled={saving}
                            className="inline-flex items-center gap-1.5 rounded-full border border-[#4B90FF] bg-[#4B90FF] px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50"
                          >
                            <Check size={12} />
                            {saving ? 'Saving…' : 'Save credentials'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void testConnection(selectedProvider.id)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            <ShieldCheck size={12} />
                            Test connection
                          </button>
                          <button
                            type="button"
                            onClick={() => void refreshProviderModels(selectedProvider.id)}
                            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          >
                            <RefreshCcw size={12} />
                            Refresh models
                          </button>
                        </div>
                      </div>

                      <div
                        data-provider-fields
                        data-provider-id={selectedProvider.id}
                        className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                      >
                        <label className="block">
                          <span className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-gray-500">
                            <KeyRound size={12} />
                            API key
                          </span>
                          <input
                            type="password"
                            value={selectedProviderDraft.apiKey}
                            onChange={(e) =>
                              updateProviderDraft(selectedProvider.id, {
                                apiKey: e.target.value,
                                clearApiKey: false,
                              })
                            }
                            placeholder={
                              selectedProvider.envApiKey
                                ? `Leave blank to keep existing (${selectedProvider.envApiKey})`
                                : 'Leave blank to keep existing'
                            }
                            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400"
                          />
                          <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 text-[11px] text-gray-500">
                            <span className="min-w-0">
                              {selectedProvider.envApiKey
                                ? `Env fallback: ${selectedProvider.envApiKey}`
                                : 'No env key fallback documented'}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateProviderDraft(selectedProvider.id, {
                                  apiKey: '',
                                  clearApiKey: !selectedProviderDraft.clearApiKey,
                                })
                              }
                              className={`font-medium ${
                                selectedProviderDraft.clearApiKey
                                  ? 'text-red-600'
                                  : 'text-gray-500 hover:text-gray-800'
                              }`}
                            >
                              {selectedProviderDraft.clearApiKey
                                ? 'Will clear saved key'
                                : 'Clear saved key'}
                            </button>
                          </div>
                        </label>

                        <label className="block">
                          <span className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-gray-500">
                            <Database size={12} />
                            Base URL
                          </span>
                          <input
                            type="text"
                            value={selectedProviderDraft.baseUrl}
                            onChange={(e) =>
                              updateProviderDraft(selectedProvider.id, { baseUrl: e.target.value })
                            }
                            placeholder={selectedProvider.defaultBaseUrl ?? 'Optional base URL'}
                            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400"
                          />
                          <p className="mt-1.5 text-[11px] text-gray-500">
                            {selectedProvider.envBaseUrl
                              ? `Env fallback: ${selectedProvider.envBaseUrl}`
                              : selectedProvider.defaultBaseUrl
                                ? `Default: ${selectedProvider.defaultBaseUrl}`
                                : 'Provider default URL'}
                          </p>
                        </label>
                      </div>

                      <div className="rounded-xl border border-gray-100 bg-[#f8fbff] px-4 py-4 text-xs">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-medium text-gray-800">Provider status</p>
                          {selectedProviderStatus?.ok === true && !selectedProviderStatus.loading && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#e9f8ee] px-2 py-1 text-[10px] font-medium text-[#2f7a3c]">
                              <CircleCheckBig size={12} />
                              Connected
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-gray-500">
                          {selectedProviderState?.configured
                            ? `Ready via ${selectedProviderState.source}`
                            : 'Waiting for credentials'}
                        </p>
                        {selectedProviderStatus?.message && (
                          <p
                            className={`mt-2 ${
                              selectedProviderStatus.ok
                                ? 'text-[#2a6a37]'
                                : selectedProviderStatus.loading
                                  ? 'text-gray-500'
                                  : 'text-red-600'
                            }`}
                          >
                            {selectedProviderStatus.message}
                          </p>
                        )}
                        <p className="mt-3 text-[11px] text-gray-500">
                          {selectedProviderModels.length} model
                          {selectedProviderModels.length === 1 ? '' : 's'} available in the current catalog.
                        </p>
                      </div>

                      <div className="rounded-xl border border-gray-100 bg-white px-4 py-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium">
                              Available models
                            </p>
                            <p className="mt-1 text-xs text-gray-500">
                              Choose one to refresh the characteristics panel on the right.
                            </p>
                          </div>
                          <span className="rounded-full bg-[#f5f8ff] px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-[#4B90FF]">
                            {selectedProviderModels.length}
                          </span>
                        </div>
                        <div data-provider-model-list className="mt-3 max-h-64 overflow-y-auto pr-1">
                          {selectedProviderModels.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500">
                              No models loaded yet for this provider.
                            </p>
                          ) : (
                            <>
                              <div className="grid grid-cols-[minmax(0,1fr)_6.5rem] gap-2 border-b border-gray-100 px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                                <span>Model ID</span>
                                <span>Launch</span>
                              </div>
                              <div className="divide-y divide-gray-100">
                                {selectedProviderModels.map((model) => {
                                  const active = model.id === selectedProviderModelId;
                                  return (
                                    <button
                                      key={model.id}
                                      data-provider-model-option
                                      type="button"
                                      onClick={() =>
                                        setSelectedReview({
                                          providerId: selectedProvider.id,
                                          modelId: model.id,
                                        })
                                      }
                                      className={`grid w-full grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-2 px-2 py-1.5 text-left transition-colors ${
                                        active ? 'bg-[#eef5ff]' : 'bg-white hover:bg-gray-50'
                                      }`}
                                    >
                                      <span
                                        className={`truncate text-[11px] font-mono ${
                                          active ? 'text-[#1f4f98]' : 'text-gray-700'
                                        }`}
                                        title={model.id}
                                      >
                                        {model.id}
                                      </span>
                                      <span
                                        data-provider-model-option-date
                                        className={`text-[11px] ${
                                          active ? 'text-[#1f4f98]' : 'text-gray-500'
                                        }`}
                                      >
                                        {model.launchDate ?? '—'}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      data-ai-llm-inspector
                      className="rounded-2xl border border-[#dbe6ff] bg-[radial-gradient(circle_at_top_left,#eef5ff,transparent_42%),linear-gradient(180deg,#ffffff_0%,#f9fbff_100%)] overflow-hidden"
                    >
                      <div className="border-b border-[#dbe6ff] px-5 py-4">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-[#4B90FF] font-semibold">
                          Characteristics
                        </p>
                        <h4 className="mt-2 text-base font-semibold text-gray-900">
                          {selectedProvider.label} review
                        </h4>
                        <p className="mt-1 text-sm text-gray-500">
                          Model behavior, capability, and fit for the provider selection you are reviewing.
                        </p>
                      </div>
                      <div className="px-5 py-4 space-y-4">
                        {modelDetailLoading ? (
                          <p className="text-sm text-gray-500">Loading model metadata…</p>
                        ) : modelDetail ? (
                          <>
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.15em] text-gray-500">
                                {catalog[modelDetail.providerId]?.label ?? modelDetail.providerId}
                              </p>
                              <h4 className="mt-1 text-xl font-semibold text-gray-900 break-all">
                                {modelDetail.title}
                              </h4>
                              <p className="mt-3 text-sm leading-6 text-gray-600">
                                {modelDetail.description}
                              </p>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                              <InspectorStat
                                icon={<BrainCircuit size={14} className="text-[#4B90FF]" />}
                                label="Thinking"
                                value={modelDetail.thinkingType}
                              />
                              <InspectorStat
                                icon={<Eye size={14} className="text-[#4B90FF]" />}
                                label="Vision"
                                value={modelDetail.supportsVision ? 'Supported' : 'Text only'}
                              />
                              <InspectorStat
                                icon={<Database size={14} className="text-[#4B90FF]" />}
                                label="Context"
                                value={
                                  modelDetail.contextWindow
                                    ? `${modelDetail.contextWindow.toLocaleString()} tokens`
                                    : 'Unknown'
                                }
                              />
                              <InspectorStat
                                icon={<ShieldCheck size={14} className="text-[#4B90FF]" />}
                                label="Metadata"
                                value={modelDetail.metadataSource}
                              />
                            </div>

                            <div className="rounded-2xl border border-gray-100 bg-white/80 p-4">
                              <p className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium">
                                Capabilities
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {modelDetail.capabilities.map((cap) => (
                                  <span
                                    key={cap}
                                    className="rounded-full border border-[#dfe7ff] bg-[#f5f8ff] px-2.5 py-1 text-[11px] text-[#4569ae]"
                                  >
                                    {cap}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {modelDetail.pricingSummary && (
                              <div className="rounded-2xl border border-gray-100 bg-white/80 p-4">
                                <p className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium">
                                  Pricing
                                </p>
                                <p className="mt-2 text-sm text-gray-700">
                                  {modelDetail.pricingSummary}
                                </p>
                              </div>
                            )}

                            <div className="rounded-2xl border border-[#e9eef7] bg-[#fbfcfe] p-4">
                              <p className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium">
                                Accuracy notes
                              </p>
                              <p className="mt-2 text-sm leading-6 text-gray-600">
                                {modelDetail.accuracySummary}
                              </p>
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">
                            Select a provider to inspect its current model characteristics.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InspectorStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white/80 p-3">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-gray-500">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-sm font-medium text-gray-900">{value}</p>
    </div>
  );
}

function WorkspaceSettings() {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-100 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-800 mb-4">General</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Workspace Name</label>
            <input type="text" defaultValue="Edgehealth" className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Workspace Slug</label>
            <input type="text" defaultValue="edgehealth" disabled className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-400 bg-gray-50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Default Platform</label>
            <select className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-600 appearance-none focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF] bg-white">
              <option value="desktop">Desktop</option>
              <option value="mobile">Mobile</option>
              <option value="pwa">PWA</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Data Retention</label>
            <select defaultValue="90" className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-600 appearance-none focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF] bg-white">
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365">1 year</option>
            </select>
          </div>
        </div>
        <div className="mt-6 flex justify-end">
          <button className="flex items-center gap-1.5 px-4 py-2 bg-[#4B90FF] text-white text-sm font-medium rounded-md hover:bg-blue-500 transition-colors">
            <Check size={14} /> Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function IntegrationsSettings() {
  const integrations = [
    { name: 'GitHub', type: 'github', status: 'active', description: 'Source control and CI/CD triggers', icon: '🐙' },
    { name: 'Slack', type: 'slack', status: 'active', description: 'Run notifications and alerts', icon: '💬' },
    { name: 'CI/CD Pipeline', type: 'ci_cd', status: 'active', description: 'GitHub Actions integration', icon: '⚡' },
    { name: 'Orchestrator', type: 'orchestrator', status: 'pending', description: 'Agent loop coordination (coming soon)', icon: '🤖' },
  ];

  return (
    <div className="space-y-4">
      {integrations.map((int) => (
        <div key={int.type} className="bg-white border border-gray-100 rounded-lg p-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-xl">{int.icon}</span>
            <div>
              <p className="text-sm font-semibold text-gray-800">{int.name}</p>
              <p className="text-xs text-gray-400 mt-0.5">{int.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium ${
              int.status === 'active' ? 'bg-[#56A34A]/10 text-[#56A34A]' :
              int.status === 'pending' ? 'bg-[#EAB508]/10 text-[#EAB508]' :
              'bg-gray-100 text-gray-500'
            }`}>
              {int.status === 'active' ? 'Connected' : int.status === 'pending' ? 'Pending Setup' : 'Inactive'}
            </span>
            <button className="text-gray-400 hover:text-[#4B90FF] transition-colors">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentsSettings() {
  const queryClient = useQueryClient();
  const { data: agentCtx } = useQuery({
    queryKey: ['settingsAgentContext'],
    queryFn: () => settingsApi.getAgentContext(),
  });
  const [generalDraft, setGeneralDraft] = useState('');
  useEffect(() => {
    if (agentCtx?.generalInstructions != null) setGeneralDraft(agentCtx.generalInstructions);
  }, [agentCtx?.generalInstructions]);

  const saveGeneral = useMutation({
    mutationFn: () => settingsApi.patchAgentContext({ generalInstructions: generalDraft }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settingsAgentContext'] });
    },
  });

  const agents = [
    { name: 'Browser Agent — Chrome', type: 'browser', status: 'online', version: '1.2.0', capabilities: ['screenshot', 'interaction', 'visual_diff'] },
    { name: 'Mobile Agent — iOS Simulator', type: 'mobile', status: 'online', version: '1.1.0', capabilities: ['screenshot', 'gesture_replay', 'accessibility'] },
    { name: 'Desktop Agent — macOS', type: 'desktop', status: 'busy', version: '1.0.5', capabilities: ['screenshot', 'interaction', 'process_monitor'] },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-100 rounded-lg p-5">
        <p className="text-sm font-semibold text-gray-800 mb-1">General agent instructions</p>
        <p className="text-xs text-gray-500 mb-3">
          Applied to AI codegen and evaluations when no project-specific notes override them. Do not store secrets.
        </p>
        <textarea
          value={generalDraft}
          onChange={(e) => setGeneralDraft(e.target.value)}
          rows={6}
          className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-800 placeholder:text-gray-400"
          placeholder="e.g. Prefer neutral QA wording; our app uses a left nav and modal dialogs for confirmations…"
        />
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => saveGeneral.mutate()}
            disabled={saveGeneral.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#4B90FF] text-white text-sm font-medium rounded-md hover:bg-blue-500 disabled:opacity-40"
          >
            <Check size={14} /> Save instructions
          </button>
        </div>
      </div>

      {agents.map((agent) => (
        <div key={agent.name} className="bg-white border border-gray-100 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Bot size={16} className="text-[#4B90FF]" />
              <div>
                <p className="text-sm font-semibold text-gray-800">{agent.name}</p>
                <p className="text-[11px] text-gray-400 ce-mono">v{agent.version} · {agent.type}</p>
              </div>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-[10px] font-medium ${
              agent.status === 'online' ? 'bg-[#56A34A]/10 text-[#56A34A]' :
              agent.status === 'busy' ? 'bg-[#4B90FF]/10 text-[#4B90FF]' :
              'bg-gray-100 text-gray-500'
            }`}>
              {agent.status.charAt(0).toUpperCase() + agent.status.slice(1)}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {agent.capabilities.map((cap) => (
              <span key={cap} className="px-2 py-0.5 text-[10px] text-gray-500 bg-gray-50 rounded border border-gray-100">
                {cap.replace('_', ' ')}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NotificationsSettings() {
  return (
    <div className="bg-white border border-gray-100 rounded-lg p-6">
      <h3 className="text-sm font-semibold text-gray-800 mb-4">Notification Preferences</h3>
      <div className="space-y-4">
        {[
          { label: 'Run completed', description: 'Notify when any run finishes execution', enabled: true },
          { label: 'Run failed', description: 'Notify when a run fails or has critical findings', enabled: true },
          { label: 'Agent offline', description: 'Notify when an agent loses connection', enabled: true },
          { label: 'Style drift detected', description: 'Notify when style consistency checks fail', enabled: false },
          { label: 'Daily summary', description: 'Receive a daily digest of all run activity', enabled: false },
        ].map((pref) => (
          <div key={pref.label} className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm text-gray-700 font-medium">{pref.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{pref.description}</p>
            </div>
            <div
              className="relative w-9 h-5 rounded-full transition-colors cursor-pointer"
              style={{ background: pref.enabled ? '#4B90FF' : '#D4D4D4' }}
            >
              <div
                className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform"
                style={{ transform: pref.enabled ? 'translateX(16px)' : 'translateX(0)' }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 pt-4 border-t border-gray-100">
        <div>
          <label className="block text-xs font-medium text-[#4B90FF] mb-1.5">Slack Webhook URL</label>
          <input
            type="url"
            placeholder="https://hooks.slack.com/services/..."
            className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]"
          />
        </div>
      </div>
    </div>
  );
}

function EnvironmentsSettings() {
  const envs = [
    { name: 'Development', type: 'development', url: 'http://localhost:3000', isDefault: true },
    { name: 'Staging', type: 'staging', url: 'https://staging.edgehealth.ai', isDefault: false },
    { name: 'Production', type: 'production', url: 'https://app.edgehealth.ai', isDefault: false },
    { name: 'Preview', type: 'preview', url: 'https://preview-pr-42.edgehealth.ai', isDefault: false },
  ];

  return (
    <div className="space-y-4">
      {envs.map((env) => (
        <div key={env.name} className="bg-white border border-gray-100 rounded-lg p-5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Server size={14} className="text-gray-400" />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-gray-800">{env.name}</p>
                {env.isDefault && (
                  <span className="px-1.5 py-0 text-[9px] text-[#4B90FF] bg-blue-50 rounded font-semibold">Default</span>
                )}
              </div>
              <p className="text-xs text-gray-400 ce-mono mt-0.5">{env.url}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href={env.url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-[#4B90FF] transition-colors">
              <ExternalLink size={13} />
            </a>
            <button className="text-gray-400 hover:text-[#4B90FF] transition-colors">
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
