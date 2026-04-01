# Changelog

## 2026-04-01

- `0.10.136`: **Projects / detached discovery** — **Discovery agent log** panel to the **right** of the inline **Live browser** (timestamped lines + optional JSON detail); WebSocket **`discoveryDebugLog`** / **`discoveryDebugLogBatch`** via `useDiscoveryLive`. Detached preview shows the same log. `@bladerunner/web 0.7.84`.

- `0.10.135`: **Run app discovery** — **longer crawl** (**80** steps, **30 min** wall clock for exploration); **minimum coverage budget** before honoring model stop (**28** executed steps **or** **14** distinct normalized URLs) unless blocked; up to **2** continuation retries with a forced prompt when the model stops early; **stricter explorer system prompt** (breadth-first, no “sufficiently explored” before budget); **5** consecutive Playwright failures before abort; **900ms** settle between steps. `@bladerunner/api 0.6.108`, `@bladerunner/web 0.7.83`.

- `0.10.134`: **Projects** — inline **Live browser** preview uses **`max-w-xs`** (`20rem`) centered (`mx-auto`) so it is narrower than the full edit card. `@bladerunner/web 0.7.82`.

- `0.10.133`: **Run app discovery** — **LLM exploration loop** (up to **40** Playwright steps, **12 min** wall clock for the crawl after auth) plus **final report** with evidence-based **Discovery Summary** and **structured JSON** (`app`, `routes`, `screens`, `agentAdvice`, `unknowns`, etc.); stored markdown leads with **`# Screens Visited`** (authoritative navigations) then **`# Discovery Summary`**. **Explore** and **final** prompts align with the Browser Automation Discovery Agent design (QA staging framing). `@bladerunner/api 0.6.107`, `@bladerunner/web 0.7.81`.

- `0.10.132`: **Run app discovery** — **Live browser** inline preview + **Detach** (`/discovery-preview/:projectId`) via Socket.IO **`discovery-${projectId}`** frames (same gateway as evaluations). **Auto sign-in** runs when a **test email** is set (was incorrectly requiring email **and** password); **multi-iteration** assist + **2.5s** settle before capture. **`screensVisited`** (main-frame navigations) stored in structured JSON + LLM prompt. `@bladerunner/api 0.6.106`, `@bladerunner/web 0.7.80`.

- `0.10.131`: **Edit project** — **Run app discovery** shows a **pipeline** (Ready → Queued → Discovering → Result), **timestamps**, status/errors, and **editable** discovery **summary (markdown)** and **structured JSON** with save/clear. Drafts stay stable while discovery **polls**; they refresh when a run **finishes** or you **save**. `@bladerunner/web 0.7.79`.

- `0.10.130`: **Projects** page uses **`max-w-7xl`** for the form + table (was `max-w-4xl`); projects table wrapper uses **`overflow-x-auto`** instead of clipping (`overflow-hidden`), **`table-fixed`** + column widths + **`Actions`** header so Edit/Delete stay visible. `@bladerunner/web 0.7.78`.

- `0.10.129`: Root **`pnpm run migrate:api`** runs **`prisma migrate deploy`** in **`@bladerunner/api`** (schema lives under `apps/api/prisma/`; running `prisma migrate` from the repo root fails with “Could not find Prisma Schema”).

- `0.10.128`: **Agent knowledge framework** — per-user **general agent instructions** (Settings → Agents) and per-project **manual notes** + **app discovery** artifacts; API `GET`/`PATCH` `/settings/agent-context`, `GET`/`PATCH` `/projects/:id/agent-knowledge`, `POST` `/projects/:id/discovery`. Injected into **instruction-to-action** (recording AI), **evaluation** codegen/analyzer when a project is linked, and **optimized prompt** `appContext`. Discovery MVP: single-page capture + LLM synthesis into markdown + structured JSON; new LLM usage key `project_discovery`. `@bladerunner/api 0.6.105`, `@bladerunner/web 0.7.77`.

## 2026-03-31

- `0.10.127`: **Evaluation detail** — **Run mode** (Normal vs Review) can be changed whenever **Start run** or **Re-run / Retry** is available, not only while `QUEUED`, so you can switch to **Normal (continuous)** before re-running after a review-mode run. Read-only run mode line only while a run is in progress and re-run is unavailable. `@bladerunner/web 0.7.76`.

- `0.10.126`: **Evaluations** — **codegen** and **analyzer** LLM user prompts include **automatic sign-in** run flags (`autoSignInEnabled` / `autoSignInCompleted`); prompts steer away from **ask human** for credential walls and from Playwright that types secrets while sign-in is still pending. **Orchestrator** coerces **ask_human → retry** when auto sign-in is on and sign-in is not done yet. Persisted step JSON includes the same flags. `@bladerunner/api 0.6.104`.

