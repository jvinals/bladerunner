/**
 * After **execute_playwright** steps only. Finish / ask_human are decided in the single codegen LLM call.
 */

export type DeterministicEvaluationAnalysis = {
  goalProgress: 'partial' | 'complete' | 'blocked';
  decision: 'retry' | 'advance';
  rationale: string;
};

export function deterministicEvaluationStepAnalysis(args: {
  executionOk: boolean;
  errorMessage?: string | null;
}): DeterministicEvaluationAnalysis {
  if (!args.executionOk) {
    const err = typeof args.errorMessage === 'string' ? args.errorMessage.trim() : '';
    return {
      goalProgress: 'partial',
      decision: 'retry',
      rationale: err
        ? `Playwright failed; next step can try a different approach. Error: ${err.slice(0, 2000)}`
        : 'Playwright reported execution failure.',
    };
  }

  return {
    goalProgress: 'partial',
    decision: 'advance',
    rationale: 'Playwright succeeded — continuing to the next codegen step.',
  };
}
