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
import {
  buildDiscoveryImageSentFields,
  truncateDiscoveryLlmField,
  type DiscoveryLlmExchangePayload,
  DISCOVERY_LLM_LOG_MAX_PROMPT_CHARS,
  DISCOVERY_LLM_LOG_MAX_RESPONSE_CHARS,
  DISCOVERY_LLM_LOG_MAX_THINKING_CHARS,
} from './discovery-llm-log.types';
import { geminiChat } from './gemini-llm-chat.adapter';
import { LlmConfigService } from './llm-config.service';
import { createChatLlmProvider } from './llm-provider-factory';
import type { LlmUsageKey } from './llm-usage-registry';
import { supportsVisionByDefault } from './llm-provider-registry';
import {
  generateNonGeminiVisionPlaywrightSnippet,
  verifyPlaywrightAgainstDomNonGemini,
} from './vision-playwright-codegen';
import { parseOptimizedPromptSpec, type OptimizedPromptSpec } from '../recording/optimized-prompt-metadata';
import {
  PLAYWRIGHT_UI_INTERACTION_GUIDELINES,
  PLAYWRIGHT_UI_INTERACTION_GUIDELINES_CONDENSED,
} from './playwright-ui-guidelines';

/** Structured reasoning from evaluation_codegen JSON (also nested under codegenOutputJson). */
export type EvaluationCodegenThinkingStructured = {
  observation: string;
  needsToDoAndWhy: string;
  priorFailuresIfAny: string;
  actionNowAndWhy: string;
  playwrightWhy: string;
};

