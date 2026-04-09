/**
 * Replaces the former vision **evaluation_analyzer** LLM. The orchestrator applies these rules
 * after each Playwright run so evaluations use a single vision call per step (codegen only).
 */

export type DeterministicEvaluationAnalysis = {
  goalProgress: 'partial' | 'complete' | 'blocked';
  decision: 'retry' | 'advance' | 'ask_human' | 'finish';
  rationale: string;
};

export function deterministicEvaluationStepAnalysis(args: {
  executionOk: boolean;
  errorMessage?: string | null;
  /** From codegen JSON: if true and execution succeeds, end the run (replaces vision-based finish). */
  signalEvaluationComplete?: boolean;
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

  if (args.signalEvaluationComplete === true) {
    return {
      goalProgress: 'complete',
      decision: 'finish',
      rationale:
        'Codegen set signalEvaluationComplete and Playwright succeeded — ending the evaluation.',
    };
  }

  return {
    goalProgress: 'partial',
    decision: 'advance',
    rationale:
      'Playwright succeeded — continuing (rule-based continuation; no separate analyzer LLM).',
  };
}
