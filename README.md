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

# Or start all dev servers in parallel (web, API on 3001, browser-worker)
pnpm dev
```

### Database (local vs hosted)

The API needs a reachable **PostgreSQL** `DATABASE_URL` (see root `.env`). If Railway (or any remote DB) is **down or unreachable**, you’ll see **`PrismaClientInitializationError` / P1001** in API logs. The API still **starts** (Prisma connects lazily); **`GET /health`** returns **503** with `services.database: "error"` until the DB is reachable.

Optional local DB:

```bash
docker compose --profile local-db up -d postgres
# In .env:
# DATABASE_URL=postgresql://bladerunner:bladerunner@127.0.0.1:5432/bladerunner
cd apps/api && pnpm exec prisma migrate deploy
```

Smoke check: `node scripts/verify-api-health.mjs` (expects HTTP 200 and `database: ok`).

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

## Changelog

- **0.2.9** — Prisma uses **lazy connect** so a bad/unreachable `DATABASE_URL` no longer crashes the API before `listen()` (fixes empty port 3001 + Vite `ECONNREFUSED`). `/health` returns **503** when the DB check fails (with `dbError` in non-production). Optional **`local-db`** Postgres service in `docker-compose.yml`; `verify-api-health.mjs` hints local setup.
- **0.2.8** — `scripts/verify-api-health.mjs` explains **ECONNREFUSED** (API not running) with `pnpm dev:api` / `pnpm dev` hints.
- **0.2.7** — API: non-production errors return the real `message` (instead of a generic 500) via `DevVerboseExceptionFilter`; recording failures map to **503** with a clear browser-worker/Playwright hint; `/health` runs a real DB `SELECT 1`; Clerk guard accepts `CLERK_PUBLISHABLE_KEY` or `VITE_CLERK_PUBLISHABLE_KEY`; run list query coerces numeric `page` / `pageSize`.
- **0.2.6** — `apps/api` defines a `dev` script so root `pnpm dev` starts NestJS (fixes Vite `/api/*` proxy 500s when only the frontend was running). `apiFetch` surfaces Nest JSON `message` on errors.
- **0.2.5** — Extended remote preview: CDP **touch** (swipe, multi-touch / pinch), **double-click**, normalized **wheel** deltas (line/page modes), **clipboard bridge** (`⌘/Ctrl+C/V/X` pull/paste/cut between remote selection and your OS clipboard).
- **0.2.4** — Remote control for recording preview: pointer and wheel events (and optional keyboard after clicking the preview) forward to Playwright via Socket.IO; `Esc` exits keyboard forwarding.
- **0.2.3** — Remove debug-session `fetch` instrumentation from `useRecording` (keep `connect_error` console logging).
- **0.2.2** — Recording preview: Socket.IO connects to `VITE_API_URL` (NestJS) instead of the Vite dev server so screencast frames reach the UI; hydrate steps from REST after `record/start`.

## License

Private — Edgehealth © 2026
