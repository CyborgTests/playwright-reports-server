# Playwright Reports Server

The Playwright Reports Server provides APIs for managing and generating reports based on Playwright test results. It allows you to:

- Store HTML reports and easily view them without downloading locally
- Merge results into one report from sharded runs together (see [Playwright Sharding](https://playwright.dev/docs/test-sharding))
- Store raw results, and aggregate them together into one report
- Check web ui for report trends and test history
- Basic api token authorization for backend and web ui, reports are secured as well
- Create Jira tickets directly with attachments

## Demo

[Check out the live demo!](https://demo-playwright-reports-server.koyeb.app)

## Table of Contents

- [Playwright Reports Server](#playwright-reports-server)
  - [Demo](#demo)
  - [Table of Contents](#table-of-contents)
  - [Getting Started](#getting-started)
    - [Prerequisites](#prerequisites)
    - [Installation](#installation)
    - [Running the Server](#running-the-server)
    - [Configuration options](#configuration-options)
  - [API Routes](#api-routes)
  - [`/api/report/list` (GET):](#apireportlist-get)
  - [`/api/report/delete` (DELETE):](#apireportdelete-delete)
  - [`/api/result/delete` (DELETE):](#apiresultdelete-delete)
  - [`/api/report/generate` (POST):](#apireportgenerate-post)
  - [`/api/result/list` (GET):](#apiresultlist-get)
  - [`/api/result/upload` (PUT):](#apiresultupload-put)
  - [`/api/info` (GET)](#apiinfo-get)
  - [`/api/ping` (GET)](#apiping-get)
  - [Authorization](#authorization)
  - [Jira Integration](#jira-integration)
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

- Node.js (v20 or higher)
- npm (v10 or higher)

### Installation

1. Clone this repository:

   ```
   git clone https://github.com/CyborgTests/playwright-reports-server.git
   cd playwright-reports-server
   ```

2. Install dependencies:
   ```
   npm install
   ```

### Running the Server

1. Build and start the server:

   ```
   npm run build && npm run start
   ```

   The `start` script uses a small Node.js utility to copy the build assets
   before launching the server, so it works on Windows without requiring Unix
   commands.

2. The application will be accessible at `http://localhost:3000`.
   All data will be stored at `/data/` folder. You can backup it, to keep your data safe.

### Configuration options

The app is configured with environment variables, so it could be specified as `.env` file as well, however there are no mandatory options.

| Name                        | Description                                                                                                       | Default |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------- |
| `API_TOKEN`                 | API token for [Authorization](#authorization)                                                                     |         |
| `AUTH_SECRET`               | Secret to encrypt JWT                                                                                             |         |
| `UI_AUTH_EXPIRE_HOURS`      | Duration of auth session                                                                                          | `"2"`   |
| `USE_SERVER_CACHE`          | Use sqlite3 for storing metadata for results and reports, config caching - improves UX, reduces impact on a s3/fs | `false` |
| `SERVER_CACHE_REFRESH_CRON` |                                                                                                                   |         |
| `DATA_STORAGE`              | Where to store data, check for additional configuration [Storage Options](#storage-options)                       | `"fs"`  |
| `JIRA_BASE_URL`             | Jira instance URL (e.g., https://your-domain.atlassian.net)                                                       |         |
| `JIRA_EMAIL`                | Jira account email address                                                                                        |         |
| `JIRA_API_TOKEN`            | Jira API token for authentication                                                                                 |         |
| `JIRA_PROJECT_KEY`          | Default Jira project key for ticket creation                                                                      |         |

## API Routes

## `/api/report/list` (GET):

Returns list of generated reports and corresponding url on server:

```sh
curl --location --request GET 'http://localhost:3000/api/report/list' \
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
      "reportUrl": "/api/serve/regression/8e9af87d-1d10-4729-aefd-3e92ee64d06c/index.html"
      //...parsed info
    },
    {
      "reportID": "8fe427ed-783c-4fb9-aacc-ba6fbc5f5667",
      "createdAt": "2024-05-06T16:59:38.814Z",
      "project": "smoke",
      "size": "1.53 MB",
      "reportUrl": "/api/serve/smoke/8fe427ed-783c-4fb9-aacc-ba6fbc5f5667/index.html"
      //...parsed info
    }
  ],
  "total": 2
}
```

## `/api/report/delete` (DELETE):

Deletes report folder

```sh
curl --location --request DELETE 'http://localhost:3000/api/report/delete' \
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

## `/api/result/delete` (DELETE):

Delete result by ids

```sh
curl --location --request DELETE 'http://localhost:3000/api/result/delete' \
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

## `/api/report/generate` (POST):

Generates report from provided resultsIds, merges results together into one report, using https://playwright.dev/docs/test-sharding#merge-reports-cli

```sh
curl --location --request POST 'http://localhost:3000/api/report/generate' \
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
  "reportUrl": "/api/serve/regression/8e9af87d-1d10-4729-aefd-3e92ee64d06c/index.html"
}
```

## `/api/result/list` (GET):

Returns list of currently existing results (raw blobs .zip files) on server:

```sh
curl --location 'http://localhost:3000/api/result/list'
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

## `/api/result/upload` (PUT):

Accepts .zip archive - output of blob report, details - https://playwright.dev/docs/test-reporters#blob-reporter:

```sh
curl --location --request PUT 'http://localhost:3000/api/result/upload' \
--header 'Authorization: <api-token>' \
--form 'file=@"/path/to/file"'
```

Notice, that you can pass any custom keys with string values as form keys:

```sh
curl --location --request PUT 'http://localhost:3000/api/result/upload' \
--header 'Authorization: <api-token>' \
--form 'file=@"/path/to/file"' \
--form 'project="desktop"' \
--form 'reporter="okhotemskyi"' \
--form 'appVersion="1.2.2"'
```

If you have **s3 storage** configured, you can pass `fileContentLength` query parameter to use **presigned URL** for **direct upload**:

```sh
curl --location --request PUT 'http://localhost:3000/api/result/upload?fileContentLength=10738538' \
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
      "reportUrl": "/api/serve/desktop/8e9af87d-1d10-4729-aefd-3e92ee64d06c/index.html",
      "metadata": { "title": "title", "project": "desktop" }
    }
  },
  "status": 201
}
```

Auto-generation reports once all shards completed is supported, you need to pass `testRun`, `shardCurrent`, `shardTotal` and `triggerReportGeneration=true` as form keys, example:

```sh
curl --location --request PUT 'http://localhost:3000/api/result/upload' \
--header 'Authorization: <api-token>' \
--form 'file=@"/path/to/file"' \
--form 'shardCurrent="1"' \
--form 'shardTotal="4"' \
--form 'triggerReportGeneration="true"'
```

Server will automatically trigger report generation when all shards for this testRun will report their blob file

## `/api/info` (GET)

Returns server stats:

```sh
curl --location 'http://localhost:3000/api/info' \
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

## `/api/ping` (GET)

Returns server stats:

```sh
curl --location 'http://localhost:3000/api/ping'
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
npm exec auth secret
# OR
openssl rand -base64 32
```

If you do not set a token the application will work without authorization, however jwt token will still be utilized.

## Jira Integration

The Playwright Reports Server includes built-in Jira integration that allows you to create Jira tickets directly from tests. This feature automatically captures test failure details, screenshots, videos, and other attachments.

### Configuration

To enable Jira integration, set the following environment variables:

```bash
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token
JIRA_PROJECT_KEY=YOUR_PROJECT_KEY (optional)
```

### Usage

1. **From Test Reports**: Navigate to any test in the web UI and click "Create Jira Ticket"
2. **Customize Ticket**: Modify the summary, description, issue type, and project key as needed
3. **Submit**: The ticket will be created in Jira with all test information and attachments

## Storage Options

The Playwright Reports Server uses local file system storage by default. However, it can be configured to use S3-compatible object storage for better scalability and persistence. Here are the details for both options:

### Local File System Storage

By default, all data is stored in the `data` folder.

- `npm run start` - `/.next/standalone/data/`
- `npm run dev` - `/data/`
- Docker image - `/app/data/`

This includes both raw test results and generated reports. When using local file system:

- Ensure the application has write permissions to the `/data/` directory.
- For data persistence when using Docker image, mount a volume or host directory to `/app/data/`.
- If you have own Docker setup, please note that by default it will be saved to `.next/standalone/data/` folder, as the executable will be in build resources.

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
| ----------------------------- | --------------------------------- | ------------------------------------ |
| `RESULT_EXPIRE_DAYS`          | How much days to keep results     |                                      |
| `RESULT_EXPIRE_CRON_SCHEDULE` | Cron schedule for results cleanup | `"33 3 * * *"` (at 03:33, every day) |
| `REPORT_EXPIRE_DAYS`          | How much days to keep reports     |                                      |
| `REPORT_EXPIRE_CRON_SCHEDULE` | Cron schedule for reports cleanup | `"44 4 * * *"` (at 04:44, every day) |

if you want more granular expiration time than day - the decimal values are supported, so for example 6 hours will be `6/24 = 0.25`.

## Docker Usage

Image is available via github public registry.

To run the server using Docker:

```sh
docker run -p 3000:3000 -v /path/on/host:/app/data ghcr.io/cyborgtests/playwright-reports-server:latest
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
  ghcr.io/cyborgtests/playwright-reports-server:latest
```

## UI White-label

There is an option to customize application UI logo, favicon, title and header links list.

### API

Patch endpoint that accepts form-data request body to update the configuration:

```sh
curl --location --request PATCH 'localhost:3000/api/config' \
  --header 'Authorization: YOUR_TOKEN' \
  --form 'title="YOUR_TITLE"' \
  --form 'logo=@"PATH_TO_YOUR_LOGO"' \
  --form 'favicon=@"PATH_TO_YOUR_FAVICON"' \
  --form 'headerLinks="{\"someLink\": \"https://example.com\", \"github\": \"https://github.com/CyborgTests\"}"'
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
