# Bladerunner by Edgehealth

> Operational control surface for validating application experiences

Bladerunner by Edgehealth is a SaaS platform for recording, managing, and validating application "runs" across desktop, mobile, and PWA targets. It supports product demos, end-to-end verification, CI/CD-linked validation, visual accuracy checks, style consistency audits, and UX smoothness detection.

## Architecture

```
bladerunner/
├── apps/
│   ├── api/          # NestJS backend (TypeScript)
│   └── web/          # React frontend (Vite + Tailwind + shadcn)
├── packages/
│   ├── types/        # Shared domain types
│   └── config/       # Shared TypeScript configs
├── docker-compose.yml
└── pnpm-workspace.yaml
```

## Quick Start

### Package manager

Workspace scripts are defined for **pnpm** (e.g. **`pnpm mailslurp:list-inboxes`**). If you use **npm** instead, run **`npm run mailslurp:list-inboxes`** — not `npm mailslurp:list-inboxes` (npm treats that as an unknown subcommand).

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (`npm install -g pnpm`)

### Setup

```bash
# Install dependencies
pnpm install

# Start backend (port 3001)
pnpm dev:api

# Start frontend (port 5173)
pnpm dev:web

# Or start API + browser-worker immediately, then Vite after TCP 3001 is open (avoids early proxy ECONNREFUSED)
pnpm dev
```

Stopping **`pnpm dev`**: the repo runs **`scripts/dev.mjs`**, which wraps **`concurrently`** and, after **`DEV_KILL_GRACE_MS`** (default **5000**), sends **SIGKILL** to the whole dev process tree if anything is still alive—so you rarely need **`kill -9`** manually. Override with e.g. `DEV_KILL_GRACE_MS=8000 pnpm dev`.

### Port 3001 already in use (`EADDRINUSE`)

Only **one** process can listen on **3001**. If a previous `pnpm dev` / `pnpm dev:api` didn’t exit cleanly, the old Node process still holds the port.

**macOS / Linux:** find and stop it, then start `pnpm dev` again:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
kill <PID>            # use the PID from the LISTEN row
# If it won’t die:
kill -9 <PID>
```

**Or** run the API on another port temporarily: `API_PORT=3003 pnpm dev:api` (and point Vite’s proxy at that port, or use `VITE_API_URL` for the web app if applicable).

### Database (local vs hosted)

The API needs a reachable **PostgreSQL** `DATABASE_URL`. It loads **`apps/api/.env` first**, then the **repo root `.env`** (Nest gives precedence to the first file present — keep `DATABASE_URL` in one place to avoid stale overrides). If Railway (or any remote DB) is **down or unreachable**, you’ll see **`PrismaClientInitializationError` / P1001** in API logs. The API still **starts** (Prisma connects lazily); **`GET /health`** returns **503** with `services.database: "error"` until the DB is reachable.

Optional local DB:

```bash
docker compose --profile local-db up -d postgres
# In .env:
# DATABASE_URL=postgresql://bladerunner:bladerunner@127.0.0.1:5432/bladerunner
cd apps/api && pnpm exec prisma migrate deploy
```

Smoke check: `node scripts/verify-api-health.mjs` (expects HTTP 200 and `database: ok`).

**Still seeing P1001 / `Can't reach database server` from your laptop (e.g. `*.proxy.rlwy.net`)?** That is **network reachability**, not “wrong password”. Check:

1. **Railway** — Postgres service is **deployed / running** (not stopped). In the DB service, confirm **public networking** or **TCP proxy** is enabled so external clients can connect.
2. **Fresh URL** — Copy `DATABASE_URL` again from the Railway dashboard (host/port can change).
3. **SSL** — Railway Postgres expects TLS. If your URL has no `sslmode=`, the API appends **`sslmode=require`** when **`PrismaService`** is constructed (after `ConfigModule` loads `.env`). You can still set it explicitly in `DATABASE_URL`.
4. **Local proof** — From repo root: `pnpm check:db-tcp` — must print **TCP connection succeeded**. If this fails, Prisma cannot work until TCP works.

