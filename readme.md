# Playwright Reports Server

The Playwright Reports Server provides APIs for managing and generating reports based on Playwright test results. It allows you to:

- Store HTML reports and easily view them without downloading locally
- Merge results into one report from sharded runs together (see [Playwright Sharding](https://playwright.dev/docs/test-sharding))
- Store raw results, and aggregate them together into one report
- Check web ui for report trends and test history
- Basic api token authorization for backend and web ui, reports are secured as well

## Demo

Check out the live demo: [familiar-alyss-alex-hot-6926ec9c.koyeb.app](https://familiar-alyss-alex-hot-6926ec9c.koyeb.app/)

## Table of Contents

- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Running the Server](#running-the-server)
- [API Routes](#api-routes)
- [Authorization](#authorization)
- [Storage Options](#storage-options)
  - [Local File System](#local-file-system-storage)
  - [S3-Compatible](#s3-compatible-object-storage)
- [Docker Usage](#docker-usage)

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm (v9 or higher)

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

2. The application will be accessible at `http://localhost:3000`.
   All data will be stored at `/data/` folder. You can backup it, to keep your data safe.

## API Routes

## `/api/report/list` (GET):

Returns list of generated reports and corresponding url on server:

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
[
  {
    "reportID": "8e9af87d-1d10-4729-aefd-3e92ee64d06c",
    "createdAt": "2024-05-06T16:52:45.017Z",
    "reportUrl": "/data/reports/8e9af87d-1d10-4729-aefd-3e92ee64d06c/index.html"
  },
  {
    "reportID": "8fe427ed-783c-4fb9-aacc-ba6fbc5f5667",
    "createdAt": "2024-05-06T16:59:38.814Z",
    "reportUrl": "/data/reports/8fe427ed-783c-4fb9-aacc-ba6fbc5f5667/index.html"
  }
]
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

## `/api/report/generate` (POST):

Generates report from provided resultsIds, merges results together into one report, using https://playwright.dev/docs/test-sharding#merge-reports-cli

```sh
curl --location 'http://localhost:3000/api/report/generate' \
--header 'Content-Type: application/json' \
--header 'Authorization: <api-token>' \
--data '{
    "resultsIds": [
        "b1d29907-7efa-48e8-a8d1-db49cf5c2998",
        "a7beb04b-f190-4fbb-bebd-58b2c776e6c3",
    ]
}'
```

Response example:

```json
{
  "reportId": "8e9af87d-1d10-4729-aefd-3e92ee64d06c",
  "reportUrl": "/data/reports/8e9af87d-1d10-4729-aefd-3e92ee64d06c/index.html"
}
```

## `/api/result/list` (GET):

Returns list of currently existing results (raw blobs .zip files) on server:

```sh
curl --location 'http://localhost:3000/api/result/list'
```

Response will contain array of results:

```json
[
  {
    "resultID": "a7beb04b-f190-4fbb-bebd-58b2c776e6c3",
    "createdAt": "2024-05-06T16:40:33.021Z",
    "testRunName": "regression-run-v1.10",
    "reporter": "okhotemskyi"
  }
]
```

## `/api/result/upload` (POST):

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

Response example:

```json
{
  "message": "Success",
  "data": {
    "resultID": "e7ed1c2a-6b24-421a-abb6-095fb62f9957",
    "createdAt": "2024-07-07T13:35:57.382Z",
    "project": "desktop",
    "reporter": "okhotemskyi",
    "appVersion": "1.2.2"
  },
  "status": 201
}
```

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

If you do not set a token the application will work without authorization.

## Storage Options

The Playwright Reports Server uses local file system storage by default. However, it can be configured to use S3-compatible object storage for better scalability and persistence. Here are the details for both options:

### Local File System Storage

By default, all data is stored in the `/data/` (`/app/data/` in the container). This includes both raw test results and generated reports. When using local storage:

- Ensure the application has write permissions to the `/data/` directory.
- For data persistence when using Docker, mount a volume or host directory to `/app/data/`.

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
   ```

2. Ensure your S3 provided credentials have read and write access to the bucket.

When S3 storage is configured, all operations that would normally interact with the local file system will instead use the S3 bucket. This includes storing raw test results, generating reports, and serving report files.

Note: When switching from local storage to S3 or vice versa, existing data will not be automatically migrated. Ensure you have a backup of your data before changing storage configurations.

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
