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
  truncateDomSectionsForGemini,
} from './gemini-instruction.client';
import { geminiChat } from './gemini-llm-chat.adapter';
import { LlmConfigService } from './llm-config.service';
import { createChatLlmProvider } from './llm-provider-factory';
import type { LlmUsageKey } from './llm-usage-registry';
import {
  generateNonGeminiVisionPlaywrightSnippet,
  verifyPlaywrightAgainstDomNonGemini,
} from './vision-playwright-codegen';
import { parseOptimizedPromptSpec, type OptimizedPromptSpec } from '../recording/optimized-prompt-metadata';

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

const EVALUATION_CODEGEN_SYSTEM = `You are a QA automation agent exploring a web app with Playwright. The user authorized testing against their own staging or demo app.

You receive a full-page Set-of-Marks screenshot (numeric badges on interactives), an interactive manifest with the same [n] indices, a Playwright CDP accessibility snapshot, the starting URL, the overall evaluation intent, desired final output, and a short summary of prior steps. Use screenshot + manifest + snapshot together; emitted Playwright must use normal locators (getByRole, getByLabel, getByText, etc.) — never reference badge numbers in the code.

Respond ONLY with valid JSON:
{
  "stepTitle": "<short human-readable name for this step (e.g. Open login form) — under 80 chars>",
  "thinking": "<what you observe and why you propose the next action toward the intent>",
  "playwrightCode": "<single async IIFE body using only \`page\` and \`expect\` from Playwright test — valid JavaScript statements, no imports; e.g. await page.getByRole('button', { name: 'Next' }).click();>",
  "expectedOutcome": "<what should change in the UI after this code runs>"
}

Rules:
- Output executable Playwright snippets only; no TypeScript types; no require/import.
- Prefer getByRole, getByLabel, getByText with stable accessible names.
- For custom selects/listboxes, use getByRole('option', { name: '…', exact: true }) or scope to the open listbox so strict mode does not match multiple options.
- One focused step per response; avoid multi-page tours in one snippet.
- If the goal appears complete from the screenshot, use a no-op or wait: e.g. await page.waitForTimeout(500); and explain in expectedOutcome that you are confirming completion.`;

const EVALUATION_ANALYZER_SYSTEM = `You judge progress of an autonomous web evaluation. The app under test is owned by the user for QA.

You receive a full-page Set-of-Marks screenshot after the step, plus manifest and accessibility snapshot text aligned with the same capture pipeline as codegen.

Respond ONLY with valid JSON:
{
  "goalProgress": "partial" | "complete" | "blocked",
  "decision": "retry" | "advance" | "ask_human" | "finish",
  "rationale": "<short reasoning>",
  "humanQuestion": "<only if decision is ask_human: clear question for the user>",
  "humanOptions": ["<3-4 short option labels>", "..."]
}

Rules:
- Use "finish" when the evaluation intent and desired output are sufficiently addressed or cannot proceed without external info.
- Use "ask_human" when authentication, ambiguous business logic, or destructive actions need explicit user choice; always provide humanQuestion and exactly 3-4 humanOptions. If the user message includes a "Run configuration (automatic sign-in)" section, follow it for when credential screens should not trigger ask_human.
- Use "retry" when the last Playwright step failed or the UI did not reach the expected state.
- Use "advance" when the step succeeded and exploration should continue.`;

function appendEvaluationCodegenAutoSignInUserBlock(
  baseUser: string,
  autoSignInEnabled: boolean,
  autoSignInCompleted: boolean,
): string {
  if (!autoSignInEnabled || autoSignInCompleted) {
    return baseUser;
  }
  return `${baseUser}

Run configuration (automatic sign-in):
- This evaluation has automatic sign-in ENABLED and sign-in has not finished yet in this run.
- Do NOT emit Playwright that types email, password, OTP, or recovery codes—the host runs Clerk/project test-user sign-in before this step's codegen.
- If the page still shows a login or MFA gate, prefer a minimal step (e.g. short waitForTimeout, waitForLoadState, or a safe non-credential interaction) rather than credential entry.`;
}

function appendEvaluationAnalyzerAutoSignInUserBlock(
  baseUser: string,
  autoSignInEnabled: boolean,
  autoSignInCompleted: boolean,
): string {
  if (!autoSignInEnabled) {
    return baseUser;
  }
  if (!autoSignInCompleted) {
    return `${baseUser}

Run configuration (automatic sign-in):
- This evaluation has automatic sign-in ENABLED; the host runs automated sign-in before each step until success.
- Do NOT choose "ask_human" solely because the screenshot shows a login, MFA, or sign-in screen—prefer "retry" if the step failed or the UI is unchanged, or "advance" if the step executed and exploration should continue; the next iteration can run assist again.
- Use "ask_human" for credential questions only when automatic sign-in is disabled for this run, or for non-credential issues (ambiguous product behavior, destructive actions, etc.).`;
  }
  return `${baseUser}

Run configuration (automatic sign-in):
- Automatic sign-in for this evaluation has already completed for this run; normal "ask_human" rules apply (including new auth gates if needed).`;
}

