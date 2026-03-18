import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { runsApi } from '@/lib/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/States';
import { formatDuration, formatRelativeTime } from '@/lib/utils';
import {
  Search, Filter, Play, Monitor, Smartphone, Globe,
  ChevronRight, RotateCcw, X
} from 'lucide-react';

const PLATFORM_ICONS: Record<string, typeof Monitor> = {
  desktop: Monitor,
  mobile: Smartphone,
  pwa: Globe,
};

const STATUS_FILTERS = [
  { value: '', label: 'All Statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'needs_review', label: 'Needs Review' },
];

const PLATFORM_FILTERS = [
  { value: '', label: 'All Platforms' },
  { value: 'desktop', label: 'Desktop' },
  { value: 'mobile', label: 'Mobile' },
  { value: 'pwa', label: 'PWA' },
];

export default function RunsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');

  const params: Record<string, string> = {};
  if (search) params.search = search;
  if (statusFilter) params.status = statusFilter;
  if (platformFilter) params.platform = platformFilter;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['runs', params],
    queryFn: () => runsApi.list(params),
  });

  const runs = (data?.data || []) as Array<{
    id: string;
    name: string;
    description?: string;
    status: string;
    platform: string;
    triggeredBy: string;
    durationMs?: number;
    stepsCount: number;
    passedSteps: number;
    failedSteps: number;
    findingsCount: number;
    tags: string[];
    createdAt: string;
  }>;

  const hasFilters = search || statusFilter || platformFilter;

  return (
    <div className="px-6 lg:px-10 py-8 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="ce-section-label mb-2">Runs</p>
          <h1 className="text-2xl font-bold text-gray-900">Run History</h1>
          <p className="text-sm text-gray-500 mt-1">
            {data ? `${data.total} total runs` : 'Loading...'}
          </p>
        </div>
        <button className="flex items-center gap-1.5 px-4 py-2 bg-[#4B90FF] text-white text-sm font-medium rounded-md hover:bg-blue-500 transition-colors">
          <Play size={14} />
          New Run
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search runs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-md pl-9 pr-3 py-2 text-sm text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF]"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-600 appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF] bg-white"
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <Filter size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="border border-gray-200 rounded-md px-3 py-2 text-sm text-gray-600 appearance-none pr-8 focus:outline-none focus:ring-2 focus:ring-[#4B90FF]/30 focus:border-[#4B90FF] bg-white"
          >
            {PLATFORM_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
          <Filter size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        </div>

        {hasFilters && (
          <button
            onClick={() => { setSearch(''); setStatusFilter(''); setPlatformFilter(''); }}
            className="text-xs text-gray-500 hover:text-[#4B90FF] transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Runs Table */}
      {isLoading ? (
        <LoadingState message="Loading runs..." />
      ) : error ? (
        <ErrorState message="Failed to load runs" onRetry={() => refetch()} />
      ) : runs.length === 0 ? (
        <EmptyState
          title={hasFilters ? 'No runs match your filters' : 'No runs yet'}
          description={hasFilters ? 'Try adjusting your filters or search term.' : 'Start your first run to begin validating application experiences.'}
          action={
            hasFilters ? (
              <button onClick={() => { setSearch(''); setStatusFilter(''); setPlatformFilter(''); }} className="text-sm text-[#4B90FF] font-medium hover:underline">
                Clear filters
              </button>
            ) : (
              <button className="flex items-center gap-1.5 px-4 py-2 bg-[#4B90FF] text-white text-sm font-medium rounded-md hover:bg-blue-500 transition-colors">
                <Play size={14} /> Start First Run
              </button>
            )
          }
        />
      ) : (
        <div className="bg-white border border-gray-100 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Run</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Platform</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Duration</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden lg:table-cell">Steps</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">Triggered</th>
                <th className="w-8 px-2"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run, i) => {
                const PlatformIcon = PLATFORM_ICONS[run.platform] || Monitor;
                return (
                  <tr
                    key={run.id}
                    className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'}`}
                  >
                    <td className="px-4 py-3">
                      <Link to={`/runs/${run.id}`} className="group">
                        <p className="text-sm font-medium text-gray-700 group-hover:text-[#4B90FF] transition-colors truncate max-w-xs">
                          {run.name}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-gray-400 ce-mono">{run.id.slice(0, 16)}</span>
                          {run.tags.slice(0, 2).map((tag) => (
                            <span key={tag} className="px-1.5 py-0 text-[9px] text-gray-400 bg-gray-100 rounded font-medium">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex items-center gap-1.5 text-xs text-gray-500">
                        <PlatformIcon size={13} className="text-gray-400" />
                        <span className="capitalize">{run.platform}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-gray-500 ce-mono">
                        {run.durationMs ? formatDuration(run.durationMs) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="text-xs text-gray-500">
                        {run.passedSteps}/{run.stepsCount}
                        {run.failedSteps > 0 && (
                          <span className="text-[#FF4D4D] ml-1">({run.failedSteps} failed)</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} size="sm" />
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-[11px] text-gray-400">{formatRelativeTime(run.createdAt)}</span>
                    </td>
                    <td className="px-2 py-3">
                      <Link to={`/runs/${run.id}`}>
                        <ChevronRight size={14} className="text-gray-300 hover:text-[#4B90FF] transition-colors" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
