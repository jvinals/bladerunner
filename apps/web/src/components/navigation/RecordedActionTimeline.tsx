/**
 * Sidebar timeline showing the sequence of recorded navigation actions.
 * Refined anytime: click a row to expand static vs dynamic editing; dynamic * stores a clean variable key (no mustache) — UI shows {{ key }} in the pill.
 */

import { useEffect, useState } from 'react';
import {
  MousePointerClick,
  Type,
  Navigation as NavigationIcon,
  Variable,
  MessageSquareText,
  Braces,
  Sparkles,
  Check,
  X,
} from 'lucide-react';
import type {
  RecordedNavigationAction,
  NavigationAuditSuggestion,
} from '@/hooks/useNavigationRecording';

interface RecordedActionTimelineProps {
  actions: RecordedNavigationAction[];
  onUpdateAction: (sequence: number, updates: Partial<RecordedNavigationAction>) => void;
  auditSuggestions?: Record<number, NavigationAuditSuggestion>;
  onAcceptAuditSuggestion?: (sequence: number) => void;
  onRejectAuditSuggestion?: (sequence: number) => void;
}

function stripMustache(raw: string): string {
  return raw.trim().replace(/^\{+|\}+$/g, '').trim();
}

function formatVariablePill(cleanKey: string): string {
  const k = stripMustache(cleanKey);
  return k ? `{{ ${k} }}` : '{{ }}';
}

/** Braces icon only for variable / prompt-style steps, not refined click instructions. */
function actionIcon(type: string, useBracesOverlay: boolean) {
  if (useBracesOverlay) {
    return <Braces size={14} className="text-violet-600 shrink-0" />;
  }
  switch (type) {
    case 'click':
      return <MousePointerClick size={14} className="text-blue-500 shrink-0" />;
    case 'type':
      return <Type size={14} className="text-emerald-500 shrink-0" />;
    case 'variable_input':
      return <Variable size={14} className="text-violet-500 shrink-0" />;
    case 'prompt':
      return <MessageSquareText size={14} className="text-rose-500 shrink-0" />;
    case 'prompt_type':
      return <Sparkles size={14} className="text-indigo-500 shrink-0" />;
    case 'navigate':
      return <NavigationIcon size={14} className="text-amber-500 shrink-0" />;
    default:
      return <MousePointerClick size={14} className="text-gray-400 shrink-0" />;
  }
}

function defaultClickCaption(action: RecordedNavigationAction): string {
  return (
    action.elementText?.trim() ||
    action.ariaLabel ||
    action.elementId ||
    `Click (${Math.round(action.x ?? 0)}, ${Math.round(action.y ?? 0)})`
  );
}

function actionLabel(action: RecordedNavigationAction): string {
  switch (action.actionType) {
    case 'navigate':
      return action.inputValue ?? action.pageUrl ?? 'Navigate';
    case 'click': {
      const custom = action.inputValue?.trim();
      if (custom) return custom.slice(0, 80);
      return defaultClickCaption(action).slice(0, 60);
    }
    case 'type':
      return action.inputValue?.slice(0, 40) || 'Type text';
    case 'variable_input':
    case 'prompt_type':
      return formatVariablePill(action.inputValue ?? '');
    case 'prompt':
      return action.inputValue?.slice(0, 60) || 'Prompt';
    default:
      return 'Action';
  }
}

function isVariableStyleRefinement(action: RecordedNavigationAction): boolean {
  return (
    action.actionType === 'variable_input' ||
    action.actionType === 'prompt_type' ||
    action.actionType === 'prompt' ||
    action.inputMode === 'variable'
  );
}

function isRefinedHighlight(action: RecordedNavigationAction): boolean {
  return (
    isVariableStyleRefinement(action) ||
    (action.actionType === 'click' && !!action.inputValue?.trim())
  );
}

function supportsStaticDynamicTabs(action: RecordedNavigationAction): boolean {
  return action.actionType === 'type' || action.actionType === 'variable_input';
}

function isPromptInstructionRow(action: RecordedNavigationAction): boolean {
  return action.actionType === 'prompt';
}

function isPromptTypeRow(action: RecordedNavigationAction): boolean {
  return action.actionType === 'prompt_type';
}

function isClickRefineRow(action: RecordedNavigationAction): boolean {
  return action.actionType === 'click';
}

type DynamicCompileMode = 'variable_input' | 'prompt_type';

