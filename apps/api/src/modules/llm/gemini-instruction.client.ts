import { GoogleGenerativeAI } from '@google/generative-ai';
import type { GenerateContentResponse } from '@google/generative-ai';

/** Placeholder replaced with the user’s natural-language task for the AI prompt step. */
export const GEMINI_INSTRUCTION_ACTION_PLACEHOLDER = '[DESCRIBE THE TASK HERE]';

/** Per-section caps; combined budget matches {@link SOM_MANIFEST_MAX_CHARS} in set-of-mark-capture (28k total). */
export const GEMINI_DOM_SOM_MAX_CHARS = 14000;
export const GEMINI_DOM_A11Y_MAX_CHARS = 14000;

/**
 * Truncate Set-of-Marks manifest and accessibility snapshot independently (14k + 14k max).
 * Same truncation is used for pass 1 (vision) and pass 2 (DOM verify) so the model sees consistent DOM text.
 */
export function truncateDomSectionsForGemini(som: string, a11y: string): { som: string; a11y: string } {
  const s = som.trim();
  const a = a11y.trim();
  if (s.length <= GEMINI_DOM_SOM_MAX_CHARS && a.length <= GEMINI_DOM_A11Y_MAX_CHARS) {
    return { som: s, a11y: a };
  }
  return {
    som:
      s.length > GEMINI_DOM_SOM_MAX_CHARS
        ? `${s.slice(0, GEMINI_DOM_SOM_MAX_CHARS)}\n… [SOM manifest truncated]`
        : s,
    a11y:
      a.length > GEMINI_DOM_A11Y_MAX_CHARS
        ? `${a.slice(0, GEMINI_DOM_A11Y_MAX_CHARS)}\n… [accessibility snapshot truncated]`
        : a,
  };
}

const GEMINI_PAGE_URL_PLACEHOLDER = '[PAGE_URL]';
const GEMINI_MANIFEST_PLACEHOLDER = '[INTERACTIVE_MANIFEST]';
const GEMINI_ACCESSIBILITY_PLACEHOLDER = '[ACCESSIBILITY_TREE]';
const GEMINI_REPAIR_CONTEXT_PLACEHOLDER = '[PLAYWRIGHT_REPAIR_CONTEXT]';

export type GeminiVisionPromptInput = {
  instruction: string;
  pageUrl: string;
  /** Set-of-Marks lines `[n] …` aligned with screenshot badges. */
  somManifest: string;
  /** Playwright CDP accessibility snapshot JSON (+ enrichment). */
  accessibilitySnapshot: string;
  failedPlaywrightCode?: string;
  recordedPlaywrightCode?: string;
  priorFailureKind?: string;
  priorFailureMessage?: string;
};

