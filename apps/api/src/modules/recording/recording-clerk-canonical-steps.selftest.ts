import assert from 'node:assert/strict';
import { CLERK_CANONICAL_SIGN_IN_STEPS } from './recording-clerk-canonical-steps';

assert.equal(CLERK_CANONICAL_SIGN_IN_STEPS.length, 6);
assert.equal(CLERK_CANONICAL_SIGN_IN_STEPS[0].action, 'TYPE');
assert.equal(CLERK_CANONICAL_SIGN_IN_STEPS[1].action, 'CLICK');
console.log('recording-clerk-canonical-steps.selftest: ok');