interface InlineEditorProps {
  action: RecordedNavigationAction;
  onUpdate: (updates: Partial<RecordedNavigationAction>) => void;
}

function TimelineInlineEditor({ action, onUpdate }: InlineEditorProps) {
  const [tab, setTab] = useState<'static' | 'variable'>(() =>
    action.actionType === 'type' ? 'static' : 'variable',
  );
  const [staticText, setStaticText] = useState(() =>
    action.actionType === 'type' ? (action.inputValue ?? '') : '',
  );
  const [varName, setVarName] = useState(() =>
    action.actionType === 'variable_input' || action.actionType === 'prompt_type'
      ? stripMustache(action.inputValue ?? '')
      : '',
  );
  const [compileAs, setCompileAs] = useState<DynamicCompileMode>(() =>
    action.actionType === 'prompt_type' ? 'prompt_type' : 'variable_input',
  );

  useEffect(() => {
    if (action.actionType === 'type') {
      setTab('static');
      setStaticText(action.inputValue ?? '');
    } else if (action.actionType === 'variable_input') {
      setTab('variable');
      setVarName(stripMustache(action.inputValue ?? ''));
      setCompileAs('variable_input');
    }
  }, [action.sequence, action.actionType, action.inputValue]);

  const pushStatic = (text: string) => {
    onUpdate({
      actionType: 'type',
      inputMode: 'static',
      inputValue: text,
    });
  };

  const pushVariable = (name: string, mode: DynamicCompileMode) => {
    const clean = stripMustache(name);
    onUpdate({
      actionType: mode,
      inputMode: 'variable',
      inputValue: clean,
    });
  };

  if (supportsStaticDynamicTabs(action)) {
    return (
      <div className="mt-2 space-y-2 rounded-lg border border-violet-100 bg-violet-50/40 p-2.5">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              setTab('static');
              pushStatic(staticText);
            }}
            className={`flex-1 rounded-md px-2 py-1 text-[10px] font-medium ${
              tab === 'static'
                ? 'bg-white text-violet-800 shadow-sm ring-1 ring-violet-200'
                : 'text-gray-600 hover:bg-white/60'
            }`}
          >
            Static value
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('variable');
              if (varName.trim()) {
                pushVariable(varName, compileAs);
              }
            }}
            className={`flex-1 rounded-md px-2 py-1 text-[10px] font-medium ${
              tab === 'variable'
                ? 'bg-white text-violet-800 shadow-sm ring-1 ring-violet-200'
                : 'text-gray-600 hover:bg-white/60'
            }`}
          >
            Dynamic variable
          </button>
        </div>
        {tab === 'static' ? (
          <label className="block space-y-1">
            <span className="text-[10px] font-medium text-gray-600">Value</span>
            <input
              type="text"
              value={staticText}
              onChange={(e) => setStaticText(e.target.value)}
              onBlur={() => pushStatic(staticText)}
              className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-900"
            />
          </label>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-[10px] font-medium text-gray-600">Variable name</span>
              <input
                type="text"
                value={varName}
                onChange={(e) => setVarName(e.target.value)}
                onBlur={() => varName.trim() && pushVariable(varName, compileAs)}
                placeholder="e.g. patient_email"
                className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-900"
              />
            </label>
            {tab === 'variable' ? (
              <label className="flex items-center gap-2 text-[10px] text-gray-600">
                <span className="shrink-0">Compile as</span>
                <select
                  value={compileAs}
                  onChange={(e) => {
                    const m = e.target.value as DynamicCompileMode;
                    setCompileAs(m);
                    if (varName.trim()) pushVariable(varName, m);
                  }}
                  className="flex-1 rounded border border-gray-200 bg-white px-1.5 py-1 text-[10px]"
                >
                  <option value="variable_input">Semantic label (default)</option>
                  <option value="prompt_type">Field label (element text)</option>
                </select>
              </label>
            ) : null}
            {varName.trim() ? (
              <p className="text-[10px] text-violet-700 font-mono">{formatVariablePill(varName)}</p>
            ) : null}
          </>
        )}
      </div>
    );
  }

  if (isPromptInstructionRow(action)) {
    return (
      <div className="mt-2 space-y-2 rounded-lg border border-rose-100 bg-rose-50/40 p-2.5">
        <label className="block space-y-1">
          <span className="text-[10px] font-medium text-gray-700">Edit AI Instruction</span>
          <textarea
            value={action.inputValue ?? ''}
            onChange={(e) => onUpdate({ inputValue: e.target.value })}
            rows={3}
            className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-900"
          />
        </label>
      </div>
    );
  }

  if (isPromptTypeRow(action)) {
    const v = stripMustache(action.inputValue ?? '');
    return (
      <div className="mt-2 space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-2.5">
        <label className="block space-y-1">
          <span className="text-[10px] font-medium text-gray-700">Edit AI Instruction</span>
          <input
            type="text"
            value={v}
            onChange={(e) =>
              onUpdate({
                inputValue: stripMustache(e.target.value),
                inputMode: 'variable',
                actionType: 'prompt_type',
              })
            }
            className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-900"
          />
        </label>
        {v ? (
          <p className="text-[10px] text-indigo-800 font-mono">{formatVariablePill(v)}</p>
        ) : null}
      </div>
    );
  }

  if (isClickRefineRow(action)) {
    const detected = defaultClickCaption(action);
    return (
      <div className="mt-2 space-y-2 rounded-lg border border-sky-100 bg-sky-50/50 p-2.5">
        <label className="block space-y-1">
          <span className="text-[10px] font-medium text-gray-700">Refine click instruction</span>
          <textarea
            value={action.inputValue ?? ''}
            onChange={(e) =>
              onUpdate({
                inputValue: e.target.value.trim() === '' ? null : e.target.value,
              })
            }
            placeholder="e.g. Pick the next available day"
            rows={3}
            className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-900 placeholder:text-gray-400"
          />
        </label>
        <p className="text-[10px] text-gray-500">
          <span className="font-medium text-gray-600">Detected: </span>
          <span className="text-gray-600">{detected.slice(0, 120)}</span>
          {detected.length > 120 ? '…' : ''}
        </p>
        <p className="text-[10px] text-gray-500">
          Leave blank to use the detected label in the exported workflow.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50/80 p-2.5 text-[10px] text-gray-500">
      This step has no text or variable to edit here.
    </div>
  );
}

