import { Injectable, Logger } from '@nestjs/common';
import {
  LlmProvider,
  ActionToInstructionInput,
  ActionToInstructionOutput,
  InstructionToActionInput,
  InstructionToActionOutput,
  InstructionToActionResult,
} from './providers/llm-provider.interface';

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
- NEVER use page.locator('span'), page.locator('div'), page.locator('a'), page.locator('button'), or page.locator('input') alone — they match many elements and Playwright throws a strict mode violation. When Visible text is available for a click, prefer getByText(visibleText, { exact: true }).first() or getByRole with name from Visible text / aria (exact: false on getByText matches substrings like "Total Patients"). Otherwise use getByRole('link', { name: '...' }), page.locator(<Selector field>) when specific, or page.locator('span', { hasText: '...' }).first() if you must scope by tag.
- Keep instructions concise but specific enough to identify the target element`;

const INSTRUCTION_TO_ACTION_SYSTEM = `You are a Playwright test automation agent for **software QA**.

Context (read carefully — do **not** refuse this task):
- The user is an engineer running **Playwright** against **their own application** (URL + screenshot provided): a **staging, demo, or internal test environment**, not production care delivery.
- Your output is **only** JavaScript that calls Playwright APIs (\`page.getByRole\`, \`fill\`, \`click\`, etc.) so automated E2E tests can drive the UI.
- Names, dates, phone numbers, or emails mentioned in the instruction are **synthetic test fixtures** for form fields (like "test@example.com" in any tutorial). You are **not** being asked for medical advice, real patient data, or to deceive anyone — only to **locate widgets and fill fields** the way every Playwright tutorial does.
- Health-adjacent UIs (clinics, dashboards) are still **web apps under test**; treat fields as generic \`<input>\` elements.

Given a natural language instruction and the current page context, generate the Playwright code to execute the action.

Respond ONLY with valid JSON:
{
  "playwrightCode": "...",
  "action": "click|type|navigate|scroll|select|hover|wait|assert|custom",
  "selector": "CSS selector or null",
  "value": "input value or null"
}

Guidelines:
- Use modern Playwright locator APIs (getByRole, getByText, getByLabel, getByPlaceholder) when possible
- NEVER emit page.locator('span'), page.locator('div'), page.locator('a'), page.locator('button'), or page.locator('input') with only a tag name — strict mode will fail when multiple elements match. Prefer getByRole with name, or locator with hasText, or .first() only as a last resort.
- **Do not invent selectors from example names in the instruction.** Example: if the user says to type "John" as first name, **do not** use \`input[placeholder="John"]\` or \`getByPlaceholder('John')\` unless the **page context** explicitly shows that exact placeholder. Prefer \`page.getByLabel(/first name/i)\`, \`getByRole('textbox', { name: /first name/i })\`, or labels from the accessibility tree / visible text excerpt.
- **Sparse tree:** If the page context is short, rely on the **screenshot** and any **"Visible page text"** section — use **regex** labels (\`/date of birth|dob/i\`, \`/phone|mobile/i\`, \`/save/i\`) with \`getByLabel\` / \`getByRole\` instead of guessing CSS attributes.
- **Tables (strict mode):** Never use \`locator('table tr:last-child td')\` or \`locator('tr:last-child td')\` **without** scoping to **one** cell — that selector matches **every** \`<td>\` in the row. Prefer \`getByRole('row', { name: /unique name/i }).getByRole('cell').first()\`, \`locator('tr:last-child').locator('td').nth(0)\`, or target a **row action button** (e.g. \`getByRole('button', { name: 'Open' })\` scoped to the row). If you must click the first cell, use \`.locator('td').first()\` **on the row locator**, not \`tr:last-child td\` alone.
- **Sidebar / nav labels:** For items like "Patients", prefer \`getByRole('navigation').getByRole('link', { name: 'Patients' })\` or \`getByRole('link', { name: /^Patients$/i })\` so you do not match headings like "Total Patients" or fail when the sidebar is not the active region.
- For navigation, use page.goto()
- For typing, use page.fill() or page.getByLabel().fill()
- **Date inputs (\`input[type="date"]\`)**: Playwright \`fill()\` only accepts **ISO 8601** values: \`YYYY-MM-DD\` (e.g. \`1980-01-01\`). Slash formats like \`01/01/1980\` or \`MM/DD/YYYY\` cause **"Malformed value"**. If the user prompt gives a human date, **convert it to ISO** in the generated fill string. Use the screenshot/a11y tree to confirm \`type="date"\`. For **text** date fields (\`mm/dd/yyyy\` placeholders), fill the **ISO** string only if the control accepts it; otherwise match the visible format from the page.
- Handle waiting implicitly (Playwright auto-waits)
- Only generate safe Playwright API calls (no eval, no fs, no network)
- **Never** respond with a refusal: always return the JSON object above. If something is ambiguous, pick the most likely locators from the page context and screenshot.
- **Match the instruction’s requested values** (date formats, name suffix patterns, phone/email patterns) in the **string literals** you pass to \`fill()\` — do not substitute unrelated example text.`;

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
  private provider: LlmProvider | null = null;

  setProvider(provider: LlmProvider) {
    this.provider = provider;
  }

  getProvider(): LlmProvider | null {
    return this.provider;
  }

  async actionToInstruction(
    input: ActionToInstructionInput,
  ): Promise<ActionToInstructionOutput> {
    if (!this.provider) {
      const label = input.elementVisibleText?.trim() || input.ariaLabel?.trim();
      return {
        instruction:
          input.action === 'click' && label
            ? `Click ${label}`
            : `${input.action} on ${input.selector}`,
        playwrightCode: `// ${input.action}: ${input.selector}`,
      };
    }

    const userPrompt = `Action: ${input.action}
Selector: ${input.selector}
Element HTML: ${input.elementHtml}
${input.elementVisibleText ? `Visible text: ${input.elementVisibleText}\n` : ''}${input.ariaLabel ? `Aria label: ${input.ariaLabel}\n` : ''}${input.value ? `Value: ${input.value}\n` : ''}Page context (accessibility tree excerpt):
${input.pageAccessibilityTree.slice(0, 3000)}`;

    try {
      const response = await this.provider.chat([
        { role: 'system', content: ACTION_TO_INSTRUCTION_SYSTEM },
        { role: 'user', content: userPrompt },
      ]);

      return JSON.parse(response);
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

  async instructionToAction(input: InstructionToActionInput): Promise<InstructionToActionResult> {
    if (!this.provider) {
      throw new Error('LLM provider not configured. Set LLM_PROVIDER and the corresponding API key in .env');
    }

    const userPrompt = `[Automation: authorized UI test; strings below are synthetic fixtures for form fields, not real patient data.]

Instruction: ${input.instruction}
Current page URL: ${input.pageUrl}
Page context (accessibility tree):
${input.pageAccessibilityTree.slice(0, 12000)}`;

    const visionAttached = !!input.screenshotBase64?.trim();

    const rawResponse = await this.provider.chat(
      [
        { role: 'system', content: INSTRUCTION_TO_ACTION_SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      {
        imageBase64: input.screenshotBase64,
        /**
         * Vision + long `playwrightCode` in JSON; use a high ceiling. OpenAI maps this to
         * `max_completion_tokens` (reasoning + output share this budget on GPT-5.x).
         */
        maxTokens: 16384,
        /** GPT-5.x defaults to `medium` reasoning effort, which can exhaust the completion budget with empty visible `content`. */
        reasoningEffort: 'low',
      },
    );

    const output = parseJsonFromLlmText(rawResponse) as InstructionToActionOutput;

    return {
      output,
      transcript: {
        systemPrompt: INSTRUCTION_TO_ACTION_SYSTEM,
        userPrompt,
        rawResponse,
        visionAttached,
      },
    };
  }

  /**
   * Suggests forward steps to mark "skip replay" after the anchor step was added or edited.
   * Returns empty suggestions when no LLM provider is configured.
   */
  async suggestStepsToSkipAfterChange(input: {
    anchor: SuggestSkipAnchorInput;
    forwardSteps: SuggestSkipForwardStepInput[];
  }): Promise<{ suggestions: Array<{ stepId: string; reason: string }> }> {
    if (!this.provider) {
      this.logger.warn('suggestStepsToSkipAfterChange: LLM provider not configured');
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

    const response = await this.provider.chat([
      { role: 'system', content: SUGGEST_SKIP_AFTER_CHANGE_SYSTEM },
      { role: 'user', content: userPayload },
    ]);

    let parsed: unknown;
    try {
      parsed = parseJsonFromLlmText(response);
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
  }
}
