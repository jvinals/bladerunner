import { cn } from '@/lib/utils';
import { Loader2, AlertCircle, Inbox } from 'lucide-react';

interface LoadingStateProps {
  message?: string;
  className?: string;
}

export function LoadingState({ message = 'Loading...', className }: LoadingStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-gray-400', className)}>
      <Loader2 size={24} className="animate-spin text-[#4B90FF] mb-3" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ message = 'Something went wrong', onRetry, className }: ErrorStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16', className)}>
      <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-3">
        <AlertCircle size={20} className="text-[#FF4D4D]" />
      </div>
      <p className="text-sm text-gray-600 mb-3">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-sm text-[#4B90FF] font-medium hover:underline"
        >
          Try again
        </button>
      )}
    </div>
  );
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16', className)}>
      <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-3">
        {icon || <Inbox size={20} className="text-gray-300" />}
      </div>
      <p className="text-sm font-medium text-gray-700 mb-1">{title}</p>
      {description && <p className="text-xs text-gray-400 mb-4 max-w-sm text-center">{description}</p>}
      {action}
    </div>
  );
}