export function RecordedActionTimeline({
  actions,
  onUpdateAction,
  auditSuggestions = {},
  onAcceptAuditSuggestion,
  onRejectAuditSuggestion,
}: RecordedActionTimelineProps) {
  const [expandedSequence, setExpandedSequence] = useState<number | null>(null);

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
        {actions.map((action) => {
          const refined = isRefinedHighlight(action);
          const expanded = expandedSequence === action.sequence;
          const audit = auditSuggestions[action.sequence];
          const rowBg = refined
            ? action.actionType === 'click' && action.inputValue?.trim()
              ? 'bg-sky-50/80 hover:bg-sky-50'
              : 'bg-violet-50/70 hover:bg-violet-50'
            : audit
              ? 'bg-amber-50/60 hover:bg-amber-50/80'
              : 'hover:bg-gray-50/80';

          return (
            <li key={action.sequence}>
              <button
                type="button"
                onClick={() =>
                  setExpandedSequence(expanded ? null : action.sequence)
                }
                className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-xs transition-colors ${rowBg}`}
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[10px] font-medium text-gray-500">
                  {action.sequence}
                </span>
                {actionIcon(action.actionType, isVariableStyleRefinement(action))}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-800">{actionLabel(action)}</p>
                  {action.actionType !== 'navigate' && action.pageUrl && (
                    <p className="mt-0.5 truncate text-[10px] text-gray-400">{action.pageUrl}</p>
                  )}
                </div>
              </button>
              {audit && onAcceptAuditSuggestion && onRejectAuditSuggestion ? (
                <div className="space-y-2 border-b border-amber-100 bg-amber-50/40 px-3 py-2">
                  <p className="text-[10px] text-amber-900">{audit.warning}</p>
                  <p className="text-[10px] text-gray-700 font-mono whitespace-pre-wrap break-words">
                    {audit.suggestedPrompt}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onAcceptAuditSuggestion(action.sequence)}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-[10px] font-medium text-white hover:bg-emerald-700"
                    >
                      <Check size={12} strokeWidth={2.5} aria-hidden />
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() => onRejectAuditSuggestion(action.sequence)}
                      className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-[10px] font-medium text-white hover:bg-blue-700"
                    >
                      <X size={12} strokeWidth={2.5} aria-hidden />
                      Reject
                    </button>
                  </div>
                </div>
              ) : null}
              {expanded ? (
                <div className="border-t border-gray-100 bg-white px-3 pb-3">
                  <TimelineInlineEditor
                    action={action}
                    onUpdate={(u) => onUpdateAction(action.sequence, u)}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
