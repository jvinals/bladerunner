import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  projectsApi,
  type ProjectDto,
  type CreateProjectBody,
  type TestEmailProvider,
  type ProjectDiscoveryStatus,
  TEST_EMAIL_PROVIDERS,
} from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { formatDiscoveryLogSingleLine, useDiscoveryLive } from '@/hooks/useDiscoveryLive';
import { DiscoveryMermaidPanel } from '@/components/DiscoveryMermaidPanel';
import {
  FolderKanban,
  Plus,
  Trash2,
  Pencil,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

const DISCOVERY_STEPS = [
  { id: 'ready', label: 'Ready' },
  { id: 'queued', label: 'Queued' },
  { id: 'running', label: 'Discovering' },
  { id: 'result', label: 'Result' },
] as const;

function discoveryStepVisual(
  status: ProjectDiscoveryStatus,
  stepIndex: number,
): 'done' | 'active' | 'pending' | 'activeError' | 'activeSuccess' {
  if (status === 'idle') {
    return stepIndex === 0 ? 'active' : 'pending';
  }
  if (status === 'queued') {
    if (stepIndex === 0) return 'done';
    if (stepIndex === 1) return 'active';
    return 'pending';
  }
  if (status === 'running') {
    if (stepIndex < 2) return 'done';
    if (stepIndex === 2) return 'active';
    return 'pending';
  }
  if (status === 'completed') {
    if (stepIndex < 3) return 'done';
    return 'activeSuccess';
  }
  if (status === 'failed') {
    if (stepIndex < 3) return 'done';
    return 'activeError';
  }
  return 'pending';
}

function formatDiscoveryTimestamp(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function screensVisitedFromStructured(structured: unknown): Array<{ url: string; title: string | null; navigatedAt: string }> {
  if (!structured || typeof structured !== 'object' || Array.isArray(structured)) return [];
  const raw = (structured as { screensVisited?: unknown }).screensVisited;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const o = row as { url?: unknown; title?: unknown; navigatedAt?: unknown };
      const url = typeof o.url === 'string' ? o.url : '';
      if (!url) return null;
      return {
        url,
        title: typeof o.title === 'string' ? o.title : null,
        navigatedAt: typeof o.navigatedAt === 'string' ? o.navigatedAt : '',
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
}

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
  const [discoveryMarkdownDraft, setDiscoveryMarkdownDraft] = useState('');
  const [discoveryJsonDraft, setDiscoveryJsonDraft] = useState('');
  const [structuredJsonError, setStructuredJsonError] = useState<string | null>(null);
  const discoverySeededForEditingId = useRef<string | null>(null);
  const prevDiscoveryStatusRef = useRef<ProjectDiscoveryStatus | null>(null);

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

  const discoveryLiveEnabled =
    !!editingId &&
    (agentKnowledge?.discoveryStatus === 'queued' || agentKnowledge?.discoveryStatus === 'running');
  const {
    frameDataUrl: discoveryFrameUrl,
    connected: discoverySocketConnected,
    logLines: discoveryLogLines,
    formatLogTime: formatDiscoveryLogTime,
    navigationMermaid: discoveryLiveMermaid,
  } = useDiscoveryLive(editingId ?? undefined, { enabled: discoveryLiveEnabled });
  const discoveryMermaidSource =
    discoveryLiveMermaid?.trim() ||
    (typeof agentKnowledge?.discoveryNavigationMermaid === 'string'
      ? agentKnowledge.discoveryNavigationMermaid
      : null) ||
    null;
  const showDiscoveryNavMap =
    !!editingId &&
    (!!discoveryMermaidSource?.trim() ||
      agentKnowledge?.discoveryStatus === 'queued' ||
      agentKnowledge?.discoveryStatus === 'running');
  const discoveryScreensVisited = screensVisitedFromStructured(agentKnowledge?.discoveryStructured);

  useEffect(() => {
    if (agentKnowledge?.manualInstructions != null) {
      setManualDraft(agentKnowledge.manualInstructions);
    }
  }, [agentKnowledge?.manualInstructions, editingId]);

  useEffect(() => {
    if (!editingId) {
      discoverySeededForEditingId.current = null;
      prevDiscoveryStatusRef.current = null;
      return;
    }
    if (!agentKnowledge) return;

    const status = agentKnowledge.discoveryStatus;
    const prev = prevDiscoveryStatusRef.current;
    const firstSeed = discoverySeededForEditingId.current !== editingId;
    const justFinished =
      prev != null &&
      (prev === 'running' || prev === 'queued') &&
      (status === 'completed' || status === 'failed');

    if (!firstSeed && !justFinished) {
      prevDiscoveryStatusRef.current = status;
      return;
    }

    setDiscoveryMarkdownDraft(agentKnowledge.discoverySummaryMarkdown ?? '');
    setDiscoveryJsonDraft(
      agentKnowledge.discoveryStructured != null
        ? JSON.stringify(agentKnowledge.discoveryStructured, null, 2)
        : '',
    );
    setStructuredJsonError(null);
    discoverySeededForEditingId.current = editingId;
    prevDiscoveryStatusRef.current = status;
  }, [editingId, agentKnowledge]);

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

  const saveDiscoverySummaryMutation = useMutation({
    mutationFn: () =>
      projectsApi.patchAgentKnowledge(editingId!, { discoverySummaryMarkdown: discoveryMarkdownDraft }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projectAgentKnowledge', editingId] });
      setDiscoveryMarkdownDraft(data.discoverySummaryMarkdown ?? '');
    },
  });

  const saveDiscoveryStructuredMutation = useMutation({
    mutationFn: (structured: Record<string, unknown> | null) =>
      projectsApi.patchAgentKnowledge(editingId!, { discoveryStructured: structured }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['projectAgentKnowledge', editingId] });
      setStructuredJsonError(null);
      setDiscoveryJsonDraft(
        data.discoveryStructured != null ? JSON.stringify(data.discoveryStructured, null, 2) : '',
      );
    },
  });

  const saveStructuredDiscovery = () => {
    setStructuredJsonError(null);
    const trimmed = discoveryJsonDraft.trim();
    if (!trimmed) {
      saveDiscoveryStructuredMutation.mutate(null);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setStructuredJsonError('Structured data must be a JSON object (not an array or primitive).');
        return;
      }
      saveDiscoveryStructuredMutation.mutate(parsed as Record<string, unknown>);
    } catch (e) {
      setStructuredJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

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
    setDiscoveryMarkdownDraft('');
    setDiscoveryJsonDraft('');
    setStructuredJsonError(null);
    discoverySeededForEditingId.current = null;
    prevDiscoveryStatusRef.current = null;
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...emptyForm });
    setShowPassword(false);
    setManualDraft('');
    setDiscoveryMarkdownDraft('');
    setDiscoveryJsonDraft('');
    setStructuredJsonError(null);
    discoverySeededForEditingId.current = null;
    prevDiscoveryStatusRef.current = null;
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
    <div className="flex-1 min-h-0 overflow-y-auto px-6 lg:px-10 py-8 w-full max-w-7xl mx-auto">
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
          <div className="border border-gray-100 rounded-md p-4 space-y-4 bg-gray-50/50">
            <div>
              <p className="text-xs font-semibold text-gray-700">Agent knowledge (this project)</p>
              <p className="text-[11px] text-gray-500 mt-1">
                Merged into recording AI, evaluations, and optimized prompts when a run uses this project.
              </p>
              <textarea
                value={manualDraft}
                onChange={(e) => setManualDraft(e.target.value)}
                rows={4}
                className="mt-2 w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
                placeholder="Manual notes for agents (terminology, flaky areas, test data hints)…"
              />
              <button
                type="button"
                onClick={() => saveAgentNotes.mutate()}
                disabled={saveAgentNotes.isPending}
                className="mt-2 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40"
              >
                Save agent notes
              </button>
            </div>

            <div className="border-t border-gray-200 pt-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-gray-700">Run app discovery</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Opens the project URL in a remote browser, attempts automatic sign-in when a test email is set (same
                    assist as evaluations),                     then runs an agent that explores up to <strong className="font-medium text-gray-600">80</strong> steps within{' '}
                    <strong className="font-medium text-gray-600">30 minutes</strong> (breadth-first coverage; early stops are rejected until a minimum depth), records
                    main-frame navigations, and writes an evidence-based summary plus structured JSON. Use{' '}
                    <strong className="font-medium text-gray-600">Detach</strong> for a full-window live view.
                  </p>
                </div>
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
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-[#4B90FF] text-white rounded-md hover:bg-blue-500 disabled:opacity-40"
                >
                  {(discoveryMutation.isPending ||
                    agentKnowledge?.discoveryStatus === 'running' ||
                    agentKnowledge?.discoveryStatus === 'queued') && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  Run app discovery
                </button>
              </div>

              {editingId && (
                <div className="flex flex-col gap-3 w-full max-w-6xl mx-auto">
                  <div className="flex flex-col md:flex-row gap-3 w-full">
                  <div className="rounded-md border border-gray-200 bg-white overflow-hidden flex-1 min-w-0 max-w-md md:max-w-none">
                    <div className="flex items-center justify-between px-2.5 py-1.5 bg-gray-50 border-b border-gray-200">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                        Live browser
                      </span>
                      <div className="flex items-center gap-2">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${discoverySocketConnected ? 'bg-emerald-500' : 'bg-gray-300'}`}
                          title={discoverySocketConnected ? 'Preview socket connected' : 'Preview socket disconnected'}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            window.open(`/discovery-preview/${editingId}`, '_blank', 'noopener,noreferrer')
                          }
                          className="text-[11px] text-[#4B90FF] hover:underline font-medium"
                        >
                          Detach
                        </button>
                      </div>
                    </div>
                    <div className="relative w-full aspect-video max-h-[320px] bg-gray-950 flex items-center justify-center">
                      {discoveryFrameUrl ? (
                        <img
                          src={discoveryFrameUrl}
                          alt=""
                          className="w-full h-full max-h-[320px] object-contain"
                        />
                      ) : (
                        <p className="text-[11px] text-gray-500 px-3 text-center">
                          {discoveryLiveEnabled
                            ? 'Connecting to stream…'
                            : 'Start discovery to watch the remote browser (JPEG frames from the browser worker).'}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="rounded-md border border-gray-200 bg-white overflow-hidden flex flex-col flex-1 min-w-0 min-h-[240px] md:min-h-0 md:h-[320px] md:min-w-[30rem] md:flex-[1.15] md:max-w-none">
                    <div className="px-2.5 py-1.5 bg-gray-50 border-b border-gray-200 shrink-0">
                      <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                        Discovery agent log
                      </span>
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1.5 text-[10px] leading-snug">
                      {discoveryLogLines.length === 0 ? (
                        <p className="text-gray-400 text-center py-4">
                          {discoveryLiveEnabled
                            ? 'Waiting for agent actions…'
                            : 'Start discovery to see a timestamped log of each step.'}
                        </p>
                      ) : (
                        [...discoveryLogLines].reverse().map((line, i) => {
                          const oneLine = formatDiscoveryLogSingleLine(line, formatDiscoveryLogTime);
                          return (
                            <div
                              key={`${line.at}-${i}`}
                              className="font-mono text-[10px] leading-tight border-b border-gray-100 py-0.5 last:border-0 whitespace-nowrap overflow-x-auto text-gray-800 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                              title={oneLine}
                            >
                              {oneLine}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  </div>
                  {showDiscoveryNavMap && (
                    <DiscoveryMermaidPanel source={discoveryMermaidSource} />
                  )}
                </div>
              )}

              <div className="rounded-md border border-gray-200 bg-white p-3">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-3">Pipeline</p>
                <div className="flex flex-wrap items-center gap-1 sm:gap-0">
                  {DISCOVERY_STEPS.map((step, idx) => {
                    const dStatus = agentKnowledge?.discoveryStatus ?? 'idle';
                    const visual = discoveryStepVisual(dStatus, idx);
                    const isLast = idx === DISCOVERY_STEPS.length - 1;
                    return (
                      <div key={step.id} className="flex items-center min-w-0">
                        <div className="flex flex-col items-center gap-1 min-w-[4.5rem] sm:min-w-[5.5rem]">
                          <span className="flex h-7 w-7 items-center justify-center">
                            {visual === 'done' && <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden />}
                            {visual === 'active' && <Loader2 className="w-5 h-5 text-blue-500 animate-spin" aria-hidden />}
                            {visual === 'activeSuccess' && (
                              <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden />
                            )}
                            {visual === 'activeError' && <XCircle className="w-5 h-5 text-red-600" aria-hidden />}
                            {visual === 'pending' && (
                              <span className="h-5 w-5 rounded-full border-2 border-gray-300 bg-gray-50" aria-hidden />
                            )}
                          </span>
                          <span
                            className={`text-[10px] text-center leading-tight px-0.5 ${
                              visual === 'active' || visual === 'activeError' || visual === 'activeSuccess'
                                ? 'font-semibold text-gray-800'
                                : 'text-gray-500'
                            }`}
                          >
                            {step.label}
                          </span>
                        </div>
                        {!isLast && (
                          <div
                            className={`hidden sm:block h-px w-4 sm:w-6 shrink-0 -mt-4 ${
                              discoveryStepVisual(dStatus, idx) === 'done' ? 'bg-emerald-300' : 'bg-gray-200'
                            }`}
                            aria-hidden
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-600">
                  <span>
                    Status:{' '}
                    <span className="font-medium text-gray-800">{agentKnowledge?.discoveryStatus ?? '—'}</span>
                  </span>
                  <span>
                    Started:{' '}
                    <span className="font-medium text-gray-800">
                      {formatDiscoveryTimestamp(agentKnowledge?.discoveryStartedAt ?? null)}
                    </span>
                  </span>
                  <span>
                    Finished:{' '}
                    <span className="font-medium text-gray-800">
                      {formatDiscoveryTimestamp(agentKnowledge?.discoveryCompletedAt ?? null)}
                    </span>
                  </span>
                </div>
              </div>

              {discoveryMutation.data && !discoveryMutation.data.accepted && discoveryMutation.data.reason && (
                <p className="text-xs text-amber-700">{discoveryMutation.data.reason}</p>
              )}
              {agentKnowledge?.discoveryError && (
                <p className="text-xs text-red-600">{agentKnowledge.discoveryError}</p>
              )}

              {discoveryScreensVisited.length > 0 && (
                <div className="rounded-md border border-gray-200 bg-white p-3">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Screens visited (main-frame navigations)
                  </p>
                  <ol className="list-decimal list-inside space-y-1 text-[11px] text-gray-700 break-all max-h-40 overflow-y-auto">
                    {discoveryScreensVisited.map((row, i) => (
                      <li key={`${row.url}-${row.navigatedAt}-${i}`}>
                        <span className="font-mono text-[10px]">{row.url}</span>
                        {row.title ? <span className="text-gray-500"> — {row.title}</span> : null}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Discovery summary (markdown)</label>
                <textarea
                  value={discoveryMarkdownDraft}
                  onChange={(e) => setDiscoveryMarkdownDraft(e.target.value)}
                  rows={8}
                  className="mt-1 w-full border border-gray-200 rounded-md px-3 py-2 text-sm font-mono"
                  placeholder="Populated after discovery runs, or paste your own notes…"
                />
                <button
                  type="button"
                  onClick={() => saveDiscoverySummaryMutation.mutate()}
                  disabled={saveDiscoverySummaryMutation.isPending}
                  className="mt-2 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40"
                >
                  Save discovery summary
                </button>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Structured discovery (JSON object)</label>
                <textarea
                  value={discoveryJsonDraft}
                  onChange={(e) => {
                    setDiscoveryJsonDraft(e.target.value);
                    setStructuredJsonError(null);
                  }}
                  rows={10}
                  className={`mt-1 w-full border rounded-md px-3 py-2 text-xs font-mono ${
                    structuredJsonError ? 'border-red-300' : 'border-gray-200'
                  }`}
                  placeholder='{}'
                />
                {structuredJsonError && <p className="mt-1 text-xs text-red-600">{structuredJsonError}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={saveStructuredDiscovery}
                    disabled={saveDiscoveryStructuredMutation.isPending}
                    className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-40"
                  >
                    Save structured JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDiscoveryJsonDraft('');
                      setStructuredJsonError(null);
                      saveDiscoveryStructuredMutation.mutate(null);
                    }}
                    disabled={saveDiscoveryStructuredMutation.isPending}
                    className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-40"
                  >
                    Clear structured data
                  </button>
                </div>
              </div>
            </div>
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
      <div className="bg-white border border-gray-100 rounded-lg overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm table-fixed">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3 w-[18%]">Name</th>
              <th className="px-4 py-3 w-[8%]">Kind</th>
              <th className="px-4 py-3 w-[22%]">URL</th>
              <th className="px-4 py-3 w-[18%]">Test user</th>
              <th className="px-4 py-3 w-[12%]">Provider</th>
              <th className="px-4 py-3 w-[14%]">Created</th>
              <th className="px-4 py-3 w-[8%] text-right whitespace-nowrap">Actions</th>
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
                  <td className="px-4 py-3 text-gray-500 truncate" title={p.url ?? ''}>
                    {p.url || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 truncate" title={p.testUserEmail ?? ''}>
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
                  <td className="px-4 py-3 align-middle">
                    <div className="flex gap-1 justify-end shrink-0">
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