function appendAgentContextUserBlock(baseUser: string, appendix?: string | null): string {
  const a = appendix?.trim();
  if (!a) return baseUser;
  return `${baseUser}

Agent instructions (workspace / project):
${a}`;
}

const PROJECT_DISCOVERY_SYSTEM = `You document a web application for QA automation agents. The app is owned by the user for staging or demo testing; treat visible data as synthetic.

Respond ONLY with valid JSON:
{
  "markdown": "<readable summary: product purpose, main areas, navigation, controls, tactical advice for Playwright agents>",
  "structured": { "schemaVersion": 1, "routes": [ { "pathPattern": "...", "title": "...", "notes": "..." } ], "screens": [ { "id": "...", "title": "...", "pathPattern": "...", "notes": "...", "notableElements": [ "..." ] } ], "agentAdvice": [ "short bullets for automation" ] }
}

Ground the answer in the screenshot, Set-of-Marks manifest, and accessibility snapshot. Do not invent routes you cannot infer from the evidence; it is OK to note uncertainty.`;

const EVALUATION_REPORT_SYSTEM = `You write structured evaluation reports for QA. The user tests their own applications; treat UI data as synthetic.

Respond ONLY with valid JSON:
{
  "markdown": "<full markdown report: app purpose, navigation/IA, main workflows observed, notable screens, gaps/risks, suggested follow-ups>",
  "structured": { "sections": [ { "title": "...", "body": "..." } ] }
}`;

const OPTIMIZED_PROMPT_SYSTEM = `You are an Interaction Intent Compiler for complex SaaS web applications.

Your job is to convert one recorded UI step into a future-proof playback instruction that reproduces the USER'S INTENDED ACTION, not the exact historical UI mechanics.

You will receive evidence for a single step, which may include:
1. A tagged screenshot of the page at the moment of the action
2. The DOM accessibility tree
3. The Playwright snippet generated for the action
4. Optional context about the test, demo, workflow, previous steps, or app domain

Your task is to infer the semantic intent behind the step and produce a canonical action specification that can later be used by another AI agent to execute the same intention even if the UI layout, selectors, labels, structure, or interaction path change.

Core principles:
1. Preserve intent, not implementation.
2. Prefer business meaning over UI wording.
3. Describe the target by role and meaning, not by brittle selectors.
4. Use the screenshot, accessibility tree, and Playwright code together. Do not rely on only one source.
5. Infer the most likely user goal from context.
6. Be conservative when evidence is ambiguous. State uncertainty explicitly.
7. Never output coordinates, CSS selectors, XPath, DOM paths, internal test ids, or transient implementation details unless they are the only meaningful identifiers and are semantically important.
8. Do not anchor the instruction to today's screen layout.
9. The output must be reusable by a playback agent in a future version of the UI.
10. Focus on the smallest meaningful user intention represented by this step.

When reconstructing intent, identify:
1. The action type being attempted
2. The business object involved
3. The target control or destination in semantic terms
4. Any required value being entered, selected, confirmed, opened, closed, searched, filtered, or submitted
5. Preconditions that make the action valid
6. The expected observable result after the action
7. Disambiguation hints that help a future agent find the correct target if the UI changes

Guidelines for robust intent extraction:
1. If the step is navigation, describe where the user is trying to go in product terms.
2. If the step is data entry, describe the field by meaning and the intended value.
3. If the step is selection, describe what is being selected and why.
4. If the step is submission or confirmation, describe the operation being committed.
5. If the step is opening a patient, chart, task, encounter, order, message, or other domain entity, describe the entity type and identifying context.
6. If labels differ across assets, infer the most semantically stable phrasing.
7. If multiple candidate intents exist, choose the best supported one and report alternatives in uncertainty_notes.
8. If the Playwright code is overly mechanical, abstract it into user intent.
9. If the action is part of a larger workflow, preserve only the intent of this specific step while referencing necessary context.

Create a playback prompt that another LLM can later use to perform the same action in a changed UI.
That playback prompt must:
1. Be imperative and action oriented
2. Be specific enough to execute
3. Be general enough to survive UI changes
4. Include what success looks like
5. Avoid brittle implementation details
6. Include fallback guidance for ambiguity

Output format:
Return ONLY valid JSON.
Do not include markdown fences.
Do not include explanations outside the JSON.

JSON schema:
{
  "step_intent_summary": "One sentence summary of the user's intent for this step.",
  "canonical_playback_prompt": "A future-proof prompt that instructs a playback agent to reproduce the intended action in the product.",
  "action_type": "One of: navigate | open | click | input | select | search | filter | submit | confirm | toggle | create | update | delete | close | expand | collapse | download | upload | other",
  "business_object": "The domain object involved, if any, such as patient, appointment, medication, encounter, message, order, task, report, chart, or null.",
  "target_semantic_description": "A stable semantic description of the target element, view, field, record, or control.",
  "input_or_selection_value": "The value entered or chosen, if any, else null.",
  "preconditions": [
    "List of conditions that should already be true before replaying this step."
  ],
  "expected_outcome": [
    "List of observable results that indicate the step succeeded."
  ],
  "disambiguation_hints": [
    "Stable clues a future playback agent can use to locate the correct target if the UI has changed."
  ],
  "do_not_depend_on": [
    "Things the playback agent should avoid relying on, such as exact wording, exact location, CSS classes, or specific containers."
  ],
  "uncertainty_notes": [
    "Any ambiguity or alternate interpretations supported by the evidence."
  ],
  "confidence": 0.0
}

Quality bar:
1. The canonical_playback_prompt must sound like an instruction to a smart UI agent.
2. It must describe the user goal and intended result, not the historical click path.
3. It must be concise but operational.
4. It must be grounded in the supplied evidence.
5. Confidence must be between 0 and 1.`;