- `0.10.125`: **Evaluations** — **auto sign-in** runs **only while sign-in has not yet succeeded** (`!clerkFullSignInDone`): each step can be the one that lands on login (step 1, 2, …). **Playback** logic only acts when the page looks like sign-in; after success the flag is set and **orchestrator stops calling** `maybeEvaluationAutoSignInAssist`. Completion is **persisted on the evaluation browser session** so **resume after human/review** does not retry sign-in. **OTP-only** Clerk assist now sets **`clerkFullSignInDone`** after filling OTP. `@bladerunner/api 0.6.103`.

- `0.10.124`: **Evaluations** — **auto sign-in** runs **only at step 1** (start of first iteration). Removed **post-step** auto sign-in after each Playwright run (was redundant and could re-trigger Clerk/login flows). `@bladerunner/api 0.6.102`.

- `0.10.123`: **Evaluation step timeline** — fixed timeline height **`1200px`** (was **1000px**). `@bladerunner/web 0.7.75`.

- `0.10.122`: **Evaluation step timeline** — fixed timeline height **`1000px`** (was **700px**): step cards, stacked strip, and parallel row on **`lg+`**. `@bladerunner/web 0.7.74`.

- `0.10.121`: **Evaluation step timeline** — step strip and step cards use **fixed `height: 700px`** (not `min-height`). **Parallel** row is **`700px` tall on `lg+`**; below `lg`, columns keep **`min-height: 700px`** so stacked layout doesn’t clip. `@bladerunner/web 0.7.73`.

- `0.10.120`: **Evaluation detail** — no **document** auto-scroll from trace or step selection (trace follows inside its panel; step strip uses horizontal **`scrollTo`** only). **Full progress log** moved **above** the step timeline, **collapsed** by default (`<details>`). `@bladerunner/web 0.7.72`.

- `0.10.119`: **Evaluation step timeline** — step timeline **`min-height: 700px`** (was 1000px). `@bladerunner/web 0.7.71`.

- `0.10.118`: **Evaluation step timeline** — step cards and timeline row use **`min-height: 1000px`** (stacked strip + parallel columns + `EvaluationStepCard`). `@bladerunner/web 0.7.70`.

- `0.10.117`: **Evaluation step timeline** — **Stacked** / **Parallel** toggle in the header. **Parallel**: one step at a time (horizontal snap scroll; follows the selected step), **Evaluation trace** fills the right column at the same height. **Stacked**: previous step strip + trace below. `@bladerunner/web 0.7.69`.

- `0.10.116`: **Evaluation trace** no longer disappears when the preview is **detached** — `useEvaluationLive` stayed enabled only when `!isDetached`, which cleared trace and dropped the socket; it now stays on for all **`liveEnabled`** runs. Trace panel visibility uses **`liveEnabled || evaluationTrace.length > 0`**. Debug ingest (session `3619df`) on socket connect for verification. `@bladerunner/web 0.7.68`.

- `0.10.115`: **Evaluation trace** — every step-scoped log line is prefixed with **`[Step N]`**; run-level **`[Eval]`** and final-report **`[Report]`**; collapsed JSON control shows **`(N keys)`** only. `@bladerunner/api 0.6.101`, `@bladerunner/web 0.7.67`.

- `0.10.114`: **Evaluation detail** — when the live preview is **detached**, the inline preview area collapses to **10px** height (thin strip; click to **reattach**); caption hidden while detached. `@bladerunner/web 0.7.66`.

- `0.10.113`: **Evaluation trace** — collapsed row is **one line**: timestamp, message, and **JSON details (N keys)** inline; expanding drops the JSON **below** that row. `@bladerunner/web 0.7.65`.

- `0.10.112`: **Evaluation trace** — JSON details on each line are **collapsed** under `<details>` (expand to read full payload). `@bladerunner/web 0.7.64`.

- `0.10.111`: **Evaluation trace (live)** — WebSocket **`evaluationDebugLog`** / **`evaluationDebugLogBatch`** (join catch-up) streams timestamped server lines (orchestrator + LLM: sign-in, capture timings, Gemini/non-Gemini request/response, Playwright run). UI panel below the step timeline on **Evaluation detail**. `@bladerunner/api 0.6.100`, `@bladerunner/web 0.7.63`.

- `0.10.110`: evaluation step timeline — during **`proposing`**, **Codegen outputs** no longer says **“Codegen model running”** while the server is still in **auto sign-in + SOM/a11y capture** (before the codegen LLM). **Debug ingest** (session `3619df`) logs wall-clock milestones: after **`proposing` emit**, after **auto sign-in**, after **capture**, before/after **codegen LLM**. `@bladerunner/api 0.6.99`, `@bladerunner/web 0.7.62`.

- `0.10.109`: evaluation **analyzer inputs** are **persisted before** the analyzer LLM runs (`updateStepAnalyzerInputsOnly`); socket **`analyzing`** triggers detail **refetch** so the UI can show JPEG/JSON while **Analyzer outputs** still spin. `@bladerunner/api 0.6.98`, `@bladerunner/web 0.7.61`.

