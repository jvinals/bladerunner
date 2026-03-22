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

**After pulling new code:** always run **`pnpm migrate`** from `apps/api` (or `pnpm exec prisma migrate deploy`) so PostgreSQL matches `schema.prisma`. If the API logs **`invalid input value for enum "StepOrigin": "AUTOMATIC"`** (or recording shows **gaps** in step numbers like 1 → 6), pending migrations were not applied—run the command above against the same **`DATABASE_URL`** the API uses, then restart the API.

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
| POST   | /runs/:id/steps/:stepId/re-record | Re-capture one step by instruction (active recording) |
| GET    | /runs/:id/checkpoints | List **app state checkpoints** (after-step browser storage + metadata) for a run |
| POST   | /runs/:id/playback/start | Start live playback; body may include **`skipUntilSequence`**, **`playThroughSequence`** (stop after that step), **`skipStepIds`**, Clerk options |

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

**`e2e/playback.spec.ts`** mocks **`GET /api/runs`**, **`GET /api/runs/:id/steps`**, and **`POST /api/runs/:id/playback/start`** so the **Runs** live replay path can be asserted without the API or browser worker; it still uses the same Clerk setup as other signed-in tests.

## Playback + Clerk OTP (API + UI)

When **Clerk auto playback is enabled** — the client sends **`autoClerkSignIn: true`**, or **`PLAYBACK_AUTO_CLERK_SIGNIN`** is unset/empty (defaults **on**), or the env is **`true`/`1`/`yes`** — and not explicitly **`false`/`0`/`no`** — the API will:

