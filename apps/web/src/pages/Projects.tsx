import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi, type ProjectDto, type CreateProjectBody } from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { FolderKanban, Plus, Trash2, Pencil } from 'lucide-react';

const KINDS: CreateProjectBody['kind'][] = ['WEB', 'IOS', 'ANDROID'];

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateProjectBody>({
    name: '',
    kind: 'WEB',
    url: '',
    artifactUrl: '',
  });

  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(),
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateProjectBody) => projectsApi.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setForm({ name: '', kind: 'WEB', url: '', artifactUrl: '' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CreateProjectBody> }) =>
      projectsApi.update(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      setEditingId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  const startEdit = (p: ProjectDto) => {
    setEditingId(p.id);
    setForm({
      name: p.name,
      kind: p.kind,
      url: p.url ?? '',
      artifactUrl: p.artifactUrl ?? '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ name: '', kind: 'WEB', url: '', artifactUrl: '' });
  };

  const submit = () => {
    if (!form.name.trim()) return;
    const body: CreateProjectBody = {
      name: form.name.trim(),
      kind: form.kind,
      url: form.url?.trim() || undefined,
      artifactUrl: form.artifactUrl?.trim() || undefined,
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

      <div className="bg-white border border-gray-100 rounded-lg p-5 mb-8 space-y-4">
        <p className="text-sm font-semibold text-gray-800">
          {editingId ? 'Edit project' : 'New project'}
        </p>
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
                setForm((f) => ({ ...f, kind: e.target.value as CreateProjectBody['kind'] }))
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

      <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Kind</th>
              <th className="px-4 py-3">URL</th>
              <th className="px-4 py-3">Artifact</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody>
            {projects.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-gray-400 text-sm">
                  No projects yet. Create one above.
                </td>
              </tr>
            ) : (
              projects.map((p) => (
                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-800">{p.name}</td>
                  <td className="px-4 py-3 text-gray-600">{p.kind}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate" title={p.url ?? ''}>
                    {p.url || '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 max-w-[180px] truncate" title={p.artifactUrl ?? ''}>
                    {p.artifactUrl || '—'}
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
                          if (window.confirm(`Delete project “${p.name}”?`)) deleteMutation.mutate(p.id);
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
