import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileText } from 'lucide-react';
import { projectsApi } from '@/lib/api';
import { DiscoveryAgentLogPanel } from '@/components/DiscoveryAgentLogPanel';
import { formatDiscoveryLogTime } from '@/hooks/useDiscoveryLive';
import { LoadingState, ErrorState } from '@/components/ui/States';

/**
 * Full-window viewer for the last persisted discovery agent log (`docs/logs/*.log` on the API host).
 */
export default function DiscoveryAgentLogPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ['discoveryAgentLog', projectId],
    queryFn: () => projectsApi.getDiscoveryAgentLog(projectId!),
    enabled: !!projectId,
  });

  if (!projectId) {
    return <ErrorState message="Missing project id" />;
  }
  if (isLoading) {
    return <LoadingState message="Loading discovery log…" />;
  }
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <ErrorState
          message={
            error instanceof Error
              ? error.message
              : 'Could not load discovery log (run app discovery at least once).'
          }
        />
        <Link
          to="/projects"
          className="mt-4 text-sm text-[#4B90FF] hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft size={14} /> Back to projects
        </Link>
      </div>
    );
  }
  if (!data) {
    return <ErrorState message="No data" />;
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col">
      <header className="shrink-0 border-b border-gray-800 px-4 py-3 flex flex-wrap items-center gap-3 bg-gray-900/80">
        <Link
          to="/projects"
          className="text-sm text-gray-400 hover:text-white inline-flex items-center gap-1.5"
        >
          <ArrowLeft size={16} />
          Projects
        </Link>
        <span className="text-gray-600">/</span>
        <span className="inline-flex items-center gap-2 text-sm font-medium text-white">
          <FileText size={18} className="text-emerald-400 shrink-0" />
          Discovery agent log
        </span>
        <code className="text-[11px] text-gray-400 font-mono truncate max-w-[min(100%,48rem)]" title={data.filename}>
          {data.filename}
        </code>
      </header>
      <div className="flex-1 min-h-0 flex flex-col p-4">
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 overflow-hidden flex flex-col flex-1 min-h-0 max-w-6xl mx-auto w-full">
          <div className="px-3 py-2 bg-gray-900 border-b border-gray-800 shrink-0">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              Log ({data.lines.length} lines)
            </span>
          </div>
          <DiscoveryAgentLogPanel
            lines={data.lines}
            formatTime={formatDiscoveryLogTime}
            variant="dark"
            sessionKey={data.filename}
            emptyMessage="This file has no parseable log lines."
          />
        </div>
      </div>
    </div>
  );
}
