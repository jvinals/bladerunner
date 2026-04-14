import {
  buildSkyvernWorkflowApiPayload,
  defaultLocalhostRewriteHostForSkyvern,
  rewriteLocalhostUrlForSkyvernPlay,
} from './skyvern-workflow-api.mapper';
import type { RecordedNavigationAction } from './navigation-recording.service';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  rewriteLocalhostUrlForSkyvernPlay('http://localhost:5173/foo', 'host.docker.internal') ===
    'http://host.docker.internal:5173/foo',
  'localhost rewrite',
);
assert(
  rewriteLocalhostUrlForSkyvernPlay('http://127.0.0.1:3000/', 'host.docker.internal') ===
    'http://host.docker.internal:3000/',
  '127 rewrite',
);
assert(
  rewriteLocalhostUrlForSkyvernPlay('https://example.com', 'host.docker.internal') === 'https://example.com/',
  'non-local unchanged',
);

assert(defaultLocalhostRewriteHostForSkyvern('http://localhost:8000') === 'host.docker.internal', 'default loopback');
assert(defaultLocalhostRewriteHostForSkyvern('https://api.skyvern.com') === undefined, 'cloud no default');

const nav = { id: 'n', name: 't', url: 'http://localhost:9/' };
const actions: RecordedNavigationAction[] = [
  {
    sequence: 1,
    actionType: 'navigate',
    x: null,
    y: null,
    elementTag: null,
    elementId: null,
    elementText: null,
    ariaLabel: null,
    inputValue: null,
    inputMode: null,
    pageUrl: null,
    actionInstruction: null,
  },
];
const built = buildSkyvernWorkflowApiPayload(nav, actions, { localhostRewriteHost: 'host.docker.internal' });
const first = built.workflow_definition.blocks[0];
assert(first?.block_type === 'navigation' && 'url' in first && first.url === 'http://host.docker.internal:9/', 'nav block url');

console.log('skyvern-workflow-api.mapper.selftest ok');
