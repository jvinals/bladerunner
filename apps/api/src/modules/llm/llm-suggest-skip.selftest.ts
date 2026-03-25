/**
 * Self-test: LLM skip-replay suggestion JSON parsing (no network).
 * Run: pnpm --filter @bladerunner/api run test:llm-suggest-skip
 */
import { ConfigService } from '@nestjs/config';
import { LlmConfigService } from './llm-config.service';
import { LlmService } from './llm.service';
import type { ChatMessage, LlmProvider } from './providers/llm-provider.interface';
import type { PrismaService } from '../prisma/prisma.service';
import type { LlmCredentialsCryptoService } from './llm-credentials-crypto.service';

function makeProvider(responseText: string): LlmProvider {
  return {
    async chat(_messages: ChatMessage[]) {
      return { content: responseText };
    },
  };
}

function makeLlmService(): LlmService {
  const mockConfig = new ConfigService({});
  const mockPrisma = {
    userLlmPreferences: { findUnique: async () => null },
  } as unknown as PrismaService;
  const mockCrypto = {
    isConfigured: () => false,
    tryDecryptJson: () => null,
  } as unknown as LlmCredentialsCryptoService;
  const llmConfig = new LlmConfigService(mockConfig, mockPrisma, mockCrypto);
  return new LlmService(mockConfig, llmConfig);
}

async function run() {
  const svc = makeLlmService();

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

  const noProvider = makeLlmService();
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