- `0.10.108`: evaluation **analyzer/codegen LLM** calls use **`AbortSignal.timeout`** (default **180s** each; override with **`EVALUATION_CODEGEN_TIMEOUT_MS`** / **`EVALUATION_ANALYZER_TIMEOUT_MS`**). On analyzer timeout the orchestrator persists a **retry** outcome instead of hanging forever. Web: **`lastProgress.sequence`** checks use **`== null`** so sequence **0** is valid. `@bladerunner/api 0.6.97`, `@bladerunner/web 0.7.60`.

- `0.10.107`: continual-learning pass — refreshed **`continual-learning-index.json`** (34 transcript paths + mtimes); **`AGENTS.md`** workspace fact on evaluation live timeline, socket progress catch-up, spinner/`{}` handling, and eval **`eval (<anonymous>)`** failure classification. Root version only.

- `0.10.106`: evaluation step loading flags use **`!= null`** for persisted JSON (not “non-empty object”) so **`{}`** from the API clears spinners; **`showCodegenFromLive`** also accepts **`expectedOutcome`**. `@bladerunner/web 0.7.59`.

- `0.10.105`: evaluation step **live spinners** no longer stick forever when **`lastProgress.phase` lags** refetched step JSON — `getLiveLoadingFlags` uses presence of persisted codegen/analyzer JSON instead of hardcoded spinners during **`proposing`**. `@bladerunner/web 0.7.58`.

- `0.10.104`: **WebSocket join catch-up** for **`evaluationProgress`**: store latest progress per evaluation and **replay on `join`** (same idea as frame catch-up) so clients that connect after the first **`proposing`** emit still get `lastProgress` and show step placeholders. `@bladerunner/api 0.6.96`.

- `0.10.103`: evaluation **step card + placeholders** appear as soon as a step is scheduled: orchestrator emits **`proposing`** before sign-in + SOM capture; live merge treats **`analyzing`** as in-flight; socket **`proposing`** triggers detail refetch. `@bladerunner/api 0.6.95`, `@bladerunner/web 0.7.57`.

- `0.10.102`: **Unhandled rejection** from evaluation/playback **user-generated Playwright** (stack `at eval (<anonymous>)` only) no longer **crashes the API** — `classifyRecordingAutomationFailure` treats eval-sourced strict/timeout/locator errors as known non-fatal (same as `executePwCode` frames). Evaluation codegen system prompt nudges **exact** option names for custom selects. `@bladerunner/api 0.6.94`.

- `0.10.101`: autonomous **evaluation** codegen and analyzer now use the same **Set-of-Marks + CDP accessibility** pipeline as AI prompt steps (`RecordingService.captureEvaluationLlmPageContext` wrapping `captureLlmPageContext`); LLM prompts include truncated manifest and a11y text; step JSON persists full fields; UI `JsonBlock` omits long text for readability. `@bladerunner/api 0.6.93`, `@bladerunner/web 0.7.56`.

- `0.10.100`: removed session `3619df` debug ingest around **`evaluationAnalyzeAfterStep`**. `@bladerunner/api 0.6.92`.

- `0.10.99`: debug ingest (session `3619df`) around **`evaluationAnalyzeAfterStep`** (`analyzer_llm_await_start` / `done` / `throw`) to diagnose **analyzer** “hangs”. `@bladerunner/api 0.6.91`.

- `0.10.98`: evaluation **live step cards** — placeholder step **as soon as** `proposing` runs (activity log + spinners); **`analyzing`** phase + richer **`proposing`** socket payload; refetch on **`executing`** / **`paused_review`**; spinners for codegen/analyzer sections until data arrives; live phase badge on step header. `@bladerunner/api 0.6.90`, `@bladerunner/web 0.7.55`.

- `0.10.97`: removed session `3619df` debug ingest **`fetch`** from **`requestBrowserFromWorker`** and browser-worker control **`close`** handler; **clearer disconnect log line** retained. `@bladerunner/api 0.6.89`, `@bladerunner/browser-worker 0.2.5`.

- `0.10.96`: debug ingest (session `3619df`) on **`requestBrowserFromWorker`** and browser-worker **control socket close** to confirm launch handshake; worker log clarifies disconnect is **expected** after launch. `@bladerunner/api 0.6.88`, `@bladerunner/browser-worker 0.2.4`.

- `0.10.95`: evaluation step detail — **icon modal previews** for codegen viewport JPEG and analyzer after-step JPEG (`ViewportJpegPreviewIconButton`); orchestrator now persists **`viewportJpegBase64`** / **`afterStepViewportJpegBase64`** on step JSON. `@bladerunner/api 0.6.87`, `@bladerunner/web 0.7.54`.

- `0.10.94`: removed session `3619df` debug ingest **`fetch`** instrumentation from evaluations `setRunModeIfQueued`, `resetForReprocess`, and **`POST /start`** / **`reprocess`** handlers. `@bladerunner/api 0.6.86`.

