/**
 * Default Skyvern `navigation_goal` strings when `actionInstruction` is unset.
 * Keep in sync with `apps/api/.../skyvern-workflow-api.mapper.ts` → `buildSkyvernWorkflowApiPayload`.
 */

import type { RecordedNavigationAction } from '@/hooks/useNavigationRecording';

export function resolveSemanticLabel(action: RecordedNavigationAction): string {
  if (action.elementText?.trim()) return action.elementText.trim();
  if (action.ariaLabel?.trim()) return action.ariaLabel.trim();
  if (action.elementId?.trim()) return action.elementId.trim();
  if (action.x != null && action.y != null) {
    return `Element at (${Math.round(action.x)}, ${Math.round(action.y)})`;
  }
  return 'Unknown element';
}

function cleanVariableKeyFromStored(stored: string | null | undefined): string {
  const s = (stored ?? '').trim();
  const m = s.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  return (m ? m[1] : s).trim();
}

function skyvernMustacheText(key: string): string {
  return `{{${key}}}`;
}

/**
 * The workflow API goal Skyvern would use if the user has not set `actionInstruction`.
 */
export function defaultSkyvernNavigationGoal(
  action: RecordedNavigationAction,
  navigationUrl: string,
): string | null {
  switch (action.actionType) {
    case 'navigate': {
      const url = action.inputValue ?? action.pageUrl ?? navigationUrl;
      return `Navigate to ${url} and wait for the page to load. The task is complete once the page has loaded.`;
    }
    case 'click': {
      const caption = action.inputValue?.trim() || resolveSemanticLabel(action);
      return `Click on: ${caption}`;
    }
    case 'type': {
      const caption = resolveSemanticLabel(action);
      const text = action.inputValue ?? '';
      return `In the field "${caption}", type the text: ${text}`;
    }
    case 'variable_input': {
      const key = cleanVariableKeyFromStored(action.inputValue);
      const caption = resolveSemanticLabel(action);
      const paramRef = key ? skyvernMustacheText(key) : '(empty)';
      return `In the field "${caption}", enter the workflow parameter value ${paramRef}`;
    }
    case 'prompt': {
      const caption = (action.inputValue ?? '').trim() || 'AI-guided click';
      return `Click: ${caption}`;
    }
    case 'prompt_type': {
      const key = cleanVariableKeyFromStored(action.inputValue);
      const caption = action.elementText?.trim() || resolveSemanticLabel(action);
      const paramRef = key ? skyvernMustacheText(key) : '(empty)';
      return `In the field "${caption}", enter the workflow parameter value ${paramRef}`;
    }
    default:
      return null;
  }
}
