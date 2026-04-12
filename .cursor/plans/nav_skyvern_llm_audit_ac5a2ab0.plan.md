# Navigation Skyvern workflow refinement — LLM routing and Smart Audit

## Goal

Wire **Navigation — Skyvern Workflow Refinement Evaluation** into **Settings → AI / LLM** and the NestJS LLM stack. The **default route for this usage key only** is **OpenRouter** with model **`anthropic/claude-3.5-sonnet`**. Do **not** use **`anthropic/claude-sonnet-4`** (invalid on OpenRouter).

**Usage key:** `navigation_skyvern_workflow_refinement`  
**Settings label:** `Navigation — Skyvern Workflow Refinement Evaluation`

---

## Step 1 — Registry and defaults (API) — **HARD CONSTRAINT**

In [`apps/api/src/modules/llm/llm-usage-registry.ts`](apps/api/src/modules/llm/llm-usage-registry.ts):

- Add `navigation_skyvern_workflow_refinement` to `LLM_USAGE_KEYS`, `LLM_USAGE_LABELS`, and `LLM_USAGE_SUPPORTS_VISION` (**false**).
- In `getDefaultPreferenceForUsage`, for **`navigation_skyvern_workflow_refinement`**, return **`{ provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' }`** (optional env override **`NAVIGATION_SKYVERN_REFINEMENT_MODEL`** only if we keep that hook; default string must remain **`anthropic/claude-3.5-sonnet`**).
- **Never** document or default this usage to `anthropic/claude-sonnet-4`.

---

## Step 2 — Settings UI (web)

In [`apps/web/src/pages/Settings.tsx`](apps/web/src/pages/Settings.tsx), append **`LLM_USAGE_ROWS`** with `key: 'navigation_skyvern_workflow_refinement'` and the label above.

---

## Step 3 — LlmService audit call — **HARD CONSTRAINT (token / payload)**

When implementing the navigation refinement LLM call in [`apps/api/src/modules/llm/llm.service.ts`](apps/api/src/modules/llm/llm.service.ts):

- **Do not** pass the raw recorded-actions array to the model.
- Add a **private** mapper (e.g. `toNavigationRefinementLlmActions`) that, for each action, **omits** **`x`**, **`y`**, **`elementId`**, and **`pageUrl`**.
- The serialized payload sent to the LLM must contain **only** these fields per row: **`sequence`**, **`actionType`**, **`elementText`**, **`ariaLabel`**, **`inputValue`**.
- Use existing **`chatJson`** + **`parseJsonFromLlmText`** with usage **`navigation_skyvern_workflow_refinement`**.

---

## Step 4 — NavigationRecordingService + `LlmModule`

- Import **`LlmModule`** in [`apps/api/src/modules/navigations/navigations.module.ts`](apps/api/src/modules/navigations/navigations.module.ts).
- Implement an audit method that calls the new **`LlmService`** API with **`userId`** and minimized actions (service may pass raw actions; **`LlmService`** performs the strip).

---

## Step 5 — Gateway

- [`apps/api/src/modules/recording/recording.gateway.ts`](apps/api/src/modules/recording/recording.gateway.ts): **`nav:requestAudit`** → run audit → **`nav:auditResults`** / **`nav:error`**.

---

## Step 6 — Frontend hook — **HARD CONSTRAINT (`acceptAuditSuggestion`)**

In [`apps/web/src/hooks/useNavigationRecording.ts`](apps/web/src/hooks/useNavigationRecording.ts), **`acceptAuditSuggestion(sequenceId)`** must update **that** action in state by:

1. **`actionType`:** set to **`'prompt'`** if the **original** `actionType` was **`'click'`**; set to **`'prompt_type'`** if the **original** was an **input** step (**`'type'`** or **`'variable_input'`**). (If other types appear, define explicit rules before shipping.)
2. **`inputValue`:** set to **`suggestion.suggestedPrompt`** (the string from the audit result for that sequence).
3. **`inputMode`:** set to **`'variable'`** where it applies to the recorded-action schema (per existing timeline / compiler expectations).

No vague “patch label” wording: the mutation is exactly the three bullets above plus keeping **`actionsRef`** in sync.

Also implement **`runSmartAudit`**, socket **`nav:requestAudit`**, and return **`auditSuggestions`**, **`auditRunning`**, **`runSmartAudit`**, **`acceptAuditSuggestion`** from the hook.

---

## Step 7 — Versioning

Patch bump root / `@bladerunner/api` / `@bladerunner/web` and **`CHANGELOG.md`** when shipping each slice.

---

## Implementation status

- [ ] Steps 1–2: registry + Settings + versions/changelog — **requires Agent mode** (Plan mode blocks `.ts` / `package.json`; approve a mode switch or run the edits locally).
- [ ] Steps 3–7: LlmService mapper + audit, module, gateway, hook `acceptAuditSuggestion`, remaining bumps

**Steps 1–2 file edits:** [`apps/api/src/modules/llm/llm-usage-registry.ts`](apps/api/src/modules/llm/llm-usage-registry.ts), [`apps/web/src/pages/Settings.tsx`](apps/web/src/pages/Settings.tsx), then patch versions + CHANGELOG per Step 7.
