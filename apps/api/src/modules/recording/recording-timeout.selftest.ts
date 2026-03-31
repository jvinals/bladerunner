import assert from 'node:assert/strict';
import { classifyRecordingAutomationFailure } from './recording-timeout.util';

const timeoutErr = new Error(
  "locator.click: Timeout 120000ms exceeded.\n    at RecordingService.executePwCode (/tmp/recording.service.ts:1:1)",
);
timeoutErr.name = 'TimeoutError';
assert.deepEqual(
  {
    kind: classifyRecordingAutomationFailure(timeoutErr).kind,
    retryable: classifyRecordingAutomationFailure(timeoutErr).isRetryable,
    nonFatal: classifyRecordingAutomationFailure(timeoutErr).isKnownNonFatal,
  },
  { kind: 'timeout', retryable: true, nonFatal: true },
);

const abortErr = new Error('Request aborted while testing AI prompt step');
abortErr.name = 'AbortError';
assert.deepEqual(
  {
    kind: classifyRecordingAutomationFailure(abortErr).kind,
    retryable: classifyRecordingAutomationFailure(abortErr).isRetryable,
  },
  { kind: 'abort', retryable: false },
);

const strictErr = new Error(
  "locator.click: Error: strict mode violation: getByRole('button', { name: '26' }) resolved to 35 elements:\n    at RecordingService.playAiPromptStepOnPage (/tmp/recording.service.ts:1:1)",
);
assert.deepEqual(
  {
    kind: classifyRecordingAutomationFailure(strictErr).kind,
    retryable: classifyRecordingAutomationFailure(strictErr).isRetryable,
    nonFatal: classifyRecordingAutomationFailure(strictErr).isKnownNonFatal,
  },
  { kind: 'strict_mode', retryable: false, nonFatal: true },
);

/** Same strict error as evaluation/AI codegen: `executePwCode` uses `new Function` — stack is only `eval (<anonymous>)`. */
const strictFromEval = new Error(
  "locator.click: Error: strict mode violation: getByRole('option', { name: 'Male' }) resolved to 2 elements:\n    at eval (<anonymous>:11:52)",
);
assert.deepEqual(
  {
    kind: classifyRecordingAutomationFailure(strictFromEval).kind,
    nonFatal: classifyRecordingAutomationFailure(strictFromEval).isKnownNonFatal,
  },
  { kind: 'strict_mode', nonFatal: true },
);

const genericErr = new Error('database connection exploded');
assert.deepEqual(
  {
    kind: classifyRecordingAutomationFailure(genericErr).kind,
    nonFatal: classifyRecordingAutomationFailure(genericErr).isKnownNonFatal,
  },
  { kind: 'other', nonFatal: false },
);

console.log('recording-timeout.selftest: ok');
