# Changelog

## 2026-04-09

- `0.10.235`: **browser-worker Docker — pnpm monorepo build** — Fly/GitHub Actions now **`fly deploy . --config apps/browser-worker/fly.toml`** from **repo root**; **`Dockerfile.production`** uses **`pnpm-lock.yaml`** + **`pnpm install --filter @bladerunner/browser-worker...`** (no isolated **`npm`** / **`package-lock.json`**). Removed **`apps/browser-worker`** from root **`.dockerignore`** so the worker image can COPY workspace files; worker workflow also triggers on root lockfile/`package.json` changes. `@bladerunner/browser-worker 0.2.12`.

- `0.10.234`: **AGENTS.md (continual learning)** — Thinking process: **accordion** + auto-expand active step; deployment: standalone **browser-worker** `package-lock.json`, Fly **GitHub Actions** workflows, **Vercel** via dashboard Git. Refreshed **`continual-learning-index.json`** (47 transcripts).

- `0.10.233`: **CI / browser-worker Docker — fix `npm install` in Fly build** — `package-lock.json` had pnpm workspace paths (`../../node_modules/.pnpm/...`), causing **`EMISSINGTARGET`** on **`RUN npm install`**. Regenerated a standalone npm lockfile (`npm install --no-workspaces`); added **`refresh-lockfile`** script + Dockerfile note. `@bladerunner/browser-worker 0.2.11`.

- `0.10.232`: **Fly.io — browser worker DNS (`ENOTFOUND`)** — API **`BROWSER_WORKER_URL`** and worker **`WORKER_EXTERNAL_HOST`** default to **`bladerunner-browser-worker.flycast`** (Fly Proxy), not **`.internal`**. Stopped Machines do not resolve on **`.internal`**, which broke evaluations when the worker scaled to zero. Redeploy API + browser-worker; if **`BROWSER_WORKER_URL`** is set as a Fly **secret**, update or remove it so it does not override **`fly.toml`**. `@bladerunner/api 0.6.166`, `@bladerunner/browser-worker 0.2.10`.

- `0.10.231`: **Thinking process — accordion rows** — Expanding a step collapses the previously expanded one (single open row). Active codegen/analyzer step still auto-expands when it becomes active. `@bladerunner/web 0.7.132`.

- `0.10.230`: **Evaluations — codegen decides finish / ask_human / execute** — `evaluation_codegen` JSON uses **`stepMode`**: **`execute_playwright`** (Playwright + deterministic retry/advance), **`finish`** (end run, finalize report), or **`ask_human`** (question + options; coerced to retry while auto sign-in pending). Removed **`signalEvaluationComplete`** in favor of explicit **`finish`**. `@bladerunner/api 0.6.165`.

- `0.10.229`: **Evaluations — remove analyzer vision LLM** — Each step uses one vision call (`evaluation_codegen`) only; after Playwright the orchestrator applies **`deterministicEvaluationStepAnalysis`** (retry on failure, advance on success, **finish** when codegen sets **`signalEvaluationComplete: true`** and execution succeeds). Removed **`evaluationAnalyzeAfterStep`** and **`EVALUATION_ANALYZER_SYSTEM`**. Post-step JPEG/SOM/a11y remain for UI preview. **`evaluation_analyzer`** in Settings is legacy/unused. README/AGENTS updated. `@bladerunner/api 0.6.164`, `@bladerunner/web 0.7.131`.

- `0.10.228`: **Thinking process — collapse only previous active on handoff** — When the active codegen/analyzer step advances, the new step auto-expands and only the **prior** active step is removed from the expanded set; other manually opened rows stay open. `@bladerunner/web 0.7.130`.

- `0.10.227`: **Thinking process — multi-expand, no forced single row** — The active step still auto-expands when codegen/analyzer runs, but other steps can stay open or be opened while a step is active; removed the single-`expandedStepId` logic and the `onToggle` guard that closed non-active rows. `@bladerunner/web 0.7.129`.

- `0.10.226`: **Evaluation trace — blue/bold only on actual LLM calls** — API adds `detail.llmInvocation` for provider request/response lines (including Gemini `generateContent`, non-Gemini request/response, override response, and post-`chatJson` “response received” rows); routing-only lines like `LLM route: resolving config` are unchanged. Web styles those lines blue/bold and shows provider/model only when `llmInvocation` is set. `@bladerunner/api 0.6.163`, `@bladerunner/web 0.7.128`.