function parseEvaluationCodegenThinking(
  parsed: Record<string, unknown>,
): { thinking: string; thinkingStructured?: EvaluationCodegenThinkingStructured } {
  const rawTs = parsed.thinkingStructured;
  if (rawTs && typeof rawTs === 'object' && !Array.isArray(rawTs)) {
    const o = rawTs as Record<string, unknown>;
    const observation = typeof o.observation === 'string' ? o.observation.trim() : '';
    const needsToDoAndWhy = typeof o.needsToDoAndWhy === 'string' ? o.needsToDoAndWhy.trim() : '';
    const priorFailuresIfAny = typeof o.priorFailuresIfAny === 'string' ? o.priorFailuresIfAny.trim() : '';
    const actionNowAndWhy = typeof o.actionNowAndWhy === 'string' ? o.actionNowAndWhy.trim() : '';
    const playwrightWhy = typeof o.playwrightWhy === 'string' ? o.playwrightWhy.trim() : '';
    const thinking = [
      observation && `Observation: ${observation}`,
      needsToDoAndWhy && `What to do and why: ${needsToDoAndWhy}`,
      priorFailuresIfAny && `Prior failures: ${priorFailuresIfAny}`,
      actionNowAndWhy && `Action now: ${actionNowAndWhy}`,
      playwrightWhy && `Playwright rationale: ${playwrightWhy}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    return {
      thinkingStructured: {
        observation,
        needsToDoAndWhy,
        priorFailuresIfAny,
        actionNowAndWhy,
        playwrightWhy,
      },
      thinking: thinking || '(no structured thinking parsed)',
    };
  }
  const legacy = typeof parsed.thinking === 'string' ? parsed.thinking.trim() : '';
  return { thinking: legacy };
}

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
- NEVER use page.locator('span'), page.locator('div'), page.locator('a'), page.locator('button'), or page.locator('input') alone — they match many elements and Playwright throws a strict mode violation. When Visible text is available for a click, prefer getByText(visibleText, { exact: true }) (without chaining .first() on a broad container) or getByRole with name from Visible text / aria (exact: false on getByText matches substrings like "Total Patients"). Do not use page.locator('div', { hasText: '...' }).first() for options in a listbox — target getByRole('option', { name: /…/i }) scoped to the open listbox when possible, or getByText on the leaf control. Otherwise use getByRole('link', { name: '...' }), page.locator(<Selector field>) when specific, or a narrowly scoped locator.
- Playwright coding guidelines for modern SPAs: do not use locator.fill() on combobox triggers or async search fields — click the combobox trigger first if the filter input is separate; use pressSequentially(text, { delay: 50 }) on the real input inside the popover/listbox. Wait for data rows or list items before reading table/list text. Prefer keyboard navigation (ArrowDown + Enter) for dynamic custom dropdowns when clicks would target detached nodes. Prefer expect(locator) web-first assertions when verifying text.
- Context: the user records **authorized QA automation** against **their own** staging or demo app; page context may include **synthetic** names and data. Phrase the JSON **instruction** as neutral UI test actions (e.g. "Click Save", "Type email into the login field")—not as requests to harm systems, steal data, or bypass security in production.
- Keep instructions concise but specific enough to identify the target element
- Additional UI interaction rules (Shadcn/Radix): ${PLAYWRIGHT_UI_INTERACTION_GUIDELINES_CONDENSED}`;

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
  "thinkingStructured": {
    "observation": "<what you see on the page from screenshot + manifest + snapshot>",
    "needsToDoAndWhy": "<what you think needs to happen next toward the intent and why>",
    "priorFailuresIfAny": "<if prior steps failed for a similar sub-goal, summarize why; otherwise say none>",
    "actionNowAndWhy": "<the single browser action you will take in this step and why>",
    "playwrightWhy": "<why this exact playwrightCode (locators, scope) addresses prior failures or avoids repeating them>"
  },
  "playwrightCode": "<single async IIFE body using only \`page\` and \`expect\` from Playwright test — valid JavaScript statements, no imports; e.g. await page.getByRole('button', { name: 'Next' }).click();>",
  "expectedOutcome": "<what should change in the UI after this code runs>"
}

Legacy (only if the model cannot emit thinkingStructured): you may instead include a single string field "thinking" with a short combined rationale — prefer thinkingStructured.

Rules:
- **Efficiency:** Take the shortest path toward the intent—avoid redundant actions, duplicate checks, or exploratory clicks when the goal is narrow; one atomic action per step is enough when the UI is ready.
- Output executable Playwright snippets only; no TypeScript types; no require/import.
- Prefer getByRole, getByLabel, getByText with stable accessible names. For Shadcn **Select** rows, the trigger is often **button**, not combobox — follow the snapshot/manifest; avoid \`getByRole('combobox')\` when the tree shows \`button\`.
- For custom selects/listboxes, prefer getByRole('option', { name: /…/i }) (case-insensitive regex) scoped to the open listbox, dialog, or popover so strict mode does not match multiple options; avoid exact: true on option text when labels may include invisible spans or formatting.
- One focused step per response: for Shadcn/Radix comboboxes, emit only one logical browser action per snippet (e.g. open the trigger, then in a later evaluation step type in the portaled filter input, then in another step pick the option — not all in one playwrightCode block). Avoid multi-page tours in one snippet.
- **Prior steps:** The "Prior steps" block lists each **step title**, whether Playwright **OK** or **FAIL**, the analyzer **decision**, a **code excerpt**, and **err** when execution failed. If several lines show the same goal (e.g. patient selection) with repeated FAIL or copy-paste titles, you MUST change locator strategy (different role, listbox scope, button trigger, placeholder, row/cell) — do not repeat the same approach.

${PLAYWRIGHT_UI_INTERACTION_GUIDELINES}`;

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
- Prefer **"finish"** as soon as the intent and desired output are visibly satisfied—do not keep choosing **"advance"** for extra exploration unless the intent clearly requires broader coverage.
- Use "finish" when the evaluation intent and desired output are sufficiently addressed or cannot proceed without external info.
- Use "ask_human" when authentication, ambiguous business logic, or destructive actions need explicit user choice; always provide humanQuestion and exactly 3-4 humanOptions. If the user message includes a "Run configuration (automatic sign-in)" section, follow it for when credential screens should not trigger ask_human.
- Use "retry" when the last Playwright step failed or the UI did not reach the expected state.
- Use "advance" when the step succeeded and exploration should continue.
- When execution failed and the **Progress summary** shows repeated **retry** cycles or similar failures for the same sub-goal (e.g. dropdown/patient selection), still use **"retry"** if the goal is reachable, but make **rationale** actionable: name which **different** interaction to try next (e.g. listbox-scoped option, button trigger vs combobox, row click, placeholder) so the next codegen step is not a blind repeat. If the same UI is impossible to interpret from the evidence, choose **"ask_human"** with one focused question.`;

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

/** Legacy single-page discovery (kept for tests / fallback). */
const PROJECT_DISCOVERY_SYSTEM = `You document a web application for QA automation agents. The app is owned by the user for staging or demo testing; treat visible data as synthetic.

Respond ONLY with valid JSON:
{
  "markdown": "<readable summary: product purpose, main areas, navigation, controls, tactical advice for Playwright agents>",
  "structured": { "schemaVersion": 1, "routes": [ { "pathPattern": "...", "title": "...", "notes": "..." } ], "screens": [ { "id": "...", "title": "...", "pathPattern": "...", "notes": "...", "notableElements": [ "..." ] } ], "agentAdvice": [ "short bullets for automation" ] }
}

Ground the answer in the screenshot, Set-of-Marks manifest, and accessibility snapshot. Do not invent routes you cannot infer from the evidence; it is OK to note uncertainty.`;

const PROJECT_DISCOVERY_EXPLORER_SYSTEM = `You are a Playwright Exploration Agent for QA, exploring a SaaS web app that the user owns. Treat visible data as synthetic test data. Describe actions as neutral verification.

Your task is to choose exactly one next exploratory action per turn.

Core objective

Explore the app as a tree, not as a loose sequence of clicks.

1. First, fully explore the current branch depth first.
2. When the current branch is exhausted or reaches maxDepth, recover to a parent hub.
3. Then move to a different unexplored primary area.
4. Continue until all discoverable primary areas and their meaningful child branches are explored up to maxDepth, subject to the user's budget.

Definitions

A primary area is any top level product section visible in:
1. Sidebar navigation
2. Top navigation
3. App switcher, launcher, or hub menu
4. Major dashboard cards that clearly route to distinct product areas

A meaningful child destination is any control that leads to a distinct logical screen, nested route, detail page, drill down, tab panel with unique content, drawer, modal detail view, or row level details.

Do not treat purely cosmetic toggles, sort controls, filters, pagination, or repeated equivalent rows as new branches unless they reveal a new route or a new logical detail surface.

Traversal policy

At every turn, use this strict priority order:

1. Continue deeper in the current branch if all of the following are true:
   a. currentDepth < maxDepth
   b. the manifest or accessibility snapshot shows an unopened meaningful child destination
   c. that child is not already listed by the user message as explored or completed

2. If the current branch cannot go deeper, mark it complete and recover toward a hub using the first recovery method that is clearly supported.

3. After recovery, navigate to the next unexplored primary area visible in the manifest or snapshot.

4. Only stop when both of these are true:
   a. the user's minimum completed steps budget is met
   b. the user's minimum distinct URLs budget is met
   and one of these is also true:
   c. all discoverable primary areas are explored to maxDepth
   d. you are blocked
   e. further actions would only repeat already explored product areas

Global coverage rule

You must optimize for full product coverage, not local completeness alone.

Never remain inside one primary area if:
1. its current branch is exhausted or at maxDepth
2. recovery is possible
3. another unexplored primary area is visible or has been previously observed in the manifest or snapshot

Completion rule

Set subsectionComplete to true only when the current branch is actually exhausted, meaning one of these is true:
1. currentDepth has reached maxDepth
2. there are no unopened meaningful child destinations in the manifest or accessibility snapshot for this branch
3. the only remaining controls are non navigational or would repeat equivalent views already explored

When subsectionComplete is true and stop is false, playwrightCode must perform a recovery step, or a shell reset followed by movement toward the next unexplored primary area.

Recovery order

Use the first applicable option below:

1. Click a visible parent or hub control such as a breadcrumb, Home, app logo, sidebar parent, section root, or back to list control.
2. Use \`await page.goBack()\` only if the app appears to use real browser history and this will not loop in the same SPA shell.
3. Use a shell reset with \`await page.goto(baseUrl)\` using the exact Base URL from the user message. After reset, move toward the next unexplored primary area if it is directly visible in the same single action. Otherwise the reset alone is acceptable as the single next step.

Evidence rules

Base every decision on the current Set of Marks manifest and accessibility snapshot.

Look specifically for:
1. links
2. tabs
3. tree items
4. expandable groups
5. row actions such as View, Open, Details, Manage
6. drawers and panels that open deeper content
7. navigation landmarks
8. cards or tiles that route to distinct sections

If a credible unopened child exists and you are below maxDepth, prefer opening it over backtracking.

List and table rule

For collections, inspect one representative unopened detail destination before concluding the collection is exhausted. Do not keep opening multiple equivalent rows unless the manifest or snapshot indicates they lead to materially different destinations.

Scrolling rule

Assume the environment already scrolls the main document and major overflow containers before each capture.

Only add a scroll related step when the evidence shows clipped, lazy loaded, collapsed, or partially hidden interactive targets. In that case, do exactly one of:
1. \`scrollIntoViewIfNeeded()\` on a tagged target
2. a wheel action in the relevant scroll container
3. a short wait after an expand action

Action constraints

1. Return exactly one logical next step.
2. Prefer \`getByRole\`, \`getByLabel\`, \`getByText\`, or other accessible locators with stable names.
3. Do not use broad selectors like \`page.locator('div')\` or \`page.locator('span')\` alone.
4. Do not invent controls, URLs, or labels not supported by the manifest or snapshot.
5. Do not output secrets or credentials.
6. Do not stop early just because the app "seems explored."
7. True blockers are limited to cases such as CAPTCHA, hard 403, unclosable modal, or no actionable targets in the evidence.
8. ${PLAYWRIGHT_UI_INTERACTION_GUIDELINES_CONDENSED}
9. **Modals:** When a dialog is open (e.g. scheduling, forms), scope controls: \`page.getByRole('dialog', { name: /…/i }).getByRole('combobox', { name: /provider/i })\` or \`page.getByRole('dialog').last().…\` if only one modal matters. Do not rely on a global \`getByRole('button', …)\` if the snapshot shows the control inside a named dialog.
10. **PREVIOUS STEP:** When the user message includes **PREVIOUS STEP**, it is the last snippet that actually ran and whether it **succeeded or failed**. Use it every time: after **SUCCESS**, advance the flow; after **FAILED** or a **Blocked** note, change locator, dialog scope, combobox vs button, or interaction pattern — do not blindly repeat.
11. **Duplicate code limit:** Never emit the **exact same** \`playwrightCode\` string more than **twice** across the run for the same control. The host **blocks** a third identical attempt. After two failures with the same code, you must switch strategy (role, placeholder, \`getByPlaceholder\`, scoped dialog, filter + option, etc.).

Output format

Respond with valid JSON only:

{
  "stop": <boolean>,
  "subsectionComplete": <boolean>,
  "reason": "<one short sentence explaining the next target or why exploration must stop>",
  "thinkingStructured": {
    "observation": "<what you see on the page>",
    "needsToDoAndWhy": "<what to explore next and why>",
    "priorFailuresIfAny": "<if PREVIOUS STEP failed, why; else none>",
    "actionNowAndWhy": "<the single exploratory action for playwrightCode and why>",
    "playwrightWhy": "<why this playwrightCode (locators, scope) given prior failures>"
  },
  "playwrightCode": "<empty string when stop is true; otherwise an async function body using only page and expect, with statements only>"
}

You may omit thinkingStructured only if JSON size is constrained; prefer including it.`;

const PROJECT_DISCOVERY_FINAL_SYSTEM = `You are a Browser Automation Discovery Agent producing the final discovery report for a SaaS web app. The user owns the app for staging QA; treat data as synthetic.

You receive: authoritative main-frame navigation list, an exploration log, base URL, optional auth note, and a Set-of-Marks screenshot of the **final** state. Ground every claim in this evidence. When something is inferred but not directly observed, say so in unknowns or notes.

Respond ONLY with valid JSON:
{
  "screensVisitedSectionMarkdown": "<Markdown body for Section 1 only: lines like \`https://... — Title\` one per line, no leading # heading>",
  "discoverySummaryMarkdown": "<Polished Markdown for humans: product overview, navigation model, main areas, workflows, automation advice, hazards, limitations. No marketing fluff.>",
  "structured": {
    "schemaVersion": 1,
    "app": { "name": "", "baseUrl": "", "description": "", "authenticated": true },
    "routes": [ { "title": "", "pathPattern": "", "notes": "", "discoveryType": "visited" } ],
    "screens": [ {
      "id": "",
      "title": "",
      "pathPattern": "",
      "notes": "",
      "discoveryType": "visited",
      "notableElements": [""],
      "primaryActions": [""],
      "navigationElements": [""],
      "statefulUrlNotes": [""],
      "automationNotes": [""]
    } ],
    "agentAdvice": [""],
    "unknowns": [""]
  }
}

FIELD RULES:
- schemaVersion must be 1.
- discoveryType must be one of: visited | linked | inferred.
- routes may include visited and clearly inferred top-level routes; mark inferred appropriately.
- screens should focus on important visited or strongly evidenced screens.
- Do not duplicate the full screensVisited array inside structured (the server merges authoritative navigations).
- Omit empty arrays or use short placeholders only where required.
- Be concise; no chain-of-thought.`;

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

/**
 * Strips optional markdown fences. Models often wrap JSON in ```json … ``` but sometimes omit the closing fence;
 * the old whole-string regex then failed and JSON.parse saw leading ```json.
 */
function stripJsonMarkdownFences(raw: string): string {
  let t = raw.trim();
  if (!t) return t;
  t = t.replace(/^```(?:json)?\s*\r?\n?/i, '');
  t = t.replace(/\r?\n?```\s*$/i, '');
  return t.trim();
}

/**
 * First complete `{ ... }` by depth counting, respecting JSON string rules (so `}` inside strings does not end the object).
 * Use when the model prepends/appends prose, chain-of-thought, or truncated markers outside the JSON.
 */
function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

function parseJsonFromLlmText(raw: string): unknown {
  const t = raw.trim();
  if (!t) {
    throw new Error('LLM returned empty response (no JSON to parse)');
  }
  const payload = stripJsonMarkdownFences(t);
  if (!payload) {
    throw new Error('LLM returned empty JSON payload after extraction');
  }

  const tryParse = (s: string): unknown | undefined => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(payload);
  if (direct !== undefined) return direct;

  const fromFenceBody = extractFirstJsonObject(payload);
  if (fromFenceBody) {
    const parsed = tryParse(fromFenceBody);
    if (parsed !== undefined) return parsed;
  }

  const fromRaw = extractFirstJsonObject(t);
  if (fromRaw && fromRaw !== fromFenceBody) {
    const parsed = tryParse(fromRaw);
    if (parsed !== undefined) return parsed;
  }

  const firstMsg = 'Could not parse JSON after fence strip and object extraction';
  const head = payload.slice(0, 120);
  const tail = payload.slice(-120);
  const looksTruncated =
    payload.includes('{') && extractFirstJsonObject(payload) === null && payload.length >= 80;
  const hint = looksTruncated
    ? ' Hint: JSON looks truncated (no balanced closing brace). On OpenAI GPT-5 vision+JSON, raise max_completion_tokens for this route and/or use reasoning_effort low so visible output fits.'
    : '';
  throw new Error(
    `${firstMsg}; response length=${payload.length}, head=${JSON.stringify(head)} tail=${JSON.stringify(tail)}${hint}`,
  );
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

  /** Attach provider + model to every evaluation trace line for LLM routing. */
  private wrapDebugLogWithLlmMeta(
    dbg: LlmChatOptions['onDebugLog'],
    meta: { provider: string; model: string },
  ): NonNullable<LlmChatOptions['onDebugLog']> | undefined {
    if (!dbg) return undefined;
    return (message: string, detail?: Record<string, unknown>) =>
      dbg(message, { ...(detail ?? {}), provider: meta.provider, model: meta.model });
  }

  private async chatWithUsage(
    userId: string | undefined,
    usage: LlmUsageKey,
    messages: ChatMessage[],
    options?: LlmChatOptions,
  ): Promise<{ content: string; thinking?: string; provider: string; model: string }> {
    const dbg = options?.onDebugLog;
    if (this.chatProviderOverride) {
      const om = { provider: 'override' as const, model: 'override' as const };
      dbg?.('LLM route: using override provider', { usage, ...om });
      const t0 = Date.now();
      const result = await this.chatProviderOverride.chat(messages, options);
      dbg?.('LLM override: response', {
        ms: Date.now() - t0,
        contentChars: result.content.length,
        ...om,
      });
      return { ...result, provider: 'override', model: 'override' };
    }

    dbg?.('LLM route: resolving config', { usage });
    const tResolve = Date.now();
    const resolved = await this.llmConfig.resolve(userId, usage);
    const credentials = await this.llmConfig.resolveProviderCredentials(userId, resolved.provider);
    const meta = { provider: resolved.provider, model: resolved.model };
    const dbgM = this.wrapDebugLogWithLlmMeta(dbg, meta);
    dbgM?.('LLM route: resolved', {
      usage,
      credSource: credentials.source,
      ms: Date.now() - tResolve,
    });
    if (!credentials.apiKey && resolved.provider !== 'ollama') {
      throw new Error(
        `No API key for provider "${resolved.provider}" (usage: ${usage}). Add the key in Settings → AI/LLM or set the env variable.`,
      );
    }
    const mergedOptions: LlmChatOptions = {
      ...options,
      onDebugLog: dbgM ?? options?.onDebugLog,
    };
    if (resolved.provider === 'gemini') {
      const tg = Date.now();
      const result = await geminiChat(credentials.apiKey!, resolved.model, messages, mergedOptions);
      dbgM?.('LLM Gemini: response', {
        ms: Date.now() - tg,
        contentChars: result.content.length,
      });
      return { ...result, provider: resolved.provider, model: resolved.model };
    }

    const sysLen = messages.find((m) => m.role === 'system')?.content?.length ?? 0;
    const userLen = messages
      .filter((m) => m.role === 'user')
      .reduce((a, m) => a + m.content.length, 0);
    dbgM?.('LLM non-Gemini: request', {
      systemChars: sysLen,
      userChars: userLen,
      hasImage: Boolean(options?.imageBase64?.trim()),
    });
    const t1 = Date.now();
    const client = createChatLlmProvider(this.configService, resolved.provider, resolved.model, credentials);
    const result = await client.chat(messages, mergedOptions);
    dbgM?.('LLM non-Gemini: response', {
      ms: Date.now() - t1,
      contentChars: result.content.length,
      thinkingChars: result.thinking?.length,
    });
    return { ...result, provider: resolved.provider, model: resolved.model };
  }

  /**
   * JSON-shaped answers via **prompting + {@link parseJsonFromLlmText}**, not OpenAI `response_format`,
   * so the same path works for OpenRouter (Claude, etc.) and avoids a second request on 400.
   */
  private async chatJson(
    userId: string | undefined,
    usage: LlmUsageKey,
    messages: ChatMessage[],
    options?: LlmChatOptions,
  ): Promise<{ content: string; thinking?: string }> {
    const result = await this.chatWithUsage(userId, usage, messages, {
      ...options,
      responseFormat: 'text',
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
      return parseJsonFromLlmText(response.content) as ActionToInstructionOutput;
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
        visionAttached:
          codegen.provider === 'gemini' ? true : supportsVisionByDefault(codegen.provider),
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
  ): Promise<{
    stepTitle: string;
    thinking: string;
    thinkingStructured?: EvaluationCodegenThinkingStructured;
    playwrightCode: string;
    expectedOutcome: string;
    /** Exact system + user text sent to chatJson (vision image is attached separately). */
    llmPrompts: { system: string; user: string };
  }> {
    const dbg = opts?.onDebugLog;
    const route = await this.llmConfig.resolve(opts?.userId, 'evaluation_codegen');
    const llmTrace = { provider: route.provider, model: route.model };
    const dbgRoute = (m: string, d?: Record<string, unknown>) => dbg?.(m, { ...(d ?? {}), ...llmTrace });
    const autoSignInEnabled = input.autoSignInEnabled ?? false;
    const autoSignInCompleted = input.autoSignInCompleted ?? false;
    dbgRoute('evaluation_codegen: start', {
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
    dbgRoute('evaluation_codegen: after truncation for model', {
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

Prior steps (chronological; each line: seq, title, OK/FAIL, analyzer decision, code excerpt, optional err):
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
    const llmPrompts = { system: EVALUATION_CODEGEN_SYSTEM, user: userWithAgent };
    dbgRoute('evaluation_codegen: user prompt assembled', {
      userPromptChars: userWithAgent.length,
      systemPromptChars: EVALUATION_CODEGEN_SYSTEM.length,
    });
    dbgRoute('evaluation_codegen: invoking chatJson (prompted JSON + vision)', { usageKey: 'evaluation_codegen' });
    const tLlm = Date.now();
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
        onDebugLog: dbgRoute,
      },
    );
    dbgRoute('evaluation_codegen: raw JSON response received', {
      contentChars: res.content.length,
      hasThinkingField: res.thinking != null && res.thinking !== '',
      ms: Date.now() - tLlm,
    });
    const parsed = parseJsonFromLlmText(res.content) as Record<string, unknown>;
    const stepTitleRaw = typeof parsed.stepTitle === 'string' ? parsed.stepTitle.trim() : '';
    const { thinking, thinkingStructured } = parseEvaluationCodegenThinking(parsed);
    const playwrightCode = typeof parsed.playwrightCode === 'string' ? parsed.playwrightCode.trim() : '';
    const expectedOutcome = typeof parsed.expectedOutcome === 'string' ? parsed.expectedOutcome.trim() : '';
    dbgRoute('evaluation_codegen: parsed structured output', {
      stepTitlePreview: stepTitleRaw.slice(0, 120),
      thinkingChars: thinking.length,
      hasThinkingStructured: Boolean(thinkingStructured),
      playwrightCodeChars: playwrightCode.length,
      expectedOutcomeChars: expectedOutcome.length,
    });
    if (!playwrightCode) {
      throw new Error('evaluation_codegen returned empty playwrightCode');
    }
    return {
      stepTitle: stepTitleRaw.slice(0, 200) || 'Untitled step',
      thinking,
      ...(thinkingStructured ? { thinkingStructured } : {}),
      playwrightCode,
      expectedOutcome,
      llmPrompts,
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
    /** Exact system + user text sent to chatJson (vision image is attached separately). */
    llmPrompts?: { system: string; user: string };
  }> {
    const dbg = opts?.onDebugLog;
    const route = await this.llmConfig.resolve(opts?.userId, 'evaluation_analyzer');
    const llmTrace = { provider: route.provider, model: route.model };
    const dbgRoute = (m: string, d?: Record<string, unknown>) => dbg?.(m, { ...(d ?? {}), ...llmTrace });
    const autoSignInEnabled = input.autoSignInEnabled ?? false;
    const autoSignInCompleted = input.autoSignInCompleted ?? false;
    dbgRoute('evaluation_analyzer: start', {
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
    const llmPrompts = { system: EVALUATION_ANALYZER_SYSTEM, user: userWithAgent };
    dbgRoute('evaluation_analyzer: invoking chatJson', {
      userPromptChars: userWithAgent.length,
      usageKey: 'evaluation_analyzer',
    });
    const tLlm = Date.now();
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
        onDebugLog: dbgRoute,
      },
    );
    dbgRoute('evaluation_analyzer: response received', {
      contentChars: res.content.length,
      ms: Date.now() - tLlm,
    });
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
        dbgRoute('evaluation_analyzer: ask_human payload invalid; falling back to advance', {});
        return {
          goalProgress,
          decision: 'advance',
          rationale: `${rationale} (fallback: invalid human question payload)`,
          llmPrompts,
        };
      }
    }
    dbgRoute('evaluation_analyzer: parsed decision', {
      goalProgress,
      decision,
      rationaleChars: rationale.length,
    });
    return {
      goalProgress,
      decision,
      rationale,
      llmPrompts,
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
   * One exploratory Playwright step during project discovery (breadth-first crawl).
   */
  async projectDiscoveryExploreStep(
    input: {
      baseUrl: string;
      authContextSummary: string;
      maxNavigations: number;
      maxWallMs: number;
      elapsedMs: number;
      stepIndex: number;
      navigationsSoFar: number;
      minStepsBeforeStop: number;
      minDistinctUrlsBeforeStop: number;
      visitedUrlsSample: string[];
      pageUrl: string;
      pageTitle: string;
      somManifest: string;
      accessibilitySnapshot: string;
      screenshotBase64: string;
      /** DFS navigation tree summary (path, depth). */
      navigationTreeSummary?: string;
      maxNavDepth?: number;
      currentNavDepth?: number;
      /** Appended when retrying after a premature stop. */
      continuationHint?: string;
      /** Last executed snippet and whether it succeeded (always passed when set). */
      lastStepOutcome?: { code: string; ok: boolean; error?: string };
    },
    opts?: {
      userId?: string;
      signal?: AbortSignal;
      onLlmExchange?: (payload: DiscoveryLlmExchangePayload) => void;
    },
  ): Promise<{
    stop: boolean;
    reason: string;
    playwrightCode?: string;
    subsectionComplete?: boolean;
    thinkingStructured?: EvaluationCodegenThinkingStructured;
  }> {
    const { som: somT, a11y: a11yT } = truncateDomSectionsForGemini(
      input.somManifest,
      input.accessibilitySnapshot,
    );
    const visitedLines =
      input.visitedUrlsSample.length > 0
        ? input.visitedUrlsSample.slice(-35).join('\n')
        : '(none yet)';
    /** Both minimums must be satisfied before the model may set stop (unless blocked). */
    const budgetMet =
      input.stepIndex >= input.minStepsBeforeStop &&
      input.navigationsSoFar >= input.minDistinctUrlsBeforeStop;
    const cont = input.continuationHint?.trim();
    const navTree = input.navigationTreeSummary?.trim();
    const maxD = input.maxNavDepth ?? 5;
    const curD = input.currentNavDepth ?? 0;
    const user = `TASK INPUTS
Base URL: ${input.baseUrl}
Credentials or auth context: ${input.authContextSummary}
Max navigations: ${input.maxNavigations}
Max wall time (ms): ${input.maxWallMs}
Elapsed (ms): ${input.elapsedMs}
Completed exploration steps so far (executed): ${input.stepIndex}
Distinct normalized URLs visited so far: ${input.navigationsSoFar}
IA navigation depth (current / max): ${curD} / ${maxD}
${navTree ? `Navigation tree (DFS):\n${navTree}\n` : ''}
NAVIGATION POLICY (sections & depth ${maxD})
- **Base URL for full shell reset:** Use the **Base URL** in TASK INPUTS verbatim inside \`await page.goto(...)\` when you need to return to the app entry, then open a **different** primary sidebar/top-nav area from the manifest.
- **Target depth:** Explore each chosen primary area to **nested depth up to ${maxD}** (tabs, child routes, drill-downs) before marking **subsectionComplete** and recovering toward hub/home.
- **Breadth:** Use the "Top-level areas seen so far" line in the tree summary as a checklist — keep opening **new** primary destinations until the manifest shows no major areas left, not only the first screen you landed on.
- **Capture:** The pipeline **scrolls the page vertically and horizontally** (and common inner scrollers) before this snapshot; still verify the manifest for off-screen or nested-scroll UI.

EXPLORATION BUDGET (hard rules)
- Do NOT set stop=true until **both** (a) at least ${input.minStepsBeforeStop} steps have been **executed**, **and** (b) at least ${input.minDistinctUrlsBeforeStop} **distinct** URLs appear in the visited list — unless you are blocked (CAPTCHA, 403, no targets).
- Budget met for this decision: ${budgetMet ? 'yes — you may stop if exploration is complete or capped' : 'no — you must continue with stop=false and playwrightCode'}.

Recent normalized URLs visited (sample):
${visitedLines}

Current page URL: ${input.pageUrl}
Document title: ${input.pageTitle}

Interactive manifest (Set-of-Marks [n]):
${somT || '(empty)'}

Accessibility snapshot:
${a11yT || '(empty)'}

The image is a full-page Set-of-Marks screenshot. Propose the next single exploratory action or stop.
${cont ? `\nCONTINUATION (previous stop was rejected — follow this):\n${cont}\n` : ''}${
      input.lastStepOutcome
        ? `\nPREVIOUS STEP (last executed Playwright on the prior iteration — use this to pick a different strategy when it failed, or build on success):\nCode:\n${input.lastStepOutcome.code.slice(0, 4000)}\nResult: ${input.lastStepOutcome.ok ? 'SUCCESS' : 'FAILED'}\n${input.lastStepOutcome.error ? `Error or note:\n${input.lastStepOutcome.error.slice(0, 2000)}\n` : ''}`
        : ''
    }`;
    const shot = input.screenshotBase64?.trim();
    if (!shot) {
      throw new Error('Discovery explore step requires a screenshot.');
    }
    const res = await this.chatJson(
      opts?.userId,
      'project_discovery',
      [
        { role: 'system', content: PROJECT_DISCOVERY_EXPLORER_SYSTEM },
        { role: 'user', content: user },
      ],
      {
        imageBase64: shot,
        /** Match project_discovery synthesize/final; GPT-5 counts reasoning inside max_completion_tokens — 2048 can truncate JSON to a few hundred chars. */
        maxTokens: 8192,
        reasoningEffort: 'low',
        temperature: 0.15,
        signal: opts?.signal,
      },
    );
    if (opts?.onLlmExchange) {
      const sysT = truncateDiscoveryLlmField(PROJECT_DISCOVERY_EXPLORER_SYSTEM, DISCOVERY_LLM_LOG_MAX_PROMPT_CHARS);
      const userT = truncateDiscoveryLlmField(user, DISCOVERY_LLM_LOG_MAX_PROMPT_CHARS);
      const respT = truncateDiscoveryLlmField(res.content, DISCOVERY_LLM_LOG_MAX_RESPONSE_CHARS);
      const thinkT = res.thinking?.trim()
        ? truncateDiscoveryLlmField(res.thinking, DISCOVERY_LLM_LOG_MAX_THINKING_CHARS)
        : null;
      const img = buildDiscoveryImageSentFields(shot);
      opts.onLlmExchange({
        kind: 'explore',
        usageKey: 'project_discovery',
        sent: {
          systemPrompt: sysT.value,
          ...(sysT.truncated ? { systemPromptTruncated: true } : {}),
          userPrompt: userT.value,
          ...(userT.truncated ? { userPromptTruncated: true } : {}),
          ...img,
        },
        received: {
          content: respT.value,
          ...(respT.truncated ? { contentTruncated: true } : {}),
          ...(thinkT ? { thinking: thinkT.value } : {}),
        },
      });
    }
    const parsed = parseJsonFromLlmText(res.content) as Record<string, unknown>;
    const stop = parsed.stop === true;
    const subsectionComplete = parsed.subsectionComplete === true;
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
    const playwrightCode =
      typeof parsed.playwrightCode === 'string' ? parsed.playwrightCode.trim() : '';
    const { thinkingStructured } = parseEvaluationCodegenThinking(parsed);
    return {
      stop,
      subsectionComplete,
      reason: reason || (stop ? 'stopped' : 'continue'),
      playwrightCode: playwrightCode || undefined,
      ...(thinkingStructured ? { thinkingStructured } : {}),
    };
  }

  /**
   * Final discovery report after exploration: structured JSON + human summary (Section 1 uses authoritative navigations on the server).
   */
  async projectDiscoveryFinalReport(
    input: {
      projectName: string;
      baseUrl: string;
      authContextSummary: string;
      signInAssistCompleted: boolean;
      explorationLogMarkdown: string;
      screensVisitedAuthoritative: Array<{ url: string; title: string | null; navigatedAt: string }>;
      finalPageUrl: string;
      somManifest: string;
      accessibilitySnapshot: string;
      screenshotBase64: string;
    },
    opts?: {
      userId?: string;
      signal?: AbortSignal;
      onLlmExchange?: (payload: DiscoveryLlmExchangePayload) => void;
    },
  ): Promise<{ discoverySummaryBodyMarkdown: string; structured: Record<string, unknown> }> {
    const { som: somT, a11y: a11yT } = truncateDomSectionsForGemini(
      input.somManifest,
      input.accessibilitySnapshot,
    );
    const authLines =
      input.screensVisitedAuthoritative.length > 0
        ? input.screensVisitedAuthoritative
            .map((v, i) => `${i + 1}. ${v.url} — ${v.title ?? '(no title)'} (${v.navigatedAt})`)
            .join('\n')
        : '(no main-frame navigations recorded)';
    const user = `Project name: ${input.projectName}
Base URL: ${input.baseUrl}
Auth / credentials context: ${input.authContextSummary}
Automatic sign-in assist reported success at least once: ${input.signInAssistCompleted ? 'yes' : 'no'}
Final page URL after exploration: ${input.finalPageUrl}

Authoritative main-frame navigations (chronological):
${authLines}

Exploration log (agent steps):
${input.explorationLogMarkdown.trim() || '(none)'}

Interactive manifest (Set-of-Marks [n]) — final state:
${somT || '(empty)'}

Accessibility snapshot — final state:
${a11yT || '(empty)'}

The attached image is the final Set-of-Marks screenshot. Produce the JSON report. Section 1 list in JSON will be replaced server-side with the authoritative navigation list; still fill screensVisitedSectionMarkdown as a polished mirror if useful.`;

    const shot = input.screenshotBase64?.trim();
    if (!shot) {
      throw new Error('Discovery final report requires a screenshot.');
    }
    const res = await this.chatJson(
      opts?.userId,
      'project_discovery',
      [
        { role: 'system', content: PROJECT_DISCOVERY_FINAL_SYSTEM },
        { role: 'user', content: user },
      ],
      {
        imageBase64: shot,
        maxTokens: 8192,
        temperature: 0.2,
        signal: opts?.signal,
      },
    );
    if (opts?.onLlmExchange) {
      const sysT = truncateDiscoveryLlmField(PROJECT_DISCOVERY_FINAL_SYSTEM, DISCOVERY_LLM_LOG_MAX_PROMPT_CHARS);
      const userT = truncateDiscoveryLlmField(user, DISCOVERY_LLM_LOG_MAX_PROMPT_CHARS);
      const respT = truncateDiscoveryLlmField(res.content, DISCOVERY_LLM_LOG_MAX_RESPONSE_CHARS);
      const thinkT = res.thinking?.trim()
        ? truncateDiscoveryLlmField(res.thinking, DISCOVERY_LLM_LOG_MAX_THINKING_CHARS)
        : null;
      const img = buildDiscoveryImageSentFields(shot);
      opts.onLlmExchange({
        kind: 'final',
        usageKey: 'project_discovery',
        sent: {
          systemPrompt: sysT.value,
          ...(sysT.truncated ? { systemPromptTruncated: true } : {}),
          userPrompt: userT.value,
          ...(userT.truncated ? { userPromptTruncated: true } : {}),
          ...img,
        },
        received: {
          content: respT.value,
          ...(respT.truncated ? { contentTruncated: true } : {}),
          ...(thinkT ? { thinking: thinkT.value } : {}),
        },
      });
    }
    const parsed = parseJsonFromLlmText(res.content) as Record<string, unknown>;
    const body =
      typeof parsed.discoverySummaryMarkdown === 'string' ? parsed.discoverySummaryMarkdown.trim() : '';
    const structuredRaw = parsed.structured;
    const structured =
      typeof structuredRaw === 'object' && structuredRaw !== null && !Array.isArray(structuredRaw)
        ? (structuredRaw as Record<string, unknown>)
        : { schemaVersion: 1 };
    if (!body) {
      throw new Error('project_discovery final returned empty discoverySummaryMarkdown');
    }
    return { discoverySummaryBodyMarkdown: body, structured };
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
    const route = await this.llmConfig.resolve(opts?.userId, 'evaluation_report');
    const llmTrace = { provider: route.provider, model: route.model };
    const dbgRoute = (m: string, d?: Record<string, unknown>) => dbg?.(m, { ...(d ?? {}), ...llmTrace });
    dbgRoute('evaluation_report: start', { stepsMarkdownChars: input.stepsMarkdown.length });
    const user = `Overall intent:
${input.intent}

Desired output:
${input.desiredOutput}

Progress summary:
${input.progressSummary?.trim() || '(none)'}

Step-by-step trace:
${input.stepsMarkdown}`;
    dbgRoute('evaluation_report: invoking chatJson', {
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
      { maxTokens: 16384, temperature: 0.3, signal: opts?.signal, onDebugLog: dbgRoute },
    );
    const parsed = parseJsonFromLlmText(res.content) as Record<string, unknown>;
    const markdown = typeof parsed.markdown === 'string' ? parsed.markdown.trim() : '';
    const structured = parsed.structured;
    dbgRoute('evaluation_report: parsed', {
      markdownChars: markdown.length,
      hasStructured: structured !== undefined,
    });
    if (!markdown) {
      throw new Error('evaluation_report returned empty markdown');
    }
    return { markdown, ...(structured !== undefined ? { structured } : {}) };
  }
}
