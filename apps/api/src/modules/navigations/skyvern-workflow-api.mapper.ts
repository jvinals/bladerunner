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
 * When Skyvern runs in Docker, `http://localhost:…` in workflow URLs points at the container, not the dev app.
 * Rewrite loopback hosts to a hostname reachable from Skyvern (e.g. `host.docker.internal` on Docker Desktop / compose `extra_hosts`).
 */
export function rewriteLocalhostUrlForSkyvernPlay(raw: string, dockerReachableHost: string | undefined): string {
  const h = dockerReachableHost?.trim();
  if (!h) return raw;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  const hn = u.hostname.toLowerCase();
  if (hn === 'localhost' || hn === '127.0.0.1' || hn === '::1') {
    u.hostname = h;
  }
  return u.toString();
}

/**
 * If the API talks to Skyvern at loopback, assume Skyvern may run in Docker and default rewrite target.
 */
export function defaultLocalhostRewriteHostForSkyvern(skyvernApiBaseUrl: string | undefined): string | undefined {
  const raw = skyvernApiBaseUrl?.trim() || 'https://api.skyvern.com';
  try {
    const u = new URL(raw);
    const hn = u.hostname.toLowerCase();
    if (hn === 'localhost' || hn === '127.0.0.1' || hn === '::1') {
      return 'host.docker.internal';
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export type BuildSkyvernWorkflowApiPayloadOptions = {
  /** When set, navigation block `url` values that use loopback are rewritten to this host (port/path preserved). */
  localhostRewriteHost?: string | null;
};

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
  options?: BuildSkyvernWorkflowApiPayloadOptions,
): { title: string; workflow_definition: SkyvernWorkflowDefinitionPayload } {
  const rewrite = options?.localhostRewriteHost ?? undefined;
  const blocks: SkyvernApiBlock[] = [];
  const variableNames = new Set<string>();
  const nextLabel = makeNextBlockLabel();

  for (const action of actions) {
    const ins = action.actionInstruction?.trim();
    switch (action.actionType) {
      case 'navigate': {
        const rawUrl = action.inputValue ?? action.pageUrl ?? navigation.url;
        const url = rewriteLocalhostUrlForSkyvernPlay(rawUrl, rewrite);
        const navigation_goal = ins
          ? ins
          : `Navigate to ${url} and wait for the page to load. The task is complete once the page has loaded.`;
        blocks.push({
          block_type: 'navigation',
          label: nextLabel('nav'),
          navigation_goal,
          url,
        });
        break;
      }
      case 'click': {
        const caption = action.inputValue?.trim() || resolveSemanticLabel(action);
        const navigation_goal = ins || `Click on: ${caption}`;
        blocks.push({
          block_type: 'action',
          label: nextLabel('click'),
          navigation_goal,
        });
        break;
      }
      case 'type': {
        const caption = resolveSemanticLabel(action);
        const text = action.inputValue ?? '';
        const navigation_goal =
          ins || `In the field "${caption}", type the text: ${text}`;
        blocks.push({
          block_type: 'action',
          label: nextLabel('type'),
          navigation_goal,
        });
        break;
      }
      case 'variable_input': {
        const key = cleanVariableKeyFromStored(action.inputValue);
        if (key) variableNames.add(key);
        const caption = resolveSemanticLabel(action);
        const paramRef = key ? skyvernMustacheText(key) : '(empty)';
        const navigation_goal =
          ins ||
          `In the field "${caption}", enter the workflow parameter value ${paramRef}`;
        blocks.push({
          block_type: 'action',
          label: nextLabel('var'),
          navigation_goal,
        });
        break;
      }
      case 'prompt': {
        const caption = (action.inputValue ?? '').trim() || 'AI-guided click';
        const navigation_goal = ins || `Click: ${caption}`;
        blocks.push({
          block_type: 'action',
          label: nextLabel('prompt'),
          navigation_goal,
        });
        break;
      }
      case 'prompt_type': {
        const key = cleanVariableKeyFromStored(action.inputValue);
        if (key) variableNames.add(key);
        const caption = action.elementText?.trim() || resolveSemanticLabel(action);
        const paramRef = key ? skyvernMustacheText(key) : '(empty)';
        const navigation_goal =
          ins ||
          `In the field "${caption}", enter the workflow parameter value ${paramRef}`;
        blocks.push({
          block_type: 'action',
          label: nextLabel('ptype'),
          navigation_goal,
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
