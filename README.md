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

1. Install browser binaries once: `pnpm test:e2e:install`
2. In **`.env`** (repo root): `VITE_CLERK_PUBLISHABLE_KEY`, **`CLERK_SECRET_KEY`** (same Clerk dev app), then one of:
   - **Ticket sign-in:** **`E2E_CLERK_USER_EMAIL`** only (no password) — `@clerk/testing` signs in via Clerk’s backend.
   - **Password, no 2FA:** **`E2E_CLERK_USER_EMAIL`** (or **`E2E_CLERK_USER_USERNAME`**) + **`E2E_CLERK_USER_PASSWORD`** — do **not** set **`AGENTMAIL_API_KEY`** / **`E2E_AGENTMAIL_INBOX_ID`**.
   - **Password + email OTP (e.g. Clerk → AgentMail):** same password vars **plus** **`AGENTMAIL_API_KEY`** and either **`E2E_AGENTMAIL_INBOX_EMAIL`** (e.g. `evocare@agentmail.to`) **or** **`E2E_AGENTMAIL_INBOX_ID`**. The UI often doesn’t show the raw id — run **`pnpm agentmail:list-inboxes`** to print **id + email** for each inbox. The copy icon next to the address in the AgentMail dashboard may also copy the inbox id (paste into a note to check).
3. Run: **`pnpm test:e2e`** (starts Vite on **5173**, runs setup auth, then signed-in specs).

Auth state is written to **`playwright/.clerk/user.json`** (gitignored). Tests assert **`/settings`** so the suite does not require the API or database.

## Changelog

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
