/**
 * Self-test: LLM skip-replay suggestion JSON parsing (no network).
 * Run: pnpm --filter @bladerunner/api run test:llm-suggest-skip
 */
import { LlmService } from './llm.service';
import type { ChatMessage, LlmProvider } from './providers/llm-provider.interface';

function makeProvider(responseText: string): LlmProvider {
  return {
    async chat(_messages: ChatMessage[]) {
      return { content: responseText };
    },
  };
}

async function run() {
  const svc = new LlmService();

  svc.setProvider(
    makeProvider(
      JSON.stringify({
        suggestions: [{ stepId: 'step-1', reason: 'Obsolete navigation' }],
      }),
    ),
  );
  const plain = await svc.suggestStepsToSkipAfterChange({
    anchor: { sequence: 1, instruction: 'Open menu', action: 'CLICK', origin: 'MANUAL' },
    forwardSteps: [
      { id: 'step-1', sequence: 2, instruction: 'Old click', action: 'CLICK', origin: 'MANUAL' },
    ],
  });
  if (plain.suggestions.length !== 1 || plain.suggestions[0].stepId !== 'step-1') {
    throw new Error('plain JSON: unexpected result');
  }

  svc.setProvider(
    makeProvider(
      '```json\n{"suggestions":[{"stepId":"b","reason":"r2"}]}\n```',
    ),
  );
  const fenced = await svc.suggestStepsToSkipAfterChange({
    anchor: { sequence: 1, instruction: 'x', action: 'CLICK', origin: 'MANUAL' },
    forwardSteps: [{ id: 'b', sequence: 3, instruction: 'y', action: 'TYPE', origin: 'MANUAL' }],
  });
  if (fenced.suggestions.length !== 1 || fenced.suggestions[0].stepId !== 'b') {
    throw new Error('fenced JSON: unexpected result');
  }

  const noProvider = new LlmService();
  const empty = await noProvider.suggestStepsToSkipAfterChange({
    anchor: { sequence: 1, instruction: 'x', action: 'CLICK', origin: 'MANUAL' },
    forwardSteps: [{ id: 'z', sequence: 2, instruction: 'y', action: 'CLICK', origin: 'MANUAL' }],
  });
  if (empty.suggestions.length !== 0) {
    throw new Error('no provider should return empty suggestions');
  }

  console.log('llm-suggest-skip.selftest: ok');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
