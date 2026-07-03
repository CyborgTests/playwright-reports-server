# Configuration

Every env var the server reads. None are required, so the defaults will get you a running instance. Set what you need; ignore what you don't.

## General

| Name | What it controls | Default |
|------|------------------|---------|
| `PORT` | HTTP port | `3001` |
| `HOST` | Bind address | `0.0.0.0` |
| `API_TOKEN` | Turns auth on (and authorizes first-run setup). See [Authorization](#authorization) and the [Authentication](./Authentication) page. | unset (open) |
| `AUTH_SECRET` | Encrypts stored secrets (e.g. GitHub sync tokens). | dev fallback |
| `UI_AUTH_EXPIRE_HOURS` | Idle session lifetime, in hours (sliding; capped at 30 days absolute) | `12` |
| `COOKIE_SECURE` | `Secure` flag on auth cookies. Set `false` only for plain-HTTP/Localhost. | `true` |
| `ROOT_USERNAME` | Break-glass admin username (recovery only; needs `ROOT_PASSWORD`) | unset |
| `ROOT_PASSWORD` | Break-glass admin password (recovery only; needs `ROOT_USERNAME`) | unset |
| `DATA_STORAGE` | `fs` / `s3` / `azure`. See [Storage](./Storage). | `fs` |
| `GITHUB_TOKEN` | Fallback token for [GitHub Sync](./GitHub-Sync) configs without one of their own | unset |

## Authorization

Set `API_TOKEN` to any non-empty value and auth turns on: the UI requires login, the API requires a session cookie or an [API key](./Authentication#api-keys). Leave it unset and the server runs in **open mode** - anyone with the URL gets full access, which may or may not be what you want. `API_TOKEN` is also the secret that authorizes [first-run setup](./Authentication#first-run-setup) of the initial admin.
More details - [Authentication](./Authentication) page.

Set `AUTH_SECRET` to a long random value so encrypted secrets (e.g. GitHub sync tokens) survive restarts. Without it the server falls back to a fixed dev key, which is unsafe for production. Rotating it invalidates anything it encrypted.

```bash
# generate one
openssl rand -base64 32
```

## S3

Set `DATA_STORAGE=s3` plus:

| Name | What it controls | Default |
|------|------------------|---------|
| `S3_ENDPOINT` | Hostname only, no scheme | |
| `S3_REGION` | Region (`auto` for Google Cloud) | |
| `S3_ACCESS_KEY` | Access key | |
| `S3_SECRET_KEY` | Secret key | |
| `S3_BUCKET` | Bucket name | `playwright-reports-server` |
| `S3_PORT` | Custom port (self-hosted) | |
| `S3_USE_SSL` | Use HTTPS to the S3 endpoint (`false` for local MinIO over plain HTTP) | `true` |
| `S3_BATCH_SIZE` | Concurrent requests during cleanup | `10` |
| `S3_MULTIPART_CHUNK_SIZE_MB` | Multipart upload chunk size, MB | `25` |

When you pick S3, Litestream replicates the SQLite metadata DB to the same bucket automatically. See [Storage -> S3](./Storage#s3) for the GCS quirks if you went the Google route.

## Azure

Set `DATA_STORAGE=azure` plus:

| Name | What it controls | Default |
|------|------------------|---------|
| `AZURE_ACCOUNT_NAME` | Storage account | |
| `AZURE_ACCOUNT_KEY` | Account key | |
| `AZURE_CONTAINER` | Container name (created if missing) | `playwright-reports-server` |
| `AZURE_BATCH_SIZE` | Concurrent requests during cleanup | `10` |

Litestream replicates the SQLite metadata DB to the same container automatically. See [Storage -> Litestream](./Storage#litestream-and-sqlite-replication).


## Checking what's actually set

The Settings page shows resolved environment. Useful after editing `.env` and forgetting to restart, which everyone has done at least once.

## See also

- [Storage](./Storage)
- [GitHub Sync](./GitHub-Sync)
- [LLM analysis](./LLM-Analysis)
- [Deployment](./Deployment)
