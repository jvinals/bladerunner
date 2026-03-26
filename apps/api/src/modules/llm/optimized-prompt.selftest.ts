import assert from 'node:assert/strict';
import { LLM_USAGE_KEYS, LLM_USAGE_LABELS, LLM_USAGE_SUPPORTS_VISION } from './llm-usage-registry';
import { LlmService } from './llm.service';

(async () => {
  assert.equal(LLM_USAGE_KEYS.includes('optimized_prompt'), true);
  assert.equal(LLM_USAGE_LABELS.optimized_prompt, 'Optimized Prompt');
  assert.equal(LLM_USAGE_SUPPORTS_VISION.optimized_prompt, true);

  const service = new LlmService({} as any, {} as any);
  service.setProvider({
    async chat(messages) {
      const system = messages.find((m) => m.role === 'system')?.content ?? '';
      const user = messages.find((m) => m.role === 'user')?.content ?? '';
      assert.ok(system.includes('Interaction Intent Compiler'));
      assert.ok(user.includes('"step_id": "step-7"'));
      assert.ok(user.includes('Application context:'));
      assert.ok(user.includes('Generated Playwright code for this step:'));
      return {
        content: JSON.stringify({
          step_intent_summary: 'Open the patient chart from the worklist.',
          canonical_playback_prompt:
            'Open the patient chart from the current worklist using patient identity and nearby clinical context to disambiguate. Succeed when the chart is visibly open.',
          action_type: 'open',
          business_object: 'patient',
          target_semantic_description: 'Patient chart entry in the current worklist',
          input_or_selection_value: 'John A. Smith',
          preconditions: ['The worklist view is already open.'],
          expected_outcome: ['The patient chart is visible.'],
          disambiguation_hints: ['Prefer patient identity over row position.'],
          do_not_depend_on: ['Exact wording', 'Exact row position'],
          uncertainty_notes: [],
          confidence: 0.93,
        }),
        thinking: 'Used the screenshot, DOM tree, and code together.',
      };
    },
  });

  const compiled = await service.compileOptimizedPrompt({
    appContext: '{"project":"Kintsugi"}',
    workflowContext: '{"run":"Morning demo"}',
    stepId: 'step-7',
    stepIndex: 7,
    recordingMode: 'ai_prompt',
    timestamp: '2026-03-26T00:00:00.000Z',
    previousStepSummaries: ['Search for John A. Smith in the patient worklist.'],
    nextStepSummaries: ['Review the chart header.'],
    humanPromptOrNull: 'Open the patient chart for John A. Smith',
    playwrightSnippet: `await page.getByRole('row', { name: /John A. Smith/ }).click();`,
    taggedScreenshotDescription: '[1] row "John A. Smith"',
    accessibilityTree: '{"role":"table"}',
    optionalPageMetadata: '{"pageUrl":"https://example.com/worklist"}',
  });

  assert.equal(compiled.output.action_type, 'open');
  assert.equal(compiled.output.business_object, 'patient');
  assert.ok(compiled.output.canonical_playback_prompt.includes('patient chart'));
  assert.ok(compiled.transcript.systemPrompt.includes('Interaction Intent Compiler'));
  assert.ok(compiled.transcript.userPrompt.includes('Open the patient chart for John A. Smith'));
  assert.ok(compiled.transcript.rawResponse.includes('"confidence":0.93'));

  console.log('llm optimized-prompt.selftest: ok');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
