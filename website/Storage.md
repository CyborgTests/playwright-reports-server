# Storage

Pick one of three at deploy time. The server doesn't migrate between them for you, so this is a one-shot choice.

| You want | `DATA_STORAGE` | Notes |
|----------|----------------|-------|
| Local dev or single host with a mounted volume | `fs` (default) | The data folder is the source of truth. Back it up. |
| Reliable persistence, disposable container | `s3` | SQLite metadata replicates to S3 by Litestream. |
| Azure-native deployment | `azure` | SQLite metadata replicates to Azure Blob by Litestream. |

## What lives where

Reports and raw results are blobs. The SQLite metadata DB (`metadata.db`) is the source of truth for everything else: report listings, test history, flakiness, tags, LLM analyses, feedback, GitHub Sync state, white-label. Loose the DB and there would be a folder of orphan files.

In Docker the data folder is `/app/data/`. Outside Docker it's `apps/backend/data/`.

---

## Litestream and SQLite replication

[Litestream](https://litestream.io) continuously replicates `metadata.db` to durable object storage. With it, you can run a stateless container and survive instance loss. Also "replication" sounds kinda cool.  

It runs when `DATA_STORAGE=s3` or `DATA_STORAGE=azure`.

What this means per backend:

- **S3**: the container is disposable. Launch a fresh one with the same S3 credentials, and the metadata is back.
- **Azure**: same story. Nothing extra to configure.
- **fs**: nothing to replicate to. Mount a volume in Docker, or back up `/app/data/metadata.db` somewhere safe.

---

## S3

```
DATA_STORAGE=s3
S3_ENDPOINT=<hostname, no scheme>    # e.g. s3.amazonaws.com or my.minio.com
S3_REGION=<region>                   # 'auto' for GCS, see below
S3_ACCESS_KEY=<key>
S3_SECRET_KEY=<secret>
S3_BUCKET=playwright-reports-server  # default
```

Tested against AWS S3, MinIO and Google Cloud Storage (with some caveats).

### Google Cloud Storage gotcha

GCS pretends to be S3 until it suddenly doesn't. Two things you have to do:

- Pre-create the bucket. The server won't.
- Set `S3_REGION=auto`. GCS won't accept arbitrary regions over the S3 API.

If you see `S3Error: The specified location constraint is not valid.`, it's almost always one of those.

### Tuning

The optional knobs you probably don't need:

- `S3_MULTIPART_CHUNK_SIZE_MB` (default 25). Bigger chunks mean fewer S3 API calls but more memory buffered per upload.
- `S3_BATCH_SIZE` (default 10). Concurrent requests during expiration cleanup. Above 50 invites the provider to throttle you.
- Presigned upload URLs are valid for 30 minutes. Plenty, unless your CI is having a bad day.

---

## Azure Blob

```
DATA_STORAGE=azure
AZURE_ACCOUNT_NAME=<account>
AZURE_ACCOUNT_KEY=<key>
AZURE_CONTAINER=playwright-reports-server   # default; created on first start if missing
```

Account credentials must allow creating containers if you let the server create it. Blob paths use forward slashes regardless of host OS, matching the S3 backend.

---

## Local filesystem

In Docker, mount a host directory at `/app/data/`:

```bash
docker run -v /path/on/host:/app/data -p 3001:3001 \
  ghcr.io/cyborgtests/playwright-reports-server:latest
```

Outside Docker, data is in `apps/backend/data/`. Back it up if you care about it. If you don't - that's also a valid lifestyle choice.

---

## Presigned uploads (S3 only)

When `DATA_STORAGE=s3` and `fileContentLength` is passed to upload endpoint (e.g. from reporter package), the server returns a presigned URL valid for 30 minutes, so the client can upload the blob directly to S3.

On `fs` and `azure`, the parameter is silently ignored and the request body is used as normal.

---

## Migrating between backends

There's no built-in path. If you really need to switch:

1. Stop the server. (Yes, downtime. Sorry.)
2. Copy `data/results/*.zip` and `data/reports/*` to the new backend, preserving paths.
3. Copy `data/metadata.db` to the new local volume. On S3, let Litestream pick it up after one start.
4. Switch `DATA_STORAGE` and restart.

The metadata DB references storage keys by relative path, so the layout has to match exactly. If migrating sounds like more work than starting fresh on the new backend - you're probably right.

---

## See also

- [Configuration](./Configuration): every env var
- [Deployment](./Deployment): Docker basics
