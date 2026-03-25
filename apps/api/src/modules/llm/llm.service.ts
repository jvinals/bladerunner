import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  LlmProvider,
  ActionToInstructionInput,
  ActionToInstructionOutput,
  InstructionToActionInput,
  InstructionToActionOutput,
  InstructionToActionResult,
  ChatMessage,
  LlmChatOptions,
} from './providers/llm-provider.interface';
import {
  buildGeminiInstructionPrompt,
  buildGeminiVerifyPrompt,
  generateGeminiPlaywrightSnippet,
  verifyGeminiPlaywrightAgainstDom,
} from './gemini-instruction.client';
import { geminiChat } from './gemini-llm-chat.adapter';
import { LlmConfigService } from './llm-config.service';
import { createChatLlmProvider } from './llm-provider-factory';
import {
  generateNonGeminiVisionPlaywrightSnippet,
  verifyPlaywrightAgainstDomNonGemini,
} from './vision-playwright-codegen';

const ACTION_TO_INSTRUCTION_SYSTEM = `You are a Playwright test recorder assistant. Given a browser action and page context, produce:
1. A concise human-readable instruction describing what the user did
2. Clean Playwright code that reproduces the action

Respond ONLY with valid JSON: { "instruction": "...", "playwrightCode": "..." }

Guidelines:
- Instructions should be natural language, e.g. "Click the 'Sign In' button in the navigation bar"
- **Visible text** (if provided) is the element's innerText from the browser — use it for the instruction name (e.g. "Click the Patients item in the sidebar"). Never say "empty span" or "empty element" when Visible text is non-empty. **Aria label** (if provided) names icon-only controls.
- Element HTML may be truncated; prefer Visible text and Aria label over HTML when they disagree with an empty-looking tag.
- For TYPE actions, use Element HTML attributes: input[type="password"] or autocomplete="current-password" means password field; type="email", name="identifier", or email-like placeholders mean email/username. Never describe typing a password into an email field or vice versa.
- The "Selector" field is the clicked element's CSS selector from the browser (tag + #id, classes, or [data-testid]). When it contains a class, id, or attribute (not just a bare tag name), prefer await page.locator(<that exact selector as a single-quoted or JSON string>) for clicks/fills so replay targets the same node.
- Playwright code should use modern locator APIs (getByRole, getByText, getByLabel) when possible
- For modal/dialog close buttons, never emit a bare page.locator with only a path[d="..."] Lucide X shape or other SVG path alone — the same path repeats on row actions vs the dialog chrome. Prefer getByRole('dialog') combined with getByRole('button', { name: /close|dismiss/i }), getByLabel, or a locator scoped to the open dialog.
- NEVER use page.locator('span'), page.locator('div'), page.locator('a'), page.locator('button'), or page.locator('input') alone — they match many elements and Playwright throws a strict mode violation. When Visible text is available for a click, prefer getByText(visibleText, { exact: true }) (without chaining .first() on a broad container) or getByRole with name from Visible text / aria (exact: false on getByText matches substrings like "Total Patients"). Do not use page.locator('div', { hasText: '...' }).first() for options in a listbox — target getByRole('option', { name: '...' }) or getByText(..., { exact: true }) on the leaf control. Otherwise use getByRole('link', { name: '...' }), page.locator(<Selector field>) when specific, or a narrowly scoped locator.
- Playwright coding guidelines for modern SPAs: do not use locator.fill() on comboboxes or async search fields — use pressSequentially(text, { delay: 50 }). Wait for data rows or list items before reading table/list text. Prefer keyboard navigation (ArrowDown + Enter) for dynamic custom dropdowns when clicks would target detached nodes. Prefer expect(locator) web-first assertions when verifying text.
- Context: the user records **authorized QA automation** against **their own** staging or demo app; page context may include **synthetic** names and data. Phrase the JSON **instruction** as neutral UI test actions (e.g. "Click Save", "Type email into the login field")—not as requests to harm systems, steal data, or bypass security in production.
- Keep instructions concise but specific enough to identify the target element`;

const EXPLAIN_AI_PROMPT_TEST_FAILURE_SYSTEM = `You help QA engineers understand why an AI-driven Playwright test step failed and how to fix the **natural-language instruction** (not the Playwright code).

The user runs tests against **their own staging or demo app**; any names or data in the UI are synthetic fixtures.

You MUST respond with ONLY valid JSON:
{
  "explanation": "<2–4 short paragraphs in plain English: what likely went wrong, referencing the error and page context when helpful>",
  "suggestedPrompt": "<one complete replacement instruction the user can paste — concrete, uses getByRole/getByLabel style wording when the page context supports it>"
}

Rules:
- suggestedPrompt must stand alone and target the **same user goal** as the original instruction.
- Do not invent real patient or PII; use generic placeholders if needed.
- Be concise; explanation under 600 words.
- If the error is vague, still give your best hypothesis and a clearer, more specific prompt.`;