### URLs

| Service        | URL                                    |
| -------------- | -------------------------------------- |
| Frontend       | http://localhost:5173                   |
| API            | http://localhost:3001                   |
| Swagger Docs   | http://localhost:3001/api/docs          |
| Health Check   | http://localhost:3001/health            |

### Docker (alternative)

```bash
docker compose up
```

## API Endpoints

| Method | Endpoint            | Description                  |
| ------ | ------------------- | ---------------------------- |
| GET    | /health             | Service health check         |
| GET    | /runs               | List runs (with filtering)   |
| GET    | /runs/dashboard     | Dashboard KPI metrics        |
| GET    | /runs/:id           | Get run details              |
| GET    | /runs/:id/recording/video | Stream session recording MP4 or legacy WebM (auth) |
| GET    | /runs/:id/recording/thumbnail | JPEG thumbnail from recording (auth) |
| GET    | /runs/:id/findings  | Get findings for a run       |
| POST   | /runs               | Create a new run             |
| GET    | /projects           | List projects                |
| GET    | /settings           | Get workspace settings       |
| PATCH  | /settings           | Update workspace settings    |
| GET    | /integrations       | List integrations            |
| GET    | /agents             | List registered agents       |

## Domain Model

Core entities: **Workspace**, **Project**, **Run**, **RunTarget**, **RunStep**, **Artifact**, **Finding**, **Integration**, **Agent**, **Environment**

A Run supports:
- Target platforms: desktop, mobile, PWA
- Statuses: queued, running, passed, failed, needs_review
- Timing metrics and step-by-step results
- Visual review and style consistency findings
- Linked artifacts (screenshots, logs, traces)
- Orchestrator association (future placeholder)

## Design System

