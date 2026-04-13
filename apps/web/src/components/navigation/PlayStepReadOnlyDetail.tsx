/**
 * Read-only expanded content for a navigation step in Play mode.
 */

import type { RecordedNavigationAction } from '@/hooks/useNavigationRecording';
import { defaultSkyvernNavigationGoal } from '@/lib/navigationSkyvernDefaults';

export interface PlayStepReadOnlyDetailProps {
  action: RecordedNavigationAction;
  navigationUrl: string;
  /**
   * When the parent shows `ActionInstructionEditor` (e.g. Play mode editing), skip duplicate
   * default-goal / override blocks and only show step meta + recorded fields.
   */
  variant?: 'full' | 'recordedFieldsOnly';
}

export function PlayStepReadOnlyDetail({
  action,
  navigationUrl,
  variant = 'full',
}: PlayStepReadOnlyDetailProps) {
  const defaultGoal = defaultSkyvernNavigationGoal(action, navigationUrl);
  const override = action.actionInstruction?.trim() ?? '';
  const showGoals = variant === 'full';

  return (
    <div className="space-y-2 border-t border-gray-100 bg-white px-3 pb-3 pt-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-700">
          {action.actionType}
        </span>
        <span className="text-[10px] text-gray-500">Step {action.sequence}</span>
      </div>

      {showGoals && defaultGoal ? (
        <div className="rounded-md border border-slate-100 bg-slate-50/80 px-2 py-1.5">
          <p className="text-[10px] font-medium text-gray-600">Default Skyvern goal</p>
          <p className="mt-1 text-[11px] leading-snug text-gray-800 whitespace-pre-wrap break-words">
            {defaultGoal}
          </p>
        </div>
      ) : null}

      {showGoals ? (
        <div className="rounded-md border border-violet-100 bg-violet-50/40 px-2 py-1.5">
          <p className="text-[10px] font-medium text-gray-700">Action instruction override</p>
          {override ? (
            <p className="mt-1 text-[11px] leading-snug text-gray-900 whitespace-pre-wrap break-words">
              {override}
            </p>
          ) : (
            <p className="mt-1 text-[10px] text-gray-500">No override — default goal above is used.</p>
          )}
        </div>
      ) : null}

      <details className="group rounded-md border border-gray-100 bg-gray-50/50">
        <summary className="cursor-pointer select-none px-2 py-1.5 text-[10px] font-medium text-gray-600">
          Recorded fields
        </summary>
        <dl className="space-y-1 px-2 pb-2 pt-0 text-[10px] text-gray-700">
          {action.pageUrl ? (
            <>
              <dt className="text-gray-500">pageUrl</dt>
              <dd className="break-all font-mono">{action.pageUrl}</dd>
            </>
          ) : null}
          {action.elementText ? (
            <>
              <dt className="text-gray-500">elementText</dt>
              <dd className="break-words">{action.elementText}</dd>
            </>
          ) : null}
          {action.ariaLabel ? (
            <>
              <dt className="text-gray-500">ariaLabel</dt>
              <dd className="break-words">{action.ariaLabel}</dd>
            </>
          ) : null}
          {action.elementId ? (
            <>
              <dt className="text-gray-500">elementId</dt>
              <dd className="break-all font-mono">{action.elementId}</dd>
            </>
          ) : null}
          {action.inputValue != null && action.inputValue !== '' ? (
            <>
              <dt className="text-gray-500">inputValue</dt>
              <dd className="break-words font-mono">{action.inputValue}</dd>
            </>
          ) : null}
          {action.x != null && action.y != null ? (
            <>
              <dt className="text-gray-500">Coordinates</dt>
              <dd>
                ({Math.round(action.x)}, {Math.round(action.y)})
              </dd>
            </>
          ) : null}
          {action.elementTag ? (
            <>
              <dt className="text-gray-500">elementTag</dt>
              <dd className="font-mono">{action.elementTag}</dd>
            </>
          ) : null}
        </dl>
      </details>
    </div>
  );
}