const SUGGEST_SKIP_AFTER_CHANGE_SYSTEM = `You analyze a test run's steps after the user changed one step (the "anchor" step).
The user may have re-recorded or replaced behavior so that some *later* steps are now redundant, wrong, or would replay obsolete UI paths.

You are given:
- The anchor step (sequence, action, instruction, origin) — this is what was just added or edited.
- Forward steps: only steps that come *after* the anchor in sequence order and are not already marked "skip replay". Each has id, sequence, action, instruction, origin.

Task: Identify which forward steps should be marked **Skip replay** (excluded from automated playback) because they are likely irrelevant or harmful after the anchor change. Prefer marking steps that duplicate work, target removed UI, or would execute stale automation.

Rules:
- Only suggest steps that appear in the forward list; use the exact \`id\` values provided.
- Do **not** suggest steps that are still clearly needed for the scenario.
- If none qualify, return an empty suggestions array.
- Respond ONLY with valid JSON:
{ "suggestions": [ { "stepId": "<uuid from forward list>", "reason": "<short reason>" } ] }`;

export type SuggestSkipAnchorInput = {
  sequence: number;
  instruction: string;
  action: string;
  origin: string;
};

export type SuggestSkipForwardStepInput = {
  id: string;
  sequence: number;
  instruction: string;
  action: string;
  origin: string;
};

/** Returned when an AI prompt Test fails and the server asks the LLM for guidance. */
export type AiPromptTestFailureHelp = {
  explanation: string;
  suggestedPrompt: string;
};

function parseJsonFromLlmText(raw: string): unknown {
  const t = raw.trim();
  if (!t) {
    throw new Error('LLM returned empty response (no JSON to parse)');
  }
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)```\s*$/m.exec(t);
  const payload = fence ? fence[1].trim() : t;
  if (!payload) {
    throw new Error('LLM returned empty JSON payload after extraction');
  }
  try {
    return JSON.parse(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const head = payload.slice(0, 120);
    const tail = payload.slice(-120);
    throw new Error(
      `JSON parse failed (${msg}); response length=${payload.length}, head=${JSON.stringify(head)} tail=${JSON.stringify(tail)}`,
    );
  }
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  /** Self-tests / dev: bypass per-user routing when set. */
  private chatProviderOverride: LlmProvider | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly llmConfig: LlmConfigService,
  ) {}

  /** @deprecated Prefer env + DB routing; used by llm-suggest-skip.selftest. */
  setProvider(provider: LlmProvider) {
    this.chatProviderOverride = provider;
  }

  getProvider(): LlmProvider | null {
    return this.chatProviderOverride;
  }

  private async chatJson(
    userId: string | undefined,
    usage: 'action_to_instruction' | 'explain_ai_prompt_failure' | 'suggest_skip_after_change',
    messages: ChatMessage[],
    options?: LlmChatOptions,
  ): Promise<{ content: string; thinking?: string }> {
    if (this.chatProviderOverride) {
      return this.chatProviderOverride.chat(messages, options);
    }

    const resolved = await this.llmConfig.resolve(userId, usage);
    const credentials = await this.llmConfig.resolveProviderCredentials(userId, resolved.provider);
    if (resolved.provider === 'gemini') {
      const key = credentials.apiKey;
      if (!key) {
        throw new Error(`No API key for provider ${resolved.provider}`);
      }
      return geminiChat(key, resolved.model, messages, options);
    }

    const client = createChatLlmProvider(this.configService, resolved.provider, resolved.model, credentials);
    return client.chat(messages, {
      ...options,
      responseFormat: 'json_object',
    });
  }

  async actionToInstruction(
    input: ActionToInstructionInput,
    opts?: { userId?: string },
  ): Promise<ActionToInstructionOutput> {
    if (this.chatProviderOverride) {
      const userPrompt = `Action: ${input.action}
