# Uploading reports

Every way to get Playwright results into the server. Pick the one that matches your situation.

| You're doing this | Use this |
|-------------------|----------|
| Running Playwright tests in CI or locally | [Reporter plugin](#1-reporter-plugin-the-default) |
| Running tests sharded across multiple machines | [Sharded runs (auto-merge)](#2-sharded-runs-auto-merge) |
| Pushing an already-built `playwright-report/` folder | [HTML upload via CLI](#3-html-upload-via-cli) |
| Combining blobs that are already on the server | [Manual report generation](#4-manual-report-generation) |
| Pulling reports from a GitHub Actions workflow | [GitHub Sync](#5-github-sync) |

---

## 1. Reporter plugin (the default)

What you'll see in CI: a `[ReporterPlaywrightReportsServer] 🎭 HTML Report is available at: ...` line at the end of the run, with a link to your report.

```bash
npm i -D @cyborgtests/reporter
```

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    // blob reporter is required; the zip is what gets uploaded
    ['blob', { outputFile: 'test-results/blob.zip' }],
    [
      '@cyborgtests/reporter',
      {
        url: 'https://reports.example.com',
        token: process.env.PWRS_TOKEN,    // skip if the server runs without API_TOKEN
        reportPath: 'test-results/blob.zip',
        // any string-valued field becomes filterable metadata in the UI
        resultDetails: {
          branch: process.env.CI_COMMIT_BRANCH,
          appVersion: process.env.APP_VERSION,
          environment: 'qa',
        },
        triggerReportGeneration: true,    // optional, false by default
      },
    ],
  ],
});
```

Bumping defaults when CI is slow or blobs are large: `requestTimeout` (60s) and `blobUploadTimeout` (10min). Setting `enabled: false` disables the reporter for local runs you don't want cluttering the dashboard.

Full reporter docs: [`packages/reporter/README.md`](https://github.com/CyborgTests/playwright-reports-server/blob/main/packages/reporter/README.md).

---

## 2. Sharded runs (auto-merge)

What you'll see: one merged report appears once all shards have uploaded. No post-step in your workflow.

In the reporter config on every shard:

```ts
resultDetails: {
  testRun: 'release-1.42-nightly',  // MUST be identical across shards
  project: 'web',
},
triggerReportGeneration: true,
```

The reporter fills in `shardCurrent` and `shardTotal` from Playwright's `--shard=N/M` flag.

**!NB**:
- **A missing shard means no report.** If a runner dies and shard 3 of 4 never arrives, the merge never happens. The orphan blobs sit there until [expiration](./Configuration#expiration) sweeps them.
- **`testRun` must be unique per actual run.** Reuse it across CI runs and you get a report that looks correct but is silently merged from blobs you didn't intend. Use a timestamp, GitHub run ID, anything unique.

For non-sharded runs, leave `shardTotal` empty (or `1`). `triggerReportGeneration: true` generates the report from the single blob immediately.

---

## 3. HTML upload via CLI

What you have: a `playwright-report/` directory built from tests already or you actually have a step to merge blobs on CI.

```bash
npx --package=@cyborgtests/reporter playwright-reporter-cli upload ./playwright-report \
  --url https://reports.example.com \
  --token "$PWRS_TOKEN" \
  --project web \
  --title "Nightly Run 2026-05-29" \
  --tags ci,nightly \
  --meta branch=main \
  --meta build=12345
```

The CLI zips the directory (it needs `index.html` at the root) and uploads. `--meta key=value` is repeatable; throw whatever you want at it.

---

## 4. Manual report generation

What you'll see: a brand-new merged report from blobs that are already on the server.

Open results page, select multiple blobs, click merge, specify the project and tags.
Useful when you've been uploading raw blobs without `triggerReportGeneration` and want to merge a specific subset by hand. Any extra string-valued fields in the body become metadata on the new report.

---

## 5. GitHub Sync

A scheduled fetcher that pulls Playwright report artifacts out of a GitHub Actions workflow and uploads them as native reports. Configured entirely from the UI (`/settings -> GitHub Sync`). See [the dedicated page](./GitHub-Sync) for the full setup, including artifact regex patterns and the templates that name your projects.

Use this when:

- Your workflow already produces a `playwright-report` artifact and you'd rather not edit the workflow file again.
- You want to backfill historical runs.
- Multiple repos produce reports and you don't want a separate setup for each.

---

## See also

- [LLM analysis](./LLM-Analysis): what auto-runs once a report uploads, assuming you bothered to configure a provider
- [Configuration](./Configuration): `API_TOKEN`, expiration, S3 chunk size
