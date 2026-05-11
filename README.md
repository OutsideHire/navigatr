# navigatr

Mobile-first sales platform for field reps. Monorepo containing the Vite + React frontend, the .NET 9 backend, and the shared OpenAPI contract.

## Layout

```
navigatr/
├── apps/
│   ├── api/        # .NET 9 + ASP.NET Core minimal APIs (backend team)
│   └── app/        # Vite + React 18 + TypeScript 5 (this is the frontend)
├── packages/
│   └── contracts/  # openapi.yaml — single source of truth for the API
├── tools/          # Build scripts (Figma token export, seed-db, etc.)
├── docs/           # Working reference docs (gitignored — not in the codebase yet)
├── docker-compose.yml
├── package.json
└── pnpm-workspace.yaml
```

The `apps/api` .NET solution lives in this repo for coordinated PRs and a single CI pipeline, but it sits outside the pnpm workspace (no `package.json`). Backend devs `cd apps/api && dotnet run`. Frontend devs use the pnpm scripts below.

## Prerequisites

- **Node.js 20+** (`node -v` should report ≥ 20)
- **pnpm 9+** (`corepack enable && corepack prepare pnpm@9 --activate`)
- **Docker** (for local Postgres via `docker-compose.yml`)
- **.NET 9 SDK** (only needed if you're also running the backend locally)

## Quick start

```bash
# install all JS deps (frontend + workspace packages)
pnpm install

# start local Postgres on :5432 (user: navigatr / pw: navigatr-dev / db: navigatr)
pnpm db:up

# run the frontend dev server at http://localhost:5173
pnpm dev:app

# run the backend dev server at http://localhost:5000 (requires .NET 9 SDK)
pnpm dev:api

# run both apps in parallel
pnpm dev
```

## Scripts

| Script               | What it does                                                    |
| -------------------- | --------------------------------------------------------------- |
| `pnpm dev`           | Runs `dev` in every app in parallel                             |
| `pnpm dev:app`       | Runs only the frontend (`apps/app`)                             |
| `pnpm dev:api`       | Runs only the backend (`apps/api`)                              |
| `pnpm build`         | Builds every app                                                |
| `pnpm test`          | Runs tests in every app                                         |
| `pnpm lint`          | Lints every app                                                 |
| `pnpm typecheck`     | Typechecks every app                                            |
| `pnpm generate-api`  | Regenerates the frontend API client from `packages/contracts/openapi.yaml` |
| `pnpm db:up`         | Starts the local Postgres container                             |
| `pnpm db:down`       | Stops the local Postgres container                              |

## Where to read next

- **`apps/app/README.md`** — frontend architecture and dev setup
- **`packages/contracts/README.md`** — how the API contract pipeline works
- **`docs/navigatr-engineering-kickoff-brief.md`** — architecture, stack, sprint 1 scope (working reference)
- **`docs/navigatr_PRD.pdf`** — functional source of truth
- **`docs/DESIGN.md`** — visual design system rules

## Status

Sprint 0 — bootstrapping. See `docs/frontend-implementation-playbook.md` for the session-by-session frontend plan.
