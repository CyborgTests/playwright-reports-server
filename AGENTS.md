# Agent guide — Playwright Reports Server

Use this file as the primary map of the repository before changing API, storage, or UI.

## Cursor: custom subagents

| Subagent | File | Use |
|----------|------|-----|
| **docs-maintainer** | [`.cursor/agents/docs-maintainer.md`](.cursor/agents/docs-maintainer.md) | After code changes: sync **AGENTS.md**, **README**, **.env.example**, OpenAPI copy. `/docs-maintainer` |
| **unit-test-writer** | [`.cursor/agents/unit-test-writer.md`](.cursor/agents/unit-test-writer.md) | After new logic: add **Vitest** unit tests (`src/**/*.test.ts`). `/unit-test-writer` |
| **devops** | [`.cursor/agents/devops.md`](.cursor/agents/devops.md) | Docker, GitHub Actions, GHCR + Docker Hub, `latest`/prerelease tags, **CHANGELOG**, production runbook. `/devops` |

Delegate with a short summary of edits and file paths; run in parallel with the main task when useful.

## Unit tests (Vitest)

- **Run**: `npm run test:unit`
- **Config**: [`vitest.config.ts`](vitest.config.ts) — `include`: `src/**/*.test.ts`, environment `node`
- **Integration / HTTP**: keep in separate suites (e.g. Playwright API tests); unit tests stay offline and mock I/O

## Stack

- **Runtime**: Node.js (ES modules)
- **Server**: Express (`server.ts`) — JSON API, static report serving, optional Vite dev middleware
- **Frontend**: Vite 6, React 19, React Router, Tailwind 4 (`src/`)
- **Database**: SQLite via `better-sqlite3` (`src/db.ts`, file `data/database.sqlite`)

**Dev entrypoint**: `npm run dev` → `tsx server.ts` (default port **3000**).

**Production / Docker**: `npm run start` or container `CMD` from [`Dockerfile`](Dockerfile). Listen port: **`PORT`** env (default 3000). Persist **`/app/data`** (or `data/` locally). Container image publish: see [CHANGELOG.md](CHANGELOG.md) and [README.md](README.md) (GHCR + Docker Hub, `latest` vs prerelease).

## Where things live

| Area | Location |
|------|----------|
| HTTP handlers, report paths, Vite in dev | `server.ts` |
| Route list + OpenAPI (`ROUTE_SPECS`, `getOpenApiSpec`) | `src/openapi.ts` |
| SQLite schema and lightweight migrations | `src/db.ts` |
| Shared TS types | `src/types.ts` |
| SPA routes and pages | `src/App.tsx`, `src/pages/` |
| Reusable UI | `src/components/` |
| Client auth (token in `localStorage`) | `src/context/AuthContext.tsx` |
| Vite config (e.g. `VITE_REQUIRE_AUTH`) | `vite.config.ts` |

## API documentation (machine-readable)

- `GET /api/openapi.json` — OpenAPI 3.1 spec
- `GET /api/docs` — Swagger UI

## Adding or changing an HTTP endpoint

1. Add or edit a route in `ROUTE_SPECS` inside `src/openapi.ts` (method, path, `operationId`, OpenAPI metadata).
2. Implement the handler in the `handlers` object in `server.ts`, keyed by the same `operationId`.
3. If the route needs auth, uploads, or extra middleware, update `middlewareByOperationId` in `server.ts`.
4. Keep the OpenAPI `responses` / `requestBody` in sync with what the handler returns.

Routes under `/api/serve/...` are registered separately (Express static) and are **not** driven by `ROUTE_SPECS`.

## Authentication

- If `API_TOKEN` is **unset**, protected routes do not require a token.
- If `API_TOKEN` is **set**, the server expects the **`Authorization` header value to equal the raw token** (same as the SPA: no `Bearer ` prefix unless your token string itself includes it).
- `GET /api/config` is intentionally reachable without auth (so the UI can read `authRequired`).

## Data directories (filesystem)

All under `data/` (created at runtime):

- `data/results/` — uploaded result zips (legacy flows)
- `data/reports/<project>/<reportId>/` — generated HTML reports (`playwright merge-reports`)
- `data/public/` — uploaded logo/favicon from settings
- `data/temp/` — uploads and merge scratch
- `data/database.sqlite` — metadata

## Implemented vs configuration-only

**Implemented in this codebase**

- Local filesystem storage under `data/`
- SQLite metadata
- Merging blob/sharded reports via `npx playwright merge-reports` (see `server.ts`)
- Optional API token gate
- Config and cron-related fields persisted and exposed for the UI

**Not implemented (do not assume code exists)**

- **S3 / `DATA_STORAGE=s3`**: env and config may mention S3; the server does not upload or read reports from S3 in the current implementation.
- **Background expiration jobs**: `RESULT_EXPIRE_*`, `REPORT_EXPIRE_*`, and cron schedule strings may appear in config/UI; there is **no** scheduled worker (e.g. node-cron) deleting old results/reports in this repo.

When editing `.env.example` or docs, keep the above distinction clear.

## Subagent / task split (suggested)

- **API + OpenAPI**: `src/openapi.ts` + `server.ts` (`handlers`, `middlewareByOperationId`)
- **Schema / SQL**: `src/db.ts` + any new queries in `server.ts`
- **UI**: `src/pages/`, `src/components/`, `src/context/`

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages.
