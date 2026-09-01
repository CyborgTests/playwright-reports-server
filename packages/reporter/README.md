# reporter

Playwright reporter that uploads results to Playwright Reports Server - https://github.com/CyborgTests/playwright-reports-server

## Install

`npm i -D @cyborgtests/reporter`

## Basic Configuration

In your `playwright.config.ts` or `playwright.config.js`:

```js
  reporter: [
    // blob reporter is required, produced zip would be uploaded
    ['blob', { outputFile: 'test-results/blob.zip' }],
    [
      '@cyborgtests/reporter',
      {
        // true by default. Use this if you need to skip this reporter for some cases (local executions for example)
        enabled: true,
        /**
         * Your server url
         * @see https://github.com/CyborgTests/playwright-reports-server
         */
        url: 'https://your server instance.com',
        // Set token if your server instance has authentication enabled
        token: '1234',
        // Timeout for reporter HTTP requests to finish, default 60000ms, increase if you have slow server and big requests.
        requestTimeout: 60000,
        // Relative path to your blob. Required.
        reportPath: 'test-results/blob.zip',
        // String metadata. Some keys are special (see below); anything else becomes a filterable tag.
        resultDetails: {
          project: 'web',
          environment: process.env.DEPLOY_ENV, // qa, staging, prod
          branch: process.env.CI_COMMIT_BRANCH,
          foo: 'bar',
        },
        // Automatically trigger HTML report generation after tests finish. Shards supported. false by default
        triggerReportGeneration: false
      },
    ],
  ],
```

Then run your tests, if you see `[ReporterPlaywrightReportsServer] 🎭 HTML Report is available at: ...` - your blob results were successfully sent to server!

### Special `resultDetails` keys

Any string field in `resultDetails` is stored as metadata. A few keys are recognized by the server and drive UI/filters instead of being “just another tag”:

| Key | Effect |
|-----|--------|
| `project` | Groups reports and results. Used by the Project filter, Quality Overview, analytics, and quarantine lookup (`skipQuarantinedTests`). |
| `environment` | Deployment target (`qa`, `staging`, `prod`, …). Dedicated **Env** column and first-class filter (`?environment=qa`). Empty / `unknown` / `n/a` values are treated as missing and show as **Unknown**. |
| `testRun` | Run id for [sharded merges](#shards). Must be identical on every shard of the same run, and unique per actual CI run. |
| `branch` | Shown inline on the reports list (branch chip). Also filterable as a tag. |
| `shardCurrent` | Auto-filled from Playwright’s `--shard=N/M` (`N`). Do not set this yourself. |
| `shardTotal` | Auto-filled from Playwright’s `--shard=N/M` (`M`). Do not set this yourself. When this is set and not `"1"`, the server waits until that many blobs with the same `testRun` (+ `project`) have uploaded, then merges them. Missing or omitted means a single-blob run. |

The reporter also injects `playwrightVersion` and, if you did not pass one, `username` (git `user.name` or `QA_USERNAME`).

Everything else (`appVersion`, `foo`, …) is a custom tag: it appears on the report detail page and can be filtered with `?tags=key:value`.

Do not put upload-control fields in `resultDetails`. `triggerReportGeneration` is a reporter option (see below); the reporter still sends it as a field on the upload so the server knows whether to merge/generate. `shardCurrent` / `shardTotal` describe a single blob and are **not** copied onto the merged report.

With `triggerReportGeneration: true`, the rest of `resultDetails` is copied onto the generated report, so the same keys filter both Results and Reports.

## Shards

Auto-generation of report after all shards completed is supported. You must set `testRun` and `triggerReportGeneration: true` on every shard; leave `shardCurrent` / `shardTotal` out — the reporter fills them from `--shard=N/M`:

```js
resultDetails: {
  project: 'web',
  // MUST be identical across shards of this run, unique per CI run
  testRun: process.env.CI_PIPELINE_ID,
},
triggerReportGeneration: true
```

After all `shardTotal` blobs for that `testRun` are uploaded, the server merges them into one HTML report. A missing shard means no report (orphans sit until cleanup). Reusing `testRun` across CI runs silently merges the wrong blobs.

## Test Quarantine Feature

The Test Quarantine feature allows you to automatically skip tests that have been marked as unstable or flaky directly from the Playwright Reports Server UI. This helps to prevent unstable tests from blocking your CI/CD pipelines.

### How It Works

1. Tests are marked as quarantined in the Playwright Reports Server manually via web UI (Analytics page) or automatically (if specified on Settings page)
2. Before test execution, the reporter fetches the list of quarantined tests from the server
3. The reporter writes this list to a local JSON file
4. During test execution, each test is checked against the quarantine list
5. Quarantined tests are automatically skipped with the reason stored in the server

### Enabling Test Quarantine

To enable automatic skipping of quarantined tests:

1. Import the extended `test` fixture from the reporter package
2. Enable `skipQuarantinedTests` in the reporter configuration
3. Use the extended `test` fixture in your config

```typescript
import { defineConfig } from '@playwright/test';
import { test } from '@cyborgtests/reporter';

export default defineConfig({
  reporter: [
    ['blob', { outputFile: 'test-results/blob.zip' }],
    [
      '@cyborgtests/reporter',
      {
        url: 'http://localhost:3000',
        reportPath: 'test-results/blob.zip',
        // Specify the project name to fetch quarantined tests for
        resultDetails: {
          project: 'my-project',
        },
        // Enable test quarantine
        skipQuarantinedTests: true,
        // Optional: Custom path for the quarantine file (default: './quarantine.json')
        quarantineFilePath: './quarantine.json',
      },
    ],
  ],
  // Use the extended test fixture that checks quarantine status
  test: test,
});
```

### The `checkQuarantine` Fixture

The reporter exports an extended `test` fixture that includes a `checkQuarantine` hook which is responsible for checking if a test is quarantined.

### Configuration Options

| Option                 | Type    | Default               | Description                                    |
|------------------------|---------|-----------------------|------------------------------------------------|
| `skipQuarantinedTests` | boolean | `false`               | Enable automatic skipping of quarantined tests |
| `quarantineFilePath`   | string  | `'./quarantine.json'` | Path where the quarantine list will be stored  |

### What Happens During Test Execution

When `skipQuarantinedTests` is enabled:

1. **Before tests run** (`onBegin`):
   - The reporter fetches quarantined tests from `/api/tests?status=quarantined&project=<your_project>`
   - Results are written to `quarantineFilePath`

2. **During each test** (`checkQuarantine` fixture):
   - The fixture reads the quarantine file
   - Checks if `testId` matches any quarantined test ID
   - If matched skips the test

3. **After tests complete** (`onEnd`):
   - Results are uploaded to the server
   - Report is generated if `triggerReportGeneration` is true

### Troubleshooting

**Quarantine file not found warning:**
```
[checkQuarantinedTests] Quarantine file not found at ./quarantine.json, proceeding without skipping tests.
```
Ensure the reporter can fetch quarantined tests from the server (check network and authentication).

**Tests not being skipped:**
- Verify `skipQuarantinedTests: true` is set
- Verify you're using the extended `test` fixture: `import { test } from '@cyborgtests/reporter'`
- Check the `project` in `resultDetails` matches the project name in the server, if you do not have the project - it can be skipped
- Ensure the quarantine file is being generated correctly

**All tests being skipped:**
- Check that the server's test management thresholds are configured appropriately
- Verify tests are correctly marked as quarantined in the server UI (Analytics page)
