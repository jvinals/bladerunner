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

# Or start both in parallel
pnpm dev
```

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

## License

Private — Edgehealth © 2026
