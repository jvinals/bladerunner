/**
 * Run: pnpm exec tsx src/modules/recording/playback-skip.selftest.ts (from apps/api)
 */
import assert from 'node:assert/strict';
import {
  buildPlaybackSkipSet,
  normalizePlaybackUrl,
  shouldSkipStoredPlaywrightForClerk,
} from './playback-skip.util';

const steps = [
  { id: 'a', sequence: 1, metadata: { clerkAuthPhase: true }, action: 'CLICK', origin: 'MANUAL' as const },
  { id: 'b', sequence: 2, metadata: {}, action: 'CLICK', origin: 'MANUAL' as const },
  { id: 'c', sequence: 3, metadata: null, action: 'CLICK', origin: 'MANUAL' as const },
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

const autoSteps = [
  { id: 'x', sequence: 1, metadata: {}, action: 'CLICK', origin: 'AUTOMATIC' as const },
  { id: 'y', sequence: 2, metadata: {}, action: 'CLICK', origin: 'MANUAL' as const },
];
s = buildPlaybackSkipSet({ steps: autoSteps, wantAutoClerkSkip: true });
assert.equal(s.has('x'), true);
assert.equal(s.has('y'), false);

s = buildPlaybackSkipSet({ steps: autoSteps, wantAutoClerkSkip: false });
assert.equal(s.has('x'), false);

const both = [
  { id: 'm', sequence: 1, metadata: { clerkAuthPhase: true }, action: 'CLICK', origin: 'AUTOMATIC' as const },
];
s = buildPlaybackSkipSet({ steps: both, wantAutoClerkSkip: true });
assert.equal(s.has('m'), true);

const navRunUrl = 'https://example.com/app/';
const navSteps = [
  {
    id: 'n1',
    sequence: 1,
    metadata: {},
    action: 'NAVIGATE',
    value: 'https://example.com/app',
    origin: 'AUTOMATIC' as const,
  },
  { id: 'n2', sequence: 2, metadata: {}, action: 'CLICK', origin: 'MANUAL' as const },
];
s = buildPlaybackSkipSet({ steps: navSteps, wantAutoClerkSkip: false, runUrl: navRunUrl });
assert.equal(s.has('n1'), true);
assert.equal(s.has('n2'), false);

assert.equal(normalizePlaybackUrl('https://example.com/app/'), normalizePlaybackUrl('https://example.com/app'));

const mailSlurpInstr = [
  {
    id: 'ms1',
    sequence: 5,
    metadata: {},
    action: 'TYPE',
    origin: 'MANUAL' as const,
    instruction: '[MailSlurp automation] Enter the code from email',
  },
];
s = buildPlaybackSkipSet({ steps: mailSlurpInstr, wantAutoClerkSkip: true });
assert.equal(s.has('ms1'), true);
assert.equal(shouldSkipStoredPlaywrightForClerk(mailSlurpInstr[0]!, true), true);
assert.equal(shouldSkipStoredPlaywrightForClerk(mailSlurpInstr[0]!, false), false);

const llmOtpNoPrefix = {
  id: 'otp5',
  sequence: 5,
  metadata: {},
  action: 'TYPE',
  origin: 'MANUAL' as const,
  instruction: "Type '139459' into the verification code input field",
  playwrightCode: `await page.getByLabel('Enter verification code').fill('139459');`,
};
s = buildPlaybackSkipSet({ steps: [llmOtpNoPrefix], wantAutoClerkSkip: true });
assert.equal(s.has('otp5'), true);
assert.equal(shouldSkipStoredPlaywrightForClerk(llmOtpNoPrefix, true), true);

const looseWording = {
  id: 'lw',
  sequence: 5,
  metadata: {},
  action: 'TYPE',
  origin: 'MANUAL' as const,
  instruction: "Type '139459' into the verification code input field",
  playwrightCode: '',
};
assert.equal(shouldSkipStoredPlaywrightForClerk(looseWording, true), true);

const manualUnrelated = {
  id: 'u1',
  sequence: 1,
  metadata: {},
  action: 'TYPE',
  origin: 'MANUAL' as const,
  instruction: 'Type your name in the field',
  playwrightCode: `await page.getByLabel('Name').fill('x');`,
};
assert.equal(shouldSkipStoredPlaywrightForClerk(manualUnrelated, true), false);

console.log('playback-skip.selftest: ok');
