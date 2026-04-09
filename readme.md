# Playwright Reports Server

Web UI and HTTP API to collect Playwright HTML report blobs, merge them with `playwright merge-reports`, list reports, and browse generated HTML. Metadata is stored in SQLite; report files live on disk under `data/`.

For **architecture, auth behavior, and agent-oriented maps**, see [AGENTS.md](./AGENTS.md).

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- npm

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Environment (optional):

   ```bash
   cp .env.example .env
   ```

   For local development you can leave `.env` empty. To require a token for API and report routes, set `API_TOKEN` in `.env` (see [.env.example](./.env.example)).

3. Run the app:

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

## Docker

Build and run locally (persist data with a volume):

```bash
docker build -t playwright-reports-server:local .
docker run --rm -p 3000:3000 -v prs-data:/app/data playwright-reports-server:local
```

- **Port**: set `PORT` if you need a different listen port (default `3000`).
- **Data**: mount a volume on `/app/data` (SQLite and uploaded reports).
- **Auth**: pass env vars e.g. `-e API_TOKEN=...` (see [.env.example](./.env.example)).

### Published images

On each **GitHub Release**, CI pushes the same digest to:

- **GHCR**: `ghcr.io/<owner>/<repo>` (e.g. `ghcr.io/CyborgTests/playwright-reports-server`)
- **Docker Hub**: `docker.io/<DOCKERHUB_USERNAME>/playwright-reports-server`

Repository secrets required for Docker Hub: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.

- **Stable release**: pull `:latest` or a semver tag.
- **Prerelease**: use an explicit tag (e.g. `1.3.0-beta.1` or `:beta`); `:latest` stays on the last **non-prerelease** release.

See [CHANGELOG.md](./CHANGELOG.md) for tagging rules.

## API documentation

- Interactive: [http://localhost:3000/api/docs](http://localhost:3000/api/docs)
- OpenAPI JSON: [http://localhost:3000/api/openapi.json](http://localhost:3000/api/openapi.json)

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Express + Vite dev server (`server.ts`) |
| `npm run start` | Production server (`NODE_ENV=production`, serves `dist/`) |
| `npm run build` | Production build of the SPA to `dist/` |
| `npm run preview` | Preview the built SPA (static) |
| `npm run lint` | Typecheck (`tsc --noEmit`) |
| `npm run test:unit` | Vitest unit tests (`src/**/*.test.ts`) |
| `npm run clean` | Remove `dist/` |