Built on the **Edgehealth Style Guide**:
- **Colors**: Primary Blue (#4B90FF), Accent (#4D65FF), Success (#56A34A), Warning (#EAB508), Destructive (#FF4D4D)
- **Typography**: Inter (UI), JetBrains Mono (data)
- **Radii**: 6px (buttons/inputs), 8px (cards/modals)
- **Components**: shadcn/ui with Edgehealth token overrides

## Tech Stack

| Layer     | Technology                                          |
| --------- | --------------------------------------------------- |
| Frontend  | React 19, TypeScript, Vite, Tailwind CSS v4, shadcn |
| Backend   | NestJS, TypeScript, Swagger/OpenAPI                 |
| Data      | In-memory mock data (swap to PostgreSQL + Prisma)   |
| Monorepo  | pnpm workspaces                                     |
| Infra     | Docker Compose                                      |

## E2E tests (Playwright + Clerk)

Shared **Clerk + password + MailSlurp OTP** helpers live in **`@bladerunner/clerk-agentmail-signin`** (`packages/clerk-agentmail-signin` — package name is historical). E2E imports thin wrappers under `e2e/helpers/`; **API playback** uses the same package for server-side auto sign-in.

1. Install browser binaries once: `pnpm test:e2e:install`
2. In **`.env`** (repo root): `VITE_CLERK_PUBLISHABLE_KEY`, **`CLERK_SECRET_KEY`** (same Clerk dev app), then one of:
   - **Ticket sign-in:** **`E2E_CLERK_USER_EMAIL`** only (no password) — `@clerk/testing` signs in via Clerk’s backend.
   - **Password, no 2FA:** **`E2E_CLERK_USER_EMAIL`** (or **`E2E_CLERK_USER_USERNAME`**) + **`E2E_CLERK_USER_PASSWORD`** — do **not** set **`MAILSLURP_*`** inbox vars.
   - **Password + email OTP (Clerk → your MailSlurp inbox):** same password vars **plus** **`MAILSLURP_API_KEY`** (from [MailSlurp](https://app.mailslurp.com)) and either **`MAILSLURP_INBOX_EMAIL`** (full address, e.g. `abc123@mailslurp.biz`) **or** **`MAILSLURP_INBOX_ID`** (UUID). Run **`pnpm mailslurp:list-inboxes`** / **`npm run mailslurp:list-inboxes`** to list inboxes. Register that inbox address as the user’s email in Clerk (or use it only for 2FA delivery as your product allows).
3. Run: **`pnpm test:e2e`** (starts Vite on **5173**, runs setup auth, then signed-in specs).

Auth state is written to **`playwright/.clerk/user.json`** (gitignored). Tests assert **`/settings`** so the suite does not require the API or database.

## Playback + Clerk + MailSlurp (API + UI)

When **`PLAYBACK_AUTO_CLERK_SIGNIN=true`** (or the client sends **`autoClerkSignIn: true`** on `POST /runs/:id/playback/start`), the API will:

1. Use the **same env vars as E2E** (`E2E_CLERK_USER_EMAIL` / `E2E_CLERK_USER_USERNAME`, `E2E_CLERK_USER_PASSWORD`, `MAILSLURP_API_KEY`, `MAILSLURP_INBOX_ID` or `MAILSLURP_INBOX_EMAIL`, `CLERK_SECRET_KEY`, publishable key) to run **one** Clerk + MailSlurp OTP flow when the playback browser shows Clerk sign-in.
2. **Skip** executing stored `playwrightCode` for steps whose **`metadata.clerkAuthPhase`** is true (set automatically during recording when the URL or UI looks like Clerk sign-in).

**Legacy runs** without tags: pass **`skipUntilSequence`** and/or **`skipStepIds`** in the POST body. The web app exposes **Clerk auto sign-in** (server default / force on / force off) and **Skip seq &lt;** next to **Play**.

**While recording** on the **Runs** page, **Sign in automatically** runs the same server-side Clerk + MailSlurp flow once on the remote browser and appends a tagged **CUSTOM** step (`clerkAuthPhase` + `clerkAutoOneShot`) so playback can skip it when auto sign-in is enabled.

Secrets stay on the **server**; the browser never receives test passwords.

**MailSlurp API errors:** verify **`MAILSLURP_API_KEY`** in **`apps/api/.env`** (overrides) and repo **`.env`**. **`pnpm mailslurp:list-inboxes`** loads both (same order as the list script).

For **third-party targets** (e.g. Evocare on Vercel), Clerk testing needs a **secret for that product’s Clerk instance**. You **cannot** set `CLERK_SECRET_KEY` twice in one `.env` (one name = one value). Instead:

- Keep **`CLERK_SECRET_KEY`** = Bladerunner (for API JWT verification when you use Bladerunner with Clerk).
- Set **`PLAYBACK_CLERK_SECRET_KEY`** (or **`E2E_CLERK_SECRET_KEY`**) = the **target app’s** Clerk secret for recording/playback auto sign-in and E2E when the publishable key comes from that app. The server can read **`publishableKey` from the live page**; the **secret** must still be configured explicitly.
- If DevTools shows Clerk API calls to a **different host** than `CLERK_FAPI`, set **`CLERK_FAPI_EXTRA_HOSTS`** (comma-separated hostnames) and/or **`CLERK_TESTING_FRONTEND_API_URL`** (hostname only, no `https://`) so testing tokens and route interception align with that Frontend API.

## Session recordings (disk)

After each completed **screen recording**, the API stores a **WebM** file and optional **JPEG thumbnail** on local disk (layout: `${RECORDINGS_DIR}/<userId>/<runId>/recording.webm` and `thumbnail.jpg`). The browser UI loads video/thumbnails via **authenticated** `fetch` → `blob:` URLs (same pattern as other protected assets).

**How the video is produced:** The recorder uses a **remote** Playwright browser (`chromium.connect` to the browser-worker). Playwright’s **`recordVideo`** file is written on the **worker** host, so the API cannot reliably read it. Instead, the API pipes the **CDP screencast** JPEG stream into **ffmpeg** as **MJPEG → H.264 MP4** (`recording.mp4`) so the file exists on the **API** machine. Older runs may still have **`recording.webm`**; **`GET /runs/:id/recording/video`** serves MP4 when present, otherwise WebM.

- **`RECORDINGS_DIR`** — Base directory for artifacts. Default: `os.tmpdir()/bladerunner-recordings` when unset. **Production:** mount a **persistent volume** (e.g. Railway) and set `RECORDINGS_DIR` to a path on that volume so recordings survive deploys.
- **`FFMPEG_PATH`** (optional) — Path to the `ffmpeg` binary. **Required on PATH** for session WebM (and for extracting thumbnails from video). If `ffmpeg` is missing, the API falls back to storing only the last **screencast JPEG** as the run thumbnail (no `RunRecording` video). The API **Dockerfile** installs `ffmpeg`.

## Changelog

- **0.6.5** — **Session recording = MP4 (H.264)**: Screencast ffmpeg pipeline uses **`libx264`** → **`recording.mp4`** (VP8/WebM was often missing on macOS ffmpeg → thumbnail-only runs). **`GET /runs/:id/recording/video`** serves MP4 or legacy WebM. **`@bladerunner/api` `0.4.4`**, **`@bladerunner/web` `0.5.2`** (copy text).
- **0.6.4** — **Run detail session recording**: Load **WebM first** (probe `/recording/video`) even when `run.recordings` is empty but a thumbnail exists; **`<video>`** `onError` falls back to JPEG + Safari/WebM note. **`@bladerunner/web` `0.5.1`**.
- **0.6.3** — Remove debug-session instrumentation from ffmpeg screencast encoder (behavior unchanged). **`@bladerunner/api` `0.4.3`**.
- **0.6.2** — **Recording stability**: Handle **EPIPE** on ffmpeg stdin (handler + stop writes when encoder exits) so a failed/ended encoder cannot crash the API process. **`@bladerunner/api` `0.4.2`**.
- **0.6.1** — **Session WebM from screencast + ffmpeg**: Encode CDP screencast to **WebM on the API host** so playback works with a **remote** browser worker (Playwright `recordVideo` alone is not usable across `connect`). **`@bladerunner/api` `0.4.1`** (API Dockerfile: **`ffmpeg`**).
- **0.6.0** — **Parallel session recording**: Playwright **`recordVideo`** alongside live CDP screencast; persist **WebM** + **thumbnail** under **`RECORDINGS_DIR`**; **`runs.thumbnail_url`**; **`RunRecording`** rows; **`GET /runs/:id/recording/video`** and **`GET /runs/:id/recording/thumbnail`** (Clerk auth + ownership); disk cleanup on **delete run**; Run detail **Session recording** player; home table uses **API thumbnail** when present (favicon fallback). **`@bladerunner/api` `0.4.0`**, **`@bladerunner/web` `0.5.0`**.
- **0.5.2** — **Delete recording runs**: API **`abortRecordingForDeletion`** closes Playwright session before DB delete; **`resetRecordingAfterRemoteDelete`** in `useRecording` when the deleted run is the active one. **Runs** dropdown **`*`** prefix for **RECORDING** runs. Home + Runs delete allow recording with a stronger confirm. **`@bladerunner/api` `0.3.5`**, **`@bladerunner/web` `0.4.2`**.
- **0.5.1** — **Dashboard / home runs table UX**: home **`w-full max-w-[min(100%,90rem)]`**, **`min-w-0`**, **`overflow-x-hidden`**; **`Table`** wrapper **`min-w-0`** (no **`overflow-auto`**) + comment; **HomeRunsTable** **`w-full min-w-0`**, **`table-fixed`** + relaxed name column (**`max-w-none`**, wider share); grid **`lg:col-span-8` / `4`**. **`@bladerunner/web` `0.4.1`**.
- **0.5.0** — **Home runs table**: TanStack Table + shadcn-style UI — **filters** (status, platform), **debounced search**, **server sort** (`sortBy` / `sortOrder` on `GET /runs`), **pagination** (10/20/50). **Compact rows** with status-tinted borders, project/platform chips, **favicon thumbnail** column (site preview; live recording gets pulse). **Delete** preserved. **`@bladerunner/web` `0.4.0`**, **`@bladerunner/api` `0.3.4`**.
- **0.4.4** — **`pnpm dev` shutdown**: `scripts/dev.mjs` wraps **`concurrently`** and, after **`DEV_KILL_GRACE_MS`** (default 5s), **SIGKILL**s the dev tree via **tree-kill** if a child still runs (avoids stray Node/Vite/Nest/tsx after Ctrl+C). **`--kill-others-on-fail`** on concurrently. **API**: **`enableShutdownHooks()`** for clean HTTP/WS close. **browser-worker**: shutdown **timeout** so Playwright **`wss.close`** cannot hang forever. **`@bladerunner/api` `0.3.3`**, **`@bladerunner/browser-worker` `0.2.1`**.
- **0.4.3** — Remove temporary debug-session HTTP logging from Clerk auto sign-in (`useRecording`, API `recording.service`, `@bladerunner/clerk-agentmail-signin` **0.3.6**). No behavior change.
- **0.4.2** — **Clerk auto sign-in UX**: **`flushSync`** before the long `clerkAutoSignInRecording` fetch so “Signing in…” paints immediately; Runs **aria-live** note that the remote browser step can take 1–2 minutes. **Post-OTP**: **flexible** button clicks **first** (**5s** timeouts; **Complete** / **Enter**); **Continue/Verify** only as last resort (**5s**). Extends fast-path **`waitForURL`** to **20s**. **`@bladerunner/clerk-agentmail-signin` `0.3.5`**.
- **0.4.1** — **Clerk auto sign-in**: debug logs (**H1**–**H4**); **fix** post-OTP step — **`waitForURL` to app host first** (Clerk often redirects without Continue/Verify), then legacy **Continue/Verify** click, then **fallback** button names (Submit/Done/Sign in/Next). Reduces **30s Playwright timeout** + long **HTTP wait** that froze the UI until the error toast. **`@bladerunner/clerk-agentmail-signin` `0.3.4`**.
- **0.4.0** — **MailSlurp OTP**: use `waitForLatestEmail` with **`since`** + set **`otpWindowStartMs` after password submit** so old inbox codes are ignored. **Runs**: `DELETE /runs/:id`, delete UI on Runs + Home. **Projects**: Prisma `Project` model (WEB / IOS / ANDROID, `url`, `artifactUrl`), CRUD **`/projects`**, **Projects** page + sidebar; optional **`projectId`** on **`POST /runs/record/start`**; run list includes **project**. **Home**: full runs **table** (100 rows). **Detach preview/playback**: `window.open` uses **`window.location.origin`** for popups. DB migration: `projects`, `runs.project_id`.
- **0.3.3** — Remove **debug-session** `fetch` instrumentation from **`@bladerunner/clerk-agentmail-signin`** (`clerk-sign-in.ts`, `mailslurp-otp.ts`); README troubleshooting no longer references **H9** / **H11** live logs.
- **0.3.2** — **Runs layout**: **AppShell** main area uses **`min-h-0` + flex column** so the `/runs` row has a **viewport-bounded height**; the preview column no longer **stretches** when the steps list grows (only the right column scrolls). Other pages use **`flex-1 min-h-0 overflow-y-auto`** on their root for normal scrolling.
- **0.3.1** — **Runs page**: when steps are appended, only the **right-hand steps list** scrolls (`scrollTop` on its panel). Removed `scrollIntoView` on the list sentinel so the **main preview** no longer shifts with each new step.
- **0.3.0** — **MailSlurp replaces AgentMail** for Clerk email OTP (E2E + recording + playback). **`.env`:** `MAILSLURP_API_KEY`, `MAILSLURP_INBOX_ID` **or** `MAILSLURP_INBOX_EMAIL`. Script **`pnpm mailslurp:list-inboxes`**. Removed **`agentmail`** dependency; package **`@bladerunner/clerk-agentmail-signin`** still hosts **`performClerkPasswordEmail2FA`** (name unchanged).
- **0.2.41** — README: **`npm run agentmail:list-inboxes`** vs invalid **`npm agentmail:list-inboxes`**; pnpm vs npm note under Quick Start.
- **0.2.40** — **`pnpm agentmail:list-inboxes`**: load **`apps/api/.env`** with **override** after root `.env` (same as API); catch **403** and print setup hints.
- **0.2.39** — **AgentMail 403**: clearer errors when **`inboxes.list`** or **`messages.list`** returns **403**; README troubleshooting (**`H11`** `inboxes_list_error` vs Clerk **H9** 200).
- **0.2.38** — Debug: **`H11`** in **`agentmail-otp`** (`otp_poll_start`, `inboxes_list_*`, `messages_list_error`) to confirm when **`403 Forbidden`** is from **AgentMail** (not Clerk FAPI — H9 already shows **200** on `/v1/client/sign_ins` / `prepare_second_factor`).
- **0.2.37** — Debug: **`H9`** now logs the **first 24 upstream FAPI responses** (always includes `status`, `atOrAbove400`) so an empty log cannot be misread — **no H9 on 0.2.36 meant every intercepted call returned &lt;400**. **`H10`** logs **`route.fetch` failures** (then we `continue` without the token).
- **0.2.36** — Debug: **`H9`** logs **upstream HTTP status** from `route.fetch` after appending `__clerk_testing_token` (and **`hadTestingToken`**) so we can tell **403 from Clerk** vs routing misses.
- **0.2.35** — **Clerk FAPI 403 (recording)**: broaden Playwright routing so `/v1/` calls are intercepted when the **request host** differs from `CLERK_FAPI` (same instance slug on `*.clerk.accounts.dev` / `*.lcl.dev`, optional **`CLERK_FAPI_EXTRA_HOSTS`**, optional **`CLERK_TESTING_FRONTEND_API_URL`** passed to `clerkSetup`). Hardened route **`fulfill`** when the upstream body is not JSON. Debug: **`H7`** `/v1/` request hosts, **`H8`** intercepts, **`H5`** any ≥400 Clerk-related response.
- **0.2.34** — **Two Clerk instances**: optional **`PLAYBACK_CLERK_SECRET_KEY`** or **`E2E_CLERK_SECRET_KEY`** for `clerkSetup` / testing tokens when the **target app** is not Bladerunner’s Clerk app; **`CLERK_SECRET_KEY`** remains for Bladerunner API auth. (You cannot assign `CLERK_SECRET_KEY` twice in one `.env`.)
- **0.2.33** — **Clerk auto sign-in (recording / playback)**: read **`publishableKey` from the live page** (`window.Clerk` / `data-clerk-publishable-key`) when it differs from API env (e.g. recording **Evocare** while Bladerunner’s `.env` only had **Bladerunner’s** `VITE_CLERK_PUBLISHABLE_KEY`), then **`clerkSetup`** + testing token for **that** Clerk app. Replaced `setupClerkTestingToken` with a **single dynamic** Playwright route that reads **`CLERK_FAPI` per request** so FAPI updates apply without stacked handlers. **`CLERK_SECRET_KEY` must still belong to the same Clerk instance** as the app under test. Package **`tsconfig`**: add **`DOM`** lib for `page.evaluate` typings.
- **0.2.32** — **`repro:clerk-stale-token`**: ignore pnpm’s forwarded **`--`** so the app origin argument parses correctly.
- **0.2.31** — **Clerk + AgentMail auto sign-in**: always run **`clerkSetup`** before each flow so **`CLERK_TESTING_TOKEN`** is refreshed (long-lived API could keep **`CLERK_FAPI`** and a **stale token**, which surfaced as Clerk FAPI **403** at email OTP). **`setupClerkTestingToken`** only once per **Playwright `BrowserContext`** to avoid stacked **`context.route`** handlers. Repro: **`pnpm run repro:clerk-stale-token -- <app-origin>`** (loads `.env`).
- **0.2.30** — **Clerk auto sign-in**: use **anchored** button names (`/^Continue$/i`, etc.) so automation does not click **“Continue with Apple”** (substring match on `/continue/i` used to start Apple OAuth and looked like a manual Apple step in the recording).
- **0.2.29** — **Clerk testing in API**: call **`clerkSetup`** when **`CLERK_FAPI`** is unset before **`setupClerkTestingToken`** (fixes “Frontend API URL is required” for recording/playback auto sign-in outside Playwright global setup).
- **0.2.28** — **Recording**: **`POST /runs/:id/recording/clerk-auto-sign-in`** + **Runs** sidebar **Sign in automatically** (one-shot Clerk + AgentMail on the live session; synthetic tagged step).
- **0.2.27** — **`@bladerunner/clerk-agentmail-signin`**: shared **Clerk + AgentMail OTP** for **E2E** and **API playback**; recording tags **`metadata.clerkAuthPhase`** on Clerk sign-in URLs/UI; playback **`PLAYBACK_AUTO_CLERK_SIGNIN`**, DTO **`autoClerkSignIn` / `skipUntilSequence` / `skipStepIds`**; UI playback options on **Runs** and **Run detail**.
- **0.2.26** — **`pnpm dev`**: run **API** + **browser-worker** in parallel, **`wait-on tcp:127.0.0.1:3001`** then start **Vite** so the `/api` proxy does not hit **ECONNREFUSED** while Nest is still booting. (Default port **3001**; if you use **`API_PORT`**, start **`dev:web`** manually after the API is up or adjust the wait target.)
- **0.2.25** — **Run detail**: tolerate missing **`targets`** / **`tags`** from API (no `.length` crash); findings query **404** → empty list; safe defaults for counts / **`artifactsCount`**.
- **0.2.24** — **Runs** page: green **Play** button (replay selected run in preview), playback canvas + step highlights, **Stop** / **Detach** while playing; run detail primary action label **Play**; shared **`playbackStepTone`** helper.
- **0.2.23** — Remove API **`listen` EADDRINUSE** try/catch block (no extra startup instrumentation); port conflict steps remain in README (**Port 3001 already in use**).
- **0.2.22** — API startup: on **EADDRINUSE** (port **3001** busy), print **`lsof` / `kill` / `API_PORT`** hints instead of a raw stack-only exit.
- **0.2.21** — **E2E / AgentMail**: resolve inbox by **`E2E_AGENTMAIL_INBOX_EMAIL`** when **`E2E_AGENTMAIL_INBOX_ID`** isn’t shown in the dashboard; **`pnpm agentmail:list-inboxes`**; OTP matcher includes “verification code” (non-Clerk branded mail).
- **0.2.20** — **E2E**: password + **email 2FA** via **AgentMail** (`agentmail` SDK): `AGENTMAIL_API_KEY` + `E2E_AGENTMAIL_INBOX_ID` + tester email/password; helpers poll inbox for Clerk OTP.
- **0.2.19** — **E2E**: `@playwright/test` + `@clerk/testing`, `e2e/global.setup.ts` (Clerk testing token + storage state), `e2e/signed-in.spec.ts`, `pnpm test:e2e` / `test:e2e:install`.
- **0.2.18** — **Playback in preview**: `POST /runs/:id/playback/start` + `POST /runs/playback/stop`, Socket.IO `playbackProgress` on `/recording`, run detail **Play back** with live canvas + step highlights, detached **`/playback/:playbackSessionId`** route; initial-navigate detection uses `RegExp` (valid TS) instead of a broken `/.../i` literal.
- **0.2.17** — Remove **`DevVerboseExceptionFilter`** (dev-only raw exception text in JSON); Nest default handler applies for unhandled errors.
- **0.2.16** — Remove **`dbError`** from **`GET /health`** (no Prisma message in JSON); align `verify-api-health.mjs` (instrumentation / leak cleanup).
- **0.2.15** — README: **EADDRINUSE on port 3001** (stale API process) — how to `lsof` / `kill` or use `API_PORT`.
- **0.2.14** — Remove dev **`PrismaService` startup logging** of DB host / `sslmode` (debug instrumentation cleanup).
- **0.2.13** — Railway **`sslmode=require`** is applied in **`PrismaService`’s constructor** (after `ConfigModule` loads `.env`), not at process import time when `DATABASE_URL` was still empty — fixes SSL patch never running.
- **0.2.12** — (superseded) attempted Railway `sslmode` at import time before env load.
- **0.2.11** — API `ConfigModule` loads **`.env` via `__dirname`** (`apps/api/.env` then repo root). Fixes wrong/missing `DATABASE_URL` when `cwd` is not the monorepo root (duplicate keys: **first file wins**, so api-local env overrides root).
- **0.2.10** — `pnpm check:db-tcp` script + README notes for Railway **P1001 / can’t reach server** (TCP proxy, SSL, fresh `DATABASE_URL`).
- **0.2.9** — Prisma uses **lazy connect** so a bad/unreachable `DATABASE_URL` no longer crashes the API before `listen()` (fixes empty port 3001 + Vite `ECONNREFUSED`). `/health` returns **503** when the DB check fails. Optional **`local-db`** Postgres service in `docker-compose.yml`; `verify-api-health.mjs` hints local setup.
- **0.2.8** — `scripts/verify-api-health.mjs` explains **ECONNREFUSED** (API not running) with `pnpm dev:api` / `pnpm dev` hints.
- **0.2.7** — API: non-production errors return the real `message` (instead of a generic 500) via `DevVerboseExceptionFilter`; recording failures map to **503** with a clear browser-worker/Playwright hint; `/health` runs a real DB `SELECT 1`; Clerk guard accepts `CLERK_PUBLISHABLE_KEY` or `VITE_CLERK_PUBLISHABLE_KEY`; run list query coerces numeric `page` / `pageSize`.
- **0.2.6** — `apps/api` defines a `dev` script so root `pnpm dev` starts NestJS (fixes Vite `/api/*` proxy 500s when only the frontend was running). `apiFetch` surfaces Nest JSON `message` on errors.
- **0.2.5** — Extended remote preview: CDP **touch** (swipe, multi-touch / pinch), **double-click**, normalized **wheel** deltas (line/page modes), **clipboard bridge** (`⌘/Ctrl+C/V/X` pull/paste/cut between remote selection and your OS clipboard).
- **0.2.4** — Remote control for recording preview: pointer and wheel events (and optional keyboard after clicking the preview) forward to Playwright via Socket.IO; `Esc` exits keyboard forwarding.
- **0.2.3** — Remove debug-session `fetch` instrumentation from `useRecording` (keep `connect_error` console logging).
- **0.2.2** — Recording preview: Socket.IO connects to `VITE_API_URL` (NestJS) instead of the Vite dev server so screencast frames reach the UI; hydrate steps from REST after `record/start`.

## License

Private — Edgehealth © 2026
