# Playwright Reports Server

The Playwright Reports Server provides APIs for managing and generating reports based on Playwright test results. It allows to:

- Store HTML reports and easily view them without downloading locally
- Merge results into one report from sharded runs together (https://playwright.dev/docs/test-sharding)
- Store raw results, and agregate them together into one report

## How to run?

Clone this repo and run:

```
npm run build && npm run start
```

All data will be stored at `/public/data/` folder. You can backup it, to keep your data safe.

Application will be accessible at `localhost:3000`

## API Routes

## `/api/report/list` (GET):

Returns list of generated reports (can be viewed by Url) on server:

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

## Authorization
Optional authorization can be enabled, by setting `API_TOKEN` environment variable on application start. This token will be required to be passed for every request.

If you do not set a token the system will work without authorization

```
API_TOKEN='my-api-token'
```