- `0.10.219`: **OpenRouter vision — ignore Amazon Bedrock** — OpenRouter can route `anthropic/claude-3-5-haiku-…` to **Amazon Bedrock**, which returned **`'claude-3-5-haiku-20241022' does not support image input`** for evaluation screenshots. Multimodal OpenRouter requests now include **`provider: { ignore: ['amazon-bedrock'] }`** so vision goes to a host that accepts images (typically Anthropic). Errors mentioning unsupported image input get a short **Hint** in the message. `@bladerunner/api 0.6.158`.

- `0.10.218`: **Docs — OpenRouter Claude Haiku 3.5** — Comments clarify that the OpenRouter+Anthropic vision compat path (system folded into user, no `image_url.detail`) applies to **`anthropic/claude-3-5-haiku-…`** and other **`anthropic/claude-…`** slugs. `@bladerunner/api 0.6.157`.

- `0.10.217`: **OpenRouter + Anthropic — vision request shape** — OpenRouter often returns **`400 Provider returned error`** when **`system` + multimodal `user`** is forwarded to Anthropic. For **`openRouterStyle`** providers with **`anthropic/`** models, **`OpenAiProvider`** now folds **system → first user** text (same pattern as other working clients) and **omits `image_url.detail`** for OpenRouter. **`APIError`** bodies are appended to thrown messages for clearer logs. `@bladerunner/api 0.6.156`.

- `0.10.216`: **LLM — no default `response_format: json_object`** — `chatJson` and **`OpenAiProvider`** now default to **plain text**; JSON is enforced via prompts and **`parseJsonFromLlmText`** (same as Gemini). Avoids OpenRouter 400s, **no double LLM call**, and matches how we already tolerate markdown / CoT. Opt-in **`responseFormat: 'json_object'`** remains for OpenAI-only strict mode. **`action_to_instruction`** uses **`parseJsonFromLlmText`** instead of raw **`JSON.parse`**. `@bladerunner/api 0.6.155`.

- `0.10.215`: **OpenRouter / non-OpenAI models — retry without JSON mode** — Chat completions used **`response_format: { type: 'json_object' }`** (required by `chatJson`). Many OpenRouter targets (e.g. **Anthropic Claude / Haiku**) reject that parameter with **HTTP 400** (`Provider returned error`). On **400**, **`OpenAiProvider`** now retries **once** without `response_format`; prompts already ask for JSON and **`parseJsonFromLlmText`** tolerates prose. `@bladerunner/api 0.6.154`.

- `0.10.214`: **Evaluations — codegen timeout no longer fails the run** — `AbortSignal.timeout` on **evaluation_codegen** (default **120s**) rejects with **`This operation was aborted`**; the analyzer already recovered from its own timeout, but codegen did not, so long vision calls **FAILED** the whole evaluation. On abort/timeout the orchestrator now logs a warning, persists a **no-op** step with **`codegenTimedOut`**, and continues so the **analyzer** can return **retry**. **`isAbortOrTimeoutError`** reads **`name`/`message`** from any thrown object (e.g. **`DOMException`**) so aborts are recognized reliably. `@bladerunner/api 0.6.153`.

- `0.10.213`: **Browser worker — valid CDP WebSocket URL for local evals** — `launchServer` used `host: '::'`, which could produce malformed endpoints (`ws://:::3003/...`) that `chromium.connect` rejects. Bind `0.0.0.0` and normalize returned `wsEndpoint` to `127.0.0.1` when `WORKER_EXTERNAL_HOST` is unset (Fly/production unchanged). `@bladerunner/browser-worker 0.2.9`.

- `0.10.212`: **API Docker build — `DATABASE_URL` for `prisma generate`** — `prisma.config.ts` requires `DATABASE_URL` when loading; Fly/GitHub Actions had no env during image build. Set a placeholder `ENV` in `Dockerfile.production` before `prisma generate` / `pnpm run build` (generate does not connect to DB). `@bladerunner/api 0.6.152`.

- `0.10.211`: **Fly API deploy — fix Dockerfile path** — `apps/api/fly.toml` used `dockerfile = "apps/api/Dockerfile.production"`, which Fly resolved under `apps/api/` → `apps/api/apps/api/Dockerfile.production` (not found in CI). Set to `Dockerfile.production` (relative to `fly.toml`).

## 2026-04-08

- `0.10.210`: **Browser worker — commit `package-lock.json`** — Locks npm deps for reproducible Fly/Docker builds. `@bladerunner/browser-worker 0.2.8`.

- `0.10.209`: **Browser worker Docker image — build TypeScript in production** — `Dockerfile.production` no longer uses `npm install --production` before `npx tsc || true` (wrong `tsc` package, silent skip, empty `dist/`, crash on start). Now `npm install` → `npm run build` → `npm prune --omit=dev`. `@bladerunner/browser-worker 0.2.7`.

