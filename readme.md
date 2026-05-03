# Playwright Reports Server

The Playwright Reports Server provides APIs for managing and generating reports based on Playwright test results. It allows you to:

- Store HTML reports and easily view them without downloading locally
- Merge results into one report from sharded runs together (see [Playwright Sharding](https://playwright.dev/docs/test-sharding))
- Store raw results, and aggregate them together into one report
- Check web ui for report trends and test history
- Basic api token authorization for backend and web ui, reports are secured as well
- Analyze test failures in Playwright reports with integrated LLM provider
- Provide a feedback for LLM analyses to impact the direction for next test runs
- Track test flakiness and quarantine unstable tests

## Project structure

This is a pnpm-workspaces monorepo:

```
├── apps/
│   ├── backend/    Fastify API server (port 3001, serves the SPA in production)
│   └── frontend/   React SPA (Vite, dev port 3000 — proxies /api to :3001)
└── packages/
    ├── shared/     @playwright-reports/shared — types, constants, utils
    └── reporter/   @playwright-reports/reporter (npm: @shelex/playwright-reporter)
```

Persistent state lives in `data/` (SQLite `metadata.db` via better-sqlite3 + raw blobs/HTML reports). Optional [Litestream](https://litestream.io) replication is configured via `litestream.yml`.

## Demo

[Check out the live demo!](https://associated-jacqui-shelexdev-028b131e.koyeb.app)

## Table of Contents

- [Playwright Reports Server](#playwright-reports-server)
  - [Demo](#demo)
  - [Project structure](#project-structure)
  - [Table of Contents](#table-of-contents)
  - [Getting Started](#getting-started)
    - [Prerequisites](#prerequisites)
    - [Installation](#installation)
    - [Running the Server](#running-the-server)
  - [Configuration options](#configuration-options)
    - [General](#general)
    - [S3 Compatible Storage](#s3-compatible-storage)
    - [LLM](#llm)
      - [Playwright Report — Per-Test Analysis](#playwright-report--per-test-analysis)
      - [Feedback widget (test-level)](#feedback-widget-test-level)
      - [Report Detail Page — Failure Summary](#report-detail-page--failure-summary)
      - [Analytics Dashboard — Failure Categories](#analytics-dashboard--failure-categories)
      - [LLM Queue Page](#llm-queue-page)
      - [Background Processing](#background-processing)
    - [Test Management](#test-management)
  - [API Routes](#api-routes)
  - [Authorization](#authorization)
  - [Test Quarantine](#test-quarantine)
  - [Storage Options](#storage-options)
    - [Local File System Storage](#local-file-system-storage)
    - [S3-Compatible Object Storage](#s3-compatible-object-storage)
    - [Expiration task](#expiration-task)
  - [Docker Usage](#docker-usage)
  - [UI White-label](#ui-white-label)
    - [API](#api)
    - [Config File](#config-file)
    - [Header links](#header-links)

## Getting Started

### Prerequisites

- Node.js (v22 or higher)
- pnpm (v9 or higher)

### Installation

1. Clone this repository:

   ```
   git clone https://github.com/Shelex/playwright-reports-server.git
   cd playwright-reports-server
   ```

2. Install dependencies:
   ```
   pnpm install
   ```

### Running the Server

**Production:**

```
pnpm run build && pnpm run start
```

The server listens on port `3001` by default (configurable via `PORT`) and serves both the API and the built SPA from a single process. App is accessible at `http://localhost:3001`.

**Development:**

```
pnpm run dev
```

Starts the backend on `:3001` and the Vite dev frontend on `:3000` concurrently. The frontend proxies `/api/*` to `:3001`, so during dev you can hit either port for the UI but **API requests should target `:3001`** (or `:3000` only if you want to go through the Vite proxy).

All persistent state lives in the `data/` folder — `apps/backend/data/` for `pnpm run start`/`dev`, `/app/data/` in the Docker image. Back this up to keep reports, results, and the SQLite metadata file safe.

## Configuration options

### General
The app is configured with environment variables, so it could be specified as `.env` file as well, however there are no mandatory options.

| Name                   | Description                                                                                 | Default |
|------------------------|---------------------------------------------------------------------------------------------|---------|
| `API_TOKEN`            | API token for [Authorization](#authorization)                                               |         |
| `AUTH_SECRET`          | Secret to encrypt JWT                                                                       |         |
| `UI_AUTH_EXPIRE_HOURS` | Duration of auth session                                                                    | `"2"`   |
| `DATA_STORAGE`         | Where to store data, check for additional configuration [Storage Options](#storage-options) | `"fs"`  |

### S3 Compatible Storage

If you want to persist reports and results on S3 compatible storage, you need to set `DATA_STORAGE` variable to `s3` and provide additional configuration:

| Name                         | Description                           | Default                   |
|------------------------------|---------------------------------------|---------------------------|
| `S3_ENDPOINT`                | S3 endpoint URL (without https://)    |                           |
| `S3_REGION`                  | S3 region                             |                           |
| `S3_ACCESS_KEY`              | S3 access key                         |                           |
| `S3_SECRET_KEY`              | S3 secret key                         |                           |
| `S3_BUCKET`                  | S3 bucket name                        | playwright-reports-server |
| `S3_PORT`                    | S3 custom port                        |                           |
| `S3_BATCH_SIZE`              | Number of concurrent requests to S3   | 10                        |
| `S3_MULTIPART_CHUNK_SIZE_MB` | Chunk size for multipart upload in MB | 25                        |

### LLM

When configured, the LLM integration provides failure analysis across the application. It is enabled ONLY if LLM provider is configured.

#### Configuration

| Name                     | Description                                                      | Default                |
|--------------------------|------------------------------------------------------------------|------------------------|
| `LLM_PROVIDER`           | LLM provider to use for test failure analysis (openai\anthropic) | openai                 |
| `LLM_BASE_URL`           | Base URL for the LLM API                                         |                        |
| `LLM_API_KEY`            | API key for the LLM provider                                     |                        |
| `LLM_MODEL`              | Model to use for the LLM provider                                | checks /model endpoint |
| `LLM_TEMPERATURE`        | Temperature setting for the LLM                                  | 0.3                    |
| `LLM_PARALLEL_REQUESTS`  | Number of concurrent LLM requests for background analysis queue  | 1                      |

#### Playwright Report — Per-Test Analysis

For failed tests in the served Playwright HTML report, the LLM analysis is exposed in one of two states:

- **Analysis already done** — an inline **LLM Analysis widget** appears above the errors area with the cached result, the model name, the failure category badge, and a **Retry** button. This is the common case once background processing has run for the test.
- **Analysis not yet done** — an **"Ask LLM"** button is added next to Playwright's "Copy prompt" so you can trigger analysis on demand. Once the analysis arrives the button is hidden and the inline widget takes over.

#### Feedback widget (test-level)

Below the analysis area, a **Feedback** panel is injected into the served Playwright report. It has an option to add a single shared note that becomes context for future LLM analyses.

At a glance, the header shows:

- 💬 *Feedback (updated 2h ago)* — current state
- **🆕 New error** — this exact failure shape (matching `errorSignature`) has not been seen in any prior run of this test, OR
- **🔁 N prior occurrences** — this failure has happened before, plus an inline "First found in [report X] — Nd ago" link
- **🔗 N other projects** — same test has feedback in other projects
- **⚠ Stale indicator** — your feedback is newer than the latest analysis

Expand the panel to:

- Read/edit the note (textarea + Save/Delete)
- Click **Regenerate** to enqueue a fresh `test_analysis` task that includes your feedback in the prompt
- Tick **"Also refresh report summary after this test"** to cascade — re-run the test analysis AND the report-level summary in one click

#### Report Detail Page — Failure Summary

On each report's detail page a **Failure Summary** card appears when the report contains failed tests:

- **"Summarize Failures"** button queues LLM analysis for all failed tests in the report, plus a report-level summary
- Once analysis is completed, the card displays failure category breakdown, error groups with occurrence counts, and an LLM-generated markdown summary of the report's failures

#### Analytics Dashboard — Failure Categories

- **Failure Categories Chart** — horizontal bar chart showing the breakdown of failure types across the latest failed reports
- **Most Common Failures** — card listing the top 5 error patterns with category badges, occurrence counts, and expandable error messages
- **LLM Failure Analysis** — project-level summary with a "Generate Analysis" button that streams an LLM synthesis of failure trends across the latest failed reports.

#### LLM Queue Page

Accessible from **Settings → LLM Configuration → "LLM Queue" button**
The queue page provides full visibility and control over LLM background tasks processing.

#### Background Processing

App will automagically:

1. Extract failure details from each failed test for every new report available (error message, stack trace, page context from traces)
2. Queue per-test LLM analysis tasks (categorization + root cause + fix suggestion)
3. After all test analyses complete, queue a report-level summary task

### Test Management

The Test Management feature is configured via the Settings page in the web UI. These settings control how test flakiness is calculated and when tests are automatically quarantined. Configuration is stored in the server's config file and persisted across restarts.

| Setting                     | Description                                                                    | Default |
|-----------------------------|--------------------------------------------------------------------------------|---------|
| Warning Threshold (%)       | Flakiness score above which tests are marked as "Flaky"                        | 2       |
| Quarantine Threshold (%)    | Flakiness score above which tests are marked as "Critical" or auto-quarantined | 5       |
| Auto-Quarantine Tests       | Automatically quarantine tests exceeding the quarantine threshold              | false   |
| Minimum Runs for Evaluation | Minimum test runs before calculating flakiness score                           | 1       |
| Evaluation Window (Days)    | Number of days to look back when calculating flakiness                         | 30      |

## API Routes

### `/api/report/list` (GET):

Returns list of generated reports and corresponding url on server:

```sh
curl --location --request GET 'http://localhost:3001/api/report/list' \
--header 'Content-Type: application/json' \
--header 'Authorization: <api-token>'
```

Response example:

```json
{
  "reports": [
    {
      "reportID": "8e9af87d-1d10-4729-aefd-3e92ee64d06c",
      "createdAt": "2024-05-06T16:52:45.017Z",
      "project": "regression",
      "size": "6.97 MB",
      "reportUrl": "/api/serve/8e9af87d-1d10-4729-aefd-3e92ee64d06c/index.html"
      //...parsed info
    },
    {
      "reportID": "8fe427ed-783c-4fb9-aacc-ba6fbc5f5667",
      "createdAt": "2024-05-06T16:59:38.814Z",
      "project": "smoke",
      "size": "1.53 MB",
      "reportUrl": "/api/serve/8fe427ed-783c-4fb9-aacc-ba6fbc5f5667/index.html"
      //...parsed info
    }
  ],
  "total": 2
}
```

### `/api/report/delete` (DELETE):

Deletes report folder

```sh
curl --location --request DELETE 'http://localhost:3001/api/report/delete' \
--header 'Content-Type: application/json' \
--header 'Authorization: <api-token>' \
--data '{
    "reportsIds": [
        "6a615fe1-2452-4867-9ae5-6ee68313aac6"
    ]
}'
```

Response example:

```json
{
  "message": "Reports deleted successfully",
  "reportsIds": ["6a615fe1-2452-4867-9ae5-6ee68313aac6"]
}
```

### `/api/result/delete` (DELETE):

Delete result by ids

```sh
curl --location --request DELETE 'http://localhost:3001/api/result/delete' \
--header 'Content-Type: application/json' \
--header 'Authorization: <api-token>' \
--data '{
    "resultsIds": [
        "6a615fe1-2452-4867-9ae5-6ee68313aac6"
    ]
}'
```

Response example:

```json
{
  "message": "Results files deleted successfully",
  "resultsIds": ["6a615fe1-2452-4867-9ae5-6ee68313aac6"]
}
```

### `/api/report/generate` (POST):

Generates report from provided resultsIds, merges results together into one report, using https://playwright.dev/docs/test-sharding#merge-reports-cli

```sh
curl --location --request POST 'http://localhost:3001/api/report/generate' \
--header 'Content-Type: application/json' \
--header 'Authorization: <api-token>' \
--data '{
    "project": "regression",
    "resultsIds": [
        "b1d29907-7efa-48e8-a8d1-db49cf5c2998",
        "a7beb04b-f190-4fbb-bebd-58b2c776e6c3",
    ]
}'
```

Response example:

```json
{
  "project": "regression",
  "reportId": "8e9af87d-1d10-4729-aefd-3e92ee64d06c",
  "reportUrl": "/api/serve/8e9af87d-1d10-4729-aefd-3e92ee64d06c/index.html"
}
```

### `/api/result/list` (GET):

Returns list of currently existing results (raw blobs .zip files) on server:

```sh
curl --location 'http://localhost:3001/api/result/list'
```

Response will contain array of results:

```json
{
  "results": [
    {
      "resultID": "a7beb04b-f190-4fbb-bebd-58b2c776e6c3",
      "createdAt": "2024-05-06T16:40:33.021Z",
      "size": "1.93 MB",
      "project": "regression",
      "testRunName": "regression-run-v1.10",
      "reporter": "okhotemskyi"
    }
  ],
  "total": 1
}
```

### `/api/result/upload` (PUT):

Accepts .zip archive - output of blob report, details - https://playwright.dev/docs/test-reporters#blob-reporter:

```sh
curl --location --request PUT 'http://localhost:3001/api/result/upload' \
--header 'Authorization: <api-token>' \
--form 'file=@"/path/to/file"'
```

Notice, that you can pass any custom keys with string values as form keys:

```sh
curl --location --request PUT 'http://localhost:3001/api/result/upload' \
--header 'Authorization: <api-token>' \
--form 'file=@"/path/to/file"' \
--form 'project="desktop"' \
--form 'reporter="okhotemskyi"' \
--form 'appVersion="1.2.2"'
```

If you have **s3 storage** configured, you can pass `fileContentLength` query parameter to use **presigned URL** for **direct upload**:

```sh
curl --location --request PUT 'http://localhost:3001/api/result/upload?fileContentLength=10738538' \
--header 'Authorization: <api-token>' \
--form 'file=@"/path/to/file"' \
--form 'project="desktop"' \
--form 'reporter="okhotemskyi"' \
--form 'appVersion="1.2.2"'
```

Response example:

```json
{
  "message": "Success",
  "data": {
    "resultID": "e7ed1c2a-6b24-421a-abb6-095fb62f9957",
    "createdAt": "2024-07-07T13:35:57.382Z",
    "project": "desktop",
    "reporter": "okhotemskyi",
    "appVersion": "1.2.2",
    "size": "1.2 MB",
    "generatedReport": {
      "reportId": "e7ed1c2a-6b24-421a-abb6-095fb62f9957",
      "reportUrl": "/api/serve/8e9af87d-1d10-4729-aefd-3e92ee64d06c/index.html",
      "metadata": { "title": "title", "project": "desktop" }
    }
  },
  "status": 201
}
```

Auto-generation reports once all shards completed is supported, you need to pass `testRun`, `shardCurrent`, `shardTotal` and `triggerReportGeneration=true` as form keys, example:

```sh
curl --location --request PUT 'http://localhost:3001/api/result/upload' \
--header 'Authorization: <api-token>' \
--form 'file=@"/path/to/file"' \
--form 'shardCurrent="1"' \
--form 'shardTotal="4"' \
--form 'triggerReportGeneration="true"'
```

Server will automatically trigger report generation when all shards for this testRun will report their blob file

### `/api/info` (GET)

Returns server stats:

```sh
curl --location 'http://localhost:3001/api/info' \
--header 'Authorization: <api-token>' \
```

Response example:

```json
{
  "dataFolderSizeinMB": "0.00 MB",
  "numOfResults": 0,
  "resultsFolderSizeinMB": "0.00 MB",
  "numOfReports": 0,
  "reportsFolderSizeinMB": "0.00 MB"
}
```

### `/api/ping` (GET)

Returns server stats:

```sh
curl --location 'http://localhost:3001/api/ping'
```

Response example:

```
pong
```

## Authorization

Optional authorization can be enabled, by setting `API_TOKEN` environment variable on application start. This token will be required to be passed for every request as header:
`Authorization: YOUR_TOKEN`

The web ui will require such token to login as well as report serving route.

For UI it is also recommended to specify `AUTH_SECRET` as jwt token is generated for client side and by default it uses random uuid.

```bash
# You can generate a new secret on the command line with:
pnpm dlx auth secret
# OR
openssl rand -base64 32
```

If you do not set a token the application will work without authorization, however jwt token will still be utilized.

## Test Quarantine

The Test Quarantine feature helps you manage flaky tests by tracking test stability over time and allowing you to temporarily isolate unreliable tests from your test runs. This feature is particularly useful for large test suites where intermittent failures can block CI/CD pipelines.

### Why Use Test Quarantine?

Flaky tests are tests that produce inconsistent results - passing sometimes and failing other times, without any changes to the code. They cause several problems:

- **Wasted Time**: You investigate failures that turn out to be false positives
- **Slower CI/CD**: You (and especially your colleagues) lose trust in test results and stop caring about test failures
- **Hidden Real Issues**: Genuine bugs may be ignored behind retries among the noise of flaky test failures
- **Resource Drain**: Rerunning tests consumes compute resources and time

The Quarantine system addresses these issues by:
1. **Tracking Flakiness**: Calculating a flakiness score based on test result history
2. **Visualization**: Test table is showing test health, score and current statuses
3. **Manual Quarantine**: Allowing you to isolate problematic tests with a reason
4. **Automatic Quarantine** (optional): Automatically quarantining tests that exceed a threshold if you are sure in the correctness of your metric tresholds. The method of calculation is generic, each project is unique with various stages and update frequency, so you can tune it as you need and enable automatic quarantine later or just handle with web interface.
5. **Skip Execution**: Quarantined tests can be automatically skipped in subsequent runs

### How Flakiness is Calculated

The flakiness score represents how unstable a test is, based on its execution history. The app checks how often the status was changed:

- **Score 0%**: Test always passes or always fails (100% consistent)
- **Higher Score**: More frequent status changes between passes and failures
- **Score 100%**: Maximum instability (status changes on every run)

The calculation considers:
1. Only runs within the configured **Evaluation Window** (default: 30 days)
2. Tests must have at least **Minimum Runs** (default: 1) to be evaluated
3. "Flaky" outcomes from Playwright are treated as failures

### Flakiness Tiers

Tests are categorized into three tiers based on their flakiness score:

| Tier     | Flakiness Range       | Badge Color | Description                                  |
|----------|-----------------------|-------------|----------------------------------------------|
| Stable   | 0% to Warning         | Green       | Tests with consistent results                |
| Flaky    | Warning to Quarantine | Yellow      | Tests showing some instability               |
| Critical | Quarantine+           | Red         | Highly unstable tests, should be quarantined |

### Skipping Quarantined Tests

To automatically skip quarantined tests during test execution: 

- enable feature in the app
- configure the reporter and use the extended `test` fixture from the "@shelex/playwright-reporter"

## Storage Options

The Playwright Reports Server uses local file system storage by default. However, it can be configured to use S3-compatible object storage for better scalability and persistence. Here are the details for both options:

### Local File System Storage

By default, all data is stored in the `data` folder.

- `pnpm run start` - `/apps/backend/data/`
- `pnpm run dev` - `/apps/backend/data/`
- Docker image - `/app/data/`

This includes both raw test results and generated reports. When using local file system:

- Ensure the application has write permissions to the `/data/` directory.
- For data persistence when using Docker image, mount a volume or host directory to `/app/data/`.
- If you have own Docker setup, please note that by default it will be saved to `/apps/backend/data/` folder, as the executable will be in build resources.

Example Docker run command with a mounted volume:

```sh
docker run -v /path/on/host:/app/data -p 3000:3000 playwright-reports-server
```

### S3-Compatible Object Storage

For improved scalability and easier management of persistent storage, you can configure the application to use S3-compatible object storage. This includes services like AWS S3, MinIO, DigitalOcean Spaces, and others.

To enable S3 storage:

1. Set the following environment variables:

   ```
   DATA_STORAGE=s3
   S3_ENDPOINT=<your-s3-endpoint> # just a hostname, like my.minio.com
   S3_REGION=<your-s3-region>
   S3_ACCESS_KEY=<your-access-key>
   S3_SECRET_KEY=<your-secret-key>
   S3_BUCKET=<your-s3-bucket-name> # optional, by default "playwright-reports-server"
   S3_PORT=9000 # optional, specify if you have self-hosted instance exposed via custom port
   S3_BATCH_SIZE=10 # optional, a number of concurrent requests to s3
   S3_MULTIPART_CHUNK_SIZE_MB=25 # optional, chunk size for multipart upload in MB
   ```

2. Ensure your S3 provided credentials have read and write access to the bucket.

When S3 storage is configured, all operations that would normally interact with the local file system will instead use the S3 bucket. This includes storing raw test results, generating reports, and serving report files.

Note: When switching from local storage to S3 or vice versa, existing data will not be automatically migrated. Ensure you have a backup of your data before changing storage configurations.

3. Google cloud storage specifics

As GCP has quite limited S3 API support, you need to ensure that:

- a bucket with the name `playwright-reports-server` is created or just specify your own bucket name via `S3_BUCKET` environment variable.
- you set the `S3_REGION` env variable to `auto`, as it does not support custom regions.
- error message in logs `S3Error: The specified location constraint is not valid.` could mean that you do not have a bucket or not specified the `S3_REGION` env variable.

### Expiration task

You can specify how much days to keep your report or result files in order to cleanup old records.  
Feature is configurable via environment variables.  
If days variable is not specified - the task registration will be skipped.

| Name                          | Description                       | Default                              |
|-------------------------------|-----------------------------------|--------------------------------------|
| `RESULT_EXPIRE_DAYS`          | How much days to keep results     |                                      |
| `RESULT_EXPIRE_CRON_SCHEDULE` | Cron schedule for results cleanup | `"33 3 * * *"` (at 03:33, every day) |
| `REPORT_EXPIRE_DAYS`          | How much days to keep reports     |                                      |
| `REPORT_EXPIRE_CRON_SCHEDULE` | Cron schedule for reports cleanup | `"44 4 * * *"` (at 04:44, every day) |

if you want more granular expiration time than day - the decimal values are supported, so for example 6 hours will be `6/24 = 0.25`.

## Docker Usage

Image is available via github public registry.

To run the server using Docker:

```sh
docker run -p 3000:3000 -v /path/on/host:/app/data ghcr.io/shelex/playwright-reports-server:latest
```

For external S3 storage, pass the necessary environment variables:

```sh
docker run -p 3000:3000 \
  -e STORAGE_TYPE=s3 \
  -e S3_ENDPOINT="<your-endpoint>" \
  -e S3_REGION="<your-region>" \
  -e S3_BUCKET="<your-bucket>" \
  -e S3_ACCESS_KEY_ID="<your-access-key>" \
  -e S3_SECRET_ACCESS_KEY="<your-secret-key>" \
  ghcr.io/shelex/playwright-reports-server:latest
```

## UI White-label

There is an option to customize application UI logo, favicon, title and header links list.

### API

Patch endpoint that accepts form-data request body to update the configuration:

```sh
curl --location --request PATCH 'localhost:3001/api/config' \
  --header 'Authorization: YOUR_TOKEN' \
  --form 'title="YOUR_TITLE"' \
  --form 'logo=@"PATH_TO_YOUR_LOGO"' \
  --form 'favicon=@"PATH_TO_YOUR_FAVICON"' \
  --form 'headerLinks="{\"someLink\": \"https://example.com\", \"github\": \"https://github.com/Shelex\"}"'
```

### Config File

- is saved to `/data/` folder, so it should be persisted to keep your changes be passed to the next build
- example:
  ```json
  {
    "title": "Custom title",
    "headerLinks": {
      "someLink": "https://example.com",
      "github": "https://github.com/YourName"
    },
    "logoPath": "/logo.svg",
    "faviconPath": "/favicon.ico"
  }
  ```
- as an alternative you can manually prepare images and a `config.json` in `/data/` folder

### Header links

- is an object, where key is a name of the link and value is the external url
- currently we have logo for: `telegram`, `github`, `discord`, `bitbucket`, `slack`
- we will use specific logo for a link name if we have it, otherwise there will be a generic link icon with a link name
