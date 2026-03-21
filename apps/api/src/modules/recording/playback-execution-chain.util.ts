import type { RunStep } from '@prisma/client';
import { isClerkAutoSignInMetadata } from './clerk-auto-sign-in-step-metadata';

type StepMeta = { clerkAuthPhase?: boolean; clerkAutomationCanonical?: boolean };

function metaFromStep(step: { metadata?: unknown }): StepMeta | undefined {
  const m = step.metadata;
  if (!m || typeof m !== 'object') return undefined;
  return m as StepMeta;
}

/**
 * Steps that participate in the **Playwright execution chain** (`executePwCode` / progress events).
 * Clerk/MailSlurp automation rows stay in the DB for UI/audit but must not be interleaved with
 * real user codegen when auto Clerk playback runs server-side `performClerkPasswordEmail2FA` instead.
 *
 * - `clerkAutomationCanonical`: legacy six synthetic rows after "Sign in automatically" — never executed.
 * - `clerk_auto_sign_in` (single-step): **in** chain — handled by explicit `performClerkPasswordEmail2FA` branch.
 * - `clerkAuthPhase` + `wantAutoClerkSignIn`: DOM-captured Clerk steps skipped by server assist; omit from chain.
 * When auto Clerk is off, `clerkAuthPhase` steps are included so stored Playwright can run (may be brittle).
 */
export function stepInPlaybackExecutionChain(
  step: { metadata?: unknown },
  wantAutoClerkSignIn: boolean,
): boolean {
  if (isClerkAutoSignInMetadata(step.metadata)) return true;
  const m = metaFromStep(step);
  if (m?.clerkAutomationCanonical === true) return false;
  if (wantAutoClerkSignIn && m?.clerkAuthPhase === true) return false;
  return true;
}

export function filterStepsForPlaybackExecutionChain(
  steps: RunStep[],
  wantAutoClerkSignIn: boolean,
): RunStep[] {
  return steps.filter((s) => stepInPlaybackExecutionChain(s, wantAutoClerkSignIn));
}