- `0.10.208`: **CI — Fly.io browser worker deploy on push to `main`** — GitHub Actions workflow deploys `bladerunner-browser-worker` from `apps/browser-worker` when worker paths change; uses `FLY_API_TOKEN` (same secret as API).

- `0.10.207`: **CI — Fly.io API deploy on push to `main`** — GitHub Actions workflow runs `flyctl deploy` from the repo root with `apps/api/fly.toml` (correct Docker context for the monorepo). Requires `FLY_API_TOKEN` in repo secrets. Root `.dockerignore` trims upload size; `apps/api/fly.toml` `[build].dockerfile` set to `apps/api/Dockerfile.production` for root-context deploys.

- `0.10.206`: **Evaluations / playback — getByRole with `exact: true`** — The button/combobox playback rewrites only matched `{ name: '…' }` with no other options, so codegen like `getByRole('button', { name: 'Sign in', exact: true })` was not transformed and strict mode could still fail. Regex now allows extra option properties. `@bladerunner/api 0.6.151`.

- `0.10.205`: **Evaluations / playback — strict mode on duplicate button names** — The button/combobox playback fallbacks used `if (count()) click()`, which still called `.click()` on ambiguous locators when count was **2+** (e.g. two "Sign in" buttons). Now: click only when count is **1**; when **>1**, prefer `form:has(input[type="password"])` for buttons, else `.first()`; combobox path uses the same count split. `@bladerunner/api 0.6.150`.

- `0.10.204`: **Clerk auto sign-in — duplicate "Sign in" buttons** — Password submit now prefers the button inside `form:has(input[type="password"])` so page-level header CTAs do not trigger Playwright strict mode; evaluation LLM guidelines note scoping when multiple "Sign in" buttons exist. `@bladerunner/clerk-agentmail-signin 0.5.3`, `@bladerunner/api 0.6.149`.

## 2026-04-01

- `0.10.200`: **Evaluations — compact New evaluation on narrow screens** — Below `sm`, the primary action shows **`+` only** (with **`aria-label="New evaluation"`**); from **`sm` up**, **Plus icon + label** unchanged. `@bladerunner/web 0.7.120`.

- `0.10.199`: **Docs — AGENTS.md continual-learning sync** — Captured evaluation thinking-step UX (no strikethrough on completed substeps; expand active step only), automatic evaluation advance without per-step Continue, and Playwright guidance to avoid long utility-class CSS locators; refreshed transcript index (39 files).

- `0.10.198`: **Home runs toolbar — compact filters on narrow screens** — Below `sm`, filter controls are **32×32 icon buttons** (native select overlay) with **`aria-label`s**; search is a **shorter second row** (`h-7`). From **`sm` up**, the previous **text dropdowns + search** layout is unchanged. `@bladerunner/web 0.7.119`.

- `0.10.197`: **Home runs table — project + steps in Run row on narrow screens** — Below `sm`, the **URL** under the run name is replaced by **project** (same pill styling as the Project column) and **step count** beside it; **Project** and **Steps** columns are hidden. Run title keeps **`title={url}`** for the full URL. `@bladerunner/web 0.7.118`.

- `0.10.196`: **Home runs table — time under date on narrow screens** — Below `sm`, the **Time** column is hidden and **duration** is stacked **under** the **Created** date in the same cell (teal, tabular). `@bladerunner/web 0.7.117`.

- `0.10.195`: **Home runs table — narrow viewport density** — Below `sm`, **status** uses **icons** (with tooltip / `aria-label`) instead of “Recording” / “Completed”, and **platform** shows the **icon only** (full name on `title`). `@bladerunner/web 0.7.116`.

- `0.10.194`: **Evaluations — Thinking process accordion** — While a step is **in progress**, that row **stays expanded** and **all other rows stay collapsed**; the active row cannot be collapsed until the step finishes. When nothing is active, rows can be toggled open one at a time. `@bladerunner/web 0.7.115`.

- `0.10.193`: **Evaluations — Thinking process substeps** — Completed thinking substeps stay **grey** but **no strikethrough**. `@bladerunner/web 0.7.114`.

- `0.10.192`: **Evaluations — Thinking process plan substeps** — Thinking process rows show **five sequential codegen thinking fields** (observation → … → Playwright rationale) with **per-row** blue spinner or green check, **grey strikethrough** when done and **black** when active; future rows stay hidden until reached. The collapsed header shows **green dot + connector** segments for each completed substep, left of the step spinner. `@bladerunner/web 0.7.113`.

