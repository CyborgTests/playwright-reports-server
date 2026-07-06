# Documentation

The stuff that didn't fit in the main README without turning it into a novel. Jump straight to the page that matches whatever's ruining your day.

## Ops & infrastructure

- **[Configuration](./Configuration)**: every env var used for configuration.
- **[Authentication](./Authentication)**: login, roles, users, invites, API keys, SSO.
- **[Storage](./Storage)**: `fs`, `s3`, `azure`. Litestream replication.
- **[Deployment](./Deployment)**: Docker basics.
- **[Notifications](./Notifications)**: ship report outcomes and summaries to Slack or any webhook. Event rules on upload, schedule rules on cron, delivery log.
- **[UI white-label](./White-label)**: title, logo, favicon, header links. Make it look like your team's tool rather than someone else's.

## Getting reports in

- **[Uploading reports](./Uploading-Reports)**: every upload path. The reporter plugin, sharded runs with auto-merge, HTML upload via CLI, GitHub Sync, manual report generation, and the direct-to-S3 presigned uploads.
- **[Data migration](./Data-Migration)**: one-time import of an existing instance's reports and results, served in place from your storage backend.
- **[GitHub Sync](./GitHub-Sync)**: scrape Playwright artifacts out of GitHub Actions on a cron so you don't have to touch any workflow files or just download the latest reports to your local instance.

## Day-to-day features

- **[Overview dashboard](./Overview-Dashboard)**: a configurable home page - per-project letter grades and OK/NOT OK verdicts rolled into one signal, pinned to `/`.
- **[Analytics dashboard](./Analytics-Dashboard)**: trends, slow tests, failure clustering.
- **[Regression tracking](./Regression-Tracking)**: telling a genuine break (was green, now broken) from a flake - opened, tracked with its breaking/last-green commits, resolved on recovery.
- **[Test management & quarantine](./Test-Management)**: how flakiness is scored, when auto-quarantine kicks in, and how the reporter actually skips quarantined tests at runtime (spoiler: a file on disk, no magic, unfortunately).
- **[Report export (PDF)](./Report-Export)**: one self-contained PDF per report, generated server-side for audits and review attachments.

## LLM integration

- **[Analysis](./LLM-Analysis)**: how failure analysis is done and why - providers, the model registry, screenshots, the background queue.
- **[Routing](./LLM-Routing)**: multi-model strategies (fusion, council, cascade, refine) per task - what each costs, when it helps, and how to experiment.
- **[Selection](./LLM-Selection)**: how to choose a model - general recommendations for local (LM Studio / oMLX / Ollama) and remote (OpenRouter).
- **[Code assistant](./Code-Assistant)**: hand your coding partner (`pwrs-cli` + Claude Code skill) access to the failure data so it can stop guessing what broke and pull real run history instead of poking around with `gh`, grep, and a web browser.

## Where things live in this repo

- `apps/backend/`: Fastify API server (port 3001)
- `apps/frontend/`: React SPA (Vite, port 3000 in dev)
- `packages/shared/`: `@playwright-reports/shared` types and constants
- `packages/reporter/`: [`@cyborgtests/reporter`](https://www.npmjs.com/package/@cyborgtests/reporter), the reporter plugin
- `packages/cli/`: [`@cyborgtests/pwrs-cli`](https://www.npmjs.com/package/@cyborgtests/pwrs-cli), the agent CLI
- `packages/skill/`: Claude Code plugin that wraps the CLI