const AI_VISUAL_ID_SYSTEM = `You are AI Visual ID, a UI-understanding assistant for QA engineers.

You receive:
1. The user's question or prompt about the current UI
2. A labeled screenshot with numeric Set-of-Marks badges
3. The complete accessibility tree
4. A Set-of-Marks manifest that maps badge numbers to interactive elements

Your job is to answer the user's question using only the supplied evidence.

Rules:
- Ground your answer in the screenshot, tag numbers, accessibility tree, and page URL.
- When referring to visible elements, cite their tag numbers when possible, like [12].
- If the evidence is ambiguous, say so plainly.
- Do not invent UI details that are not supported by the screenshot or tree.
- Return plain text, not JSON or markdown tables, unless the user explicitly asked for a structured format.`;

export type OptimizedPromptCompilerInput = {
  appContext: string;
  workflowContext: string;
  stepId: string;
  stepIndex: number;
  recordingMode: string;
  timestamp: string;
  previousStepSummaries: string[];
  nextStepSummaries: string[];
  humanPromptOrNull?: string | null;
  playwrightSnippet: string;
  taggedScreenshotDescription: string;
  accessibilityTree: string;
  optionalPageMetadata?: string;
  screenshotBase64?: string;
};

export type OptimizedPromptCompilerResult = {
  output: OptimizedPromptSpec;
  transcript: {
    systemPrompt: string;
    userPrompt: string;
    rawResponse: string;
    thinking?: string;
  };
};