1. Run **one** Clerk password + email OTP flow when the playback browser shows Clerk sign-in. **How the OTP is obtained** is controlled by **`clerkOtpMode`** on **`POST /runs/:id/playback/start`**, the **Runs / Run detail** **Clerk OTP** dropdown, and server env **`PLAYBACK_CLERK_OTP_MODE`** (default **`mailslurp`** when unset):
   - **`mailslurp`** — read the code from a **MailSlurp** inbox (**`MAILSLURP_API_KEY`** + **`MAILSLURP_INBOX_ID`** or **`MAILSLURP_INBOX_EMAIL`**).
   - **`clerk_test_email`** — [Clerk test emails](https://clerk.com/docs/testing/test-emails-and-phones): set **`E2E_CLERK_USER_EMAIL`** (or username) to an address with **`+clerk_test`** in the local part (e.g. `jane+clerk_test@gmail.com`). Clerk does **not** send a real email; the verification code is always **`424242`** and does **not** count against the dev **100-email** limit. **No** **`MAILSLURP_*`** required.
   Core Clerk env (**`E2E_CLERK_USER_PASSWORD`**, identifier, **`CLERK_SECRET_KEY`** / **`PLAYBACK_CLERK_SECRET_KEY`**, publishable key) is required in both modes.
2. **Skip** executing stored `playwrightCode` for steps whose **`metadata.clerkAuthPhase`** is true (DOM-captured Clerk UI during recording) when auto Clerk is on — same as before. **New recordings** store **one** **`CUSTOM`** step after **Sign in automatically** with **`metadata.kind: clerk_auto_sign_in`**, **`otpMode`** (`mailslurp` \| `clerk_test_email`), and **`postAuthPageUrl`** (normalized URL right after sign-in). Playback runs **`performClerkPasswordEmail2FA`** for that step using the **recorded `otpMode`** (not the UI dropdown default), then warns if the live post-auth URL differs from **`postAuthPageUrl`**. **Legacy runs** may still have **six** rows with **`metadata.clerkAutomationCanonical`**; those stay out of the Playwright loop when auto Clerk is on, while **`clerk_auto_sign_in`** steps **are** in the loop and handled explicitly.

**Legacy runs** without tags: pass **`skipUntilSequence`** and/or **`skipStepIds`** in the POST body. The web app exposes **Clerk auto sign-in** (server default / force on / force off), **Clerk OTP** (test email vs MailSlurp vs server default — applies to assist and defaults; **`clerk_auto_sign_in`** steps use recorded **`otpMode`**), and **Skip seq &lt;** next to **Play**.

**Step-scoped playback:** **`skipUntilSequence: N`** runs stored steps starting at sequence **N** (skips earlier steps). **`playThroughSequence: M`** stops playback after executing step **M** (use with the same **`skipUntilSequence`** for “this step only”). **Runs** and **Run detail** step cards expose **Play from here** / **This step only** when playback is available.

**While recording** on the **Runs** page, **Sign in automatically** runs **`performClerkPasswordEmail2FA`** once (OTP mode next to the button), **deletes manually captured steps after the initial navigate**, then persists **one** **`CUSTOM`** step with **`clerk_auto_sign_in`** metadata (recorded OTP mode + post-auth URL). DOM capture is paused during automation; capture callbacks stay **serial** so manual steps after sign-in stay ordered.

Secrets stay on the **server**; the browser never receives test passwords.

**MailSlurp API errors:** verify **`MAILSLURP_API_KEY`** in **`apps/api/.env`** (overrides) and repo **`.env`**. **`pnpm mailslurp:list-inboxes`** loads both (same order as the list script).

For **third-party targets** (e.g. Evocare on Vercel), Clerk testing needs a **secret for that product’s Clerk instance**. You **cannot** set `CLERK_SECRET_KEY` twice in one `.env` (one name = one value). Instead:

- Keep **`CLERK_SECRET_KEY`** = Bladerunner (for API JWT verification when you use Bladerunner with Clerk).
- Set **`PLAYBACK_CLERK_SECRET_KEY`** (or **`E2E_CLERK_SECRET_KEY`**) = the **target app’s** Clerk secret for recording/playback auto sign-in and E2E when the publishable key comes from that app. The server can read **`publishableKey` from the live page**; the **secret** must still be configured explicitly.
- If DevTools shows Clerk API calls to a **different host** than `CLERK_FAPI`, set **`CLERK_FAPI_EXTRA_HOSTS`** (comma-separated hostnames) and/or **`CLERK_TESTING_FRONTEND_API_URL`** (hostname only, no `https://`) so testing tokens and route interception align with that Frontend API.

## App state checkpoints (restore strategy)

Bladerunner persists **checkpoints** after each recorded step (best-effort **Playwright `storageState`** JSON under **`RECORDINGS_DIR`**, plus DB rows via **`GET /runs/:id/checkpoints`**). **Hybrid model:**

- **Source of truth for “being at step K”** — **Prefix replay**: run steps **1…K−1** in order (what **Play from here** does via **`skipUntilSequence`**). This matches how automation is stored and is the most deterministic way to align with a stored step.
- **Session-oriented restore** — Checkpoints help with **cookies / `localStorage`** (e.g. auth) but **do not** capture full SPA in-memory state; use them as a supplement, not a full “restore DOM” guarantee.

Set **`RECORDING_CHECKPOINTS=false`** in **`apps/api`** env to disable writing checkpoint files/rows during recording (default **on**).

**Re-record (AI) after a run is completed** still requires an **active recording session** today; use **Re-record** on the **Runs** page while that run is recording. A future “edit completed run” flow would combine **prefix replay or checkpoint** + the same LLM re-record path.

## Session recordings (disk)

After each completed **screen recording**, the API stores a **WebM** file and optional **JPEG thumbnail** on local disk (layout: `${RECORDINGS_DIR}/<userId>/<runId>/recording.webm` and `thumbnail.jpg`). The browser UI loads video/thumbnails via **authenticated** `fetch` → `blob:` URLs (same pattern as other protected assets).

**How the video is produced:** The recorder uses a **remote** Playwright browser (`chromium.connect` to the browser-worker). Playwright’s **`recordVideo`** file is written on the **worker** host, so the API cannot reliably read it. Instead, the API pipes the **CDP screencast** JPEG stream into **ffmpeg** as **MJPEG → H.264 MP4** (`recording.mp4`) so the file exists on the **API** machine. Older runs may still have **`recording.webm`**; **`GET /runs/:id/recording/video`** serves MP4 when present, otherwise WebM.

- **`RECORDINGS_DIR`** — Base directory for artifacts. Default: `os.tmpdir()/bladerunner-recordings` when unset. **Production:** mount a **persistent volume** (e.g. Railway) and set `RECORDINGS_DIR` to a path on that volume so recordings survive deploys.
- **`FFMPEG_PATH`** (optional) — Path to the `ffmpeg` binary. **Required on PATH** for session WebM (and for extracting thumbnails from video). If `ffmpeg` is missing, the API falls back to storing only the last **screencast JPEG** as the run thumbnail (no `RunRecording` video). The API **Dockerfile** installs `ffmpeg`.
- **`FFPROBE_PATH`** (optional) — Used to read encoded duration for **wall-clock timing sync** (fixes sped-up playback when MJPEG-from-pipe had the wrong implicit FPS).
- **`RECORDING_SCREENCAST_INPUT_FPS`** (optional, default **8**) — Hint for ffmpeg’s MJPEG demuxer (CDP screencast is not 25 fps). The API also **re-times** the finished MP4 to match **run start → stop** when probe duration drifts.

## Changelog

- **0.7.75** — **Run detail**: Playback toolbar controls **taller** (`py-1.5`, seq input aligned); card padding **`py-0.5`**. **`@bladerunner/web` `0.6.49`**.
- **0.7.74** — **Run detail**: Playback toolbar **shorter** (`py-0`, `leading-none`); metrics card **no max-width** on large screens, **`lg:flex-nowrap`** so Duration–Run Details stay **one line** (with **`overflow-x-auto`** if the viewport is tight). **`@bladerunner/web` `0.6.48`**.
- **0.7.73** — **Run detail**: Playback toolbar **slightly shorter** (`py-0.5` controls, tighter `gap`); metrics card **slightly wider** (`max-w` ~30rem). **`@bladerunner/web` `0.6.47`**.
- **0.7.72** — **Run detail**: Playback card **slightly shorter** (`py-0`); metrics card **slightly wider** (`max-w` ~28.5rem). **`@bladerunner/web` `0.6.46`**.
- **0.7.71** — **Run detail**: Playback card **slightly shorter** (`py-0.5`); metrics card **slightly wider** (`max-w` ~27rem). **`@bladerunner/web` `0.6.45`**.
- **0.7.70** — **Run detail**: Playback controls card **slightly shorter** (`py-1`); metrics / **Run details** card **slightly wider** (`max-w` ~25.5rem). **`@bladerunner/web` `0.6.44`**.
- **0.7.69** — **Run detail**: Softer playback vs metrics split (`flex-[1.2]`, metrics `max-w` ~23rem, min playback ~30rem); playback toolbar uses **horizontal scroll** again instead of wrapping. **`@bladerunner/web` `0.6.43`**.
- **0.7.68** — **Run detail**: Wider playback toolbar row (`flex-[3]`), narrower metrics card (`max-w` ~17.5rem), slightly shorter metrics padding; playback controls **wrap** instead of horizontal scroll. **`@bladerunner/web` `0.6.42`**.
- **0.7.67** — **Run detail**: **View** control (**Split** / **Stack**) to the right of the playback toolbar — **Split** keeps **Live replay preview** left and **Recorded steps** right; **Stack** shows steps in a **horizontal scrolling** row with **full-width preview** below. **`@bladerunner/web` `0.6.41`**.
- **0.7.66** — **Playback**: Socket **`completed`** / **`stopped`** now sets status **`idle`** after teardown (avoids a stuck **`COMPLETED`** / **`STOPPED`** label with no session). **`@bladerunner/web` `0.6.40`**.
- **0.7.65** — **Playback**: Manual **Stop** sets status **`idle`** (not **`stopped`**). **Run to seq** clears whenever **`!isPlaying && !playbackSessionId`** so it resets after **Stop**/**complete**/**navigation**. **`@bladerunner/web` `0.6.39`**.
- **0.7.64** — **Playback**: **`stopPlayback`** clears **preview frame** and **playback error**; socket **`completed` / `stopped`** also clears the **last frame** so the canvas does not show a stale image after a run ends. **Run detail** and **Runs** reset **Run to seq** when playback **stops** or **completes**. **`@bladerunner/web` `0.6.38`**.
- **0.7.63** — **Run detail**: **Live replay preview** and **Recorded steps** use a **taller** shared block (`min-h` **520px**, viewport **~75vh**, cap **880px**). **`@bladerunner/web` `0.6.37`**.
- **0.7.62** — **Playback UI**: **Recorded steps** highlight follows the **next** step after a step finishes (`playbackProgress` `after`/`skipped` used to leave the cursor on the completed row). **`effectivePlaybackHighlightSequence`** in **`playbackStepTone`**. **`@bladerunner/web` `0.6.36`**.
- **0.7.61** — **Web**: Removed debug **NDJSON ingest** / render logging from **`usePlayback`** and **`DetachedPlayback`**. **`@bladerunner/web` `0.6.35`**.
- **0.7.60** — **Playback UI**: **Pause** and **Stop** stay **disabled** until the recorded **`clerk_auto_sign_in`** step has finished (socket **`playbackProgress`** `after` / `skipped` — same as **`completedSequences`** in **`usePlayback`**). Applies to **Run detail**, **Runs** (inline replay), and **Detached playback**. Runs without that step are unchanged. **`@bladerunner/web` `0.6.34`**.
- **0.7.59** — **Run detail**: **Playback** controls card is **left**, **Duration / Steps / …** metrics card is **right** (`lg` row); toolbar row uses **`justify-start`**. **`@bladerunner/web` `0.6.33`**.
- **0.7.58** — **Run detail**: Back link is **Back to Home** (navigates to **`/`**). **`@bladerunner/web` `0.6.32`**.
- **0.7.57** — **Run detail**: **Metrics** (Duration, Steps, …) and **playback** controls share **one row** on large screens with **matching card chrome** (`rounded-lg border … px-2 py-1.5 shadow-sm`); **`lg:items-stretch`** keeps **equal height**; playback column scrolls horizontally when needed. **`@bladerunner/web` `0.6.31`**.
- **0.7.56** — **Steps UI**: Single-step **Automatic Clerk sign-in** is stored with **`origin: AUTOMATIC`** (was `MANUAL`); **StepCard** also treats **`metadata.kind === clerk_auto_sign_in`** or **“Automatic Clerk sign-in…”** instructions as **Automatic** for older runs. **`@bladerunner/api` `0.5.38`**, **`@bladerunner/web` `0.6.30`**.
- **0.7.55** — **Run detail**: **Play**, **Pause/Resume**, **Stop**, **Restart**, **Next step**, **Run to seq** + **Go**, and **Detach preview** are **one always-visible row** (`flex-nowrap`, horizontal scroll on narrow viewports); controls are **disabled** when not applicable. **`@bladerunner/web` `0.6.29`**.
- **0.7.54** — **Run detail**: **Stop / Restart / Detach** and **paused** step controls sit in a **card below Play · Pause** in the header; **Run details** slide-over keeps only **pre-play** playback options (Clerk, OTP, skip, delay). Slightly tighter margins while playing. **`@bladerunner/web` `0.6.28`**.
- **0.7.53** — **Run detail**: **Playback** controls (Clerk, OTP, skip, delay, session / paused actions) live in the **Run details** right slide-over, opened by **Run Details** after **Artifacts**; removed the second inline gray panel beside metrics. **`@bladerunner/web` `0.6.27`**.
- **0.7.52** — **Run detail**: **Playback settings** controls are **inline** again next to a **narrower metrics strip** (no **Playback settings** button; no playback slide-over). **`@bladerunner/web` `0.6.26`**.
- **0.7.51** — **Run detail**: **Playback settings** moved into the same **right slide-over** pattern as **Run details** (backdrop, slide-in, Escape). Opening one panel closes the other. **`@bladerunner/web` `0.6.25`**.
- **0.7.50** — **Run detail**: **Timeline, Details, Findings, Artifacts** live in a **right slide-over** opened by **Run Details** (after **Artifacts** on the metrics row). **Targets** and **Tags** stay as compact strips below. **`@bladerunner/web` `0.6.24`**.
- **0.7.49** — **Run detail**: **Timeline, Targets, Details, Tags, Findings, Artifacts** join the **metrics** block as **compact strips** (same pattern as Duration / Steps / …); the large **bottom grid** for those sections is removed so **Live replay preview** and **Recorded steps** share a **taller, matched height** (`min-h-[380px]`, `h-[min(64vh,720px)]`). **`@bladerunner/web` `0.6.23`**.
- **0.7.48** — **Run detail**: **Duration / Steps / Failures / Findings / Artifacts** in one **compact strip** (one line when space allows; wraps to two) with **`·`** separators — replaces five large cards. **`@bladerunner/web` `0.6.22`**.
- **0.7.47** — **Run detail**: **Full width** (`max-w-none`) always — not tied to Play. **Live replay preview** uses **`flex-1`**; **Recorded steps** is a **narrower right column** (`~min(20rem, 26%)`, `max-w-sm`, `min-w-[17rem]`). Bottom **Targets / Findings** grid unchanged. **`@bladerunner/web` `0.6.21`**.
- **0.7.46** — **Run detail**: While **playback is running** (`isPlaying`), the page uses **full main width** (`max-w-none`), **single-column** preview + steps, and **Findings / Tags / Details** stack **below** Targets (no narrow right column). Slightly taller preview canvas and steps list. **`@bladerunner/web` `0.6.20`**.
- **0.7.45** — **Run detail**: Playback **Clerk / OTP / skip / delay** moved behind **Playback settings**; top row is **Play**, **Pause** (or **Resume** while paused), then **Playback settings**. **Stop / Restart / Detach** and step-advance controls live in the panel while playing. **`@bladerunner/web` `0.6.19`**.
- **0.7.44** — **Run detail**: Session recording **video / preview** opens in a **modal**; header button **Video recording** (when artifacts/thumbnail exist). **`@bladerunner/web` `0.6.18`**.
- **0.7.43** — **Step cards**: Checkpoint thumbnails **without** the “After” text label; thumbs **`h-8 w-14`** (was `h-6 w-11`). **`@bladerunner/web` `0.6.17`**.
- **0.7.42** — **Run / playback step list**: **`StepCard`** rows are **shorter** (tighter padding and type). **Checkpoint “After”** thumbnails show as a **small fixed-size strip** on the **right** of the card (replacing the separate **`CheckpointDivider`** row). **`@bladerunner/web` `0.6.16`**.
- **0.7.41** — **Detached playback**: **Replay** after **completed / stopped / failed** starts a new session via **`POST /runs/:sourceRunId/playback/start`** (options from **`GET /runs/playback/:id`** while active, else `?source=` + server defaults). **`playbackBodyFromSnapshot`** in **`@bladerunner/web`**. Detach URL includes **`?source=`** for replay when the session is gone. **`@bladerunner/web` `0.6.15`**.
- **0.7.40** — **Playback UX**: Detached playback keeps **Pause / Stop / Restart** when the **preview socket disconnects** (only hides after **completed / stopped / failed**). Hint text **· Controls** and **`aria-label="Playback controls"`**. Run detail and Runs show a **Playback** label plus a **disabled Pause** before you start — then the live Pause replaces it after **Play**. **`@bladerunner/web` `0.6.14`**.
- **0.7.39** — **Playback UI + API**: Detached playback window and run pages add **Pause / Resume / Stop / Restart**, **Next step** (advance one while paused), and **Run to sequence** (advance until step N). **`POST /runs/playback/advance-one`**, **`advance-to`**, **`restart`**, **`GET /runs/playback/:playbackSessionId`**. Labels **`Automatic Clerk sign-in`** / **`Automatic Clerk OTP`**. **`@bladerunner/api` `0.5.37`**, **`@bladerunner/web` `0.6.13`**.
- **0.7.38** — **Playback + LLM**: **`path[…]`** locators are rewritten to **`page.getByRole('dialog').last().locator('path[…]').first()`** so global **`.first()`** does not click the wrong Lucide X (e.g. row remove vs modal close). **`actionToInstruction`** prompt: prefer dialog-scoped or named close controls, not bare **`path[d="…"]`**. **`@bladerunner/api` `0.5.36`**.
- **0.7.37** — **Playback**: **`relaxPageLocatorFirstForPlayback`** also appends **`.first()`** to **`page.locator('tag[attr]…')`** selectors (e.g. Lucide **`path[d="M18 6 6 18"]`**) when not already narrowed — fixes strict mode when the same path shape is reused. **`@bladerunner/api` `0.5.35`**.
- **0.7.36** — **Playback**: **`relaxPageLocatorFirstForPlayback`** (replaces in-service **`relaxPlaywrightCodegenForPlayback`**) also appends **`.first()`** to **`page.locator('tag.class1.class2…')`** compound class chains (e.g. **`svg.lucide-triangle-alert`**) when not already narrowed — fixes strict mode when the same icon class appears on multiple buttons. **`@bladerunner/api` `0.5.34`**.
- **0.7.35** — **Recording / playback**: removed **debug-session** NDJSON **fetch** instrumentation from **`tightenGetByTextLocatorsForPlayback`** and **`runPlaybackLoop` / `executePwCode`** (verification complete). **`@bladerunner/api` `0.5.33`**.
- **0.7.34** — **Playback**: **`click({ force: true })`** is **not** applied until **`clerkFullSignInDone`** (after **`clerk_auto_sign_in`** or the pre-loop Clerk assist). Pre-auth steps used **force** and could break **automatic Clerk sign-in** when a recorded **`clerk_auto_sign_in`** row exists (initial assist is skipped). **`@bladerunner/api` `0.5.32`**.
- **0.7.33** — **Playback**: bare **`.click()`** in stored codegen is rewritten to **`.click({ force: true })`** (default; set **`PLAYBACK_CLICK_FORCE=false`** to disable) so Radix/dialog layers that **intercept pointer events** do not hang the action. **`relaxClickForceForPlayback`** in the **`executePwCode`** pipeline. **`@bladerunner/api` `0.5.31`**.
- **0.7.32** — **Playback**: **`tightenGetByTextLocatorsForPlayback`** rewrites stored **`getByText(..., { exact: false })`** to **`exact: true`** and inserts **`.first()`** before **`.click()`** when missing — substring matches no longer hit “Total Patients” / “Patients in your care”. **`preferGetByTextForBareTagLocator`** now emits **`exact: true`**. LLM prompt updated accordingly. **`@bladerunner/api` `0.5.30`**.
- **0.7.31** — **Recording**: DOM capture now sends **`elementText`** (`innerText`) and **`ariaLabel`** to **`actionToInstruction`**; **`getElementHtml`** uses **`outerHTML`** (was `cloneNode(false)`, which hid label text). LLM prompt forbids “empty span” when visible text exists; **`preferGetByTextForBareTagLocator`** rewrites bare `page.locator('span').first().click()` when label text is known. **`@bladerunner/api` `0.5.29`**.
- **0.7.30** — **Recording + playback**: **single-step automatic Clerk sign-in** — one **`CUSTOM`** row with **`metadata.kind: clerk_auto_sign_in`** (`otpMode`, `postAuthPageUrl`) instead of six canonical steps; playback runs **`performClerkPasswordEmail2FA`** from recorded **`otpMode`** and skips pre-loop assist when that step exists. Legacy **`clerkAutomationCanonical`** runs unchanged. **`@bladerunner/api` `0.5.28`**.
- **0.7.29** — **Recording**: removed **debug-session NDJSON/fetch** instrumentation from Clerk DOM capture path (verification complete). **`@bladerunner/api` `0.5.27`**.
- **0.7.28** — **Recording**: **Clerk DOM capture barrier** — `session.clerkDomCaptureBarrier` increments when auto sign-in pause starts/ends; DOM capture callbacks snapshot it and **drop** `recordStep` after LLM if the barrier crossed (fixes slow LLM finishing after `resume` and still persisting a stale TYPE). **`@bladerunner/api` `0.5.26`**.
- **0.7.27** — **Recording**: debounced `input` capture now **re-checks pause** before `__bladerunnerRecordAction` (scheduled callbacks could fire mid–auto sign-in after inputs queued before pause). **`@bladerunner/api` `0.5.25`**.
- **0.7.26** — **Recording**: **Pause DOM capture** during **`performClerkPasswordEmail2FA`** so debounced `input` events from the automated OTP fill are not persisted as an extra TYPE (duplicate of canonical step 6); one-shot skip for a stray OTP-shaped TYPE after canonical steps. **`@bladerunner/api` `0.5.24`**.
- **0.7.25** — **Recording**: removed legacy **`pendingPostClerkVerificationAutomaticUi`** tagging of the first TYPE after **Sign in automatically** — it duplicated canonical step 6 (Clerk OTP) with a real DOM-captured OTP step. **`@bladerunner/api` `0.5.23`**.
- **0.7.24** — **Playback**: **Execution chain** filters out Clerk/MailSlurp metadata rows (`clerkAuthPhase`, `clerkAutomationCanonical`) when auto Clerk is on — only **user app** steps run through `executePwCode` in sequence; canonical rows stay in DB for display. **`@bladerunner/api` `0.5.22`**.
- **0.7.23** — **Recording**: DOM capture is **serialized** (FIFO) so LLM latency cannot reorder steps; **Sign in automatically** **removes** manual steps after navigate before inserting canonical Clerk steps (no duplicate Clerk blocks); LLM prompt prefers password vs email from `input` `type`/`name`; slightly longer HTML snippet for inputs. **`@bladerunner/api` `0.5.21`**.
- **0.7.22** — **Playback**: Clerk assist no longer treats arbitrary visible numeric inputs as OTP when the URL is not sign-in-like (avoids long MailSlurp waits / timeouts on in-app pages). Same guard for full sign-in when only OTP detection fired. **`@bladerunner/api` `0.5.20`**.
- **0.7.21** — **Recording**: **Sign in automatically** appends **six** canonical TYPE/CLICK steps (email, Continue, password, Continue, verification code, Continue) instead of one CUSTOM row, so the recorded timeline matches the Clerk + MailSlurp flow; playback behavior unchanged (one `performClerkPasswordEmail2FA` when auto Clerk is on). **`@bladerunner/api` `0.5.19`**.
- **0.7.20** — **Playback**: escape Tailwind `:` in class chains inside `page.locator('…')` (e.g. `hover:bg-accent` → `hover\\:bg-accent`) so `querySelector` accepts recorded CSS; skips selectors with `[` / spaces. **`@bladerunner/api` `0.5.18`**.
- **0.7.19** — **Playback**: after Clerk **full** auto sign-in (`performClerkPasswordEmail2FA`), do not run the OTP-only MailSlurp path again when skipped TYPE rows still match OTP UI — avoids hanging with no toast. **`@bladerunner/api` `0.5.17`**.
- **0.7.18** — **Clerk OTP**: default **`mailslurp`** again when **`PLAYBACK_CLERK_OTP_MODE`** is unset; UI **Clerk OTP** defaults to MailSlurp on Runs / Run detail. Use **`PLAYBACK_CLERK_OTP_MODE=clerk_test_email`** or the test-email dropdown option for **`+clerk_test`** / **`424242`** without MailSlurp. **`@bladerunner/api` `0.5.16`**, **`@bladerunner/web` `0.6.12`**.
- **0.7.17** — **Clerk OTP**: default to **[Clerk test emails](https://clerk.com/docs/testing/test-emails-and-phones)** — identifier must include **`+clerk_test`**, fixed code **`424242`**, no MailSlurp / no dev email quota. **`PLAYBACK_CLERK_OTP_MODE`** (`clerk_test_email` \| `mailslurp`) + API **`clerkOtpMode`** + UI **Clerk OTP** dropdown (Runs / Run detail + recording). **`@bladerunner/clerk-agentmail-signin` `0.4.0`**, **`@bladerunner/api` `0.5.15`**, **`@bladerunner/web` `0.6.11`**.
- **0.7.16** — **Playback**: removed temporary **debug ingest** / **NDJSON** probes for `td` timeouts (post-fix cleanup). **`@bladerunner/api` `0.5.14`**, **`@bladerunner/web` `0.6.10`**.
- **0.7.15** — **Recording**: when the LLM returns a **bare tag** `page.locator('span')` (etc.) but the injected **`getSelector`** value is a **concrete CSS** path (`span.ml-2…`, `td.px-6.py-4`), **merge** stored **`playwrightCode`** to use **`page.locator(<recorded selector>)`** so playback does not use **`.first()`** on the wrong node (fixes misaligned URLs before table clicks). **`actionToInstruction`** prompt updated to prefer the **Selector** field when specific. **`@bladerunner/api` `0.5.13`**, **`@bladerunner/web` `0.6.10`**.
- **0.7.14** — **Playback (debug)**: before each non-skipped step, probe **`td` / `td.px-6.py-4`** counts + first-cell visibility when stored code references table classes; on step failure, log again — NDJSON to **`.cursor/debug-5f6bd9.log`** + ingest (diagnose **`locator.click` Timeout** vs missing DOM). **`@bladerunner/api` `0.5.12`**, **`@bladerunner/web` `0.6.10`**.
- **0.7.13** — **Playback**: fix **`relaxPlaywrightCodegenForPlayback`** — correct **`String.replace`** capture groups so bare **`page.locator('span')`** (etc.) is rewritten to **`.first()`**, avoiding Playwright **strict mode** on generic tag locators. **`@bladerunner/api` `0.5.11`**, **`@bladerunner/web` `0.6.10`**.
- **0.7.12** — **Playback**: **`PLAYBACK_AUTO_CLERK_SIGNIN`** unset or empty defaults **Clerk/MailSlurp auto playback ON** (use **`false`/`0`/`no`** to disable); matches **Server default** in the UI when the client omits **`autoClerkSignIn`**. Broader verification-code **instruction** / **`getByLabel`+`fill`** heuristics for skip. **`@bladerunner/api` `0.5.10`**, **`@bladerunner/web` `0.6.10`**.
- **0.7.11** — **Playback**: also skip stored codegen for **LLM-worded** verification-code steps (e.g. *Type … into the verification code input*) and for **`getByLabel('Enter verification code')`** in **`playwrightCode`**, when **Clerk auto** playback is on — fixes **MANUAL** OTP rows without **`[MailSlurp automation]`** still executing brittle locators after MailSlurp. **`@bladerunner/api` `0.5.9`**, **`@bladerunner/web` `0.6.9`**.
- **0.7.10** — **Playback**: skip stored **`playwrightCode`** for steps whose instruction contains **`[MailSlurp automation]`** (in addition to **`AUTOMATIC`** / **`metadata.clerkAuthPhase`**), so MailSlurp/Clerk automation is not followed by brittle LLM locators (e.g. **`getByLabel('Enter verification code')`** timeout after OTP is already filled). **`@bladerunner/api` `0.5.8`**, **`@bladerunner/web` `0.6.8`**.
- **0.7.9** — **Recording + playback / MailSlurp OTP**: broader OTP field detection (**`detectClerkOtpInputVisible`**, **`fillClerkOtpFromMailSlurp`** in **`@bladerunner/clerk-agentmail-signin`**); after **Sign in automatically**, next captured **TYPE** step tagged **`clerkAuthPhase` + AUTOMATIC**; playback runs MailSlurp on **skipped** automatic steps and after each step (**OTP-only** path when identifier hidden + full **`performClerkPasswordEmail2FA`** when needed). **`@bladerunner/clerk-agentmail-signin` `0.3.7`**, **`@bladerunner/api` `0.5.7`**, **`@bladerunner/web` `0.6.7`** (patch bump with API).
- **0.7.8** — **Playback**: zero-state **`page.goto(run.url)`** before every replay; skip redundant first **NAVIGATE** when it matches the run URL (normalized); with **auto Clerk** playback, skip **`StepOrigin.AUTOMATIC`** steps (not only **`metadata.clerkAuthPhase`**). **`POST /runs/playback/pause`** / **`resume`** + loop wait; UI **Pause** / **Resume**, **delay** slider ( **`delayMs`** ) on **Runs** + **Run detail**; default Clerk auto mode **On**; detached **`/playback/:id`** mirrors pause/stop. **Note:** only one **Clerk** automation pass per session today (**`clerkAutoSignInDone`**). **`@bladerunner/web` `0.6.6`**, **`@bladerunner/api` `0.5.6`**.
- **0.7.7** — **Recording preview + steps**: removed **`setCurrentFrame(null)`** after start (it cleared frames already received); **refetch `GET /runs/:id/steps`** on socket connect after join (steps emitted before join were dropped); **latest screencast JPEG** sent to the joining socket on **`join`**; **refetch steps** after **Clerk auto sign-in** completes; CDP screencast **`everyNthFrame: 1`** for smoother static-page preview. **`@bladerunner/web` `0.6.5`**, **`@bladerunner/api` `0.5.5`**.
- **0.7.6** — **Runs / Run detail**: **StepCard** collapses playback actions, re-record, and Playwright code below the instruction by default; **Show step details** / **Hide step details** toggles the block. **`@bladerunner/web` `0.6.4`**.
- **0.7.5** — **Recording**: first step with action **NAVIGATE** (sequence 1) is always **`StepOrigin.AUTOMATIC`** for UI; re-record uses the existing step’s sequence so step 1 stays automatic when still a navigate. Does not add `clerkAuthPhase` or MailSlurp instruction prefix unless Clerk rules already apply. **`@bladerunner/api` `0.5.4`**.
- **0.7.4** — **Checkpoint thumbnails + live dividers**: JPEG screenshots captured at each checkpoint; **`GET /runs/:id/checkpoints/:checkpointId/thumbnail`**; checkpoint dividers between step cards (expandable thumbnail popup); **Play from here** / **This step only** visible during recording (disabled while browser busy); checkpoint query uses `effectiveRunId` so it works during active recording (polls every 3s). Migration: `thumbnail_path` on `run_checkpoints`. **`@bladerunner/web` `0.6.3`**, **`@bladerunner/api` `0.5.3`**.
- **0.7.3** — **App state checkpoints** (`RunCheckpoint`, migration): optional **`storageState`** snapshots after each step; **`GET /runs/:id/checkpoints`**. **Playback**: **`playThroughSequence`** stops after a given step; UI **Play from here** / **This step only** on **Runs** + **Run detail**. README: restore strategy (hybrid: prefix replay + checkpoints). **`RECORDING_CHECKPOINTS`** env. **`@bladerunner/web` `0.6.2`**, **`@bladerunner/api` `0.5.2`**.
- **0.7.2** — **Docs**: troubleshooting for **`StepOrigin` / `AUTOMATIC`** — run **`pnpm migrate`** in **`apps/api`** when the DB enum is behind **`schema.prisma`** (fixes `22P02` invalid enum + missing recording steps). **`apps/api`**: **`migrate`** script.
- **0.7.1** — **Runs**: show **`role="alert"`** error when **Re-record step** fails. **`@bladerunner/web` `0.6.1`**.
- **0.7.0** — **`StepOrigin.AUTOMATIC`** (Prisma migration): Clerk/MailSlurp-tagged steps use **`[MailSlurp automation]`** instruction prefix; playback behavior unchanged (**`metadata.clerkAuthPhase`** skip + single **`performClerkPasswordEmail2FA`**). **`POST /runs/:id/steps/:stepId/re-record`** re-captures a step by instruction during active recording; **Runs** step cards show **Re-record**. **`@bladerunner/web` `0.6.0`**, **`@bladerunner/api` `0.5.0`**, **`@bladerunner/types` `0.2.0`**.
- **0.6.10** — Remove temporary debug ingest logging from **Run detail** / **Runs** playback handlers. **`@bladerunner/web` `0.5.6`**.
- **0.6.9** — **Playback Play UX**: `disabled` + `pointer-events-none` blocked **all** clicks (no `startPlayback`, nothing in Network). **Run detail** + **Runs** use **`aria-disabled`** + visual opacity so clicks run; **Run detail** shows **Loading…** while **`GET /runs/:id/steps`** is pending when **`stepsCount` > 0** but steps not merged yet; step load errors surfaced. **`GET /runs/:id`** (`findOne`) now includes **`stepsCount`** (and list-style metrics) for reliable gating. **`@bladerunner/web` `0.5.5`**, **`@bladerunner/api` `0.4.6`**.
- **0.6.8** — **Run detail live replay**: Load steps via **`GET /runs/:id/steps`** (same as Runs page) so **`recordedSteps`** / **Play** work when **`GET /runs/:id`** omits or returns an empty **`steps`** array. **`@bladerunner/web` `0.5.4`**.
- **0.6.7** — **Live replay preview**: `usePlayback` surfaces **`startPlayback`** failures, Socket.IO **`connect_error`**, and **`status.failed`** `error` from the server; **Runs** + **Run detail** preview panels show **Connecting to playback stream…** and **`role="alert"`** errors; **Runs** shows step load failures. **`e2e/playback.spec.ts`** (mocked API). **`@bladerunner/web` `0.5.3`**.
- **0.6.6** — **Session video timing**: MJPEG pipe had **wrong implicit FPS** (playback looked 2–3× fast). **`RECORDING_SCREENCAST_INPUT_FPS`** (default 8) + **post-encode `setpts`** vs **wall-clock** (`ffprobe` duration). **`@bladerunner/api` `0.4.5`**.
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
