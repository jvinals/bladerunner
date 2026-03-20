import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Search,
  Trash2,
  Monitor,
  Smartphone,
  Globe,
} from 'lucide-react';
import { runsApi } from '@/lib/api';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { LoadingState } from '@/components/ui/States';
import { formatDuration, formatRelativeTime, cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RunThumbnail } from '@/components/home/RunThumbnail';

export type HomeRunRow = {
  id: string;
  name: string;
  status: string;
  platform: string;
  url: string;
  /** Populated after a completed recording when a JPEG thumbnail exists on disk. */
  thumbnailUrl?: string | null;
  durationMs?: number | null;
  triggeredBy: string;
  createdAt: string;
  stepsCount: number;
  project?: { id: string; name: string; kind: string } | null;
};

const PLATFORM_ICONS: Record<string, typeof Monitor> = {
  desktop: Monitor,
  mobile: Smartphone,
  pwa: Globe,
};

function platformKey(p: string) {
  return (p || '').toLowerCase();
}

function rowAccent(status: string) {
  switch (status) {
    case 'COMPLETED':
      return 'border-l-[3px] border-l-[var(--ce-success)] bg-emerald-500/[0.03]';
    case 'FAILED':
      return 'border-l-[3px] border-l-[var(--ce-destructive)] bg-red-500/[0.04]';
    case 'RECORDING':
      return 'border-l-[3px] border-l-[var(--ce-primary)] bg-sky-500/[0.05]';
    case 'CANCELLED':
      return 'border-l-[3px] border-l-amber-500/70 bg-amber-500/[0.04]';
    default:
      return 'border-l-[3px] border-l-transparent';
  }
}

function SortIcon({ sorted }: { sorted: false | 'asc' | 'desc' }) {
  if (sorted === 'asc') return <ArrowUp className="size-3 text-[var(--ce-primary)]" />;
  if (sorted === 'desc') return <ArrowDown className="size-3 text-[var(--ce-primary)]" />;
  return <ArrowUpDown className="size-3 opacity-40" />;
}

/** Column widths for `table-fixed` — fits the viewport without horizontal scroll. */
function columnWidthClass(columnId: string): string {
  switch (columnId) {
    case 'thumb':
      return 'w-10 shrink-0 px-1';
    case 'name':
      return 'min-w-0 max-w-none w-[36%]';
    case 'project':
      return 'min-w-0 w-[10%]';
    case 'status':
      return 'min-w-0 w-[10%]';
    case 'platform':
      return 'min-w-0 w-[8%]';
    case 'steps':
      return 'w-[5%] min-w-0';
    case 'duration':
      return 'min-w-0 w-[8%]';
    case 'created':
      return 'min-w-0 w-[10%]';
    case 'actions':
      return 'w-16 shrink-0 text-right';
    default:
      return 'min-w-0';
  }
}

function SortHeader({
  label,
  column,
}: {
  label: string;
  column: {
    getIsSorted: () => false | 'asc' | 'desc';
    toggleSorting: (desc?: boolean) => void;
  };
}) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      className="inline-flex max-w-full min-w-0 items-center gap-1 text-left font-semibold text-foreground hover:text-[var(--ce-primary)]"
      onClick={() => column.toggleSorting()}
    >
      <span className="truncate">{label}</span>
      <SortIcon sorted={sorted} />
    </button>
  );
}

