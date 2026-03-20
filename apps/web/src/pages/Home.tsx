import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { runsApi } from '@/lib/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { formatDuration, formatRelativeTime } from '@/lib/utils';
import {
  Activity, Zap, Clock, Bot, AlertTriangle, TrendingUp,
  Play, ArrowRight, CheckCircle, Monitor, Smartphone, Globe, Trash2, FolderKanban,
} from 'lucide-react';

const PLATFORM_ICONS: Record<string, typeof Monitor> = {
  desktop: Monitor,
  mobile: Smartphone,
  pwa: Globe,
};

export default function HomePage() {
  const queryClient = useQueryClient();

  const { data: kpis, isLoading: kpisLoading, error: kpisError } = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: runsApi.getDashboard,
  });

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ['home-runs-table'],
    queryFn: () => runsApi.list({ pageSize: '100' }),
  });

  const deleteRunMutation = useMutation({
    mutationFn: (id: string) => runsApi.deleteRun(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['home-runs-table'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      queryClient.invalidateQueries({ queryKey: ['recent-runs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-kpis'] });
    },
  });

  if (kpisLoading) return <LoadingState message="Loading dashboard..." />;
  if (kpisError) return <ErrorState message="Failed to load dashboard data" />;

  const runs = (runsData?.data || []) as Array<{
    id: string;
    name: string;
    status: string;
    platform: string;
    url: string;
    durationMs?: number;
    triggeredBy: string;
    createdAt: string;
    stepsCount: number;
    project?: { id: string; name: string; kind: string } | null;
  }>;

  const handleDelete = (run: { id: string; name: string; status: string }) => {
    if (run.status === 'RECORDING') {
      window.alert('Stop the recording from the Runs page before deleting.');
      return;
    }
    if (!window.confirm(`Delete run “${run.name}”? This cannot be undone.`)) return;
    deleteRunMutation.mutate(run.id);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 lg:px-10 py-8 max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <p className="ce-section-label mb-2">Dashboard</p>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Welcome to Bladerunner</h1>
        <p className="text-sm text-gray-500">Operational control surface for validating application experiences</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Runs', value: kpis?.totalRuns ?? 0, icon: Activity, trend: `+${kpis?.runsTrend ?? 0}%`, accent: false },
          { label: 'Pass Rate', value: `${kpis?.passRate ?? 0}%`, icon: CheckCircle, trend: `+${kpis?.passRateTrend ?? 0}%`, accent: true },
          { label: 'Avg Duration', value: formatDuration(kpis?.avgDuration ?? 0), icon: Clock, trend: null, accent: false },
          { label: 'Active Agents', value: kpis?.activeAgents ?? 0, icon: Bot, trend: null, accent: true },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white border border-gray-100 rounded-lg p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] text-gray-400 uppercase tracking-wider">{kpi.label}</p>
              <kpi.icon size={14} className="text-gray-300" />
            </div>
            <p className={`text-2xl font-bold ${kpi.accent ? 'text-[#4B90FF]' : 'text-gray-800'}`}>
              {kpi.value}
            </p>
            {kpi.trend && (
              <span className="inline-flex items-center gap-0.5 mt-2 px-2 py-0.5 bg-green-50 text-[#56A34A] text-[10px] font-semibold rounded-full">
                <TrendingUp size={10} />
                {kpi.trend}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Runs table */}
        <div className="lg:col-span-2 bg-white border border-gray-100 rounded-lg overflow-hidden flex flex-col min-h-0">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-800">Runs</p>
            <Link to="/runs" className="text-xs text-[#4B90FF] font-medium hover:underline flex items-center gap-1">
              Open recording <ArrowRight size={12} />
            </Link>
          </div>
          {runsLoading ? (
            <div className="p-8">
              <LoadingState message="Loading runs..." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/80 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Project</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Platform</th>
                    <th className="px-4 py-3">Steps</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3 w-24" />
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">
                        No runs yet. Start one from <Link to="/runs" className="text-[#4B90FF] font-medium">Runs</Link>.
                      </td>
                    </tr>
                  ) : (
                    runs.map((run) => {
                      const PlatformIcon = PLATFORM_ICONS[run.platform] || Monitor;
                      return (
                        <tr key={run.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-4 py-3">
                            <Link
                              to={`/runs/${run.id}`}
                              className="font-medium text-gray-800 hover:text-[#4B90FF] line-clamp-2"
                            >
                              {run.name}
                            </Link>
                            <p className="text-[10px] text-gray-400 truncate max-w-[220px]" title={run.url}>
                              {run.url}
                            </p>
                          </td>
                          <td className="px-4 py-3 text-gray-600 text-xs">
                            {run.project?.name ?? '—'}
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge status={run.status} size="sm" />
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center gap-1 text-gray-500 text-xs">
                              <PlatformIcon size={12} />
                              {run.platform}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-600 tabular-nums">{run.stepsCount}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">
                            {run.durationMs != null ? formatDuration(run.durationMs) : '—'}
                          </td>
                          <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">
                            {formatRelativeTime(run.createdAt)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <Link
                                to={`/runs/${run.id}`}
                                className="p-1.5 rounded-md text-[#4B90FF] hover:bg-blue-50 text-xs font-medium"
                              >
                                View
                              </Link>
                              <button
                                type="button"
                                title="Delete run"
                                disabled={deleteRunMutation.isPending}
                                onClick={() => handleDelete(run)}
                                className="p-1.5 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-40"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Quick Start */}
          <div className="bg-white border border-gray-100 rounded-lg p-5">
            <p className="text-sm font-semibold text-gray-800 mb-4">Quick Start</p>
            <div className="space-y-2">
              <Link
                to="/runs"
                className="flex items-center gap-2.5 px-3 py-2.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF] transition-colors"
              >
                <Play size={13} className="text-[#4B90FF]" />
                Start a New Run
              </Link>
              <Link
                to="/projects"
                className="flex items-center gap-2.5 px-3 py-2.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF] transition-colors"
              >
                <FolderKanban size={13} className="text-[#4B90FF]" />
                Manage Projects
              </Link>
              <Link
                to="/settings"
                className="flex items-center gap-2.5 px-3 py-2.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF] transition-colors"
              >
                <Bot size={13} className="text-[#4B90FF]" />
                Configure Agents
              </Link>
              <Link
                to="/settings"
                className="flex items-center gap-2.5 px-3 py-2.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-md hover:border-[#4B90FF] hover:text-[#4B90FF] transition-colors"
              >
                <Zap size={13} className="text-[#4B90FF]" />
                Set Up Integrations
              </Link>
            </div>
          </div>

          {/* System Status */}
          <div className="bg-white border border-gray-100 rounded-lg p-5">
            <p className="text-sm font-semibold text-gray-800 mb-4">System Status</p>
            <div className="space-y-3">
              {[
                { label: 'API', status: 'Operational', color: '#56A34A' },
                { label: 'Agents', status: 'Operational', color: '#56A34A' },
                { label: 'Orchestrator', status: 'Not configured', color: '#A3A3A3' },
                { label: 'Storage', status: 'Operational', color: '#56A34A' },
              ].map((s) => (
                <div key={s.label} className="flex items-center justify-between">
                  <span className="text-xs text-gray-600">{s.label}</span>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                    <span className="text-[11px] text-gray-500">{s.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Findings Alert */}
          {(kpis?.findingsCount ?? 0) > 0 && (
            <div className="bg-[#EAB508]/5 border border-[#EAB508]/20 rounded-lg p-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle size={14} className="text-[#EAB508] mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-gray-700">
                    {kpis?.findingsCount} Open Findings
                  </p>
                  <p className="text-[11px] text-gray-500 mt-0.5">
                    Some runs have findings that need review before the next release.
                  </p>
                  <Link to="/runs" className="text-[11px] text-[#4B90FF] font-medium mt-2 inline-block hover:underline">
                    Review findings →
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
