export type RecordingAutomationFailureKind =
  | 'abort'
  | 'timeout'
  | 'strict_mode'
  | 'playwright'
  | 'other';

export type RecordingAutomationFailure = {
  kind: RecordingAutomationFailureKind;
  message: string;
  name: string;
  stack: string;
  isAbort: boolean;
  isTimeout: boolean;
  isStrictMode: boolean;
  isRetryable: boolean;
  isKnownNonFatal: boolean;
};

function stringifyError(error: unknown): { message: string; name: string; stack: string } {
  if (error instanceof Error) {
    return {
      message: error.message || String(error),
      name: error.name || 'Error',
      stack: error.stack || '',
    };
  }
  return {
    message: String(error),
    name: '',
    stack: '',
  };
}

export function classifyRecordingAutomationFailure(error: unknown): RecordingAutomationFailure {
  const { message, name, stack } = stringifyError(error);
  const haystack = `${name}\n${message}\n${stack}`;
  const isAbort =
    /AbortError/i.test(name) ||
    /\baborted\b/i.test(message) ||
    /\brequest aborted\b/i.test(message) ||
    /\bcancelled\b/i.test(message);
  const isTimeout =
    /TimeoutError/i.test(name) ||
    /\btimeout\b/i.test(message) ||
    /\bexceeded\b/i.test(message);
  const isStrictMode = /strict mode violation/i.test(message);
  const fromRecordingAutomation =
    /modules\/recording\//i.test(stack) ||
    /modules\/runs\//i.test(stack) ||
    /\bexecutePwCode\b/.test(stack) ||
    /\bplayAiPromptStepOnPage\b/.test(stack) ||
    /\btestAiPromptStep\b/.test(stack);

  let kind: RecordingAutomationFailureKind = 'other';
  if (isAbort) kind = 'abort';
  else if (isTimeout) kind = 'timeout';
  else if (isStrictMode) kind = 'strict_mode';
  else if (/locator\.|getByRole|getByText|Playwright/i.test(haystack)) kind = 'playwright';

  const isRetryable = isTimeout && !isAbort;
  const isKnownNonFatal = fromRecordingAutomation && (isAbort || isTimeout || isStrictMode || kind === 'playwright');

  return {
    kind,
    message,
    name,
    stack,
    isAbort,
    isTimeout,
    isStrictMode,
    isRetryable,
    isKnownNonFatal,
  };
}
