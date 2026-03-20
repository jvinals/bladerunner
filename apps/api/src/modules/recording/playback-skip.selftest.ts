/**
 * Run: pnpm exec tsx src/modules/recording/playback-skip.selftest.ts (from apps/api)
 */
import assert from 'node:assert/strict';
import { buildPlaybackSkipSet } from './playback-skip.util';

const steps = [
  { id: 'a', sequence: 1, metadata: { clerkAuthPhase: true } },
  { id: 'b', sequence: 2, metadata: {} },
  { id: 'c', sequence: 3, metadata: null },
];

let s = buildPlaybackSkipSet({ steps, wantAutoClerkSkip: true });
assert.equal(s.has('a'), true);
assert.equal(s.has('b'), false);

s = buildPlaybackSkipSet({ steps, wantAutoClerkSkip: false, skipUntilSequence: 3 });
assert.equal(s.has('a'), true);
assert.equal(s.has('b'), true);
assert.equal(s.has('c'), false);

s = buildPlaybackSkipSet({ steps, wantAutoClerkSkip: false, skipStepIds: ['c'] });
assert.equal(s.has('c'), true);

console.log('playback-skip.selftest: ok');
