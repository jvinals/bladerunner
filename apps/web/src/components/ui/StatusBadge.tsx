import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  passed: 'bg-[#56A34A] text-white',
  failed: 'bg-[#FF4D4D] text-white',
  running: 'bg-[#4B90FF] text-white',
  queued: 'bg-gray-200 text-gray-600',
  needs_review: 'bg-[#EAB508] text-white',
  cancelled: 'bg-gray-400 text-white',
  // Integration / Agent statuses
  active: 'bg-[#56A34A] text-white',
  online: 'bg-[#56A34A] text-white',
  inactive: 'bg-gray-300 text-gray-600',
  offline: 'bg-gray-300 text-gray-600',
  pending: 'bg-[#EAB508] text-white',
  busy: 'bg-[#4B90FF] text-white',
  error: 'bg-[#FF4D4D] text-white',
};

const STATUS_LABELS: Record<string, string> = {
  passed: 'Passed',
  failed: 'Failed',
  running: 'Running',
  queued: 'Queued',
  needs_review: 'Needs Review',
  cancelled: 'Cancelled',
  active: 'Active',
  online: 'Online',
  inactive: 'Inactive',
  offline: 'Offline',
  pending: 'Pending',
  busy: 'Busy',
  error: 'Error',
};

interface StatusBadgeProps {
  status: string;
  className?: string;
  size?: 'sm' | 'default';
}

export function StatusBadge({ status, className, size = 'default' }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs',
        STATUS_STYLES[status] || 'bg-gray-100 text-gray-600',
        className
      )}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}
