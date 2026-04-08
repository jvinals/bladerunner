import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  evaluationsApi,
  projectsApi,
  type AutoClerkOtpUiMode,
  type CreateEvaluationBody,
  type ProjectDto,
} from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ClipboardList, Plus, ExternalLink } from 'lucide-react';

/** Ensure API-required `https://` URL when copying from project settings. */
function startUrlFromProject(projectUrl: string | null | undefined): string | null {
  const t = projectUrl?.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

export default function EvaluationsPage() {
  const queryClient = useQueryClient();
  const [panelOpen, setPanelOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [intent, setIntent] = useState('');
  const [desiredOutput, setDesiredOutput] = useState('');
  const [projectId, setProjectId] = useState('');
  const [autoSignIn, setAutoSignIn] = useState(false);
  const [autoSignInOtp, setAutoSignInOtp] = useState<AutoClerkOtpUiMode>('default');

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['evaluations'],
    queryFn: () => evaluationsApi.list(),
  });

  const { data: projects = [] as ProjectDto[] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateEvaluationBody) => evaluationsApi.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['evaluations'] });
      setName('');
      setUrl('https://');
      setIntent('');
      setDesiredOutput('');
      setProjectId('');
      setAutoSignIn(false);
      setAutoSignInOtp('default');
      setPanelOpen(false);
    },
  });

  const submit = () => {
    const u = url.trim();
    if (!u || !intent.trim() || !desiredOutput.trim()) return;
    const body: CreateEvaluationBody = {
      name: name.trim() || undefined,
      url: u,
      intent: intent.trim(),
      desiredOutput: desiredOutput.trim(),
      ...(projectId ? { projectId } : {}),
      autoSignIn,
    };
    if (autoSignIn && autoSignInOtp !== 'default') {
      body.autoSignInClerkOtpMode = autoSignInOtp;
    }
    createMutation.mutate(body);
  };

  if (isLoading) return <LoadingState message="Loading evaluations..." />;
  if (error) return <ErrorState message="Failed to load evaluations" />;

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight flex items-center gap-2">
            <ClipboardList className="w-7 h-7 text-[#4B90FF]" />
            Evaluations
          </h1>
          <p className="text-sm text-gray-500 mt-1 max-w-xl">
            Autonomous browser sessions: the model proposes Playwright steps, runs them on the remote
            browser, and produces a structured report from your intent and desired output.
          </p>
        </div>
        <button
          type="button"
          aria-label="New evaluation"
          onClick={() => setPanelOpen((o) => !o)}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#4B90FF] px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#3d7fe6] sm:px-4"
        >
          <span className="text-xl font-medium leading-none sm:hidden">+</span>
          <span className="hidden items-center gap-2 sm:inline-flex">
            <Plus size={18} className="shrink-0" aria-hidden />
            New evaluation
          </span>
        </button>
      </div>

      {panelOpen && (
        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">Create evaluation</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-gray-500">Name (optional)</span>
              <input
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Checkout happy path"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-gray-500">Project (optional)</span>
              <select
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-800 bg-white"
                value={projectId}
                onChange={(e) => {
                  const id = e.target.value;
                  setProjectId(id);
                  if (!id) return;
                  const p = projects.find((x) => x.id === id);
                  const next = startUrlFromProject(p?.url ?? null);
                  if (next) setUrl(next);
                }}
                aria-label="Project"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">
                Manage projects under <Link to="/projects" className="text-[#4B90FF] hover:underline">Projects</Link>.
              </p>
            </label>
            <div className="block sm:col-span-2 rounded-md border border-gray-100 bg-gray-50/80 px-3 py-3 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-gray-300"
                  checked={autoSignIn}
                  onChange={(e) => setAutoSignIn(e.target.checked)}
                />
                <span className="text-sm text-gray-800">
                  Auto-sign in when the app shows a sign-in screen (Clerk or project test user credentials).
                </span>
              </label>
              {autoSignIn && (
                <div className="pl-6 flex flex-wrap items-center gap-2 text-[11px] text-gray-600">
                  <label htmlFor="eval-create-clerk-otp" className="whitespace-nowrap">
                    Clerk OTP
                  </label>
                  <select
                    id="eval-create-clerk-otp"
                    value={autoSignInOtp}
                    onChange={(e) => setAutoSignInOtp(e.target.value as AutoClerkOtpUiMode)}
                    className="flex-1 min-w-[160px] border border-gray-200 rounded-md px-2 py-1.5 text-[11px] text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30"
                  >
                    <option value="default">Server default</option>
                    <option value="clerk_test_email">Test email (424242)</option>
                    <option value="mailslurp">MailSlurp inbox</option>
                  </select>
                </div>
              )}
            </div>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-gray-500">Start URL</span>
              <input
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm font-mono"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-gray-500">Global intent</span>
              <textarea
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm min-h-[88px]"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="What should the run explore or verify?"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-gray-500">Desired report output</span>
              <textarea
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm min-h-[88px]"
                value={desiredOutput}
                onChange={(e) => setDesiredOutput(e.target.value)}
                placeholder="e.g. Bullet list of UX issues, pass/fail table, accessibility notes..."
              />
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              className="text-sm text-gray-600 px-3 py-2"
              onClick={() => setPanelOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={createMutation.isPending}
              onClick={submit}
              className="rounded-lg bg-[#4B90FF] text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-12 text-center border border-dashed border-gray-200 rounded-xl">
          No evaluations yet. Create one to queue an autonomous run.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white overflow-hidden">
          {rows.map((row) => (
            <li key={row.id}>
              <Link
                to={`/evaluations/${row.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50/80 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 truncate">{row.name}</span>
                    <StatusBadge status={row.status} size="sm" narrowAsIcon />
                    {row.project && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] text-gray-500 max-w-[140px] truncate"
                        title={row.project.name}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: row.project.color }}
                          aria-hidden
                        />
                        {row.project.name}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate mt-0.5 flex items-center gap-1">
                    <ExternalLink size={12} className="shrink-0 opacity-60" />
                    {row.url}
                  </p>
                </div>
                <span className="text-[10px] text-gray-400 whitespace-nowrap">
                  {new Date(row.createdAt).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
