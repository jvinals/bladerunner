/**
 * Compiles a list of recorded NavigationActions into a Skyvern-compatible
 * Workflow JSON structure.
 *
 * Skyvern is a Vision LLM engine — it uses **semantic labels** and natural-
 * language descriptions, NOT brittle DOM selectors or element IDs. Every block
 * label is resolved through a human-readability priority chain:
 *
 *   elementText > ariaLabel > placeholder > name > elementId > coordinate fallback
 *
 * Scroll events are ephemeral and never reach this compiler.
 *
 * Variable placeholders: `inputValue` stores the **clean** parameter key (no
 * mustache). Output JSON uses `"text": "{{key}}"`.
 */

import type { RecordedNavigationAction } from './navigation-recording.service';

// ---------------------------------------------------------------------------
// Skyvern Workflow types
// ---------------------------------------------------------------------------

export interface SkyvernParameter {
  key: string;
  parameter_type: 'workflow';
  default_value: string;
}

export interface SkyvernBlock {
  block_type: 'navigation' | 'action';
  label: string;
  url?: string;
  action_type?: 'click' | 'input_text';
  text?: string;
}

export interface SkyvernWorkflow {
  workflow_id: string;
  title: string;
  parameters: SkyvernParameter[];
  blocks: SkyvernBlock[];
}

// ---------------------------------------------------------------------------
// Semantic label resolution
// ---------------------------------------------------------------------------

/** Normalize DB value: strip legacy `{{name}}` wrappers to a clean workflow key. */
export function cleanVariableKeyFromStored(stored: string | null | undefined): string {
  const s = (stored ?? '').trim();
  const m = s.match(/^\{\{\s*([^}]+?)\s*\}\}$/);
  return (m ? m[1] : s).trim();
}

function skyvernMustacheText(key: string): string {
  return `{{${key}}}`;
}

/**
 * Derive the most human-readable label from action metadata.
 *
 * Priority: elementText > ariaLabel > placeholder (stored in ariaLabel
 * fallback during recording) > name attribute (not stored separately —
 * captured as part of elementId heuristic) > elementId > coordinate fallback.
 */
export function resolveSemanticLabel(action: RecordedNavigationAction): string {
  if (action.elementText?.trim()) return action.elementText.trim();
  if (action.ariaLabel?.trim()) return action.ariaLabel.trim();
  if (action.elementId?.trim()) return action.elementId.trim();
  if (action.x != null && action.y != null) {
    return `Element at (${Math.round(action.x)}, ${Math.round(action.y)})`;
  }
  return 'Unknown element';
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

/**
 * Compile recorded navigation actions into a Skyvern Workflow JSON.
 *
 * @param navigation - The parent navigation record (id + name + url).
 * @param actions    - Ordered list of recorded actions (scroll excluded).
 * @returns A complete SkyvernWorkflow ready for JSON serialization.
 */
export function compileToSkyvernWorkflow(
  navigation: { id: string; name: string; url: string },
  actions: RecordedNavigationAction[],
): SkyvernWorkflow {
  const blocks: SkyvernBlock[] = [];
  const variableNames = new Set<string>();

  for (const action of actions) {
    switch (action.actionType) {
      case 'navigate': {
        blocks.push({
          block_type: 'navigation',
          label: `Navigate to ${action.inputValue ?? action.pageUrl ?? navigation.url}`,
          url: action.inputValue ?? action.pageUrl ?? navigation.url,
        });
        break;
      }

      case 'click': {
        const label =
          action.inputValue?.trim() || resolveSemanticLabel(action);
        blocks.push({
          block_type: 'action',
          action_type: 'click',
          label,
        });
        break;
      }

      case 'type': {
        blocks.push({
          block_type: 'action',
          action_type: 'input_text',
          label: resolveSemanticLabel(action),
          text: action.inputValue ?? '',
        });
        break;
      }

      case 'variable_input': {
        const key = cleanVariableKeyFromStored(action.inputValue);
        if (key) {
          variableNames.add(key);
        }
        blocks.push({
          block_type: 'action',
          action_type: 'input_text',
          label: resolveSemanticLabel(action),
          text: key ? skyvernMustacheText(key) : '',
        });
        break;
      }

      case 'prompt': {
        const label = (action.inputValue ?? '').trim() || 'AI prompt step';
        blocks.push({
          block_type: 'action',
          action_type: 'click',
          label,
        });
        break;
      }

      case 'prompt_type': {
        const key = cleanVariableKeyFromStored(action.inputValue);
        if (key) {
          variableNames.add(key);
        }
        const label =
          action.elementText?.trim() || resolveSemanticLabel(action);
        blocks.push({
          block_type: 'action',
          action_type: 'input_text',
          label,
          text: key ? skyvernMustacheText(key) : '',
        });
        break;
      }

      default:
        break;
    }
  }

  const parameters: SkyvernParameter[] = [...variableNames].sort().map((key) => ({
    key,
    parameter_type: 'workflow' as const,
    default_value: '',
  }));

  return {
    workflow_id: navigation.id,
    title: navigation.name,
    parameters,
    blocks,
  };
}
