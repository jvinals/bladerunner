import assert from 'node:assert/strict';
import { graphToMermaid, sanitizeMermaidNodeId, type NavNodeRecord } from './discovery-navigation-tree';

const nodes: NavNodeRecord[] = [
  { id: 'a', label: 'Root', depth: 0, parentId: null, urlNorm: '' },
  { id: 'b', label: 'Child "x"', depth: 1, parentId: 'a', urlNorm: 'https://x' },
];
const edges = [{ from: 'a', to: 'b' }];
const m = graphToMermaid(nodes, edges);
assert.match(m, /^flowchart TD/);
assert.ok(m.includes(sanitizeMermaidNodeId('a')));
assert.ok(m.includes('-->'));
console.log('discovery-navigation-tree.selftest: ok');
