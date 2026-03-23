/**
 * Run: pnpm exec tsx src/modules/recording/playback-skip.selftest.ts (from apps/api)
 */
import assert from 'node:assert/strict';
import {
  CLERK_AUTO_SIGN_IN_KIND,
  CLERK_AUTO_SIGN_IN_SCHEMA_VERSION,
} from './clerk-auto-sign-in-step-metadata';
import { AI_PROMPT_STEP_KIND, AI_PROMPT_STEP_SCHEMA_VERSION } from './ai-prompt-step-metadata';
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

const clerkAutoSignInStep = {
  id: 'cas',
  sequence: 2,
  metadata: {
    kind: CLERK_AUTO_SIGN_IN_KIND,
    schemaVersion: CLERK_AUTO_SIGN_IN_SCHEMA_VERSION,
    otpMode: 'mailslurp' as const,
    postAuthPageUrl: 'https://example.com/app/home',
  },
  action: 'CUSTOM',
  origin: 'MANUAL' as const,
  instruction: 'Automatic Clerk sign-in (MailSlurp OTP)',
  playwrightCode: '/* clerk_auto_sign_in */',
};
assert.equal(shouldSkipStoredPlaywrightForClerk(clerkAutoSignInStep, true), false);
s = buildPlaybackSkipSet({ steps: [clerkAutoSignInStep], wantAutoClerkSkip: true });
assert.equal(s.has('cas'), false);

const aiPromptStep = {
  id: 'ai1',
  sequence: 6,
  metadata: { kind: AI_PROMPT_STEP_KIND, schemaVersion: AI_PROMPT_STEP_SCHEMA_VERSION },
  action: 'CUSTOM',
  origin: 'AI_PROMPT' as const,
  instruction: 'Type the verification code',
  playwrightCode: '/* ai_prompt_step */',
};
assert.equal(shouldSkipStoredPlaywrightForClerk(aiPromptStep, true), false);
s = buildPlaybackSkipSet({ steps: [llmOtpNoPrefix, aiPromptStep], wantAutoClerkSkip: true });
assert.equal(s.has('otp5'), true);
assert.equal(s.has('ai1'), false);

console.log('playback-skip.selftest: ok');
