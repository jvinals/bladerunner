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

/**
 * Derive the most human-readable label from action metadata.
 *
 * Priority: elementText > ariaLabel > placeholder (stored in ariaLabel
 * fallback during recording) > name attribute (not stored separately —
 * captured as part of elementId heuristic) > elementId > coordinate fallback.
 */
function resolveSemanticLabel(action: RecordedNavigationAction): string {
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
        blocks.push({
          block_type: 'action',
          action_type: 'click',
          label: resolveSemanticLabel(action),
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
        const raw = action.inputValue ?? '';
        const varMatch = raw.match(/^\{\{(.+)\}\}$/);
        if (varMatch) {
          variableNames.add(varMatch[1]);
        }
        blocks.push({
          block_type: 'action',
          action_type: 'input_text',
          label: resolveSemanticLabel(action),
          text: raw,
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
