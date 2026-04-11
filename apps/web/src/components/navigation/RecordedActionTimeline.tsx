/**
 * Sidebar timeline showing the sequence of recorded navigation actions.
 * Each action is displayed with an icon, semantic label, and sequence number.
 */

import { MousePointerClick, Type, Navigation as NavigationIcon, Variable } from 'lucide-react';
import type { RecordedNavigationAction } from '@/hooks/useNavigationRecording';

interface RecordedActionTimelineProps {
  actions: RecordedNavigationAction[];
}

function actionIcon(type: string) {
  switch (type) {
    case 'click':
      return <MousePointerClick size={14} className="text-blue-500 shrink-0" />;
    case 'type':
      return <Type size={14} className="text-emerald-500 shrink-0" />;
    case 'variable_input':
      return <Variable size={14} className="text-violet-500 shrink-0" />;
    case 'navigate':
      return <NavigationIcon size={14} className="text-amber-500 shrink-0" />;
    default:
      return <MousePointerClick size={14} className="text-gray-400 shrink-0" />;
  }
}

function actionLabel(action: RecordedNavigationAction): string {
  switch (action.actionType) {
    case 'navigate':
      return action.inputValue ?? action.pageUrl ?? 'Navigate';
    case 'click':
      return action.elementText?.slice(0, 60) || action.ariaLabel || action.elementId || `Click (${Math.round(action.x ?? 0)}, ${Math.round(action.y ?? 0)})`;
    case 'type':
      return action.inputValue?.slice(0, 40) || 'Type text';
    case 'variable_input':
      return action.inputValue || 'Variable';
    default:
      return 'Action';
  }
}

export function RecordedActionTimeline({ actions }: RecordedActionTimelineProps) {
  if (actions.length === 0) {
    return (
      <p className="text-xs text-gray-400 px-3 py-4 text-center">
        No actions recorded yet. Click on the browser to begin.
      </p>
    );
  }

  return (
    <div className="overflow-y-auto max-h-[600px]">
      <ul className="divide-y divide-gray-50">
        {actions.map((action) => (
          <li
            key={action.sequence}
            className="flex items-start gap-2.5 px-3 py-2.5 text-xs"
          >
            <span className="mt-0.5 flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-[10px] font-medium text-gray-500 shrink-0">
              {action.sequence}
            </span>
            {actionIcon(action.actionType)}
            <div className="min-w-0 flex-1">
              <p className="text-gray-800 truncate font-medium">{actionLabel(action)}</p>
              {action.actionType !== 'navigate' && action.pageUrl && (
                <p className="text-[10px] text-gray-400 truncate mt-0.5">{action.pageUrl}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
