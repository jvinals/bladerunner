/**
 * Run: pnpm exec tsx src/modules/recording/clerk-auto-sign-in-step-metadata.selftest.ts (from apps/api)
 */
import assert from 'node:assert/strict';
import {
  CLERK_AUTO_SIGN_IN_KIND,
  CLERK_AUTO_SIGN_IN_SCHEMA_VERSION,
  isClerkAutoSignInMetadata,
  postAuthUrlsRoughlyMatch,
} from './clerk-auto-sign-in-step-metadata';

assert.equal(
  isClerkAutoSignInMetadata({
    kind: CLERK_AUTO_SIGN_IN_KIND,
    schemaVersion: CLERK_AUTO_SIGN_IN_SCHEMA_VERSION,
    otpMode: 'mailslurp',
    postAuthPageUrl: 'https://a.com/x',
  }),
  true,
);
assert.equal(isClerkAutoSignInMetadata({ kind: 'other' }), false);
assert.equal(postAuthUrlsRoughlyMatch('https://a.com/x/', 'https://a.com/x'), true);

console.log('clerk-auto-sign-in-step-metadata.selftest: ok');