- `0.10.93`: **`setRunModeIfQueued`** no-ops when the evaluation is already **RUNNING** / **WAITING_FOR_HUMAN** / **WAITING_FOR_REVIEW**, so a duplicate **`POST /start`** (e.g. after **Re-run** while the UI still showed queued) no longer returns 400. `@bladerunner/api 0.6.85`.

- `0.10.92`: temporary debug instrumentation (session `3619df`) on `POST /evaluations/:id/start` and `reprocess`, plus `setRunModeIfQueued` / `resetForReprocess` for run-mode 400 diagnosis. `@bladerunner/api 0.6.84`.

- `0.10.91`: **New evaluation** form fills **Start URL** from the selected project’s URL when present (adds `https://` if missing). `@bladerunner/web 0.7.53`.

- `0.10.90`: evaluation step cards use **half the timeline strip width** (`flex-[0_0_calc(50%-0.5rem)]` with `gap-4`). `@bladerunner/web 0.7.52`.

- `0.10.89`: evaluation **Step timeline** uses horizontal scrolling again (snap + smooth scroll); active step follows with `inline: 'end'` so newer steps stay toward the right. `@bladerunner/web 0.7.51`.

- `0.10.88`: evaluation detail layout — **Goal Definitions** card above actions; full-width live preview under run controls; **Step timeline** below preview with a two-column step grid on `md+`; human input after timeline. `@bladerunner/web 0.7.50`.

- `0.10.87`: removed debug-session `fetch` instrumentation (evaluations run-mode probe, Prisma constructor, recording resume/pointer/key, runs `findOne`, Runs/RunDetail/useRecording hooks). `@bladerunner/api 0.6.83`, `@bladerunner/web 0.7.49`.

- `0.10.86`: evaluation detail page scrolls in the main shell (`flex-1 min-h-0 overflow-y-auto`) so long step timelines and JSON blocks are reachable. `@bladerunner/web 0.7.48`.

- `0.10.85`: evaluation **step review mode** — `EvaluationRunMode` (`continuous` | `step_review`), `WAITING_FOR_REVIEW`, step fields (`stepTitle`, `progressSummaryBefore`, codegen/analyzer JSON snapshots), orchestrator pause/resume via `POST /evaluations/:id/continue-review`, LLM `stepTitle` in codegen JSON. Migration `20260331120000_evaluation_review_mode`. `@bladerunner/api 0.6.82`, `@bladerunner/web 0.7.47`.

## 2026-03-30

- `0.10.83`: evaluation detail **Activity log** groups live last-event JSON and persisted progress in one bordered panel with internal scroll (`max-h-64`). `@bladerunner/web 0.7.46`.
- `0.10.82`: debug instrumentation (session `3619df`) on evaluation `runLoop` entry, worker `requestBrowserFromWorker` failure, and `reprocess` path; `@bladerunner/api 0.6.81`, `@bladerunner/web 0.7.45`.
- `0.10.81`: browser-worker `chromium.launchServer` sets `channel: 'chromium'` so headless uses the main bundled Chromium binary instead of `chromium-headless-shell` (avoids failures when only the shell path is missing from the Playwright cache).
- `@bladerunner/browser-worker 0.2.3`: same.
- `0.10.80`: root `postinstall` runs `playwright install chromium` so local dev (browser-worker `chromium.launchServer`) has matching Chromium / headless-shell binaries after `pnpm install`; set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in CI if you do not need browsers. `@bladerunner/browser-worker 0.2.2`: align `playwright-core` to `^1.58.2` with the API package.
- `0.10.79`: document that `evaluations.project_id` / auto-sign-in columns require `pnpm --filter @bladerunner/api migrate` (or `prisma migrate deploy`) so the DB matches the Prisma schema; fixes P2022 when migrations were not applied.
- `@bladerunner/api 0.6.80`: same (operational fix; no code change beyond version).
- `0.10.78`: evaluations support **Auto-sign in** (optional): when enabled, the autonomous browser uses the same Clerk / project test-user assist as playback whenever a sign-in page is detected (before each step and after Playwright execution).
- `@bladerunner/api 0.6.79`: `Evaluation.autoSignIn`, `autoSignInClerkOtpMode`; `RecordingService.maybeEvaluationAutoSignInAssist` + `resolveClerkOtpModeForEvaluation`; migration `20260330180000_evaluation_auto_sign_in`.
- `@bladerunner/web 0.7.44`: create + detail UI for auto sign-in and Clerk OTP mode.
- `0.10.77`: evaluations can be linked to a **project** (optional `project_id` on evaluations; create/edit in UI from Projects-backed list).
- `@bladerunner/api 0.6.78`: `Evaluation.projectId`, list/detail include `project` summary; create/update DTOs accept `projectId`; migration `20260330140000_evaluation_project_id`.
- `@bladerunner/web 0.7.43`: project picker on evaluation create and detail; Evaluations list shows linked project name/color.
- `0.10.76`: evaluations support editing global intent and desired output (PATCH), and **Re-run** / **Retry** via `POST /evaluations/:id/reprocess` which resets steps, questions, and reports then starts a new run.
- `@bladerunner/api 0.6.77`: `UpdateEvaluationDto`, `PATCH /evaluations/:id`, `resetForReprocess`, `POST /evaluations/:id/reprocess`.
- `@bladerunner/web 0.7.42`: evaluation detail textareas, Save changes, Re-run / Retry wired to reprocess; first-time **Start** remains for `QUEUED` only.
- `0.10.75`: added detached evaluation live preview (`/evaluation-preview/:evaluationId`) with Detach / Reattach on the evaluation detail page, mirroring recording preview behavior.
- `@bladerunner/web 0.7.41`: `DetachedEvaluationPreview` page, route, and inline preview hidden while detached (single stream via the detached window).
- `0.10.74`: evaluation start now returns `scheduled` in the API JSON when a run was actually queued (skipped if a run is already in progress for that id); the detail page shows feedback and debug logs cover the start path.
- `@bladerunner/web 0.7.40`: handle `scheduled: false` from `POST /evaluations/:id/start`, surface start errors, and instrument start mutation success/error.
- `@bladerunner/api 0.6.76`: `scheduleRun` returns boolean; `scheduleRun` / `runLoop` / controller instrumented for session `91995d`.
- `0.10.73`: fixed Prisma/pg TLS when `DATABASE_URL` includes `sslmode=require` so `ssl.rejectUnauthorized` is not overwritten by parsed connection options (resolves self-signed chain errors with `@prisma/adapter-pg`).
- `@bladerunner/api 0.6.75`: build `PoolConfig` from `parse(DATABASE_URL)` with merged `ssl`, add direct `pg` + `pg-connection-string` dependencies.
- `0.10.72`: added Evaluations (autonomous LLM + Playwright runs with human verification, final report, live UI, and socket progress).
- `@bladerunner/web 0.7.39`: added `evaluationsApi`, `Evaluations` and `EvaluationDetail` pages, sidebar nav, `useEvaluationLive` for `/recording` frames and `evaluationProgress`, and status badges for evaluation states.
- `@bladerunner/api 0.6.74`: added Prisma models and migrations, `EvaluationsModule` (orchestrator, REST + `start`/`cancel`/`human-answer`), evaluation browser sessions on the recording worker, `evaluationProgress` gateway events, and join-time catch-up frames for evaluation rooms.
- `@bladerunner/types 0.2.10`: added `evaluation_*` LLM usage keys for models-by-task settings.

