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
  Wand2,
  Trash2,
} from 'lucide-react';
import type {
  RecordedNavigationAction,
  NavigationAuditSuggestion,
} from '@/hooks/useNavigationRecording';
import { navigationsApi } from '@/lib/api';
import { defaultSkyvernNavigationGoal } from '@/lib/navigationSkyvernDefaults';
import { ChooseActionPromptModal } from './ChooseActionPromptModal';
import { PlayStepReadOnlyDetail } from './PlayStepReadOnlyDetail';

interface RecordedActionTimelineProps {
  /** Required for Improve with AI and persisting instruction patches when not recording. */
  navigationId?: string;
  /** Navigation base URL — used to show the default Skyvern goal for `navigate` steps. */
  navigationUrl?: string;
  actions: RecordedNavigationAction[];
  onUpdateAction: (sequence: number, updates: Partial<RecordedNavigationAction>) => void;
  auditSuggestions?: Record<number, NavigationAuditSuggestion>;
  onAcceptAuditSuggestion?: (sequence: number) => void;
  onRejectAuditSuggestion?: (sequence: number) => void;
  /** Play mode: list only, no editing or expansion. */
  readOnly?: boolean;
  /**
   * When `readOnly` is true, allow accordion expand for step details (Play) without inline editors.
   */
  readOnlyInteractive?: boolean;
  /**
   * With `readOnly` + `readOnlyInteractive`: allow editing Skyvern action instructions + Improve with AI
   * (same as Record mode for those controls). Requires `navigationId` and a real `onUpdateAction` that persists.
   */
  playInstructionEditing?: boolean;
  /** When set (e.g. Skyvern Play), highlight this action row. */
  highlightSequence?: number | null;
  /** Delete step (REST during idle playback, or socket while recording). */
  onDeleteAction?: (sequence: number) => void;
  /** Disable delete control (e.g. while a Skyvern play run is active). */
  deleteActionDisabled?: boolean;
}

function DeleteStepButton({
  sequence,
  onDelete,
  disabled,
}: {
  sequence: number;
  onDelete?: (sequence: number) => void;
  disabled?: boolean;
}) {
  if (!onDelete) return null;
  return (
    <button
      type="button"
      title="Delete this step"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onDelete(sequence);
      }}
      className="mt-0.5 shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
      aria-label="Delete step"
    >
      <Trash2 size={14} strokeWidth={2} />
    </button>
  );
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

function supportsActionInstruction(action: RecordedNavigationAction): boolean {
  switch (action.actionType) {
    case 'navigate':
    case 'click':
    case 'type':
    case 'variable_input':
    case 'prompt_type':
    case 'prompt':
      return true;
    default:
      return false;
  }
}

type DynamicCompileMode = 'variable_input' | 'prompt_type';

interface InlineEditorProps {
  action: RecordedNavigationAction;
  onUpdate: (updates: Partial<RecordedNavigationAction>) => void;
  navigationId?: string;
  navigationUrl: string;
  improveLoadingSequence: number | null;
  onImproveClick: (action: RecordedNavigationAction) => void;
}

