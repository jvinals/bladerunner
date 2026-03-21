import assert from 'node:assert/strict';
import { filterStepsForPlaybackExecutionChain, stepInPlaybackExecutionChain } from './playback-execution-chain.util';

const mk = (id: string, seq: number, meta?: Record<string, unknown>) =>
  ({
    id,
    sequence: seq,
    metadata: meta,
    action: 'CLICK',
    instruction: 'x',
    playwrightCode: `await page.waitForLoadState('domcontentloaded');`,
    origin: 'MANUAL',
  }) as any;

assert.equal(stepInPlaybackExecutionChain(mk('a', 1, { clerkAutomationCanonical: true }), true), false);
assert.equal(stepInPlaybackExecutionChain(mk('b', 2, { clerkAuthPhase: true }), true), false);
assert.equal(stepInPlaybackExecutionChain(mk('c', 3, { clerkAuthPhase: true }), false), true);
assert.equal(stepInPlaybackExecutionChain(mk('d', 4, undefined), true), true);

const all = [
  mk('1', 1, undefined),
  mk('2', 2, { clerkAuthPhase: true }),
  mk('3', 3, { clerkAutomationCanonical: true }),
  mk('4', 4, undefined),
];
const filtered = filterStepsForPlaybackExecutionChain(all as any, true);
assert.equal(filtered.length, 2);
assert.equal(filtered[0].id, '1');
assert.equal(filtered[1].id, '4');

console.log('playback-execution-chain.selftest: ok');