## 2026-03-28

- `0.10.71`: added visible pending feedback when saving an in-progress recording for later so the Runs page shows that the resumable save is still processing.
- `@bladerunner/web 0.7.38`: added a spinner and temporary disabled state to the `Save for later` recording action, and blocked `Finish` while the save request is in flight.
- `0.10.70`: fixed continue-recording handoff for dormant recording runs so playback pages can reopen legacy in-progress runs instead of failing on resume.
- `@bladerunner/api 0.6.73`: allowed `resumeRecording()` to reopen dormant runs still marked `RECORDING` when no live session exists, and added selftest coverage for that legacy status path.
- `0.10.69`: removed the temporary runtime instrumentation used to diagnose resumable playback repair failures and manual-step AI prompt relabeling after the fixes were confirmed.
- `@bladerunner/api 0.6.72`: cleaned up playback/replay debug probes from recording repair, resume checkpoint restore, selector rewrite diagnosis, and transcript metadata tracing.
- `@bladerunner/web 0.7.37`: removed temporary run-detail, runs-page, recording-hook, and step-card probes used during resumable playback debugging.
- `0.10.68`: fixed resumable-run playback for Tailwind-heavy file-input locators and stopped manual steps from being mislabeled as AI prompt after playback repair attempts.
- `@bladerunner/api 0.6.71`: escaped broader Tailwind class-chain syntax in playback locators, including file-input variants and arbitrary values, and prevented transcript persistence from stamping `ai_prompt_step` metadata onto manual steps.
- `@bladerunner/web 0.7.36`: treated `origin` as the authoritative UI signal for AI prompt steps so contaminated manual-step metadata no longer changes the step badge or playback tone.
- `0.10.67`: fixed resumable-run playback compilation for recorded locators that contain nested quoted CSS fragments before continuing a saved recording.
- `@bladerunner/api 0.6.70`: rewrote playback locator escaping to recover the full `.locator(...)` CSS argument even when the recorded snippet contains embedded quote sequences, and added a focused nested-quote selftest.
- `0.10.66`: added resumable recording runs so in-progress recordings can be saved, reopened for prefix playback, and continued later from a fresh restored browser session.
- `@bladerunner/api 0.6.69`: added the `PAUSED` run lifecycle, split recording stop into save-vs-finish flows, restored resumed sessions from checkpoints, and added a focused resumable-recording selftest.
- `@bladerunner/web 0.7.35`: added `Save for later` and `Continue recording` actions in Runs and Run Detail, while allowing paused runs to replay their recorded prefix.
- `@bladerunner/types 0.2.9`: added the shared paused recording status enum for resumable runs.

