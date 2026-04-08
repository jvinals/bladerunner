import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  HelpCircle,
  Hourglass,
  Loader2,
  PauseCircle,
  Radio,
  User,
  Wifi,
  WifiOff,
  XCircle,
  Zap,
} from 'lucide-react';
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
  RECORDING: 'bg-[#4B90FF] text-white',
  PAUSED: 'bg-amber-500 text-white',
  COMPLETED: 'bg-[#56A34A] text-white',
  FAILED: 'bg-[#FF4D4D] text-white',
  CANCELLED: 'bg-gray-400 text-white',
  QUEUED: 'bg-gray-200 text-gray-700',
  RUNNING: 'bg-[#4B90FF] text-white',
  WAITING_FOR_HUMAN: 'bg-violet-500 text-white',
  WAITING_FOR_REVIEW: 'bg-sky-600 text-white',
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
  RECORDING: 'Recording',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  QUEUED: 'Queued',
  RUNNING: 'Running',
  WAITING_FOR_HUMAN: 'Needs input',
  WAITING_FOR_REVIEW: 'Review pause',
};

/** Icons for compact (narrow viewport) status display — keys align with STATUS_LABELS / STATUS_STYLES. */
const STATUS_ICONS: Record<string, LucideIcon> = {
  passed: CheckCircle2,
  failed: XCircle,
  running: Loader2,
  queued: Clock,
  needs_review: AlertTriangle,
  cancelled: Ban,
  active: CheckCircle2,
  online: Wifi,
  inactive: WifiOff,
  offline: WifiOff,
  pending: Hourglass,
  busy: Zap,
  error: AlertCircle,
  RECORDING: Radio,
  PAUSED: PauseCircle,
  COMPLETED: CheckCircle2,
  FAILED: XCircle,
  CANCELLED: Ban,
  QUEUED: Clock,
  RUNNING: Loader2,
  WAITING_FOR_HUMAN: User,
  WAITING_FOR_REVIEW: Eye,
};

interface StatusBadgeProps {
  status: string;
  className?: string;
  size?: 'sm' | 'default';
  /** Below `sm`, render a status icon instead of the full label (table density on small viewports). */
  narrowAsIcon?: boolean;
}

export function StatusBadge({
  status,
  className,
  size = 'default',
  narrowAsIcon = false,
}: StatusBadgeProps) {
  const label = STATUS_LABELS[status] || status;
  const Icon = STATUS_ICONS[status] ?? HelpCircle;
  const styleClass = STATUS_STYLES[status] || 'bg-gray-100 text-gray-600';

  if (narrowAsIcon) {
    const iconSize = size === 'sm' ? 'size-3.5' : 'size-4';
    const isSpinning = status === 'RUNNING' || status === 'running';
    return (
      <span
        title={label}
        aria-label={label}
        className={cn(
          'inline-flex items-center justify-center rounded-full font-medium',
          size === 'sm'
            ? 'min-h-[1.375rem] min-w-[1.375rem] p-0.5 text-[10px] sm:min-h-0 sm:min-w-0 sm:px-2 sm:py-0.5'
            : 'min-h-7 min-w-7 p-1 text-xs sm:min-h-0 sm:min-w-0 sm:px-3 sm:py-1',
          styleClass,
          className,
        )}
      >
        <Icon
          className={cn(iconSize, 'shrink-0 sm:hidden', isSpinning && 'animate-spin')}
          aria-hidden
        />
        <span className="hidden max-w-[10rem] truncate sm:inline">{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-medium whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-3 py-1 text-xs',
        styleClass,
        className,
      )}
    >
      {label}
    </span>
  );
}
