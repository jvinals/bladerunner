/**
 * Maps recorded navigation actions to Skyvern REST API `workflow_definition`
 * shape (see OpenAPI WorkflowDefinitionYAML / WorkflowCreateYAMLRequest).
 */

import type { RecordedNavigationAction } from './navigation-recording.service';
import { cleanVariableKeyFromStored, resolveSemanticLabel } from './skyvern-compiler';

/** Minimal block shapes accepted by Skyvern POST /v1/workflows `json_definition.workflow_definition`. */
export type SkyvernApiWorkflowParameter = {
  parameter_type: 'workflow';
  key: string;
  workflow_parameter_type: 'string';
  default_value?: string;
  description?: string | null;
};

export type SkyvernApiNavigationBlock = {
  block_type: 'navigation';
  label: string;
  navigation_goal: string;
  url: string | null;
};

export type SkyvernApiActionBlock = {
  block_type: 'action';
  label: string;
  navigation_goal: string;
};

export type SkyvernApiBlock = SkyvernApiNavigationBlock | SkyvernApiActionBlock;

export interface SkyvernWorkflowDefinitionPayload {
  version: number;
  parameters: SkyvernApiWorkflowParameter[];
  blocks: SkyvernApiBlock[];
}

function skyvernMustacheText(key: string): string {
  return `{{${key}}}`;
}

function blockLabel(prefix: string, sequence: number): string {
  return `${prefix}_${sequence}`.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 120);
}

/**
 * Build `workflow_definition` + title for Skyvern create/update workflow requests.
 */
export function buildSkyvernWorkflowApiPayload(
  navigation: { id: string; name: string; url: string },
  actions: RecordedNavigationAction[],
): { title: string; workflow_definition: SkyvernWorkflowDefinitionPayload } {
  const blocks: SkyvernApiBlock[] = [];
  const variableNames = new Set<string>();

  for (const action of actions) {
    const seq = action.sequence;
    switch (action.actionType) {
      case 'navigate': {
        const url = action.inputValue ?? action.pageUrl ?? navigation.url;
        const goal = `Open the URL and continue: ${url}`;
        blocks.push({
          block_type: 'navigation',
          label: blockLabel('nav', seq),
          navigation_goal: goal,
          url,
        });
        break;
      }
      case 'click': {
        const caption = action.inputValue?.trim() || resolveSemanticLabel(action);
        blocks.push({
          block_type: 'action',
          label: blockLabel('click', seq),
          navigation_goal: `Click on: ${caption}`,
        });
        break;
      }
      case 'type': {
        const caption = resolveSemanticLabel(action);
        const text = action.inputValue ?? '';
        blocks.push({
          block_type: 'action',
          label: blockLabel('type', seq),
          navigation_goal: `In the field "${caption}", type the text: ${text}`,
        });
        break;
      }
      case 'variable_input': {
        const key = cleanVariableKeyFromStored(action.inputValue);
        if (key) variableNames.add(key);
        const caption = resolveSemanticLabel(action);
        const paramRef = key ? skyvernMustacheText(key) : '(empty)';
        blocks.push({
          block_type: 'action',
          label: blockLabel('var', seq),
          navigation_goal: `In the field "${caption}", enter the workflow parameter value ${paramRef}`,
        });
        break;
      }
      case 'prompt': {
        const caption = (action.inputValue ?? '').trim() || 'AI-guided click';
        blocks.push({
          block_type: 'action',
          label: blockLabel('prompt', seq),
          navigation_goal: `Click: ${caption}`,
        });
        break;
      }
      case 'prompt_type': {
        const key = cleanVariableKeyFromStored(action.inputValue);
        if (key) variableNames.add(key);
        const caption = action.elementText?.trim() || resolveSemanticLabel(action);
        const paramRef = key ? skyvernMustacheText(key) : '(empty)';
        blocks.push({
          block_type: 'action',
          label: blockLabel('ptype', seq),
          navigation_goal: `In the field "${caption}", enter the workflow parameter value ${paramRef}`,
        });
        break;
      }
      default:
        break;
    }
  }

  const parameters: SkyvernApiWorkflowParameter[] = [...variableNames].sort().map((key) => ({
    parameter_type: 'workflow',
    key,
    workflow_parameter_type: 'string',
    default_value: '',
  }));

  return {
    title: navigation.name || 'Navigation',
    workflow_definition: {
      version: 1,
      parameters,
      blocks,
    },
  };
}
