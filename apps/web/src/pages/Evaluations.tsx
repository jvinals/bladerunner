import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { evaluationsApi, type CreateEvaluationBody } from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ClipboardList, Plus, ExternalLink } from 'lucide-react';

export default function EvaluationsPage() {
  const queryClient = useQueryClient();
  const [panelOpen, setPanelOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('https://');
  const [intent, setIntent] = useState('');
  const [desiredOutput, setDesiredOutput] = useState('');

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['evaluations'],
    queryFn: () => evaluationsApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateEvaluationBody) => evaluationsApi.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['evaluations'] });
      setName('');
      setUrl('https://');
      setIntent('');
      setDesiredOutput('');
      setPanelOpen(false);
    },
  });

  const submit = () => {
    const u = url.trim();
    if (!u || !intent.trim() || !desiredOutput.trim()) return;
    createMutation.mutate({
      name: name.trim() || undefined,
      url: u,
      intent: intent.trim(),
      desiredOutput: desiredOutput.trim(),
    });
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
          onClick={() => setPanelOpen((o) => !o)}
          className="inline-flex items-center gap-2 rounded-lg bg-[#4B90FF] text-white text-sm font-medium px-4 py-2.5 hover:bg-[#3d7fe6] transition-colors"
        >
          <Plus size={18} />
          New evaluation
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
                    <StatusBadge status={row.status} size="sm" />
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