export function HomeRunsTable() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [platformFilter, setPlatformFilter] = useState<string>('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 10 });
  const [sorting, setSorting] = useState<SortingState>([{ id: 'created', desc: true }]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput.trim()), 320);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [debouncedSearch, statusFilter, platformFilter]);

  const queryParams = useMemo(() => {
    const sort = sorting[0];
    let sortBy = 'createdAt';
    let sortOrder: 'asc' | 'desc' = 'desc';
    if (sort) {
      sortOrder = sort.desc ? 'desc' : 'asc';
      if (sort.id === 'name') sortBy = 'name';
      else if (sort.id === 'duration') sortBy = 'durationMs';
      else if (sort.id === 'status') sortBy = 'status';
      else if (sort.id === 'created') sortBy = 'createdAt';
    }
    const p: Record<string, string> = {
      page: String(pagination.pageIndex + 1),
      pageSize: String(pagination.pageSize),
      sortBy,
      sortOrder,
    };
    if (debouncedSearch) p.search = debouncedSearch;
    if (statusFilter) p.status = statusFilter;
    if (platformFilter) p.platform = platformFilter;
    return p;
  }, [pagination, sorting, debouncedSearch, statusFilter, platformFilter]);

  const { data: runsData, isLoading } = useQuery({
    queryKey: ['home-runs-table', queryParams],
    queryFn: () => runsApi.list(queryParams),
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

  const rows: HomeRunRow[] = useMemo(() => {
    const raw = (runsData?.data || []) as HomeRunRow[];
    return raw;
  }, [runsData]);

  const totalPages = runsData?.totalPages ?? 0;
  const total = runsData?.total ?? 0;

  const handleDelete = useCallback(
    (run: HomeRunRow) => {
      const msg =
        run.status === 'RECORDING'
          ? `Delete “${run.name}”? This will end the active recording and remove the run permanently.`
          : `Delete run “${run.name}”? This cannot be undone.`;
      if (!window.confirm(msg)) return;
      deleteRunMutation.mutate(run.id);
    },
    [deleteRunMutation],
  );

  const columns = useMemo<ColumnDef<HomeRunRow>[]>(
    () => [
      {
        id: 'thumb',
        header: () => <span className="sr-only">Preview</span>,
        cell: ({ row }) => (
          <RunThumbnail
            runId={row.original.id}
            url={row.original.url}
            status={row.original.status}
            thumbnailUrl={row.original.thumbnailUrl}
            className="size-7 rounded"
          />
        ),
        enableSorting: false,
        size: 44,
      },
      {
        accessorKey: 'name',
        id: 'name',
        header: ({ column }) => <SortHeader label="Run" column={column} />,
        cell: ({ row }) => (
          <div className="min-w-0 max-w-full">
            <Link
              to={`/runs/${row.original.id}`}
              className="block font-medium text-foreground hover:text-[var(--ce-primary)] line-clamp-1 text-xs leading-tight"
            >
              {row.original.name}
            </Link>
            <p className="text-[10px] text-muted-foreground truncate" title={row.original.url}>
              {row.original.url}
            </p>
          </div>
        ),
      },
      {
        id: 'project',
        header: 'Project',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="inline-flex items-center rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-800 dark:text-violet-200">
            {row.original.project?.name ?? '—'}
          </span>
        ),
      },
      {
        accessorKey: 'status',
        id: 'status',
        header: ({ column }) => <SortHeader label="Status" column={column} />,
        cell: ({ row }) => <StatusBadge status={row.original.status} size="sm" />,
      },
      {
        id: 'platform',
        header: 'Plat.',
        enableSorting: false,
        cell: ({ row }) => {
          const pk = platformKey(row.original.platform);
          const Icon = PLATFORM_ICONS[pk] || Monitor;
          return (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-slate-500/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-200 capitalize">
              <Icon className="size-3 opacity-80" />
              {pk || '—'}
            </span>
          );
        },
      },
      {
        accessorKey: 'stepsCount',
        id: 'steps',
        header: 'Steps',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums text-xs text-muted-foreground">{row.original.stepsCount}</span>
        ),
      },
      {
        accessorKey: 'durationMs',
        id: 'duration',
        header: ({ column }) => <SortHeader label="Time" column={column} />,
        cell: ({ row }) => (
          <span className="text-[11px] text-cyan-800/90 dark:text-cyan-200/90 tabular-nums">
            {row.original.durationMs != null ? formatDuration(row.original.durationMs) : '—'}
          </span>
        ),
      },
      {
        accessorKey: 'createdAt',
        id: 'created',
        header: ({ column }) => <SortHeader label="Created" column={column} />,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">
            {formatRelativeTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-0.5">
            <Button variant="ghost" size="icon" className="size-7 text-[var(--ce-primary)]" asChild>
              <Link to={`/runs/${row.original.id}`} title="Open run">
                <ChevronRight className="size-4" />
              </Link>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-destructive hover:text-destructive"
              title="Delete run"
              disabled={deleteRunMutation.isPending}
              onClick={() => handleDelete(row.original)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ),
      },
    ],
    [handleDelete],
  );

  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting(updater);
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  };

  const table = useReactTable({
    data: rows,
    columns,
    pageCount: totalPages,
    state: { pagination, sorting },
    manualPagination: true,
    manualSorting: true,
    onPaginationChange: setPagination,
    onSortingChange: handleSortingChange,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <div className="flex w-full min-w-0 flex-col min-h-0 rounded-xl border border-border/80 bg-card shadow-sm overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border/60 bg-gradient-to-r from-slate-50/80 via-white to-sky-50/40 dark:from-slate-900/40 dark:via-card dark:to-sky-950/20 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-foreground">Runs</p>
          <p className="text-[11px] text-muted-foreground">
            {total} total · filter, sort, paginate
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative min-w-0 max-w-full flex-1 sm:flex-initial sm:min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name or URL…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="h-8 w-full min-w-0 max-w-full pl-8 text-xs sm:w-[min(100%,240px)]"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
          >
            <option value="">All statuses</option>
            <option value="RECORDING">Recording</option>
            <option value="COMPLETED">Completed</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <select
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
          >
            <option value="">All platforms</option>
            <option value="DESKTOP">Desktop</option>
            <option value="MOBILE">Mobile</option>
            <option value="PWA">PWA</option>
          </select>
          <select
            value={pagination.pageSize}
            onChange={(e) =>
              setPagination({ pageIndex: 0, pageSize: Number(e.target.value) })
            }
            className="h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm"
          >
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="p-8">
          <LoadingState message="Loading runs…" />
        </div>
      ) : (
        <>
          <Table className="table-fixed">
            <TableHeader>
              {table.getHeaderGroups().map((hg) => (
                <TableRow key={hg.id} className="hover:bg-transparent border-b border-border/80 bg-muted/30">
                  {hg.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={cn('py-2', columnWidthClass(header.column.id))}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center text-sm text-muted-foreground">
                    No runs match.{' '}
                    <Link to="/runs" className="text-[var(--ce-primary)] font-medium hover:underline">
                      Start one
                    </Link>
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={cn('h-11', rowAccent(row.original.status))}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={cn('py-1.5', columnWidthClass(cell.column.id))}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex flex-col gap-2 border-t border-border/60 bg-muted/20 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] text-muted-foreground">
              Page {pagination.pageIndex + 1} of {Math.max(1, totalPages || 1)}
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={pagination.pageIndex <= 0}
                onClick={() => setPagination((p) => ({ ...p, pageIndex: p.pageIndex - 1 }))}
              >
                <ChevronLeft className="size-3.5" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={pagination.pageIndex >= totalPages - 1 || totalPages === 0}
                onClick={() => setPagination((p) => ({ ...p, pageIndex: p.pageIndex + 1 }))}
              >
                Next
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