Selector: ${input.selector}
Element HTML: ${input.elementHtml}
${input.elementVisibleText ? `Visible text: ${input.elementVisibleText}\n` : ''}${input.ariaLabel ? `Aria label: ${input.ariaLabel}\n` : ''}${input.value ? `Value: ${input.value}\n` : ''}Page context (accessibility tree excerpt):
${input.pageAccessibilityTree.slice(0, 3000)}`;
      try {
        const response = await this.chatProviderOverride.chat([
          { role: 'system', content: ACTION_TO_INSTRUCTION_SYSTEM },
          { role: 'user', content: userPrompt },
        ]);
        return JSON.parse(response.content);
      } catch (err) {
        this.logger.error('actionToInstruction failed', err);
        const label = input.elementVisibleText?.trim() || input.ariaLabel?.trim();
        return {
          instruction:
            input.action === 'click' && label
              ? `Click ${label}`
              : `${input.action} on ${input.selector}`,
          playwrightCode: `// ${input.action}: ${input.selector}`,
        };
      }
    }

    try {
      const userPrompt = `Action: ${input.action}
Selector: ${input.selector}
Element HTML: ${input.elementHtml}
${input.elementVisibleText ? `Visible text: ${input.elementVisibleText}\n` : ''}${input.ariaLabel ? `Aria label: ${input.ariaLabel}\n` : ''}${input.value ? `Value: ${input.value}\n` : ''}Page context (accessibility tree excerpt):
${input.pageAccessibilityTree.slice(0, 3000)}`;

      const response = await this.chatJson(
        opts?.userId,
        'action_to_instruction',
        [
          { role: 'system', content: ACTION_TO_INSTRUCTION_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        { maxTokens: 4096, temperature: 0.2 },
      );
      return JSON.parse(response.content);
    } catch (err) {
      this.logger.error('actionToInstruction failed', err);
      const label = input.elementVisibleText?.trim() || input.ariaLabel?.trim();
      return {
        instruction:
          input.action === 'click' && label
            ? `Click ${label}`
            : `${input.action} on ${input.selector}`,
        playwrightCode: `// ${input.action}: ${input.selector}`,
      };
    }
  }

  async instructionToAction(
    input: InstructionToActionInput,
    opts?: {
      userId?: string;
      signal?: AbortSignal;
      onStream?: (ev: { rawText: string; thinking?: string }) => void;
    },
  ): Promise<InstructionToActionResult> {
    const startedAt = Date.now();
    const shot = input.screenshotBase64?.trim();
    if (!shot) {
      throw new Error(
        'A screenshot is required for Playwright instruction generation (capture failed or was skipped).',
      );
    }

    const codegen = await this.llmConfig.resolve(opts?.userId, 'playwright_codegen');
    const codegenCredentials = await this.llmConfig.resolveProviderCredentials(opts?.userId, codegen.provider);
    const apiKey = codegenCredentials.apiKey;
    if (codegen.provider === 'gemini' && !apiKey) {
      throw new Error(
        `No API key for provider "${codegen.provider}". Configure the provider in Settings or .env (see README).`,
      );
    }

    const fullPrompt = buildGeminiInstructionPrompt({
      instruction: input.instruction,
      pageUrl: input.pageUrl,
      somManifest: input.somManifest,
      accessibilitySnapshot: input.accessibilitySnapshot,
    });

    let draftPlaywrightCode: string;
    let thinking: string | undefined;

    if (codegen.provider === 'gemini') {
      const geminiApiKey = apiKey;
      const out = await generateGeminiPlaywrightSnippet({
        apiKey: geminiApiKey as string,
        model: codegen.model,
        fullPrompt,
        imageBase64: shot,
        signal: opts?.signal,
        onProgress: opts?.onStream,
      });
      draftPlaywrightCode = out.playwrightCode;
      thinking = out.thinking;
    } else {
      const out = await generateNonGeminiVisionPlaywrightSnippet({
        config: this.configService,
        provider: codegen.provider,
        model: codegen.model,
        credentials: codegenCredentials,
        input,
        imageBase64: shot,
        signal: opts?.signal,
        onProgress: opts?.onStream,
      });
      draftPlaywrightCode = out.playwrightCode;
      thinking = out.thinking;
    }

    const verifyOn = this.llmConfig.geminiInstructionVerifyEnabled();
    let finalPlaywrightCode = draftPlaywrightCode;
    let verifyUserPrompt: string | undefined;
    let verifyRawResponse: string | undefined;
    if (verifyOn) {
      const verify = await this.llmConfig.resolve(opts?.userId, 'playwright_verify');
      verifyUserPrompt = buildGeminiVerifyPrompt({
        instruction: input.instruction,
        pageUrl: input.pageUrl,
        somManifest: input.somManifest,
        accessibilitySnapshot: input.accessibilitySnapshot,
        draftPlaywrightCode,
      });
      const verifyStartedAt = Date.now();
      try {
        if (verify.provider === 'gemini') {
          const verifyCredentials = await this.llmConfig.resolveProviderCredentials(opts?.userId, 'gemini');
          const vk = verifyCredentials.apiKey;
          if (!vk) {
            this.logger.warn('DOM verify skipped: Gemini provider is not configured');
          } else {
            const verified = await verifyGeminiPlaywrightAgainstDom({
              apiKey: vk,
              model: verify.model,
              instruction: input.instruction,
              pageUrl: input.pageUrl,
              somManifest: input.somManifest,
              accessibilitySnapshot: input.accessibilitySnapshot,
              draftPlaywrightCode,
              signal: opts?.signal,
            });
            verifyRawResponse = verified.rawText;
            finalPlaywrightCode = verified.playwrightCode;
          }
        } else {
          const verifyCredentials = await this.llmConfig.resolveProviderCredentials(opts?.userId, verify.provider);
          const verified = await verifyPlaywrightAgainstDomNonGemini({
            config: this.configService,
            provider: verify.provider,
            model: verify.model,
            credentials: verifyCredentials,
            instruction: input.instruction,
            pageUrl: input.pageUrl,
            somManifest: input.somManifest,
            accessibilitySnapshot: input.accessibilitySnapshot,
            draftPlaywrightCode,
            signal: opts?.signal,
          });
          verifyRawResponse = verified.rawText;
          finalPlaywrightCode = verified.playwrightCode;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`DOM verify pass failed; using draft codegen only: ${msg}`);
      }
    }

    const output: InstructionToActionOutput = {
      playwrightCode: finalPlaywrightCode,
      action: 'custom',
      selector: undefined,
      value: undefined,
    };

    return {
      output,
      transcript: {
        systemPrompt: '',
        userPrompt: fullPrompt,
        rawResponse: finalPlaywrightCode,
        ...(verifyOn ? { draftPlaywrightCode } : {}),
        ...(verifyUserPrompt ? { verifyUserPrompt } : {}),
        ...(verifyRawResponse ? { verifyRawResponse } : {}),
        visionAttached: true,
        screenshotBase64: shot,
        ...(thinking ? { thinking } : {}),
      },
    };
  }

  async explainAiPromptTestFailure(
    input: {
      instruction: string;
      technicalError: string;
      pageUrl: string;
      pageAccessibilityTree: string;
      screenshotBase64?: string;
      failedPlaywrightCode?: string;
    },
    opts?: { signal?: AbortSignal; userId?: string },
  ): Promise<AiPromptTestFailureHelp | null> {
    if (this.chatProviderOverride) {
      const user = `Original test instruction:\n"""${input.instruction}"""\n\nFailure (technical):\n"""${input.technicalError.slice(0, 8000)}"""${input.failedPlaywrightCode?.trim() ? `\n\nFailed Playwright code:\n"""${input.failedPlaywrightCode.trim().slice(0, 12000)}"""` : ''}\n\nCurrent page URL: ${input.pageUrl}\n\nPage context (accessibility / structure, may be partial):\n${input.pageAccessibilityTree.slice(0, 12000)}`;
      try {
        const llm = await this.chatProviderOverride.chat(
          [
            { role: 'system', content: EXPLAIN_AI_PROMPT_TEST_FAILURE_SYSTEM },
            { role: 'user', content: user },
          ],
          {
            imageBase64: input.screenshotBase64,
            maxTokens: 4096,
            reasoningEffort: 'low',
            signal: opts?.signal,
          },
        );
        const parsed = parseJsonFromLlmText(llm.content) as { explanation?: unknown; suggestedPrompt?: unknown };
        if (typeof parsed.explanation !== 'string' || typeof parsed.suggestedPrompt !== 'string') return null;
        const explanation = parsed.explanation.trim();
        const suggestedPrompt = parsed.suggestedPrompt.trim();
        if (!explanation || !suggestedPrompt) return null;
        return { explanation, suggestedPrompt };
      } catch {
        return null;
      }
    }

    try {
      const user = `Original test instruction:\n"""${input.instruction}"""\n\nFailure (technical):\n"""${input.technicalError.slice(0, 8000)}"""${input.failedPlaywrightCode?.trim() ? `\n\nFailed Playwright code:\n"""${input.failedPlaywrightCode.trim().slice(0, 12000)}"""` : ''}\n\nCurrent page URL: ${input.pageUrl}\n\nPage context (accessibility / structure, may be partial):\n${input.pageAccessibilityTree.slice(0, 12000)}`;
      const llm = await this.chatJson(
        opts?.userId,
        'explain_ai_prompt_failure',
        [
          { role: 'system', content: EXPLAIN_AI_PROMPT_TEST_FAILURE_SYSTEM },
          { role: 'user', content: user },
        ],
        {
          imageBase64: input.screenshotBase64,
          maxTokens: 4096,
          reasoningEffort: 'low',
          signal: opts?.signal,
        },
      );
      const parsed = parseJsonFromLlmText(llm.content) as { explanation?: unknown; suggestedPrompt?: unknown };
      if (typeof parsed.explanation !== 'string' || typeof parsed.suggestedPrompt !== 'string') return null;
      const explanation = parsed.explanation.trim();
      const suggestedPrompt = parsed.suggestedPrompt.trim();
      if (!explanation || !suggestedPrompt) return null;
      return { explanation, suggestedPrompt };
    } catch (err) {
      this.logger.warn(`explainAiPromptTestFailure: ${err}`);
      return null;
    }
  }

  async suggestStepsToSkipAfterChange(
    input: {
      anchor: SuggestSkipAnchorInput;
      forwardSteps: SuggestSkipForwardStepInput[];
    },
    opts?: { userId?: string },
  ): Promise<{ suggestions: Array<{ stepId: string; reason: string }> }> {
    if (this.chatProviderOverride) {
      if (input.forwardSteps.length === 0) return { suggestions: [] };
      const userPayload = JSON.stringify({ anchor: input.anchor, forwardSteps: input.forwardSteps }, null, 2);
      const response = await this.chatProviderOverride.chat([
        { role: 'system', content: SUGGEST_SKIP_AFTER_CHANGE_SYSTEM },
        { role: 'user', content: userPayload },
      ]);
      let parsed: unknown;
      try {
        parsed = parseJsonFromLlmText(response.content);
      } catch (err) {
        this.logger.error('suggestStepsToSkipAfterChange: invalid JSON', err);
        return { suggestions: [] };
      }
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('suggestions' in parsed) ||
        !Array.isArray((parsed as { suggestions: unknown }).suggestions)
      ) {
        return { suggestions: [] };
      }
      const out: Array<{ stepId: string; reason: string }> = [];
      for (const item of (parsed as { suggestions: unknown[] }).suggestions) {
        if (typeof item !== 'object' || item === null) continue;
        const stepId = (item as { stepId?: unknown }).stepId;
        const reason = (item as { reason?: unknown }).reason;
        if (typeof stepId !== 'string' || typeof reason !== 'string' || !stepId.trim() || !reason.trim()) continue;
        out.push({ stepId: stepId.trim(), reason: reason.trim() });
      }
      return { suggestions: out };
    }

    const resolved = await this.llmConfig.resolve(opts?.userId, 'suggest_skip_after_change');
    const credentials = await this.llmConfig.resolveProviderCredentials(opts?.userId, resolved.provider);
    if (resolved.provider === 'gemini' && !credentials.apiKey) {
      this.logger.warn('suggestStepsToSkipAfterChange: no API key for configured provider');
      return { suggestions: [] };
    }

    if (input.forwardSteps.length === 0) {
      return { suggestions: [] };
    }

    const userPayload = JSON.stringify(
      {
        anchor: input.anchor,
        forwardSteps: input.forwardSteps,
      },
      null,
      2,
    );

    try {
      const response = await this.chatJson(
        opts?.userId,
        'suggest_skip_after_change',
        [
          { role: 'system', content: SUGGEST_SKIP_AFTER_CHANGE_SYSTEM },
          { role: 'user', content: userPayload },
        ],
        { maxTokens: 4096, temperature: 0.2 },
      );

      let parsed: unknown;
      try {
        parsed = parseJsonFromLlmText(response.content);
      } catch (err) {
        this.logger.error('suggestStepsToSkipAfterChange: invalid JSON', err);
        return { suggestions: [] };
      }

      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('suggestions' in parsed) ||
        !Array.isArray((parsed as { suggestions: unknown }).suggestions)
      ) {
        return { suggestions: [] };
      }

      const out: Array<{ stepId: string; reason: string }> = [];
      for (const item of (parsed as { suggestions: unknown[] }).suggestions) {
        if (typeof item !== 'object' || item === null) continue;
        const stepId = (item as { stepId?: unknown }).stepId;
        const reason = (item as { reason?: unknown }).reason;
        if (typeof stepId !== 'string' || typeof reason !== 'string' || !stepId.trim() || !reason.trim()) {
          continue;
        }
        out.push({ stepId: stepId.trim(), reason: reason.trim() });
      }
      return { suggestions: out };
    } catch (err) {
      this.logger.warn(`suggestStepsToSkipAfterChange: ${err}`);
      return { suggestions: [] };
    }
  }
}