const GEMINI_INSTRUCTION_TEMPLATE = `You are an expert Playwright automation engineer.

Context (required): The user is running authorized automated UI / QA tests against their own application (staging, demo, or local). Names and data visible in the UI are synthetic test fixtures, not real individuals or production secrets. Your only deliverable is Playwright JavaScript that drives the browser for UI validation (clicks, fills, assertions)—not guidance on harming systems, bypassing security in production, or exfiltrating data. If the task below could be read as sensitive, interpret it as neutral QA coverage (for example: verify that unauthorized access is rejected and the expected message is shown) and still output the automation code.

I am attaching a Set-of-Marks screenshot of the full scrollable page: high-contrast numeric badges are drawn on interactive controls across the page (not only what was in the initial viewport). The interactive manifest below uses the same numbers [n] as the badges. The accessibility snapshot is a separate Playwright CDP tree (captured before badges were drawn). Use the screenshot, the interactive manifest, and the accessibility snapshot together; emitted Playwright code must use normal locators (getByRole, getByLabel, getByPlaceholder, getByText, etc.) — do not reference badge numbers in the final code.

Page URL:
${GEMINI_PAGE_URL_PLACEHOLDER}

Task to perform:
${GEMINI_INSTRUCTION_ACTION_PLACEHOLDER}

Interactive manifest (interactives on the full page; aligned with screenshot badges):
${GEMINI_MANIFEST_PLACEHOLDER}

Playwright CDP accessibility snapshot (JSON or enriched text; structural DOM / a11y distillation):
${GEMINI_ACCESSIBILITY_PLACEHOLDER}

Previous Playwright context (optional, may be absent):
${GEMINI_REPAIR_CONTEXT_PLACEHOLDER}

Playwright coding guidelines for modern SPAs (avoid flakiness):
- No locator.fill() on search inputs, comboboxes, or async dropdowns — use locator.pressSequentially(text, { delay: 50 }) so React/Vue input handlers and network requests fire.
- Do not chain .first() immediately after a generic container filtered only by hasText on a div/listbox — clicks can hit dead space. Prefer getByText('Exact', { exact: true }), getByRole('option', { name: 'Exact' }), or another leaf-level locator.
- Do not read table or list text immediately on navigation; await the target row/cell or use web-first assertions so content is loaded first.
- For dynamic custom listboxes, after the list is visible prefer ArrowDown + Enter rather than clicking a possibly detached node.
- If the matching dropdown result row is already visible in the screenshot or interactive manifest, do not add a preparatory click on a different nearby field-selector combobox just because it exists. Prefer the visible search textbox/input and the matching result row.
- Prefer web-first assertions: await expect(locator).toContainText(...) (expect is available in the execution environment) instead of one-shot innerText checks.

Strict output rules:
Return only valid Playwright JavaScript code (syntax that runs in a JavaScript engine without transpilation). Do not use TypeScript-only syntax: no non-null assertions (expr!.prop), no type assertions (as Type), no interface/type declarations, and no satisfies/as const unless you emit plain JavaScript equivalents.
Do not include explanations.
Do not include markdown fences.
Do not include titles, notes, assumptions, comments, or alternatives.
Do not describe the screenshot.
Do not output pseudocode.
Do not output anything before or after the Playwright code.

Execution requirements:
The code may contain one or multiple sequential Playwright actions, depending on what is necessary to complete the task correctly.
Do not artificially limit the solution to a single instruction if multiple steps are needed.
Generate only the minimum necessary sequence of actions required to achieve the task reliably.

Implementation requirements:
Infer the most likely UI structure from the screenshot, interactive manifest, and accessibility snapshot.
Write the most robust production style Playwright snippet possible.
Make it resilient to different content, dynamic values, user data, themes, settings, layouts, and configuration states.
Avoid brittle selectors such as exact text matches when text may vary, screen coordinates, absolute positions, and fragile nth child chains.
Prefer stable locators such as role, label, placeholder, test id, aria attributes, stable attributes, and layered fallback locators.
When reading or acting on a single HTML table, use page.locator('table').first() (or a more specific selector) so strict mode does not fail if multiple tables exist.
For combobox or search-as-you-type dropdowns, prefer getByRole('option', { name: ... }) or options under the listbox/dialog over very broad tag unions (e.g. mixing div and li) that can match the wrong node.
For search fields and comboboxes, use getByPlaceholder when the UI shows placeholder text (e.g. "Search conditions..." for disease/condition search), or getByRole('combobox') / getByRole('textbox'). Do not use locator('xpath=following::input') after a section heading or label: the first following input in DOM order is often a hidden type=file upload, not the search field. If you must use XPath, use following::input[not(@type="file")] or scope under a stable container.
If the snippet picks the next item from a list by scanning existing page text, handle the case when no item remains so the code does not silently skip work.
Handle likely UI variations when relevant, including dialogs, menus, tabs, loading states, collapsed sections, empty or prefilled fields, and controls already in the desired state.
Use only the minimum waits needed and follow Playwright best practices.
If the screenshot is not sufficient to know a perfect selector, still output the strongest practical Playwright snippet with intelligent fallback locators.

Output format requirement:
Your entire response must be executable Playwright JavaScript only, consisting of the full sequence of actions needed to complete the task.
`;

