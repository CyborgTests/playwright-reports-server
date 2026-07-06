# Deployment

The shipping image is `ghcr.io/cyborgtests/playwright-reports-server:latest`. Node 24 Alpine, runs as `appuser`, exposes port `3001`, healthchecks `GET /api/ping`, data volume at `/app/data/`. Nothing fancy.

If you don't already have an opinion about how to host this, there are couple of requirements:
- if you want to merge reports in app - consider investing into more storage space, as it basically would need to maintain all blobs + produce a report at a time. Failed reports usually require a lot more than 1kb html for success run and could be up to 300-500Mb for decent set of tests (up to 100), or even more if something went really wrong.
- for the storage there are multiple options (local fs/s3/azure/other s3-compatible object storages)
- state lives in local SQLite. There's a replication to storage, but for fs you would need to share it between instances via volume/attached storage.
- it could work on a CPU-limited small 0.5GB RAM instance and that could be used as a starting point. Small "nuance" here is that node itself + dependencies eat up to ~200Mb.

## Quick starts

**Local filesystem, with a mounted volume:**

```bash
docker run -d --name pw-reports \
  -p 3001:3001 \
  -v /path/on/host:/app/data \
  ghcr.io/cyborgtests/playwright-reports-server:latest
```

**S3 storage:**

```bash
docker run -d --name pw-reports \
  -p 3001:3001 \
  -e API_TOKEN=<long-random-string> \
  -e AUTH_SECRET=<another-long-random-string> \
  -e DATA_STORAGE=s3 \
  -e S3_ENDPOINT=s3.amazonaws.com \
  -e S3_REGION=us-east-1 \
  -e S3_ACCESS_KEY=<key> \
  -e S3_SECRET_KEY=<secret> \
  -e S3_BUCKET=my-pw-reports \
  ghcr.io/cyborgtests/playwright-reports-server:latest
```

Litestream replicates the metadata DB to the same bucket automatically.

**Azure Blob storage.** 
Litestream replicates the metadata DB to your Azure container, same shape as the S3 path:

```bash
docker run -d --name pw-reports \
  -p 3001:3001 \
  -e API_TOKEN=... \
  -e AUTH_SECRET=... \
  -e DATA_STORAGE=azure \
  -e AZURE_ACCOUNT_NAME=... \
  -e AZURE_ACCOUNT_KEY=... \
  -e AZURE_CONTAINER=playwright-reports-server \
  ghcr.io/cyborgtests/playwright-reports-server:latest
```

## Health and logs

```bash
docker logs -f pw-reports
curl http://localhost:3001/api/ping   # pong
```

The healthcheck is built into the image.

## Updating

```bash
docker pull ghcr.io/cyborgtests/playwright-reports-server:latest
docker rm -f pw-reports
# re-run with the same flags
```

## Backups

| Backend | What to back up |
|---------|------------------|
| `fs` | The whole `data/` directory (the mounted host path) |
| `s3` | The bucket. Litestream keeps the metadata DB in there continuously. |
| `azure` | The container. Litestream keeps the metadata DB in it continuously. |

> The first backup test is the one before you need it. The second backup test is done *after* you need it, and usually almost always fails, especially when the first test wasn't done. Do the first test, ensure your data is shared across instances.

## See also

- [Storage](./Storage)
- [Configuration](./Configuration)
