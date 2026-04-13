# Navigation recording: Action instruction + Improve with AI + confirmation modal

## Overview

Add an optional per-step **Action instruction** (natural language) on the Navigation recording timeline, persisted on `NavigationAction`, wired into Skyvern `navigation_goal` when set, plus **Improve with AI** and a **confirmation modal** (Skyvern-style) before applying the improved text.

**Scope (confirmed):** Navigate, click, type / variable_input / prompt_type, and prompt rows.

---

## 1. Data model

- Add nullable column on **`NavigationAction`**, e.g. `action_instruction` (`Text`, optional), mapped to `actionInstruction` in TypeScript.
- Prisma migration under [`apps/api/prisma/`](apps/api/prisma/).
- Extend **`RecordedNavigationAction`** in API + web; **`mergeOneRecordedAction`** copies `actionInstruction` from client; **`stopSession` `createMany`** persists it.
- Extend [`NavigationActionDto`](apps/web/src/lib/api.ts) and [`toRecordedActions`](apps/web/src/pages/NavigationDetail.tsx).

---

## 2. Skyvern mapping

When `actionInstruction?.trim()` is non-empty, use it as the **primary** natural-language goal for that block; otherwise keep current templates.

Update both [`skyvern-workflow-api.mapper.ts`](apps/api/src/modules/navigations/skyvern-workflow-api.mapper.ts) (Play API) and [`skyvern-compiler.ts`](apps/api/src/modules/navigations/skyvern-compiler.ts) (preview after stop).

---

## 3. Improve with AI (API)

- **POST** e.g. `/navigations/:id/actions/improve-instruction` with body `{ draft: string, action: { …minimal snapshot } }`, authenticated.
- **`LlmService.improveNavigationActionInstruction`**: refine draft for Skyvern, single imperative, neutral QA tone; usage key e.g. `navigation_action_instruction_improve`.
- **Response:** `{ improved: string }` (original draft stays on the client for the modal).

---

## 4. UI: Action instruction field

- In [`RecordedActionTimeline.tsx`](apps/web/src/components/navigation/RecordedActionTimeline.tsx) (`TimelineInlineEditor`), add **Action instruction** for navigate, click, type/variable, prompt rows (helper `supportsActionInstruction`).
- Label, optional tooltip, tip line (“Skyvern executes one action per block”).
- **Wand** button → triggers improve flow (below); loading/disabled state while API runs.

---

## 5. UI: “Choose your prompt” confirmation (new)

After the improve API returns **success**, do **not** write `improved` directly into the action. Instead open a **modal** modeled on Skyvern:

| Element | Behavior |
|--------|------------|
| **Title** | e.g. “Choose your prompt” |
| **Subtitle** | e.g. “Select which version of the prompt you’d like to use” |
| **Toggle** | Two segments: **Improved** \| **Original** — switches the large preview text |
| **Preview** | Read-only text area showing either the **improved** LLM result or the **original** `draft` (the text that was sent to improve, typically current `actionInstruction` or empty + context) |
| **Cancel** | Close modal; **no** change to stored instruction |
| **Use this prompt** | Primary button: set `actionInstruction` (or the field used for NL goal) to the **currently selected** version (improved vs original), call `onUpdate`, close modal |

**Edge cases**

- If improve API **fails**: show toast/error; do not open modal (or open with improved = draft and disable Improved — prefer **no modal on failure**).
- **Original** tab always shows the pre-request text the user had when they clicked Improve (capture `draft` in local state before the request).

**Component**

- New small component e.g. `ChooseActionPromptModal.tsx` next to timeline components, or colocated in `RecordedActionTimeline.tsx` if preferred — keep Radix Dialog consistent with [`VariableInjectionModal`](apps/web/src/components/navigation/VariableInjectionModal.tsx).

---

## 6. Testing / version

- Manual: improve → modal → Use this prompt → stop → persisted instruction + Skyvern goal.
- Patch version bump + [`CHANGELOG.md`](CHANGELOG.md) entry.

---

## 7. Implementation todos

1. Schema + merge + persist + DTOs
2. Mapper + compiler instruction-first behavior
3. LLM endpoint `improve-instruction`
4. Timeline: Action instruction field + wand
5. **Choose your prompt modal** (Original / Improved toggle, Cancel, Use this prompt)