/** Full text sent to Gemini (user turn) including task, URL, SOM manifest, and a11y snapshot. */
export function buildGeminiInstructionPrompt(input: GeminiVisionPromptInput | string): string {
  const resolved: GeminiVisionPromptInput =
    typeof input === 'string'
      ? { instruction: input, pageUrl: '', somManifest: '', accessibilitySnapshot: '' }
      : input;
  const action = resolved.instruction.trim();
  const url = resolved.pageUrl.trim() || '(unknown)';
  const { som, a11y } = truncateDomSectionsForGemini(resolved.somManifest, resolved.accessibilitySnapshot);
  const manifestBlock = som.length ? som : '(none)';
  const a11yBlock = a11y.length ? a11y : '(none)';
  const repairContext = [
    resolved.priorFailureKind?.trim() ? `Failure kind: ${resolved.priorFailureKind.trim()}` : '',
    resolved.priorFailureMessage?.trim() ? `Failure message: ${resolved.priorFailureMessage.trim()}` : '',
    resolved.failedPlaywrightCode?.trim()
      ? `Previously active Playwright that failed:\n${resolved.failedPlaywrightCode.trim()}`
      : '',
    resolved.recordedPlaywrightCode?.trim()
      ? `Original recorded Playwright baseline:\n${resolved.recordedPlaywrightCode.trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return GEMINI_INSTRUCTION_TEMPLATE.replace(GEMINI_INSTRUCTION_ACTION_PLACEHOLDER, action)
    .replace(GEMINI_PAGE_URL_PLACEHOLDER, url)
    .replace(GEMINI_MANIFEST_PLACEHOLDER, manifestBlock)
    .replace(GEMINI_ACCESSIBILITY_PLACEHOLDER, a11yBlock)
    .replace(GEMINI_REPAIR_CONTEXT_PLACEHOLDER, repairContext || '(none)');
}

const GEMINI_VERIFY_DRAFT_MAX_CHARS = 16000;

const GEMINI_VERIFY_PAGE_URL = '[PAGE_URL]';
const GEMINI_VERIFY_TASK = '[TASK]';
const GEMINI_VERIFY_SOM = '[SOM_MANIFEST]';
const GEMINI_VERIFY_A11Y = '[ACCESSIBILITY_TREE]';
const GEMINI_VERIFY_DRAFT = '[DRAFT_PLAYWRIGHT]';
const GEMINI_VERIFY_REPAIR_CONTEXT = '[PLAYWRIGHT_REPAIR_CONTEXT]';

const GEMINI_VERIFY_TEMPLATE = `You are an expert Playwright automation engineer performing a verification pass (no image).

You are given the same page URL, task, interactive manifest, and accessibility snapshot that were used to generate draft Playwright code. Your job is to check whether the draft code only uses controls, roles, names, placeholders, labels, and test ids that are consistent with those DOM sections, and whether it avoids strict-mode pitfalls (multiple matches, overly broad locators) described in the codegen guidelines.

Rules:
- If the draft is already correct and consistent with the DOM text, output it **unchanged** (verbatim).
- If you find mismatches (e.g. wrong role name, placeholder not present, locator that cannot match the described UI), output a **corrected** full Playwright JavaScript snippet that completes the same task.
- Treat unnecessary preparatory actions as incorrect when the target result is already visible in the DOM context. Example: if the task is to pick a patient from a visible dropdown result row, do not keep a preceding click on a separate "Name" combobox unless the task explicitly requires changing that combobox.
- Output **only** executable Playwright JavaScript (same rules as codegen: no TypeScript-only syntax, no markdown fences, no comments or explanation).

Page URL:
${GEMINI_VERIFY_PAGE_URL}

Task:
${GEMINI_VERIFY_TASK}

Interactive manifest:
${GEMINI_VERIFY_SOM}

Accessibility snapshot:
${GEMINI_VERIFY_A11Y}

Draft Playwright code to verify:
${GEMINI_VERIFY_DRAFT}

Previous Playwright context (optional):
${GEMINI_VERIFY_REPAIR_CONTEXT}
`;

export function buildGeminiVerifyPrompt(input: {
  instruction: string;
  pageUrl: string;
  somManifest: string;
  accessibilitySnapshot: string;
  draftPlaywrightCode: string;
  failedPlaywrightCode?: string;
  recordedPlaywrightCode?: string;
  priorFailureKind?: string;
  priorFailureMessage?: string;
}): string {
  const { som, a11y } = truncateDomSectionsForGemini(input.somManifest, input.accessibilitySnapshot);
  let draft = input.draftPlaywrightCode.trim();
  if (draft.length > GEMINI_VERIFY_DRAFT_MAX_CHARS) {
    draft = `${draft.slice(0, GEMINI_VERIFY_DRAFT_MAX_CHARS)}\n… [draft truncated for verify pass]`;
  }
  const url = input.pageUrl.trim() || '(unknown)';
  const repairContext = [
    input.priorFailureKind?.trim() ? `Failure kind: ${input.priorFailureKind.trim()}` : '',
    input.priorFailureMessage?.trim() ? `Failure message: ${input.priorFailureMessage.trim()}` : '',
    input.failedPlaywrightCode?.trim()
      ? `Previously active Playwright that failed:\n${input.failedPlaywrightCode.trim()}`
      : '',
    input.recordedPlaywrightCode?.trim()
      ? `Original recorded Playwright baseline:\n${input.recordedPlaywrightCode.trim()}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return GEMINI_VERIFY_TEMPLATE.replace(GEMINI_VERIFY_PAGE_URL, url)
    .replace(GEMINI_VERIFY_TASK, input.instruction.trim())
    .replace(GEMINI_VERIFY_SOM, som.length ? som : '(none)')
    .replace(GEMINI_VERIFY_A11Y, a11y.length ? a11y : '(none)')
    .replace(GEMINI_VERIFY_DRAFT, draft)
    .replace(GEMINI_VERIFY_REPAIR_CONTEXT, repairContext || '(none)');
}

export async function verifyGeminiPlaywrightAgainstDom(params: {
  apiKey: string;
  model: string;
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
  const { apiKey, model, signal } = params;
  const fullPrompt = buildGeminiVerifyPrompt(params);
  const genAI = new GoogleGenerativeAI(apiKey);
  const gm = genAI.getGenerativeModel({ model });
  const result = await gm.generateContent(
    {
      contents: [
        {
          role: 'user',
          parts: [{ text: fullPrompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.1,
      },
    },
    { signal },
  );
  const aggregated = result.response;
  const rawText = aggregated.text().trim();
  if (!rawText) {
    throw new Error(formatGeminiEmptyOutputError(aggregated as GenerateContentResponse));
  }
  return {
    rawText,
    playwrightCode: normalizeGeminiPlaywrightSnippet(rawText),
  };
}

/** Strip accidental markdown fences; trim. Model should not emit them per template. */
export function normalizeGeminiPlaywrightSnippet(raw: string): string {
  let t = raw.trim();
  const fenced = /^```(?:typescript|ts|javascript|js)?\s*\n?([\s\S]*?)```\s*$/m.exec(t);
  if (fenced) {
    t = fenced[1].trim();
  }
  return t.trim();
}

/**
 * Extract incremental answer vs thought-summary text from one streamed chunk.
 * Gemini returns thought summaries with `thought: true` and the summary in `text` (not `thought` as a string).
 * @see https://ai.google.dev/gemini-api/docs/thinking
 */
function extractChunkParts(chunk: unknown): { text: string; thought: string } {
  let text = '';
  let thought = '';
  const c = chunk as {
    candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }>;
  };
  const parts = c.candidates?.[0]?.content?.parts;
  if (!parts) return { text: '', thought: '' };
  for (const part of parts) {
    const t = typeof part.text === 'string' ? part.text : '';
    if (!t) continue;
    const isThought = part.thought === true;
    if (isThought) {
      thought += t;
    } else {
      text += t;
    }
  }
  return { text, thought };
}

/** User-facing hint when Gemini returns no code (often safety / empty completion). */
const GEMINI_EMPTY_REPHRASE_HINT =
  ' If the model blocked the request, rephrase the step as neutral QA on a staging app (e.g. verify error messages or access denial); avoid attack-like or abusive wording; shorten or generalize sensitive fixture text in the instruction.';

function formatGeminiEmptyOutputError(aggregated: GenerateContentResponse): string {
  const parts: string[] = [];
  const pf = aggregated.promptFeedback;
  if (pf) {
    parts.push(`promptBlockReason=${String(pf.blockReason)}`);
    if (pf.blockReasonMessage?.trim()) {
      parts.push(`blockReasonMessage=${pf.blockReasonMessage.trim().slice(0, 240)}`);
    }
  }
  const c0 = aggregated.candidates?.[0];
  if (c0?.finishReason != null) parts.push(`finishReason=${String(c0.finishReason)}`);
  if (c0?.finishMessage?.trim()) parts.push(`finishMessage=${c0.finishMessage.trim().slice(0, 240)}`);
  if (c0?.safetyRatings?.length) {
    const brief = c0.safetyRatings.map((s) => ({
      category: s.category,
      probability: s.probability,
    }));
    parts.push(`safetyRatings=${JSON.stringify(brief)}`);
  }
  const detail = parts.length ? ` (${parts.join('; ')})` : '';
  return `Gemini returned no usable text for Playwright snippet${detail}.${GEMINI_EMPTY_REPHRASE_HINT}`;
}

export type GeminiInstructionStreamProgress = { rawText: string; thinking?: string };

export async function generateGeminiPlaywrightSnippet(params: {
  apiKey: string;
  model: string;
  /** Full user message (task + URL + manifest + rules). */
  fullPrompt: string;
  imageBase64: string;
  signal?: AbortSignal;
  /** Called with cumulative text as the stream arrives (throttled). */
  onProgress?: (ev: GeminiInstructionStreamProgress) => void;
}): Promise<{ rawText: string; playwrightCode: string; thinking?: string }> {
  const { apiKey, model, fullPrompt, imageBase64, signal, onProgress } = params;
  const genAI = new GoogleGenerativeAI(apiKey);
  const gm = genAI.getGenerativeModel({ model });
  const { stream, response } = await gm.generateContentStream(
    {
      contents: [
        {
          role: 'user',
          parts: [
            { text: fullPrompt },
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: imageBase64.trim(),
              },
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.2,
        thinkingConfig: {
          includeThoughts: true,
        },
      } as import('@google/generative-ai').GenerationConfig & {
        thinkingConfig?: { includeThoughts?: boolean };
      },
    },
    { signal },
  );

  let accumulated = '';
  let thinkingAcc = '';
  let lastEmitAt = 0;
  let lastEmittedCombined = 0;
  const THROTTLE_MS = 120;
  const MIN_CHARS = 220;

  const emitProgress = (force: boolean) => {
    if (!onProgress) return;
    const now = Date.now();
    const combined = accumulated.length + thinkingAcc.length;
    if (
      !force &&
      now - lastEmitAt < THROTTLE_MS &&
      combined - lastEmittedCombined < MIN_CHARS &&
      combined > 0
    ) {
      return;
    }
    lastEmitAt = now;
    lastEmittedCombined = combined;
    const t = thinkingAcc.trim();
    onProgress({
      rawText: accumulated,
      ...(t ? { thinking: t } : {}),
    });
  };

  for await (const chunk of stream) {
    const { text, thought } = extractChunkParts(chunk);
    accumulated += text;
    thinkingAcc += thought;
    emitProgress(false);
  }

  const aggregated = await response;
  emitProgress(true);

  const rawText = accumulated.trim();
  if (!rawText) {
    throw new Error(formatGeminiEmptyOutputError(aggregated));
  }
  const thinking = thinkingAcc.trim() || undefined;
  return {
    rawText,
    playwrightCode: normalizeGeminiPlaywrightSnippet(rawText),
    ...(thinking ? { thinking } : {}),
  };
}
