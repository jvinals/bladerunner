import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  projectsApi,
  type ProjectDto,
  type CreateProjectBody,
  type TestEmailProvider,
  TEST_EMAIL_PROVIDERS,
} from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { FolderKanban, Plus, Trash2, Pencil, Eye, EyeOff } from 'lucide-react';

const KINDS: CreateProjectBody['kind'][] = ['WEB', 'IOS', 'ANDROID'];

const PROJECT_COLORS = [
  '#4B90FF', '#56A34A', '#EAB508', '#E05252',
  '#9333EA', '#F97316', '#06B6D4', '#EC4899',
  '#8B5CF6', '#14B8A6', '#84CC16', '#6366F1',
];

interface ProjectForm {
  name: string;
  kind: 'WEB' | 'IOS' | 'ANDROID';
  url: string;
  artifactUrl: string;
  color: string;
  testUserEmail: string;
  testUserPassword: string;
  testEmailProvider: TestEmailProvider | '';
}

const emptyForm: ProjectForm = {
  name: '',
  kind: 'WEB',
  url: '',
  artifactUrl: '',
  color: PROJECT_COLORS[0],
  testUserEmail: '',
  testUserPassword: '',
  testEmailProvider: '',
};

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectForm>({ ...emptyForm });
  const [showPassword, setShowPassword] = useState(false);
  const [manualDraft, setManualDraft] = useState('');

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  });

  const { data: agentKnowledge } = useQuery({
    queryKey: ['projectAgentKnowledge', editingId],
    queryFn: () => projectsApi.getAgentKnowledge(editingId!),
    enabled: !!editingId,
    refetchInterval: (q) => {
      const s = q.state.data?.discoveryStatus;
      return s === 'queued' || s === 'running' ? 3000 : false;
    },
  });

  useEffect(() => {
    if (agentKnowledge?.manualInstructions != null) {
      setManualDraft(agentKnowledge.manualInstructions);
    }
  }, [agentKnowledge?.manualInstructions, editingId]);

  const createMutation = useMutation({
    mutationFn: (body: CreateProjectBody) => projectsApi.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setForm({ ...emptyForm });
      setShowPassword(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CreateProjectBody> }) =>
      projectsApi.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setEditingId(null);
      setShowPassword(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const saveAgentNotes = useMutation({
    mutationFn: () => projectsApi.patchAgentKnowledge(editingId!, { manualInstructions: manualDraft }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectAgentKnowledge', editingId] });
    },
  });

  const discoveryMutation = useMutation({
    mutationFn: () => projectsApi.triggerDiscovery(editingId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectAgentKnowledge', editingId] });
    },
  });

  const startEdit = (p: ProjectDto) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      kind: p.kind,
      url: p.url ?? '',
      artifactUrl: p.artifactUrl ?? '',
      color: p.color,
      testUserEmail: p.testUserEmail ?? '',
      testUserPassword: p.testUserPassword ?? '',
      testEmailProvider: p.testEmailProvider ?? '',
    });
    setShowPassword(false);
    setManualDraft('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowPassword(false);
    setManualDraft('');
  };

  const submit = () => {
    if (!form.name.trim()) return;
    const body: CreateProjectBody = {
      name: form.name.trim(),
      kind: form.kind,
      url: form.url?.trim() || undefined,
      artifactUrl: form.artifactUrl?.trim() || undefined,
      color: form.color,
      testUserEmail: form.testUserEmail?.trim() || undefined,
      testUserPassword: form.testUserPassword || undefined,
      testEmailProvider: form.testEmailProvider || null,
    };
    if (editingId) {
      updateMutation.mutate({ id: editingId, body });
    } else {
      createMutation.mutate(body);
    }
  };

  if (isLoading) return <LoadingState message="Loading projects..." />;
  if (error) return <ErrorState message="Failed to load projects" />;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 lg:px-10 py-8 max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <p className="ce-section-label mb-2">Workspace</p>
          <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
            <FolderKanban size={26} className="text-[#4B90FF]" />
            Projects
          </h1>
          <p className="text-sm text-gray-500">
            Web apps and mobile targets. Pick a project when starting a new recording on the Runs page.
          </p>
        </div>
      </div>

      {/* ── Form ─────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-lg p-5 mb-8 space-y-4">
        <p className="text-sm font-semibold text-gray-800">
          {editingId ? 'Edit project' : 'New project'}
        </p>

        {/* Color picker */}
        <div>
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Color</label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setForm((f) => ({ ...f, color: c }))}
                className="w-7 h-7 rounded-full border-2 transition-all hover:scale-110"
                style={{
                  backgroundColor: c,
                  borderColor: form.color === c ? '#1f2937' : 'transparent',
                  boxShadow: form.color === c ? `0 0 0 2px white, 0 0 0 4px ${c}` : 'none',
                }}
                title={c}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
              placeholder="My product"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Kind</label>
            <select
              value={form.kind}
              onChange={(e) =>
                setForm((f) => ({ ...f, kind: e.target.value as ProjectForm['kind'] }))
              }
              className="mt-1 w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              URL / store link
            </label>
            <input
              value={form.url ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
              placeholder="https://… or App Store URL"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              APK / IPA / artifact link
            </label>
            <input
              value={form.artifactUrl ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, artifactUrl: e.target.value }))}
              className="mt-1 w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
              placeholder="Optional download or CI artifact URL"
            />
          </div>
        </div>

        {/* ── Test user credentials ──────────────────────────── */}
        <div className="border-t border-gray-100 pt-4 mt-2">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Test user credentials
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Email</label>
              <input
                type="email"
                value={form.testUserEmail}
                onChange={(e) => setForm((f) => ({ ...f, testUserEmail: e.target.value }))}
                className="mt-1 w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
                placeholder="test@example.com"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Password</label>
              <div className="mt-1 relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={form.testUserPassword}
                  onChange={(e) => setForm((f) => ({ ...f, testUserPassword: e.target.value }))}
                  className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm pr-9"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Email provider</label>
              <select
                value={form.testEmailProvider}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    testEmailProvider: (e.target.value || '') as TestEmailProvider | '',
                  }))
                }
                className="mt-1 w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
              >
                <option value="">None</option>
                {TEST_EMAIL_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {editingId && (
          <div className="border border-gray-100 rounded-md p-4 space-y-3 bg-gray-50/50">
            <p className="text-xs font-semibold text-gray-700">Agent knowledge (this project)</p>
            <p className="text-[11px] text-gray-500">
              Merged into recording AI, evaluations, and optimized prompts when a run uses this project. Discovery adds an automated map after you run it.
            </p>
            <textarea
              value={manualDraft}
              onChange={(e) => setManualDraft(e.target.value)}
              rows={5}
              className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
              placeholder="Manual notes for agents (terminology, flaky areas, test data hints)…"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => saveAgentNotes.mutate()}
                disabled={saveAgentNotes.isPending}
                className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40"
              >
                Save agent notes
              </button>
              <span className="text-[11px] text-gray-500">
                Discovery:{' '}
                <span className="font-medium text-gray-700">
                  {agentKnowledge?.discoveryStatus ?? '—'}
                </span>
              </span>
              <button
                type="button"
                onClick={() => discoveryMutation.mutate()}
                disabled={
                  discoveryMutation.isPending ||
                  agentKnowledge?.discoveryStatus === 'running' ||
                  agentKnowledge?.discoveryStatus === 'queued' ||
                  form.kind !== 'WEB' ||
                  !form.url?.trim()
                }
                className="px-3 py-1.5 text-sm bg-[#4B90FF] text-white rounded-md hover:bg-blue-500 disabled:opacity-40"
              >
                Run app discovery
              </button>
            </div>
            {discoveryMutation.data && !discoveryMutation.data.accepted && discoveryMutation.data.reason && (
              <p className="text-xs text-amber-700">{discoveryMutation.data.reason}</p>
            )}
            {agentKnowledge?.discoveryError && (
              <p className="text-xs text-red-600">{agentKnowledge.discoveryError}</p>
            )}
            {agentKnowledge?.discoverySummaryMarkdown && (
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-600 font-medium">Last discovery summary</summary>
                <pre className="mt-2 p-3 bg-white border border-gray-100 rounded-md whitespace-pre-wrap text-gray-700 max-h-64 overflow-y-auto">
                  {agentKnowledge.discoverySummaryMarkdown}
                </pre>
              </details>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => submit()}
            disabled={!form.name.trim() || createMutation.isPending || updateMutation.isPending}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#4B90FF] text-white text-sm font-medium rounded-md hover:bg-blue-500 disabled:opacity-40"
          >
            <Plus size={14} />
            {editingId ? 'Save changes' : 'Create project'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* ── Table ─────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Kind</th>
              <th className="px-4 py-3">URL</th>
              <th className="px-4 py-3">Test user</th>
              <th className="px-4 py-3">Provider</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">
                  No projects yet. Create one above.
                </td>
              </tr>
            ) : (
              projects.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-800">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      {p.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{p.kind}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[180px] truncate" title={p.url ?? ''}>
                    {p.url || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-[180px] truncate" title={p.testUserEmail ?? ''}>
                    {p.testUserEmail || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {p.testEmailProvider
                      ? TEST_EMAIL_PROVIDERS.find((x) => x.value === p.testEmailProvider)?.label ?? p.testEmailProvider
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(p.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <button
                        type="button"
                        title="Edit"
                        onClick={() => startEdit(p)}
                        className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        title="Delete"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete project "${p.name}"?`)) deleteMutation.mutate(p.id);
                        }}
                        className="p-1.5 rounded-md text-red-600 hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