## 2026-03-25

- `0.10.65`: removed the temporary runtime instrumentation used to verify the recording-page automatic sign-in false-failure fix after the issue was confirmed resolved.
- `@bladerunner/api 0.6.68`: cleaned up the generic auto sign-in post-submit verification probes while keeping the short settle-window success handling.
- `@bladerunner/web 0.7.34`: removed the temporary recording auto sign-in request lifecycle probes from `useRecording`.
- `0.10.64`: fixed the false automatic sign-in failure shown during recording by letting generic login submits finish their short in-flight transition before classifying them as stuck on the form.
- `@bladerunner/api 0.6.67`: re-checked generic post-submit auth state after a short settle window and treated successful redirect/form disappearance as sign-in success instead of a 503 failure.
- `0.10.63`: added targeted runtime probes to diagnose the false automatic sign-in error shown on the recording page after a seemingly successful generic login.
- `@bladerunner/api 0.6.66`: logged the generic post-submit auth state before and after a short observation window to determine whether sign-in success is being classified too early.
- `@bladerunner/web 0.7.33`: logged the recording-page automatic sign-in request lifecycle so UI-side stale error reporting can be distinguished from backend false failures.
- `0.10.62`: removed the temporary runtime instrumentation used to diagnose AI Visual ID tree rendering and generic auto sign-in issues after both fixes were confirmed.
- `@bladerunner/api 0.6.65`: cleaned up backend debug probes from AI Visual ID capture/tree persistence and generic auto sign-in diagnostics while keeping the verified fixes.
- `@bladerunner/web 0.7.32`: removed temporary AI Visual ID placement and modal render probes from the Runs page and tree modal.
- `0.10.61`: reshaped the AI Visual ID tree into a Playwright-style accessibility view by collapsing raw CDP wrapper nodes and preserving semantic attributes.
- `@bladerunner/api 0.6.64`: normalized CDP accessibility snapshots into semantic AI Visual ID nodes with filtered wrappers, preserved ARIA-style attributes, and tighter tag matching.
- `@bladerunner/web 0.7.31`: rendered AI Visual ID tree rows as Playwright-style `role "name" [attr=value]` entries and removed noisy `no tag` badges from wrapper-heavy output.
- `0.10.60`: added focused runtime diagnostics for AI Visual ID tree quality so noisy accessibility nodes can be filtered with evidence from live captures.
- `@bladerunner/api 0.6.63`: logged AI Visual ID tree composition metrics and sample noisy/tagged nodes to debug the malformed accessibility tree presentation.
- `0.10.59`: fixed AI Visual ID tree capture in runtimes where Playwright's `page.accessibility` API is unavailable by falling back to Chromium CDP accessibility data.
- `@bladerunner/api 0.6.62`: captured AI Visual ID accessibility trees through `Accessibility.getFullAXTree` when the Playwright accessibility API is missing, preserving the modal tree payload.
- `0.10.58`: added a run-scoped AI Visual ID tool on the recording page with persistent prompt/answer history and a tree viewer for labeled UI context.
- `@bladerunner/api 0.6.61`: added AI Visual ID capture, persistence, REST endpoints, LLM routing, and a focused selftest for tree/tag mapping.
- `@bladerunner/web 0.7.30`: added the recording-page AI Visual ID panel, persisted history list, and screenshot plus accessibility-tree modal with blinking tag highlights.
- `@bladerunner/types 0.2.8`: added the shared `ai_visual_id` LLM usage key.
- `0.10.57`: added temporary runtime instrumentation and a focused generic auto sign-in selftest to debug intermittent playback startup failures before landing the final fix.
- `@bladerunner/api 0.6.60`: logged generic auto sign-in detection/form state and added a Playwright-backed delayed/two-step auth selftest for runtime diagnosis.
- `@bladerunner/clerk-agentmail-signin 0.5.2`: tightened OTP completion waits so same-host verification screens do not report false success before the OTP UI actually exits.
- `0.10.56`: removed the temporary runtime instrumentation used to debug scroll recording and playback after the fixes were confirmed.
- `@bladerunner/api 0.6.59`: cleaned up backend debug probes while keeping the recorded-scroll targeting and animated playback behavior.
- `@bladerunner/web 0.7.29`: removed temporary client-side wheel debugging logs from the recording preview bridge.
- `0.10.55`: made playback scroll steps visibly animate through their movement instead of jumping to the final position in a single frame.
- `@bladerunner/api 0.6.58`: changed scroll-step playback to probe for the best responsive scroll container and animate the recorded delta progressively with `requestAnimationFrame`.
- `0.10.54`: fixed playback of recorded scroll steps by resolving broad selectors to a descendant-or-match element that actually responds to the stored scroll delta.
- `@bladerunner/api 0.6.57`: taught scroll-step playback to search matched containers and apply the delta to the first element whose scroll position actually changes.
- `0.10.53`: fixed recording so scroll gestures are persisted as replayable steps instead of being silently ignored after the remote page moved.
- `@bladerunner/api 0.6.56`: captured debounced wheel gestures as manual `SCROLL` steps with stored relative scroll Playwright code for page and panel scrolling.
- `0.10.52`: changed new recording defaults so runs start with the larger browser preset and high-quality preview settings out of the box.
- `@bladerunner/web 0.7.28`: defaulted the Runs page recording controls to `1440 x 900`, `High` stream quality, and `High` preview smoothness.
- `0.10.51`: added a read-only optimized prompt review panel in playback step details so canonical prompts and supporting intent metadata can be inspected per step.
- `@bladerunner/web 0.7.27`: rendered stored optimized prompt details inside `StepCard` when playback metadata includes a compiled prompt.
- `0.10.50`: added per-step optimized playback prompts that capture user intent from recorded evidence and let playback fall back to semantic step recreation before the normal repair path.
- `@bladerunner/api 0.6.55`: added the `Optimized Prompt` LLM task, persisted per-step optimized prompt evidence/results, refreshed prompts after recording stops, and used canonical playback prompts as a fallback before standard playback regeneration.
- `@bladerunner/web 0.7.26`: exposed the new `Optimized Prompt` task in AI / LLM settings so users can choose the model/provider used for canonical per-step prompt compilation.
- `@bladerunner/types 0.2.7`: added the shared `optimized_prompt` LLM usage key.
- `0.10.49`: added safe recording-time controls for browser resolution, stream quality, and preview smoothness on the Runs page, while keeping playback aligned to the same stored viewport.
- `@bladerunner/api 0.6.54`: persisted per-run capture settings, used them to size recording/playback browsers, and applied matching screencast quality/smoothness settings to preview and saved video capture.
- `@bladerunner/web 0.7.25`: added Runs page controls for browser resolution, stream quality, and preview smoothness when starting a recording.
- `0.10.48`: added an easy project filter to the Home runs table so recent runs can be narrowed without leaving the dashboard.
- `@bladerunner/api 0.6.53`: taught the runs list endpoint to accept a `projectId` filter for dashboard and runs-table queries.
- `@bladerunner/web 0.7.24`: added a Home runs table project picker that filters runs by project alongside the existing search, status, and platform controls.
- `0.10.47`: preserved immutable record-time Playwright per step so playback can try the active snippet first, repair failures with fresh LLM context, and promote successful replacements without losing the original baseline.
- `@bladerunner/api 0.6.52`: added `recorded_playwright_code`, stored record-time snippets across recording flows, and taught playback to retry failed steps by regenerating Playwright with both the broken active code and the original recorded code as context.
- `0.10.46`: hardened AI prompt timeout handling so client-abort signals are narrower, retryable generate failures can retry once, and known recording/playback promise rejections no longer take down the API process.
- `@bladerunner/api 0.6.51`: classified recording/playback automation failures, persisted failed AI prompt code context in step metadata, switched AI test aborts to real request aborts, and added a non-fatal unhandled-rejection guard for known timeout paths.
- `0.10.45`: removed the temporary Provider dropdown debug probes after confirming the generic combobox-trigger fallback fixed the shadcn-style playback issue.
- `@bladerunner/api 0.6.50`: cleaned up Provider dropdown instrumentation while keeping the resilient role/text fallback for generated combobox clicks.
- `0.10.44`: added a generic playback fallback for combobox triggers so shadcn-style dropdowns keep working even when accessible role/name queries do not resolve their visible labels.
- `@bladerunner/api 0.6.49`: rewrote generated combobox clicks to try role/name first and then visible-text trigger locators, based on runtime evidence from the Kintsugi Provider dropdown mismatch.
- `0.10.43`: added temporary runtime probes to compare Provider dropdown DOM semantics against AI prompt codegen for the Kintsugi playback issue.
- `@bladerunner/api 0.6.48`: instrumented Provider dropdown capture and codegen summaries to debug why generated Playwright locators for the shadcn-style control do not execute successfully.
- `0.10.42`: removed the temporary playback teardown crash probes after confirming the screencast shutdown race fix.
- `@bladerunner/api 0.6.47`: cleaned up playback teardown instrumentation while keeping the closed-target screencast ack guard in place.
- `0.10.41`: fixed playback teardown crashes caused by late screencast frame acknowledgements arriving after the browser was already closing.
- `@bladerunner/api 0.6.46`: made screencast teardown tolerant of closed-target CDP ack races during recording/playback shutdown while preserving the existing playback completion flow.
- `0.10.40`: removed the temporary Kintsugi dropdown codegen debug probes and one-off repro scripts after confirming the AI prompt selection fix.
- `@bladerunner/api 0.6.45`: cleaned up runtime instrumentation from Set-of-Marks capture and AI prompt codegen while keeping the verified dropdown-targeting behavior.
- `0.10.39`: taught AI prompt codegen to avoid unnecessary field-selector combobox clicks when the desired dropdown result row is already visible in the captured DOM context.
- `@bladerunner/api 0.6.44`: strengthened Playwright codegen and DOM-verify guidance so visible patient search result rows win over unrelated nearby comboboxes like the Kintsugi `Name` picker.
- `0.10.38`: fixed Set-of-Marks candidate ordering so newly discovered custom dropdown rows are actually sorted and tagged in the final screenshot manifest.
- `@bladerunner/api 0.6.43`: moved custom pointer-text SOM candidates into the final sort/slice pass so visible dropdown results like the Kintsugi `Julian` row are no longer dropped before badge generation.
- `0.10.37`: taught Set-of-Marks capture to tag custom clickable dropdown rows with visible text, so AI prompt screenshots can include patient search results like the Kintsugi `Julian` row.
- `@bladerunner/api 0.6.42`: expanded Set-of-Marks candidate detection beyond semantic controls to include visible pointer-text custom options, and added temporary dropdown repro instrumentation.
- `0.10.36`: removed temporary AI prompt latency timing probes and the one-off repro helper after confirming the verify pass caused the visible delay.
- `@bladerunner/api 0.6.41`: cleaned up AI prompt latency instrumentation while preserving the existing codegen and verify behavior.
- `0.10.35`: added temporary AI prompt latency instrumentation to measure the gap between visible model output and final Playwright code completion.
- `@bladerunner/api 0.6.40`: instrumented AI prompt codegen and verify timing for runtime diagnosis of post-stream latency.
- `0.10.34`: removed temporary AI prompt Anthropic debug probes and the one-off signal repro script after confirming the request-shape fix.
- `@bladerunner/api 0.6.39`: cleaned up Anthropic AI prompt instrumentation while keeping the corrected SDK request options wiring.
- `0.10.33`: fixed AI prompt step generation when Anthropic is selected for Playwright codegen by sending abort signals as request options instead of request body fields.
- `@bladerunner/api 0.6.38`: corrected Anthropic SDK request wiring for AI prompt codegen so `signal` no longer triggers `invalid_request_error`.
- `0.10.32`: removed temporary Kintsugi auto-sign-in debug probes and one-off repro scripts after confirming the non-Clerk fallback works.
- `@bladerunner/api 0.6.37`: cleaned up runtime instrumentation from recording/playback auto sign-in while preserving the project-aware auth fallback.
- `0.10.31`: taught automatic sign-in to fall back to project-stored credentials for non-Clerk apps like Kintsugi while keeping Clerk detection for Evocare-style flows.
- `@bladerunner/api 0.6.36`: added project-aware generic email/password sign-in alongside the existing Clerk automation path and persisted the chosen auth kind for playback.
- `0.10.30`: removed the temporary measurement probe used to validate the compact “Models by task” card height reduction.
- `@bladerunner/web 0.7.23`: cleaned up debug-only task-card measurement hooks while keeping the compact table layout.
- `0.10.29`: condensed the AI / LLM “Models by task” card into a table-like layout to cut its vertical footprint substantially.
- `@bladerunner/web 0.7.22`: replaced per-row stacked labels with a shared header row and compact single-line task/provider/model/connection rows.
- `0.10.28`: removed temporary instrumentation and repro artifacts after confirming the AI / LLM save fix.
- `@bladerunner/web 0.7.21`: cleaned up the temporary save-path debug probe from the settings UI.
- `@bladerunner/api 0.6.35`: removed temporary save-path debug probes and repro helpers while keeping the no-op credential save fix.
- `0.10.27`: fixed AI / LLM settings saves so model-routing changes no longer fail when credential encryption is unset and no credentials are actually being changed.
- `@bladerunner/api 0.6.34`: pruned empty provider credential fields before persistence and skipped credential writes for no-op saves.
- `0.10.26`: removed temporary AI / LLM debug instrumentation after confirming the provider-status fix.
- `@bladerunner/web 0.7.20`: cleaned up runtime logging probes from the settings UI while keeping the final status behavior intact.
- `0.10.25`: aligned the AI / LLM provider list status with live test results so failed provider tests no longer show as green in the left rail.
- `@bladerunner/web 0.7.19`: made the provider list show `testing`, `connected`, or `test failed` based on the latest connection test before falling back to static configuration state.
- `0.10.24`: added Cerebras, MiniMax, Kimi, and Qwen as built-in AI / LLM providers with OpenAI-compatible defaults and suggested model seeds.
- `@bladerunner/api 0.6.33`: extended the LLM provider registry with Cerebras, MiniMax, Kimi, and Qwen plus curated starter model ids.
- `0.10.23`: tightened the AI / LLM settings density by compressing the "Models by task" card and converting provider model rows into a one-line table with launch dates when provider metadata is available.
- `@bladerunner/web 0.7.18`: reduced task-card row height and added compact model-list columns for model id and launch date.
- `@bladerunner/api 0.6.32`: extended provider model responses to include launch-date metadata where available.