- `0.10.191`: **Docs — LLM encryption env format** — `.env.example` notes that `LLM_CREDENTIALS_ENCRYPTION_KEY` must use **`KEY=value`** (a missing `=` merges name + value so the variable is never set).

- `0.10.190`: **Settings — Save credentials not gated on encryption flag** — **Save** / **Save LLM settings** stay enabled while saving (typing a provider API key does not change server `LLM_CREDENTIALS_ENCRYPTION_KEY`). Amber copy clarifies **server encryption** vs **OpenRouter key**. `@bladerunner/web 0.7.112`.

- `0.10.189`: **LLM credentials encryption env** — Clearer **503** when `LLM_CREDENTIALS_ENCRYPTION_KEY` is unset; **Settings** disables **Save** until encryption is configured and shows **openssl** instructions; **`.env.example`** documents the variable. `@bladerunner/api 0.6.147`, `@bladerunner/web 0.7.111`.

- `0.10.188`: **Settings — LLM provider credentials blocked by task routing** — `PATCH /settings` applied **`usage` before `providerCredentials`**; any row with an **empty model** (e.g. provider switched before the catalog loaded) caused **400** and **skipped saving API keys** (often OpenRouter). **Provider credentials are persisted first**; invalid `usage` rows are **skipped** (warn log) instead of failing the whole patch. `@bladerunner/api 0.6.146`.

- `0.10.187`: **Dev — "Failed to fetch" to API** — Vite proxy now targets **`127.0.0.1:3001`** (avoids `localhost` → `::1` vs IPv4 listen mismatches). `apiFetch` / `buildApiUrl` support optional **`VITE_API_URL`** with clearer network errors; API **CORS** allows **`http://127.0.0.1:5173`**. `.env.example` no longer implies you must set `VITE_API_URL` in dev (prefer omitting it so `/api` uses the proxy). `@bladerunner/web 0.7.110`, `@bladerunner/api 0.6.145`.

- `0.10.186`: **Settings — AI/LLM empty provider list** — Removed temporary debug ingest / extra DB read from `getCapabilities`. When `GET /settings` returns no `providerDefinitions`, the AI tab now shows a clear message instead of blank task models and a missing credentials panel (`selectedProvider` was null). `@bladerunner/api 0.6.144`, `@bladerunner/web 0.7.109`.

- `0.10.185`: **Debug — OpenRouter LLM settings persistence** — Runtime ingest logs for OpenRouter `capabilities` / masked-credentials (`H1`–`H3`) while investigating configured-state persistence. `@bladerunner/api 0.6.143`, `@bladerunner/web 0.7.108`.

- `0.10.184`: **Settings — AI/LLM provider header layout** — **Save credentials** / Test / Refresh no longer sit in a tight two-column grid beside the title (which caused overlap on mid-width layouts). Title, help copy, and actions are **stacked** with normal flow. `@bladerunner/web 0.7.107`.

- `0.10.183`: **Settings — LLM test uses in-form API key** — `POST /settings/llm/test-connection` accepts optional **`apiKey`** / **`baseUrl`** so **Test connection** validates what you typed before **Save** (merged with DB/env when a field is left blank). AI/LLM provider card: **Save credentials** button + short note that the top **Save LLM settings** also persists secrets. `@bladerunner/api 0.6.142`, `@bladerunner/web 0.7.106`.

- `0.10.182`: **Evaluations — main crop luma vs screencast** — Stricter **DOM** gate (no more passing on ~72 chars + nav-only widgets); then **`waitUntilMainScreenshotNotMostlyWhite`** takes **`main`/`[role="main"]` JPEG crops** and repeats until **mean luma ≤232** or **10** rounds, with **`networkidle`** between tries (aligns capture closer to what the streamed video shows once ink lands). Ingest: **`main landmark crop luma`** per round (`hypothesisId` **H7**). `@bladerunner/api 0.6.141`.

- `0.10.181`: **Evaluations — wait for hydrated `main` before vision capture** — After shell settle, **`waitForMainContentLandmarkHydrated`** waits (up to ~18s) until a visible **`main` / `[role="main"]`** region has **text**, **several widgets**, or a **sized iframe**, so dashboard chrome alone does not end capture with an empty center panel. Debug ingest logs **`main landmark probe`** (`mainRegions`, `maxText`, `maxWidgets`, `mainHydrationTimedOut`). `@bladerunner/api 0.6.140`.

- `0.10.180`: **Evaluations — sparse-shell vision recovery + preview copy** — When **≤2** visible interactives remain after initial settle, run a **scroll nudge** (lazy-mount friendly), wait for **≥3** controls or **longer body text**, then paint again before SOM + JPEG (logs: `sparseShellRecovery`, `sparseShellRecoveryTimedOut`). **JPEG preview** modal notes that **step thinking** also uses **prior steps and Playwright errors**, not only this frame. `@bladerunner/api 0.6.139`, `@bladerunner/web 0.7.105`.