function ActionInstructionEditor({
  action,
  onUpdate,
  navigationId,
  navigationUrl,
  improveLoadingSequence,
  onImproveClick,
}: {
  action: RecordedNavigationAction;
  onUpdate: (updates: Partial<RecordedNavigationAction>) => void;
  navigationId?: string;
  navigationUrl: string;
  improveLoadingSequence: number | null;
  onImproveClick: (action: RecordedNavigationAction) => void;
}) {
  if (!supportsActionInstruction(action)) return null;
  const loading = improveLoadingSequence === action.sequence;
  const defaultGoal = defaultSkyvernNavigationGoal(action, navigationUrl);
  return (
    <div className="mb-2 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
      {defaultGoal ? (
        <div className="space-y-1 rounded-md border border-slate-100 bg-white/90 px-2 py-1.5">
          <p className="text-[10px] font-medium text-gray-600">Default Skyvern goal</p>
          <p className="text-[11px] leading-snug text-gray-800 whitespace-pre-wrap break-words">
            {defaultGoal}
          </p>
          <p className="text-[9px] text-gray-500">
            Used when the override below is empty. Matches the Play / export workflow.
          </p>
        </div>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <label className="min-w-0 flex-1 space-y-1">
          <span className="text-[10px] font-medium text-gray-700">Override (optional)</span>
          <textarea
            value={action.actionInstruction ?? ''}
            onChange={(e) =>
              onUpdate({
                actionInstruction: e.target.value.trim() === '' ? null : e.target.value,
              })
            }
            placeholder="Leave empty to use the default goal above…"
            rows={3}
            className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-[11px] text-gray-900 placeholder:text-gray-400"
          />
        </label>
        <button
          type="button"
          title={navigationId ? 'Improve with AI' : 'Navigation id missing'}
          disabled={!navigationId || loading}
          onClick={() => onImproveClick(action)}
          className="mt-5 shrink-0 rounded-md border border-violet-200 bg-white p-1.5 text-violet-700 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Wand2 size={14} strokeWidth={2} className={loading ? 'animate-pulse' : ''} aria-hidden />
        </button>
      </div>
      <p className="text-[9px] leading-snug text-gray-500">
        One browser action per block. Improve with AI uses the default + step context when the
        override is empty.
      </p>
    </div>
  );
}

function TimelineInlineEditor({
  action,
  onUpdate,
  navigationId,
  navigationUrl,
  improveLoadingSequence,
  onImproveClick,
}: InlineEditorProps) {
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
    } else if (action.actionType === 'prompt_type') {
      setTab('variable');
      setVarName(stripMustache(action.inputValue ?? ''));
      setCompileAs('prompt_type');
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
      <>
        <ActionInstructionEditor
          action={action}
          onUpdate={onUpdate}
          navigationId={navigationId}
          navigationUrl={navigationUrl}
          improveLoadingSequence={improveLoadingSequence}
          onImproveClick={onImproveClick}
        />
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
      </>
    );
  }

  if (isPromptInstructionRow(action)) {
    return (
      <>
        <ActionInstructionEditor
          action={action}
          onUpdate={onUpdate}
          navigationId={navigationId}
          navigationUrl={navigationUrl}
          improveLoadingSequence={improveLoadingSequence}
          onImproveClick={onImproveClick}
        />
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
      </>
    );
  }

  if (isPromptTypeRow(action)) {
    const v = stripMustache(action.inputValue ?? '');
    return (
      <>
        <ActionInstructionEditor
          action={action}
          onUpdate={onUpdate}
          navigationId={navigationId}
          navigationUrl={navigationUrl}
          improveLoadingSequence={improveLoadingSequence}
          onImproveClick={onImproveClick}
        />
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
      </>
    );
  }

  if (isClickRefineRow(action)) {
    const detected = defaultClickCaption(action);
    return (
      <>
        <ActionInstructionEditor
          action={action}
          onUpdate={onUpdate}
          navigationId={navigationId}
          navigationUrl={navigationUrl}
          improveLoadingSequence={improveLoadingSequence}
          onImproveClick={onImproveClick}
        />
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
      </>
    );
  }

  if (action.actionType === 'navigate') {
    const target = (action.inputValue ?? action.pageUrl ?? '').trim();
    return (
      <>
        <ActionInstructionEditor
          action={action}
          onUpdate={onUpdate}
          navigationId={navigationId}
          navigationUrl={navigationUrl}
          improveLoadingSequence={improveLoadingSequence}
          onImproveClick={onImproveClick}
        />
        {target ? (
          <p className="text-[10px] text-gray-600">
            <span className="font-medium text-gray-700">URL: </span>
            <span className="break-all">{target.slice(0, 240)}</span>
            {target.length > 240 ? '…' : ''}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50/80 p-2.5 text-[10px] text-gray-500">
      This step has no text or variable to edit here.
    </div>
  );
}

export function RecordedActionTimeline({
  navigationId,
  navigationUrl = '',
  actions,
  onUpdateAction,
  auditSuggestions = {},
  onAcceptAuditSuggestion,
  onRejectAuditSuggestion,
  readOnly = false,
  readOnlyInteractive = false,
  playInstructionEditing = false,
  highlightSequence = null,
  onDeleteAction,
  deleteActionDisabled = false,
}: RecordedActionTimelineProps) {
  const [expandedSequence, setExpandedSequence] = useState<number | null>(null);
  const [improveLoadingSeq, setImproveLoadingSeq] = useState<number | null>(null);
  const [improveModal, setImproveModal] = useState<{
    sequence: number;
    original: string;
    improved: string;
  } | null>(null);
  const [improveErr, setImproveErr] = useState<string | null>(null);

  useEffect(() => {
    if (!readOnly || !readOnlyInteractive) return;
    if (highlightSequence != null) {
      setExpandedSequence(highlightSequence);
    }
  }, [readOnly, readOnlyInteractive, highlightSequence]);

  useEffect(() => {
    if (expandedSequence == null) return;
    if (!actions.some((a) => a.sequence === expandedSequence)) {
      setExpandedSequence(null);
    }
  }, [actions, expandedSequence]);

  const handleImproveClick = async (action: RecordedNavigationAction) => {
    if (!navigationId) return;
    const override = (action.actionInstruction ?? '').trim();
    const draftForImprove =
      override || defaultSkyvernNavigationGoal(action, navigationUrl) || '';
    setImproveErr(null);
    setImproveLoadingSeq(action.sequence);
    try {
      const res = await navigationsApi.improveActionInstruction(navigationId, {
        draft: draftForImprove,
        sequence: action.sequence,
        actionType: action.actionType,
        elementText: action.elementText,
        ariaLabel: action.ariaLabel,
        inputValue: action.inputValue,
        pageUrl: action.pageUrl,
      });
      setImproveModal({
        sequence: action.sequence,
        original: draftForImprove,
        improved: res.improved,
      });
    } catch (e) {
      setImproveErr(e instanceof Error ? e.message : 'Could not improve instruction');
    } finally {
      setImproveLoadingSeq(null);
    }
  };

  if (actions.length === 0) {
    return (
      <p className="text-xs text-gray-400 px-3 py-4 text-center">
        {readOnly
          ? 'No actions in this navigation yet.'
          : 'No actions recorded yet. Click on the browser to begin.'}
      </p>
    );
  }

  return (
    <>
      {improveErr && (!readOnly || playInstructionEditing) ? (
        <p className="border-b border-red-100 px-3 py-2 text-[11px] text-red-600">{improveErr}</p>
      ) : null}
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

          const playHere =
            readOnly && highlightSequence != null && action.sequence === highlightSequence;

          if (readOnly && !readOnlyInteractive) {
            return (
              <li key={action.sequence}>
                <div
                  className={`flex w-full items-start gap-1 px-3 py-2.5 text-left text-xs ${rowBg} ${
                    playHere
                      ? 'ring-2 ring-emerald-500/80 ring-inset bg-emerald-50/90 shadow-sm'
                      : ''
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                        playHere
                          ? 'bg-emerald-600 text-white'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {action.sequence}
                    </span>
                    {actionIcon(action.actionType, isVariableStyleRefinement(action))}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-gray-800">{actionLabel(action)}</p>
                      {action.actionType !== 'navigate' && action.pageUrl && (
                        <p className="mt-0.5 truncate text-[10px] text-gray-400">{action.pageUrl}</p>
                      )}
                    </div>
                  </div>
                  <DeleteStepButton
                    sequence={action.sequence}
                    onDelete={onDeleteAction}
                    disabled={deleteActionDisabled}
                  />
                </div>
              </li>
            );
          }

          if (readOnly && readOnlyInteractive) {
            return (
              <li key={action.sequence}>
                <div className="flex w-full items-start gap-1 px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => setExpandedSequence(expanded ? null : action.sequence)}
                    className={`flex min-w-0 flex-1 items-start gap-2.5 text-left text-xs transition-colors ${rowBg} rounded-md px-0 py-0 ${
                      playHere
                        ? 'ring-2 ring-emerald-500/80 ring-inset bg-emerald-50/90 shadow-sm'
                        : ''
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium ${
                        playHere
                          ? 'bg-emerald-600 text-white'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
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
                  <DeleteStepButton
                    sequence={action.sequence}
                    onDelete={onDeleteAction}
                    disabled={deleteActionDisabled}
                  />
                </div>
                {expanded ? (
                  playInstructionEditing ? (
                    <div className="border-t border-gray-100 bg-white px-3 pb-3 pt-2 space-y-2">
                      {supportsActionInstruction(action) ? (
                        <ActionInstructionEditor
                          action={action}
                          onUpdate={(u) => onUpdateAction(action.sequence, u)}
                          navigationId={navigationId}
                          navigationUrl={navigationUrl}
                          improveLoadingSequence={improveLoadingSeq}
                          onImproveClick={handleImproveClick}
                        />
                      ) : null}
                      <PlayStepReadOnlyDetail
                        action={action}
                        navigationUrl={navigationUrl}
                        variant={
                          supportsActionInstruction(action) ? 'recordedFieldsOnly' : 'full'
                        }
                      />
                    </div>
                  ) : (
                    <PlayStepReadOnlyDetail action={action} navigationUrl={navigationUrl} />
                  )
                ) : null}
              </li>
            );
          }

          return (
            <li key={action.sequence}>
              <div className="flex w-full items-start gap-1 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedSequence(expanded ? null : action.sequence)
                  }
                  className={`flex min-w-0 flex-1 items-start gap-2.5 text-left text-xs transition-colors ${rowBg} rounded-md px-0 py-0`}
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
                <DeleteStepButton
                  sequence={action.sequence}
                  onDelete={onDeleteAction}
                  disabled={deleteActionDisabled}
                />
              </div>
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
                    navigationId={navigationId}
                    navigationUrl={navigationUrl}
                    improveLoadingSequence={improveLoadingSeq}
                    onImproveClick={handleImproveClick}
                    onUpdate={(u) => onUpdateAction(action.sequence, u)}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
      <ChooseActionPromptModal
        open={improveModal !== null}
        onOpenChange={(open) => {
          if (!open) setImproveModal(null);
        }}
        originalText={improveModal?.original ?? ''}
        improvedText={improveModal?.improved ?? ''}
        onCancel={() => setImproveModal(null)}
        onUse={(choice) => {
          if (!improveModal) return;
          const text = choice === 'improved' ? improveModal.improved : improveModal.original;
          onUpdateAction(improveModal.sequence, {
            actionInstruction: text.trim() === '' ? null : text,
          });
          setImproveModal(null);
        }}
      />
    </>
  );
}
