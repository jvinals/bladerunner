import type { ConfigService } from '@nestjs/config';
import {
  buildGeminiInstructionPrompt,
  buildGeminiVerifyPrompt,
  normalizeGeminiPlaywrightSnippet,
} from './gemini-instruction.client';
import { createChatLlmProvider } from './llm-provider-factory';
import type { LlmProviderCredential } from './llm-config.service';
import type { LlmProviderId } from './llm-usage-registry';
import type { InstructionToActionInput } from './providers/llm-provider.interface';

/**
 * Vision Playwright codegen via OpenAI-compatible or Anthropic (non-Gemini).
 * Uses the same prompt template as Gemini for consistent behavior.
 */
export async function generateNonGeminiVisionPlaywrightSnippet(params: {
  config: ConfigService;
  provider: Exclude<LlmProviderId, 'gemini'>;
  model: string;
  credentials: LlmProviderCredential;
  input: InstructionToActionInput;
  imageBase64: string;
  signal?: AbortSignal;
  onProgress?: (ev: { rawText: string; thinking?: string }) => void;
}): Promise<{ rawText: string; playwrightCode: string; thinking?: string }> {
  const fullPrompt = buildGeminiInstructionPrompt({
    instruction: params.input.instruction,
    pageUrl: params.input.pageUrl,
    somManifest: params.input.somManifest,
    accessibilitySnapshot: params.input.accessibilitySnapshot,
    failedPlaywrightCode: params.input.failedPlaywrightCode,
    recordedPlaywrightCode: params.input.recordedPlaywrightCode,
    priorFailureKind: params.input.priorFailureKind,
    priorFailureMessage: params.input.priorFailureMessage,
  });

  const client = createChatLlmProvider(params.config, params.provider, params.model, params.credentials);
  const result = await client.chat([{ role: 'user', content: fullPrompt }], {
    imageBase64: params.imageBase64.trim(),
    maxTokens: 8192,
    temperature: 0.2,
    signal: params.signal,
    responseFormat: 'text',
  });

  const rawText = result.content.trim();
  params.onProgress?.({ rawText, ...(result.thinking?.trim() ? { thinking: result.thinking } : {}) });

  return {
    rawText,
    playwrightCode: normalizeGeminiPlaywrightSnippet(rawText),
    ...(result.thinking?.trim() ? { thinking: result.thinking.trim() } : {}),
  };
}

export async function verifyPlaywrightAgainstDomNonGemini(params: {
  config: ConfigService;
  provider: Exclude<LlmProviderId, 'gemini'>;
  model: string;
  credentials: LlmProviderCredential;
  instruction: string;
  pageUrl: string;
  somManifest: string;
  accessibilitySnapshot: string;
  draftPlaywrightCode: string;
  failedPlaywrightCode?: string;
  recordedPlaywrightCode?: string;
  priorFailureKind?: string;
  priorFailureMessage?: string;
  signal?: AbortSignal;
}): Promise<{ rawText: string; playwrightCode: string }> {
  const fullPrompt = buildGeminiVerifyPrompt({
    instruction: params.instruction,
    pageUrl: params.pageUrl,
    somManifest: params.somManifest,
    accessibilitySnapshot: params.accessibilitySnapshot,
    draftPlaywrightCode: params.draftPlaywrightCode,
    failedPlaywrightCode: params.failedPlaywrightCode,
    recordedPlaywrightCode: params.recordedPlaywrightCode,
    priorFailureKind: params.priorFailureKind,
    priorFailureMessage: params.priorFailureMessage,
  });

  const client = createChatLlmProvider(params.config, params.provider, params.model, params.credentials);
  const result = await client.chat([{ role: 'user', content: fullPrompt }], {
    maxTokens: 8192,
    temperature: 0.1,
    signal: params.signal,
    responseFormat: 'text',
  });

  const rawText = result.content.trim();
  return {
    rawText,
    playwrightCode: normalizeGeminiPlaywrightSnippet(rawText),
  };
}
