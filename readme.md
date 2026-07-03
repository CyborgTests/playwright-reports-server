# Playwright Reports Server

A self-hosted home for your Playwright test results. Stores reports, merges sharded runs, tracks flakiness over time, and (optionally) runs LLM failure analysis you can read from the UI or pipe into your code assistant.

What you get:

- **Reports & results storage**: keep HTML reports in one place, view them without downloading.
- **Sharded run merging**: server-side equivalent of [`playwright merge-reports`](https://playwright.dev/docs/test-sharding), without scripting the post-step.
- **GitHub Sync**: pull Playwright artifacts from GitHub Actions on a cron without touching workflow files.
- **Overview and Analytics dashboards**: statuses, pass-rate trends, slow tests, failure categories, failure clusters.
- **Test flakiness & quarantine**: score test stability, optionally skip the noisiest.
- **LLM failure analysis**: pick any OpenAI-compatible or Anthropic-format provider; analyses surface inline on each report and on the dashboard. Bring your own token casino.
- **Code-agent integration**: the [`pwrs-cli`](https://www.npmjs.com/package/@cyborgtests/pwrs-cli) plus Claude Code skill exposes failure context to Claude Code, Codex, Cursor, and the LLM-driven code assistant that drops next week.
- **Notifications**: send report details and summaries to Slack or any webhook. Event rules on upload, schedule rules on cron, delivery log. See [notifications docs](https://github.com/CyborgTests/playwright-reports-server/wiki/Notifications).
- **Pluggable storage**: local filesystem, S3-compatible, or Azure Blob, see [storage docs](https://github.com/CyborgTests/playwright-reports-server/wiki/Storage).
- **Accounts, roles, and SSO**: optional auth, off by default; set `API_TOKEN` to turn it on. Cookie sessions with scrypt-hashed passwords, three roles (admin / reader / readonly), invite-only onboarding, scoped API keys for CI and the CLI, and optional single sign-on via GitHub, Google, or any OIDC provider (Okta and friends). See [Authentication](https://github.com/CyborgTests/playwright-reports-server/wiki/Authentication).
- **Persistent state** with SQLite and [Litestream](https://litestream.io) replication for S3 and Azure Blob storages. See [storage](https://github.com/CyborgTests/playwright-reports-server/wiki/Storage).

## Demo

[demo-playwright-reports-server.koyeb.app](https://demo-playwright-reports-server.koyeb.app)

## Getting started

### Prerequisites

- Node.js v22+
- pnpm v9+

### Install & run

```bash
git clone https://github.com/CyborgTests/playwright-reports-server.git
cd playwright-reports-server
pnpm install
```

**Production:**

```bash
pnpm run build && pnpm run start
```

Server listens on port `3001` by default (configurable via `PORT`) and serves both the API and the built SPA from one process. Open `http://localhost:3001`.

**Development:**

```bash
pnpm run dev
```

Backend on `:3001`, Vite dev frontend on `:3000`. The frontend proxies `/api/*` to `:3001`, so during dev you can hit either port for the UI.

All persistent state lives in `apps/backend/data/` for `pnpm run start` and `dev`, or `/app/data/` in the Docker image. Back this up to keep reports, results, and the SQLite metadata file safe. Or don't.  

### Docker

```bash
docker run -p 3001:3001 -v /path/on/host:/app/data \
  ghcr.io/cyborgtests/playwright-reports-server:latest
```

Full deployment options: see **[Deployment](https://github.com/CyborgTests/playwright-reports-server/wiki/Deployment)**.

## Documentation

The detailed docs live in the **[wiki](https://github.com/CyborgTests/playwright-reports-server/wiki)**:

| Topic | Page |
|-------|------|
| Every env var | [Configuration](https://github.com/CyborgTests/playwright-reports-server/wiki/Configuration) |
| Accounts, roles, sessions, API keys, SSO | [Authentication](https://github.com/CyborgTests/playwright-reports-server/wiki/Authentication) |
| `fs` / `s3` / `azure` backends and Litestream replication | [Storage](https://github.com/CyborgTests/playwright-reports-server/wiki/Storage) |
| Title, logo, favicon, header links | [White‐label](https://github.com/CyborgTests/playwright-reports-server/wiki/White%E2%80%90label) |
| Deployment | [Deployment](https://github.com/CyborgTests/playwright-reports-server/wiki/Deployment) |
| How to upload reports | [Uploading Reports](https://github.com/CyborgTests/playwright-reports-server/wiki/Uploading-Reports) |
| Analytics stats, trends, failure clustering strategies | [Analytics](https://github.com/CyborgTests/playwright-reports-server/wiki/Analytics-Dashboard) |
| Flakiness scoring, quarantine, reporter-side skip | [Test Management](https://github.com/CyborgTests/playwright-reports-server/wiki/Test-Management) |
| LLM analysis | [LLM Analysis](https://github.com/CyborgTests/playwright-reports-server/wiki/LLM-Analysis) |
| Claude Code / Codex / Cursor integration via `pwrs-cli` | [Code Assistant Integration](https://github.com/CyborgTests/playwright-reports-server/wiki/Code-Assistant-Integration) |
| Slack & webhook notifications, event + schedule rules, templates, delivery log | [Notifications](https://github.com/CyborgTests/playwright-reports-server/wiki/Notifications) |
