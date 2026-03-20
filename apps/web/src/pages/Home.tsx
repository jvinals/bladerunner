import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { runsApi } from '@/lib/api';
import { LoadingState, ErrorState } from '@/components/ui/States';
import { formatDuration } from '@/lib/utils';
import {
  Activity, Zap, Clock, Bot, AlertTriangle, TrendingUp,
  Play, ArrowRight, CheckCircle, FolderKanban,
} from 'lucide-react';
import { HomeRunsTable } from '@/components/home/HomeRunsTable';

export default function HomePage() {
  const { data: kpis, isLoading: kpisLoading, error: kpisError } = useQuery({
    queryKey: ['dashboard-kpis'],
    queryFn: runsApi.getDashboard,
  });

  if (kpisLoading) return <LoadingState message="Loading dashboard..." />;
  if (kpisError) return <ErrorState message="Failed to load dashboard data" />;

  return (
    <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden px-6 lg:px-10 py-8 w-full max-w-[min(100%,90rem)] mx-auto">
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Runs table — wider column so the table never needs horizontal scroll */}
        <div className="lg:col-span-8 flex flex-col min-h-0 min-w-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] text-muted-foreground uppercase tracking-wider">Recent activity</span>
            <Link to="/runs" className="text-xs text-[#4B90FF] font-medium hover:underline flex items-center gap-1">
              Open recording <ArrowRight size={12} />
            </Link>
          </div>
          <HomeRunsTable />
        </div>

        {/* Right column */}
        <div className="lg:col-span-4 space-y-6 min-w-0">
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