- `0.10.179`: **Evaluations — stronger vision settle (blank JPEG vs LLM text)** — `settlePageForLlmVisionCapture` now waits **`networkidle`** (best-effort), requires at least one **visible** interactive (not `opacity:0` / 0×0), counts **same-origin iframes** and **open shadow roots**, then **`document.fonts.ready`** + double **`requestAnimationFrame`** before SOM + JPEG. Ingest logs (debug session) record settle outcome + mean JPEG luma for verification. `@bladerunner/api 0.6.138`.

- `0.10.178`: **Evaluations — wait for interactive DOM before vision capture** — `captureEvaluationLlmPageContext` now runs **`load`** + **`waitForFunction`** until at least one interactive element exists (up to ~20s) before SOM + a11y + JPEG, so empty SOM headers and blank screenshots from pre-hydration shells are much less likely. `@bladerunner/api 0.6.137`.

- `0.10.177`: **Evaluations — JPEG preview shows LLM text context** — Codegen/analyzer JPEG modal now includes **expandable** Set-of-Marks manifest + accessibility snapshot (same fields as in the multimodal user prompt), with copy explaining the model names controls from **text** as well as pixels. Removed temporary evaluation-orchestrator debug ingest hooks. `@bladerunner/api 0.6.136`, `@bladerunner/web 0.7.104`.

- `0.10.176`: **Evaluations — viewport JPEG preview** — Codegen/analyzer JPEG modal uses **Blob URLs**, **object-fit contain** + max height so **full-page** screenshots scale into view (avoids a “blank” strip from only seeing the top white margin). Neutral background + short note that the model also reads **SOM manifest** and **accessibility** text. `@bladerunner/web 0.7.103`.

- `0.10.175`: **Evaluations — codegen JSON thinking as structured object** — **Codegen outputs (JSON)** (and related raw blocks) show `thinking` as nested JSON (`observation`, `needsToDoAndWhy`, …) when `thinkingStructured` exists or when legacy prose uses `Observation:` / `What to do and why:` / … labels; duplicate `thinkingStructured` is omitted from the display object. `@bladerunner/web 0.7.102`.

- `0.10.174`: **Agent context — no discovery in LLM prompts** — Workspace/project prompt injection and optimized `appContext` **`agentKnowledge`** include only **`general`** and **`projectManual`**; discovery summary, structured map, and Mermaid are not sent to any model. `@bladerunner/api 0.6.135`.

- `0.10.173`: **Agent context — no Discovery Summary in LLM prompts** — Prompt injection and optimized `appContext` JSON no longer include the `# Discovery Summary` narrative from stored project knowledge (screens visited + structured excerpt + Mermaid still pass). Renamed optimized field **`discoverySummary` → `discoveryContext`**. `@bladerunner/api 0.6.134`.

- `0.10.172`: **Tooling — continual-learning hook state** — Refreshed `.cursor/hooks/state/continual-learning.json` (transcript index metadata).

- `0.10.171`: **Evaluations — LLM prompts + codegen JSON** — Persists **`llmPrompts`** (`system` / `user`) on codegen and analyzer step JSON; orchestrator merges prompts into persisted inputs. **Codegen output** JSON orders **`thinkingStructured` → `thinking` → `stepTitle`** (then code/outcome). Step cards: **prompt** icon left of **JPEG** preview; both use **`z-[220]` / `z-[221]`** when embedded in the full-step modal. **Codegen outputs (JSON)** shows full persisted output (no stripping of thinking fields). `@bladerunner/api 0.6.133`, `@bladerunner/web 0.7.101`.

- `0.10.170`: **Evaluations / discovery — thinking sub-items** — **Codegen output — thinking** shows five labeled sub-items (what the model sees, what it plans and why, prior failures, intended action, Playwright rationale). **Thinking Process** uses a stacked layout with placeholders for empty fields; step timeline and discovery steps use the same labels. `@bladerunner/web 0.7.100`.

- `0.10.169`: **Evaluations + discovery — full timeline + structured thinking** — Evaluations persist **orchestrator** steps (`step_kind`: load URL, optional auto sign-in) with **LLM** steps; API returns **`stepKind`** in camelCase. Codegen JSON supports **`thinkingStructured`** (five fields); UI shows nested reasoning on **Thinking process** and step cards (orchestrator rows use a compact layout + cog icon). **Discovery** appends **`discovery_steps_json`** (goto, auth, explore success/fail/blocked) and **`GET /projects/:id/agent-knowledge`** includes **`discoverySteps`**. Projects page: **Discovery steps** panel with expand + **Full step** modal. Migration **`20260405120000_evaluation_step_kind_discovery_steps_json`**. `@bladerunner/api 0.6.132`, `@bladerunner/web 0.7.99`.

