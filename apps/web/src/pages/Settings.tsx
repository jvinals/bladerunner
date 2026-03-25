import { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon, Globe, Bot, Bell, Server,
  ExternalLink, Check, ChevronRight, Sparkles,
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
  { key: 'explain_ai_prompt_failure', label: 'Explain AI prompt test failure' },
  { key: 'suggest_skip_after_change', label: 'Suggest steps to skip after edit' },
];

type LlmCap = {
  hasGeminiKey: boolean;
  hasOpenAiKey: boolean;
  hasAnthropicKey: boolean;
  hasOpenRouterKey: boolean;
};

function providerHasKey(caps: LlmCap, provider: string): boolean {
  switch (provider) {
    case 'gemini':
      return caps.hasGeminiKey;
    case 'openai':
      return caps.hasOpenAiKey;
    case 'anthropic':
      return caps.hasAnthropicKey;
    case 'openrouter':
      return caps.hasOpenRouterKey;
    default:
      return false;
  }
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<string>('workspace');

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 lg:px-10 py-8 max-w-6xl">
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
  const [catalog, setCatalog] = useState<
    Record<string, { label: string; suggestedModels: string[]; models: string[] }>
  >({});

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
            providerCatalog: Record<
              string,
              { label: string; suggestedModels: string[]; models: string[] }
            >;
          };
        };
        if (d.llm?.usage) setUsage({ ...d.llm.usage });
        if (d.llm?.capabilities) setCaps(d.llm.capabilities);
        if (d.llm?.providerCatalog) setCatalog(d.llm.providerCatalog);
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

  const updateRow = (key: string, field: 'provider' | 'model', value: string) => {
    setUsage((prev) => {
      if (field === 'provider') {
        const p = value;
        const first =
          catalog[p]?.suggestedModels?.[0] ?? catalog[p]?.models?.[0] ?? '';
        return {
          ...prev,
          [key]: { provider: p, model: first },
        };
      }
      return {
        ...prev,
        [key]: {
          provider: prev[key]?.provider ?? 'gemini',
          model: value,
        },
      };
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await settingsApi.update({ llm: { usage } });
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

  const providerOptions = ['gemini', 'openai', 'anthropic', 'openrouter'] as const;

  return (
    <div className="space-y-6">
      <div className="bg-white border border-gray-100 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-gray-800 mb-1">Models by task</h3>
        <p className="text-xs text-gray-500 mb-4">
          Choose provider and model for each automation step. API keys are configured only in server{' '}
          <code className="text-[11px] bg-gray-50 px-1 rounded">.env</code> — not stored here.
        </p>
        {error && (
          <div className="mb-4 text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">{error}</div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500">
                <th className="py-2 pr-3 font-medium">Task</th>
                <th className="py-2 pr-3 font-medium">Provider</th>
                <th className="py-2 pr-3 font-medium">Model id</th>
                <th className="py-2 font-medium">Key</th>
              </tr>
            </thead>
            <tbody>
              {LLM_USAGE_ROWS.map((row) => {
                const u = usage[row.key];
                const prov = u?.provider ?? 'gemini';
                const listed = catalog[prov]?.models ?? catalog[prov]?.suggestedModels ?? [];
                const cur = u?.model?.trim() ?? '';
                const modelOptions = cur && !listed.includes(cur) ? [cur, ...listed] : listed;
                return (
                  <tr key={row.key} className="border-b border-gray-50 align-top">
                    <td className="py-3 pr-3 text-gray-700 max-w-[220px]">{row.label}</td>
                    <td className="py-3 pr-3">
                      <select
                        value={prov}
                        onChange={(e) => updateRow(row.key, 'provider', e.target.value)}
                        className="w-full min-w-[120px] border border-gray-200 rounded-md px-2 py-1.5 text-gray-800 bg-white"
                      >
                        {providerOptions.map((p) => (
                          <option key={p} value={p}>
                            {catalog[p]?.label ?? p}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-3 pr-3">
                      <select
                        value={
                          modelOptions.length === 0
                            ? ''
                            : modelOptions.includes(cur)
                              ? cur
                              : (modelOptions[0] ?? '')
                        }
                        onChange={(e) => updateRow(row.key, 'model', e.target.value)}
                        className="w-full min-w-[200px] max-w-[min(100%,28rem)] border border-gray-200 rounded-md px-2 py-1.5 text-gray-800 font-mono text-[11px] bg-white"
                        title={cur || 'Model id'}
                      >
                        {modelOptions.length === 0 ? (
                          <option value="">Loading models…</option>
                        ) : (
                          modelOptions.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))
                        )}
                      </select>
                    </td>
                    <td className="py-3">
                      {caps && (
                        <span
                          className={
                            providerHasKey(caps, prov)
                              ? 'text-[#56A34A] font-medium'
                              : 'text-amber-600 font-medium'
                          }
                        >
                          {providerHasKey(caps, prov) ? 'OK' : 'Missing key'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#4B90FF] text-white text-sm font-medium rounded-md hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            <Check size={14} /> {saving ? 'Saving…' : 'Save LLM settings'}
          </button>
        </div>
      </div>
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
            <select className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-600 appearance-none focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF] bg-white">
              <option value="30">30 days</option>
              <option value="90" selected>90 days</option>
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
  const agents = [
    { name: 'Browser Agent — Chrome', type: 'browser', status: 'online', version: '1.2.0', capabilities: ['screenshot', 'interaction', 'visual_diff'] },
    { name: 'Mobile Agent — iOS Simulator', type: 'mobile', status: 'online', version: '1.1.0', capabilities: ['screenshot', 'gesture_replay', 'accessibility'] },
    { name: 'Desktop Agent — macOS', type: 'desktop', status: 'busy', version: '1.0.5', capabilities: ['screenshot', 'interaction', 'process_monitor'] },
  ];

  return (
    <div className="space-y-4">
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
