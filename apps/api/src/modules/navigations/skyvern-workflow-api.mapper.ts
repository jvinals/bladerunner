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

/**
 * Skyvern requires **unique** `label` per block. Recording `sequence` can repeat in the DB
 * (e.g. duplicate rows) or across types; use a monotonic index per emitted block.
 */
function makeNextBlockLabel(): (kind: string) => string {
  let i = 0;
  return (kind: string) => {
    i += 1;
    const raw = `s${i}_${kind}`.replace(/[^a-zA-Z0-9_-]+/g, '_');
    return raw.slice(0, 120);
  };
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
  const nextLabel = makeNextBlockLabel();

  for (const action of actions) {
    switch (action.actionType) {
      case 'navigate': {
        const url = action.inputValue ?? action.pageUrl ?? navigation.url;
        blocks.push({
          block_type: 'navigation',
          label: nextLabel('nav'),
          navigation_goal: `Navigate to ${url} and wait for the page to load. The task is complete once the page has loaded.`,
          url,
        });
        break;
      }
      case 'click': {
        const caption = action.inputValue?.trim() || resolveSemanticLabel(action);
        blocks.push({
          block_type: 'action',
          label: nextLabel('click'),
          navigation_goal: `Click on: ${caption}`,
        });
        break;
      }
      case 'type': {
        const caption = resolveSemanticLabel(action);
        const text = action.inputValue ?? '';
        blocks.push({
          block_type: 'action',
          label: nextLabel('type'),
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
          label: nextLabel('var'),
          navigation_goal: `In the field "${caption}", enter the workflow parameter value ${paramRef}`,
        });
        break;
      }
      case 'prompt': {
        const caption = (action.inputValue ?? '').trim() || 'AI-guided click';
        blocks.push({
          block_type: 'action',
          label: nextLabel('prompt'),
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
          label: nextLabel('ptype'),
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