- `0.10.168`: **Evaluations — full step from Thinking process** — Each row in **Thinking process** has a **Full step** control that opens a modal with the same **EvaluationStepCard** content as the step timeline (codegen/analyzer panels, JPEG previews). [`EvaluationStepCard`](apps/web/src/components/evaluation/EvaluationStepCard.tsx) extracted for reuse. `@bladerunner/web 0.7.98`.

- `0.10.167`: **Discovery — previous step + duplicate cap** — Explore passes **PREVIOUS STEP** (last snippet + **SUCCESS**/**FAILED** + error) into every next `projectDiscoveryExploreStep` after a run; **identical** normalized `playwrightCode` executes at most **twice**, then the loop blocks a third and logs without advancing the step counter (short backoff + iteration guard so duplicate proposals cannot tight-loop). System/user prompts updated. `@bladerunner/api 0.6.131`.

- `0.10.166`: **Discovery — provider dropdown loop** — Explore loop now passes **LAST STEP FAILED** (code + error) into the next `projectDiscoveryExploreStep` so the model must change locators. **Playback:** [`fallbackNamedButtonSelectTriggerClicksForPlayback`](apps/api/src/modules/recording/recording-playwright-merge.util.ts) wraps `getByRole('button', { name: '…' })` clicks with the same combobox/filter fallbacks as combobox triggers. **Prompts:** modal/dialog scoping rules. Discovery browser uses **`evaluationPlaywrightTimeoutMs`** defaults. `@bladerunner/api 0.6.130`.

- `0.10.165`: **Evaluations — faster perceived steps** — Default **Gemini** model for **evaluation_codegen** / **evaluation_analyzer** is **`gemini-2.0-flash`** (override with **`EVALUATION_VISION_MODEL`** or **`GEMINI_EVALUATION_MODEL`**); other vision keys still use **`GEMINI_INSTRUCTION_MODEL`**. Defaults: **15s** Playwright (`EVALUATION_PLAYWRIGHT_TIMEOUT_MS`), **120s** LLM aborts (`EVALUATION_CODEGEN_TIMEOUT_MS` / `EVALUATION_ANALYZER_TIMEOUT_MS`). Prompt nudges: shorter path, **finish** when satisfied. [`.env.example`](.env.example) documents tuning + same-region deploy. `@bladerunner/api 0.6.129`.

- `0.10.164`: **Evaluations — shorter Playwright timeouts** — Evaluation browser pages now use **20s** default action/navigation timeout (Playwright’s implicit **30s**). Override with **`EVALUATION_PLAYWRIGHT_TIMEOUT_MS`**. Set in [`startEvaluationSession`](apps/api/src/modules/recording/recording.service.ts) via `setDefaultTimeout` / `setDefaultNavigationTimeout`. `@bladerunner/api 0.6.128`.

- `0.10.163`: **Playback — `getByText` exact match** — [`tightenGetByTextLocatorsForPlayback`](apps/api/src/modules/recording/recording-playwright-merge.util.ts) and related helpers no longer force `{ exact: true }` for long/composite labels (length > 32, Unicode bullets, or `MM/DD/YYYY` dates). Substring matching avoids timeouts on EHR rows like `Alina Wren 08/28/1985 • 40yo` where DOM text is split or punctuation differs. New [`shouldUseExactGetByTextForPlayback`](apps/api/src/modules/recording/recording-playwright-merge.util.ts). `@bladerunner/api 0.6.127`.

- `0.10.162`: **Evaluations — richer prior-steps context + search/pick guidelines** — Codegen user prompt now lists last **10** steps **chronologically** with **step title**, **OK/FAIL**, analyzer **decision**, **code excerpt**, and **error** when Playwright failed (so the model can see repeated patient-selection failures and switch locators). **EVALUATION_CODEGEN_SYSTEM** + **EVALUATION_ANALYZER_SYSTEM** nudge actionable retries. [`playwright-ui-guidelines.ts`](apps/api/src/modules/llm/playwright-ui-guidelines.ts) §6–7: wait for **listbox/option** (or table **row**) after filter; do not repeat the same failed **getByRole** pattern. `@bladerunner/api 0.6.126`.

- `0.10.161`: **LLM — Shadcn Select vs combobox** — Extended [`playwright-ui-guidelines.ts`](apps/api/src/modules/llm/playwright-ui-guidelines.ts) with rule §5: Radix **Select** triggers are often **`role="button"`**, not `combobox`; avoid `getByRole('combobox', { name: /Name/i })` timeouts; use snapshot/manifest, dialog scope, `getByPlaceholder` / `getByLabel` / `button`. **Evaluation codegen** + **Gemini** implementation line updated. `@bladerunner/api 0.6.125`.

- `0.10.160`: **LLM — Playwright UI guidelines** — Shared [`playwright-ui-guidelines.ts`](apps/api/src/modules/llm/playwright-ui-guidelines.ts) (`PLAYWRIGHT_UI_INTERACTION_GUIDELINES` + condensed variant) injected into **evaluation codegen**, **Gemini instruction + verify** templates, **action→instruction** recorder prompt, and **discovery explorer** system prompt. Rules: atomic steps for combobox flows, click trigger before portaled filter input, soft regex for options, portal/auto-wait. Reconciled prior `exact: true` option nudges with regex guidance. `@bladerunner/api 0.6.124`.

- `0.10.159`: **Evaluation — Thinking process panel** — Full-width section on evaluation detail (above Full progress log / Step timeline): collapsible rows per step with codegen **stepTitle**, blue spinner while the step is in flight, green check / red X from **Playwright** `executionOk` in analyzer inputs when done, **`(Xs)`** duration from **`step_duration_ms`** (wall time for the step). Expanded: one-line **playwrightCode**, red **error** when execution failed. Migration **`20260404120000_evaluation_step_duration_ms`**. `@bladerunner/api 0.6.123`, `@bladerunner/web 0.7.97`.

- `0.10.158`: **Discovery agent log files** — Each discovery run appends NDJSON to `docs/logs/{slug}-discovery-DDMMYY-HHmm.log` (repo root resolved from `pnpm-workspace.yaml`; override with **`DISCOVERY_LOGS_DIR`**). DB field `discovery_agent_log_file` stores the basename; **`GET /projects/:id/discovery/agent-log`** returns parsed lines. Projects table: **scroll** button next to the project name opens **`/discovery-agent-log/:projectId`** (same `DiscoveryAgentLogPanel` as live discovery). Migration **`20260403130000_discovery_agent_log_file`**. `@bladerunner/api 0.6.122`, `@bladerunner/web 0.7.96`.

- `0.10.157`: **Discovery explore JSON truncation** — `projectDiscoveryExploreStep` used `maxTokens: 2048`; OpenAI GPT-5 counts **reasoning** inside `max_completion_tokens`, so the visible JSON could be cut off mid-`playwrightCode` (~few hundred chars) and `parseJsonFromLlmText` failed. Raised to **8192** and set **`reasoningEffort: 'low'`** (aligned with other vision+JSON routes). Clearer parse error when extraction finds no balanced `{...}` (likely truncation). `@bladerunner/api 0.6.121`.

- `0.10.156`: **AGENTS.md (continual learning)** — merged **AI Prompt** / **AI Visual ID** workspace facts into one bullet (12-bullet guideline); clarified **LLM JSON** fence wording. Refreshed `.cursor/hooks/state/continual-learning-index.json` with current mtimes for all **35** `agent-transcripts` `*.jsonl` files.

- `0.10.155`: **LLM JSON parse (prose + JSON)** — `parseJsonFromLlmText` extracts the first balanced `{ ... }` with string-aware brace matching when the model adds CoT or text before/after the object (fixes `Unexpected token 'C'` when prose leads). `@bladerunner/api 0.6.120`.

- `0.10.154`: **LLM JSON parse** — `parseJsonFromLlmText` strips optional \`\`\`json fences even when the **closing** fence is missing (models often omit it); fallback slice from first \`{\` to last \`}\` if needed. `@bladerunner/api 0.6.119`.

- `0.10.153`: **Discovery explorer system prompt** — replaced the explorer LLM system prompt with the Playwright Exploration Agent template (tree traversal, primary areas, recovery order, evidence/scrolling/list rules, JSON output). `@bladerunner/api 0.6.118`.

- `0.10.152`: **Run app discovery — cancel** — `POST /projects/:id/discovery/cancel` aborts the in-process run (`AbortSignal` + LLM cancellation); DB ends as **failed** with `Cancelled by user.` Projects UI: **Cancel discovery** while **queued** or **running**, then **Run app discovery** again. `@bladerunner/api 0.6.117`, `@bladerunner/web 0.7.95`.

- `0.10.151`: **Discovery agent log — LLM modal closes** — list keys used the index **after** `reverse()`, so new log lines shifted keys and **remounted** rows (modals closed). Keys now use the stable **original** line index. `@bladerunner/web 0.7.94`.

- `0.10.150`: **Discovery LLM log — modal review** — LLM rows no longer use nested collapsibles; **click the row** to open one **scrollable modal** with full **SENT** (system, user, screenshot) and **RECEIVED** (model + thinking). `@bladerunner/web 0.7.93`.

- `0.10.149`: **Discovery agent log — sticky scroll** — new lines keep the view pinned to the **newest** (top) until you scroll down; scrolling back to the **top** resumes follow mode. `@bladerunner/web 0.7.92`.

- `0.10.148`: **Discovery agent log — LLM SENT / RECEIVED** — API emits **`detail.llm`** for every explore and final **`project_discovery`** call. Web: each LLM row expands to **collapsible SENT** (system prompt, user prompt, screenshot with modal) and **collapsible RECEIVED** (model message + optional thinking); each text field has a **modal** (expand icon) for full content. `@bladerunner/api 0.6.116`, `@bladerunner/web 0.7.91`.

- `0.10.147`: **Run app discovery stuck spinner** — if agent knowledge still shows **queued/running** after an API restart while no job runs in-process, **`GET /projects/:id/agent-knowledge`** reconciles to **failed** with a clear error so the button is usable again. `@bladerunner/api 0.6.115`.

- `0.10.146`: **Discovery depth + map + scroll** — explorer prompts: infer **deeper levels** from manifest/a11y; note server **pre-scroll**. **Visited screens** + nav tree use **URL + normalized title** (`discoveryScreenKey`) so SPAs add Mermaid nodes; **Mermaid** labels show **title · pathname** and **dedupe edges**. Before each discovery capture: **scroll** document + overflow regions. `@bladerunner/api 0.6.114`.

- `0.10.145`: **Discovery agent log — LLM transcripts** — each **`project_discovery`** call (explore / retry / final synthesis) emits **`detail.llm`** with **SENT** (system + user prompts, optional screenshot base64 up to a size cap) and **RECEIVED** (raw model JSON + optional thinking). Web UI: **expandable row** with nested collapsibles; long text / large fields use **View full** → modal; screenshot uses **View screenshot** → modal. `@bladerunner/api 0.6.113`, `@bladerunner/web 0.7.90`.

- `0.10.144`: **Discovery navigation** — explorer prompt + user message: explicit **back / home / `page.goto(baseUrl)`** recovery order, **breadth** across primary sections (checklist from tree), target **depth 4–5** per area; tree summary lists **top-level areas seen**. Session **`ba63e6`** ingest logs (H1–H3) for subsectionComplete / goBack / goto / top-level counts until verified. `@bladerunner/api 0.6.112`.

- `0.10.143`: **Discovery** — removed temporary debug ingest (`ba63e6`) from `project-discovery.service.ts` after verification. `@bladerunner/api 0.6.111`.

- `0.10.142`: **Discovery exploration budget** — stop is honored only after **both** minimum executed steps **and** minimum distinct normalized URLs (**32**); continuation retries use the same rule (retry while either minimum is unmet). Fixes premature completion when **14** distinct URLs was reached quickly. `@bladerunner/api 0.6.110`.

- `0.10.141`: **Discovery agent log** — **newest first** (reversed list); **hidden horizontal scrollbars** on each line (still scrollable). `@bladerunner/web 0.7.89`.

- `0.10.140`: **Run app discovery** — **DFS-style** navigation tree (max depth **5**), **`subsectionComplete`** in explore LLM JSON, **live Mermaid** map (`discoveryNavigationMermaid` column + WebSocket **`discoveryNavigationMermaid`**); **Projects** panel below live preview + log; **agent context** includes truncated Mermaid. Caps: **200** steps, **45 min** exploration wall clock. `@bladerunner/api 0.6.109`, `@bladerunner/web 0.7.88`.

- `0.10.139`: **Discovery agent log** — **one entry = one line** (timestamp — message + optional JSON detail); horizontal scroll per row; **`formatDiscoveryLogSingleLine`** in `useDiscoveryLive`. `@bladerunner/web 0.7.87`.

- `0.10.138`: **Discovery agent log** — removed **`scrollIntoView`** auto-follow so the **page** no longer jumps when new log lines arrive. `@bladerunner/web 0.7.86`.

- `0.10.137`: **Projects** — **Discovery agent log** panel is **wider** (`min-w-[30rem]`, flex grow) and **taller** (**320px** row height, matching live preview); section uses **`max-w-6xl`**. Detached preview log column **`min(40rem,48vw)`**. `@bladerunner/web 0.7.85`.

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