function buildOptimizedPromptUserPrompt(input: OptimizedPromptCompilerInput): string {
  const previous = input.previousStepSummaries.length
    ? JSON.stringify(input.previousStepSummaries, null, 2)
    : 'null';
  const next = input.nextStepSummaries.length ? JSON.stringify(input.nextStepSummaries, null, 2) : 'null';
  const humanPrompt = input.humanPromptOrNull?.trim() ? input.humanPromptOrNull.trim() : 'null';
  const optionalPageMetadata = input.optionalPageMetadata?.trim() ? input.optionalPageMetadata.trim() : 'null';
  return `Convert the following recorded UI step into a future-proof intent specification for playback.

Application context:
${input.appContext}

Workflow context:
${input.workflowContext}

Step metadata:
{
  "step_id": "${input.stepId}",
  "step_index": ${input.stepIndex},
  "recording_mode": "${input.recordingMode}",
  "timestamp": "${input.timestamp}"
}

Optional previous step summaries:
${previous}

Optional next step summaries:
${next}

Human instruction used to create the step, if any:
${humanPrompt}

Generated Playwright code for this step:

${input.playwrightSnippet}

Tagged screenshot description or OCR-like tagged regions:
${input.taggedScreenshotDescription}

Accessibility tree:

${input.accessibilityTree}

Additional DOM or page metadata, if available:

${optionalPageMetadata}

Important requirements:

Infer the real user intention behind this single step.
Produce a canonical playback prompt that would still work if the UI changes in layout, styling, selectors, or exact wording.
Prefer product meaning over literal labels when the meaning is clear.
Use domain terminology when appropriate.
If there is ambiguity, make the best supported interpretation and mention uncertainty in uncertainty_notes.
Output ONLY valid JSON matching the required schema.

## What the generated playback prompt should feel like

A good result from that template will produce prompts like these:

Open the patient's chart from the current worklist by selecting the row or control corresponding to John A. Smith, using patient identity and surrounding clinical context to disambiguate. Do not rely on the exact row position or current table layout. Succeed when the patient chart is displayed and the header or main content clearly reflects that patient's record.
Enter the patient's date of birth into the demographic form using the value 02/14/1978, targeting the field whose meaning is date of birth even if its label or placement has changed. Succeed when the form shows the value applied to the birth date field without validation errors.
Apply the medication filter for active prescriptions in the current medications view. Use the filter control associated with medication status, not its exact location or current widget style. Succeed when the list updates to show only active medications.`;
}

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

  private async chatWithUsage(
    userId: string | undefined,
    usage: LlmUsageKey,
    messages: ChatMessage[],
    options?: LlmChatOptions,
  ): Promise<{ content: string; thinking?: string; provider: string; model: string }> {
    const dbg = options?.onDebugLog;
    if (this.chatProviderOverride) {
      dbg?.('LLM route: using override provider', { usage });
      const t0 = Date.now();
      const result = await this.chatProviderOverride.chat(messages, options);
      dbg?.('LLM override: response', { ms: Date.now() - t0, contentChars: result.content.length });
      return { ...result, provider: 'override', model: 'override' };
    }

    dbg?.('LLM route: resolving config', { usage });
    const resolved = await this.llmConfig.resolve(userId, usage);
    const credentials = await this.llmConfig.resolveProviderCredentials(userId, resolved.provider);
    dbg?.('LLM route: resolved', { usage, provider: resolved.provider, model: resolved.model });
    if (resolved.provider === 'gemini') {
      const key = credentials.apiKey;
      if (!key) {
        throw new Error(`No API key for provider ${resolved.provider}`);
      }
      const result = await geminiChat(key, resolved.model, messages, options);
      return { ...result, provider: resolved.provider, model: resolved.model };
    }

    const sysLen = messages.find((m) => m.role === 'system')?.content?.length ?? 0;
    const userLen = messages
      .filter((m) => m.role === 'user')
      .reduce((a, m) => a + m.content.length, 0);
    dbg?.('LLM non-Gemini: request', {
      provider: resolved.provider,
      model: resolved.model,
      systemChars: sysLen,
      userChars: userLen,
      hasImage: Boolean(options?.imageBase64?.trim()),
    });
    const t1 = Date.now();
    const client = createChatLlmProvider(this.configService, resolved.provider, resolved.model, credentials);
    const result = await client.chat(messages, options);
    dbg?.('LLM non-Gemini: response', {
      provider: resolved.provider,
      ms: Date.now() - t1,
      contentChars: result.content.length,
      thinkingChars: result.thinking?.length,
    });
    return { ...result, provider: resolved.provider, model: resolved.model };
  }

  private async chatJson(
    userId: string | undefined,
    usage: LlmUsageKey,
    messages: ChatMessage[],
    options?: LlmChatOptions,
  ): Promise<{ content: string; thinking?: string }> {
    const result = await this.chatWithUsage(userId, usage, messages, {
      ...options,
      responseFormat: 'json_object',
    });
    return { content: result.content, thinking: result.thinking };
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
      agentContextBlock: input.agentContextBlock,
      failedPlaywrightCode: input.failedPlaywrightCode,
      recordedPlaywrightCode: input.recordedPlaywrightCode,
      priorFailureKind: input.priorFailureKind,
      priorFailureMessage: input.priorFailureMessage,
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
        agentContextBlock: input.agentContextBlock,
        failedPlaywrightCode: input.failedPlaywrightCode,
        recordedPlaywrightCode: input.recordedPlaywrightCode,
        priorFailureKind: input.priorFailureKind,
        priorFailureMessage: input.priorFailureMessage,
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
              agentContextBlock: input.agentContextBlock,
              failedPlaywrightCode: input.failedPlaywrightCode,
              recordedPlaywrightCode: input.recordedPlaywrightCode,
              priorFailureKind: input.priorFailureKind,
              priorFailureMessage: input.priorFailureMessage,
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
            agentContextBlock: input.agentContextBlock,
            failedPlaywrightCode: input.failedPlaywrightCode,
            recordedPlaywrightCode: input.recordedPlaywrightCode,
            priorFailureKind: input.priorFailureKind,
            priorFailureMessage: input.priorFailureMessage,
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

  async aiVisualId(
    input: {
      prompt: string;
      pageUrl: string;
      somManifest: string;
      accessibilitySnapshot: string;
      screenshotBase64: string;
    },
    opts?: { userId?: string; signal?: AbortSignal },
  ): Promise<{ answer: string; fullPrompt: string; provider: string; model: string; thinking?: string }> {
    const fullPrompt = `User prompt:
${input.prompt.trim()}

Page URL:
${input.pageUrl}

Set-of-Marks manifest:
${input.somManifest.trim() || '(no interactive tags found)'}

Accessibility tree:
${input.accessibilitySnapshot.trim() || '(no accessibility tree captured)'}

Answer the user using only this evidence. Reference tag numbers like [7] when they help identify the UI element.`;

    const result = await this.chatWithUsage(
      opts?.userId,
      'ai_visual_id',
      [
        { role: 'system', content: AI_VISUAL_ID_SYSTEM },
        { role: 'user', content: fullPrompt },
      ],
      {
        imageBase64: input.screenshotBase64,
        maxTokens: 4096,
        temperature: 0.2,
        responseFormat: 'text',
        signal: opts?.signal,
      },
    );

    return {
      answer: result.content.trim(),
      fullPrompt,
      provider: result.provider,
      model: result.model,
      ...(result.thinking ? { thinking: result.thinking } : {}),
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
      recordedPlaywrightCode?: string;
    },
    opts?: { signal?: AbortSignal; userId?: string },
  ): Promise<AiPromptTestFailureHelp | null> {
    if (this.chatProviderOverride) {
      const user = `Original test instruction:\n"""${input.instruction}"""\n\nFailure (technical):\n"""${input.technicalError.slice(0, 8000)}"""${input.failedPlaywrightCode?.trim() ? `\n\nFailed Playwright code:\n"""${input.failedPlaywrightCode.trim().slice(0, 12000)}"""` : ''}${input.recordedPlaywrightCode?.trim() ? `\n\nOriginal recorded Playwright code:\n"""${input.recordedPlaywrightCode.trim().slice(0, 12000)}"""` : ''}\n\nCurrent page URL: ${input.pageUrl}\n\nPage context (accessibility / structure, may be partial):\n${input.pageAccessibilityTree.slice(0, 12000)}`;
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
      const user = `Original test instruction:\n"""${input.instruction}"""\n\nFailure (technical):\n"""${input.technicalError.slice(0, 8000)}"""${input.failedPlaywrightCode?.trim() ? `\n\nFailed Playwright code:\n"""${input.failedPlaywrightCode.trim().slice(0, 12000)}"""` : ''}${input.recordedPlaywrightCode?.trim() ? `\n\nOriginal recorded Playwright code:\n"""${input.recordedPlaywrightCode.trim().slice(0, 12000)}"""` : ''}\n\nCurrent page URL: ${input.pageUrl}\n\nPage context (accessibility / structure, may be partial):\n${input.pageAccessibilityTree.slice(0, 12000)}`;
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

  async compileOptimizedPrompt(
    input: OptimizedPromptCompilerInput,
    opts?: { signal?: AbortSignal; userId?: string },
  ): Promise<OptimizedPromptCompilerResult> {
    const userPrompt = buildOptimizedPromptUserPrompt(input);
    if (this.chatProviderOverride) {
      const llm = await this.chatProviderOverride.chat(
        [
          { role: 'system', content: OPTIMIZED_PROMPT_SYSTEM },
          { role: 'user', content: userPrompt },
        ],
        {
          imageBase64: input.screenshotBase64,
          maxTokens: 4096,
          temperature: 0.1,
          reasoningEffort: 'low',
          signal: opts?.signal,
          responseFormat: 'json_object',
        },
      );
      return {
        output: parseOptimizedPromptSpec(parseJsonFromLlmText(llm.content)),
        transcript: {
          systemPrompt: OPTIMIZED_PROMPT_SYSTEM,
          userPrompt,
          rawResponse: llm.content,
          ...(llm.thinking?.trim() ? { thinking: llm.thinking.trim() } : {}),
        },
      };
    }

    const llm = await this.chatJson(
      opts?.userId,
      'optimized_prompt',
      [
        { role: 'system', content: OPTIMIZED_PROMPT_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      {
        imageBase64: input.screenshotBase64,
        maxTokens: 4096,
        temperature: 0.1,
        reasoningEffort: 'low',
        signal: opts?.signal,
        responseFormat: 'json_object',
      },
    );

    return {
      output: parseOptimizedPromptSpec(parseJsonFromLlmText(llm.content)),
      transcript: {
        systemPrompt: OPTIMIZED_PROMPT_SYSTEM,
        userPrompt,
        rawResponse: llm.content,
        ...(llm.thinking?.trim() ? { thinking: llm.thinking.trim() } : {}),
      },
    };
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

  /**
   * Propose the next Playwright snippet for an evaluation step (vision + intent).
   */
  async evaluationProposePlaywrightStep(
    input: {
      url: string;
      intent: string;
      desiredOutput: string;
      progressSummary: string | null;
      priorStepsBrief: string;
      screenshotBase64: string;
      pageUrl: string;
      somManifest: string;
      accessibilitySnapshot: string;
      /** When true, evaluation has automatic sign-in enabled (Clerk / project test user). */
      autoSignInEnabled?: boolean;
      /** When true, automated sign-in already succeeded this run (`clerkFullSignInDone`). */
      autoSignInCompleted?: boolean;
      /** Merged workspace + project + discovery instructions (when evaluation has a project). */
      agentContextAppendix?: string;
    },
    opts?: { userId?: string; signal?: AbortSignal; onDebugLog?: (m: string, d?: Record<string, unknown>) => void },
  ): Promise<{ stepTitle: string; thinking: string; playwrightCode: string; expectedOutcome: string }> {
    const dbg = opts?.onDebugLog;
    const autoSignInEnabled = input.autoSignInEnabled ?? false;
    const autoSignInCompleted = input.autoSignInCompleted ?? false;
    dbg?.('evaluation_codegen: start', {
      pageUrl: input.pageUrl,
      screenshotBase64Chars: input.screenshotBase64?.length ?? 0,
      somManifestChars: input.somManifest?.length ?? 0,
      accessibilitySnapshotChars: input.accessibilitySnapshot?.length ?? 0,
      autoSignInEnabled,
      autoSignInCompleted,
    });
    const { som: somT, a11y: a11yT } = truncateDomSectionsForGemini(
      input.somManifest,
      input.accessibilitySnapshot,
    );
    dbg?.('evaluation_codegen: after truncation for model', {
      somChars: somT.length,
      a11yChars: a11yT.length,
    });
    const user = `Start URL: ${input.url}
Current page URL: ${input.pageUrl}
Overall intent:
${input.intent}

Desired final output:
${input.desiredOutput}

Progress summary (rolling):
${input.progressSummary?.trim() || '(none yet)'}

Prior steps (brief):
${input.priorStepsBrief.trim() || '(none)'}

Interactive manifest (Set-of-Marks [n] lines; aligned with badges on the attached full-page image):
${somT || '(empty)'}

Playwright CDP accessibility snapshot (captured before overlay; structural a11y tree):
${a11yT || '(empty)'}

The attached image is the full-page Set-of-Marks screenshot (numeric badges on interactives).`;
    const userWithAutoSignIn = appendEvaluationCodegenAutoSignInUserBlock(
      user,
      autoSignInEnabled,
      autoSignInCompleted,
    );
    const userWithAgent = appendAgentContextUserBlock(userWithAutoSignIn, input.agentContextAppendix);
    dbg?.('evaluation_codegen: user prompt assembled', {
      userPromptChars: userWithAgent.length,
      systemPromptChars: EVALUATION_CODEGEN_SYSTEM.length,
    });
    dbg?.('evaluation_codegen: invoking chatJson (JSON mode + vision)', { usageKey: 'evaluation_codegen' });
    const res = await this.chatJson(
      opts?.userId,
      'evaluation_codegen',
      [
        { role: 'system', content: EVALUATION_CODEGEN_SYSTEM },
        { role: 'user', content: userWithAgent },
      ],
      {
        imageBase64: input.screenshotBase64,
        maxTokens: 8192,
        temperature: 0.2,
        signal: opts?.signal,
        onDebugLog: dbg,
      },
    );
    dbg?.('evaluation_codegen: raw JSON response received', {
      contentChars: res.content.length,
      hasThinkingField: res.thinking != null && res.thinking !== '',
    });
    const parsed = parseJsonFromLlmText(res.content) as Record<string, unknown>;
    const stepTitleRaw = typeof parsed.stepTitle === 'string' ? parsed.stepTitle.trim() : '';
    const thinking = typeof parsed.thinking === 'string' ? parsed.thinking.trim() : '';
    const playwrightCode = typeof parsed.playwrightCode === 'string' ? parsed.playwrightCode.trim() : '';
    const expectedOutcome = typeof parsed.expectedOutcome === 'string' ? parsed.expectedOutcome.trim() : '';
    dbg?.('evaluation_codegen: parsed structured output', {
      stepTitlePreview: stepTitleRaw.slice(0, 120),
      thinkingChars: thinking.length,
      playwrightCodeChars: playwrightCode.length,
      expectedOutcomeChars: expectedOutcome.length,
    });
    if (!playwrightCode) {
      throw new Error('evaluation_codegen returned empty playwrightCode');
    }
    return {
      stepTitle: stepTitleRaw.slice(0, 200) || 'Untitled step',
      thinking,
      playwrightCode,
      expectedOutcome,
    };
  }

  /**
   * After executing proposed Playwright, decide retry / advance / human / finish.
   */
  async evaluationAnalyzeAfterStep(
    input: {
      intent: string;
      desiredOutput: string;
      progressSummary: string | null;
      executedCode: string;
      executionOk: boolean;
      errorMessage?: string;
      pageUrlAfter: string;
      screenshotAfterBase64: string;
      somManifest: string;
      accessibilitySnapshot: string;
      autoSignInEnabled?: boolean;
      autoSignInCompleted?: boolean;
      agentContextAppendix?: string;
    },
    opts?: { userId?: string; signal?: AbortSignal; onDebugLog?: (m: string, d?: Record<string, unknown>) => void },
  ): Promise<{
    goalProgress: 'partial' | 'complete' | 'blocked';
    decision: 'retry' | 'advance' | 'ask_human' | 'finish';
    rationale: string;
    humanQuestion?: string;
    humanOptions?: string[];
  }> {
    const dbg = opts?.onDebugLog;
    const autoSignInEnabled = input.autoSignInEnabled ?? false;
    const autoSignInCompleted = input.autoSignInCompleted ?? false;
    dbg?.('evaluation_analyzer: start', {
      pageUrlAfter: input.pageUrlAfter,
      executionOk: input.executionOk,
      screenshotChars: input.screenshotAfterBase64?.length ?? 0,
      executedCodeChars: input.executedCode?.length ?? 0,
      autoSignInEnabled,
      autoSignInCompleted,
    });
    const { som: somT, a11y: a11yT } = truncateDomSectionsForGemini(
      input.somManifest,
      input.accessibilitySnapshot,
    );
    const user = `Overall intent:
${input.intent}

Desired output:
${input.desiredOutput}

Progress summary:
${input.progressSummary?.trim() || '(none)'}

Executed Playwright (last step):
${input.executedCode}

Execution OK: ${input.executionOk}
${input.errorMessage ? `Error: ${input.errorMessage}` : ''}

Page URL after step: ${input.pageUrlAfter}

Interactive manifest after step (Set-of-Marks [n]; aligned with badges on the image):
${somT || '(empty)'}

Accessibility snapshot after step:
${a11yT || '(empty)'}

The attached image is the full-page Set-of-Marks screenshot after execution.`;
    const userWithAutoSignIn = appendEvaluationAnalyzerAutoSignInUserBlock(
      user,
      autoSignInEnabled,
      autoSignInCompleted,
    );
    const userWithAgent = appendAgentContextUserBlock(userWithAutoSignIn, input.agentContextAppendix);
    dbg?.('evaluation_analyzer: invoking chatJson', {
      userPromptChars: userWithAgent.length,
      usageKey: 'evaluation_analyzer',
    });
    const res = await this.chatJson(
      opts?.userId,
      'evaluation_analyzer',
      [
        { role: 'system', content: EVALUATION_ANALYZER_SYSTEM },
        { role: 'user', content: userWithAgent },
      ],
      {
        imageBase64: input.screenshotAfterBase64,
        maxTokens: 4096,
        temperature: 0.2,
        signal: opts?.signal,
        onDebugLog: dbg,
      },
    );
    dbg?.('evaluation_analyzer: response received', { contentChars: res.content.length });
    const parsed = parseJsonFromLlmText(res.content) as Record<string, unknown>;
    const goalProgress = parsed.goalProgress === 'complete' || parsed.goalProgress === 'blocked' || parsed.goalProgress === 'partial' ? parsed.goalProgress : 'partial';
    const decision =
      parsed.decision === 'retry' ||
      parsed.decision === 'advance' ||
      parsed.decision === 'ask_human' ||
      parsed.decision === 'finish'
        ? parsed.decision
        : 'advance';
    const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';
    let humanQuestion: string | undefined;
    let humanOptions: string[] | undefined;
    if (decision === 'ask_human') {
      humanQuestion = typeof parsed.humanQuestion === 'string' ? parsed.humanQuestion.trim() : undefined;
      const ho = parsed.humanOptions;
      if (Array.isArray(ho)) {
        humanOptions = ho.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).slice(0, 4);
      }
      if (!humanQuestion || !humanOptions?.length) {
        dbg?.('evaluation_analyzer: ask_human payload invalid; falling back to advance', {});
        return {
          goalProgress,
          decision: 'advance',
          rationale: `${rationale} (fallback: invalid human question payload)`,
        };
      }
    }
    dbg?.('evaluation_analyzer: parsed decision', { goalProgress, decision, rationaleChars: rationale.length });
    return {
      goalProgress,
      decision,
      rationale,
      ...(humanQuestion ? { humanQuestion } : {}),
      ...(humanOptions?.length ? { humanOptions } : {}),
    };
  }

  /**
   * Initial project discovery: synthesize markdown + structured map from one captured page (MVP).
   */
  async projectDiscoverySynthesize(
    input: {
      projectName: string;
      startUrl: string;
      pageUrl: string;
      somManifest: string;
      accessibilitySnapshot: string;
      screenshotBase64: string;
      /** Main-frame navigations observed during the discovery session (URLs may include redirects and client-side routing). */
      screensVisited?: Array<{ url: string; title: string | null; navigatedAt: string }>;
    },
    opts?: { userId?: string; signal?: AbortSignal },
  ): Promise<{ markdown: string; structured: Record<string, unknown> }> {
    const { som: somT, a11y: a11yT } = truncateDomSectionsForGemini(
      input.somManifest,
      input.accessibilitySnapshot,
    );
    const visitedBlock =
      input.screensVisited && input.screensVisited.length > 0
        ? `Screens visited during this session (main-frame navigations, in order):
${input.screensVisited.map((v, i) => `${i + 1}. ${v.url}${v.title ? ` — "${v.title}"` : ''}`).join('\n')}

`
        : '';
    const user = `Project name: ${input.projectName}
Start URL: ${input.startUrl}
Current page URL: ${input.pageUrl}

${visitedBlock}You are performing a first-pass discovery of a web app. This capture covers the initial page after load (and optional sign-in). Infer the product, navigation, and practical advice for automation. Use the visited list above to describe routing and entry points; the screenshot is the final state after capture.

Interactive manifest (Set-of-Marks [n]):
${somT || '(empty)'}

Accessibility snapshot:
${a11yT || '(empty)'}

The attached image is a full-page Set-of-Marks screenshot.`;
    const shot = input.screenshotBase64?.trim();
    if (!shot) {
      throw new Error('Project discovery requires a screenshot.');
    }
    const res = await this.chatJson(
      opts?.userId,
      'project_discovery',
      [
        { role: 'system', content: PROJECT_DISCOVERY_SYSTEM },
        { role: 'user', content: user },
      ],
      {
        imageBase64: shot,
        maxTokens: 8192,
        temperature: 0.2,
        signal: opts?.signal,
      },
    );
    const parsed = parseJsonFromLlmText(res.content) as Record<string, unknown>;
    const markdown = typeof parsed.markdown === 'string' ? parsed.markdown.trim() : '';
    const structuredRaw = parsed.structured;
    const structured =
      typeof structuredRaw === 'object' && structuredRaw !== null && !Array.isArray(structuredRaw)
        ? (structuredRaw as Record<string, unknown>)
        : { schemaVersion: 1 };
    if (!markdown) {
      throw new Error('project_discovery returned empty markdown');
    }
    return { markdown, structured };
  }

  /**
   * Final markdown + structured report from step history.
   */
  async evaluationGenerateFinalReport(
    input: {
      intent: string;
      desiredOutput: string;
      progressSummary: string | null;
      stepsMarkdown: string;
    },
    opts?: { userId?: string; signal?: AbortSignal; onDebugLog?: (m: string, d?: Record<string, unknown>) => void },
  ): Promise<{ markdown: string; structured?: unknown }> {
    const dbg = opts?.onDebugLog;
    dbg?.('evaluation_report: start', { stepsMarkdownChars: input.stepsMarkdown.length });
    const user = `Overall intent:
${input.intent}

Desired output:
${input.desiredOutput}

Progress summary:
${input.progressSummary?.trim() || '(none)'}

Step-by-step trace:
${input.stepsMarkdown}`;
    dbg?.('evaluation_report: invoking chatJson', {
      userPromptChars: user.length,
      usageKey: 'evaluation_report',
    });
    const res = await this.chatJson(
      opts?.userId,
      'evaluation_report',
      [
        { role: 'system', content: EVALUATION_REPORT_SYSTEM },
        { role: 'user', content: user },
      ],
      { maxTokens: 16384, temperature: 0.3, signal: opts?.signal, onDebugLog: dbg },
    );
    const parsed = parseJsonFromLlmText(res.content) as Record<string, unknown>;
    const markdown = typeof parsed.markdown === 'string' ? parsed.markdown.trim() : '';
    const structured = parsed.structured;
    dbg?.('evaluation_report: parsed', { markdownChars: markdown.length, hasStructured: structured !== undefined });
    if (!markdown) {
      throw new Error('evaluation_report returned empty markdown');
    }
    return { markdown, ...(structured !== undefined ? { structured } : {}) };
  }
}
