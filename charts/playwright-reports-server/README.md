# playwright-reports-server

![Version: 0.1.0](https://img.shields.io/badge/Version-0.1.0-informational?style=flat-square) ![Type: application](https://img.shields.io/badge/Type-application-informational?style=flat-square) ![AppVersion: 6.1.1](https://img.shields.io/badge/AppVersion-6.1.1-informational?style=flat-square)

Self-hosted home for Playwright test results (reports, history, flakiness, analytics)

## Install

```bash
helm install reports oci://ghcr.io/cyborgtests/charts/playwright-reports-server \
  --set auth.existingSecret=reports-auth
```

The Secret holds `API_TOKEN` (turns authentication on, and is asked for once to create the
first admin) and `AUTH_SECRET` (encrypts stored secrets such as SSO client secrets):

```bash
kubectl create secret generic reports-auth \
  --from-literal=API_TOKEN="$(openssl rand -hex 32)" \
  --from-literal=AUTH_SECRET="$(openssl rand -base64 32)"
```

## Storage

- `fs` (default): reports and the SQLite metadata live on a PersistentVolumeClaim created
  from the StatefulSet `volumeClaimTemplates` (or `storage.fs.persistence.existingClaim`).
- `s3`: reports go to an S3-compatible bucket (pre-created); Litestream replicates the
  SQLite metadata to the same bucket, so the pod keeps only a scratch volume and can be
  recreated at any time. Credentials come from an existing Secret:

```yaml
storage:
  type: s3
  s3:
    endpoint: s3.example.com
    bucket: playwright-reports
    existingSecret: reports-s3   # keys S3_ACCESS_KEY, S3_SECRET_KEY
```

The server runs as a single-replica StatefulSet: SQLite has a single writer, and the
StatefulSet never starts the new pod before the old one is gone. The claim template is
immutable: to grow the volume, resize the PVC itself (`data-<fullname>-0`).

## Single sign-on

SSO providers (GitHub, Google, any OIDC issuer) are configured by an admin in the UI
(Settings -> General for the public base URL, then Settings -> Single Sign-On). The
redirect URI to register is `<base url>/api/auth/oauth/<provider>/callback`.

## Requirements

Kubernetes: `>=1.25.0-0`

## Values

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| affinity | object | `{}` | Affinity. |
| auth.apiToken | string | `""` | API token, when `existingSecret` is empty (a Secret is created). |
| auth.apiTokenKey | string | `"API_TOKEN"` | Key of the API token (master switch, bootstrap secret of the first admin) in the Secret. |
| auth.authSecret | string | `""` | Encryption secret, when `existingSecret` is empty (a Secret is created). |
| auth.authSecretKey | string | `"AUTH_SECRET"` | Key of the secret encrypting stored secrets (SSO client secrets, tokens) in the Secret. |
| auth.cookieSecure | bool | `true` | Secure flag on auth cookies. Keep true behind TLS. |
| auth.enabled | bool | `true` | Turn authentication on (sets `API_TOKEN`). Off = open mode, everyone is an admin. |
| auth.existingSecret | string | `""` | Existing Secret holding `API_TOKEN` and `AUTH_SECRET` (keys below). Recommended. |
| auth.root.existingSecret | string | `""` | Existing Secret with a break-glass admin (recovery only; leave empty normally). |
| auth.root.passwordKey | string | `"ROOT_PASSWORD"` | Key of the break-glass password. |
| auth.root.usernameKey | string | `"ROOT_USERNAME"` | Key of the break-glass username. |
| auth.sessionHours | int | `12` | Idle session lifetime in hours (sliding, 30-day absolute cap). |
| extraEnv | list | `[]` | Extra environment variables (list of EnvVar). |
| extraEnvFrom | list | `[]` | Extra environment sources (list of EnvFromSource). |
| fullnameOverride | string | `""` | Override the full release name. |
| image.pullPolicy | string | `"IfNotPresent"` | Image pull policy. |
| image.repository | string | `"ghcr.io/cyborgtests/playwright-reports-server"` | Image repository. |
| image.tag | string | `""` | Image tag. Defaults to `v<Chart.appVersion>`. |
| imagePullSecrets | list | `[]` | Image pull secrets. |
| ingress.annotations | object | `{}` | Ingress annotations. |
| ingress.className | string | `""` | Ingress class name. |
| ingress.enabled | bool | `false` | Create an Ingress. |
| ingress.hosts | list | `[{"host":"playwright-reports.example.com","paths":[{"path":"/","pathType":"Prefix"}]}]` | Hosts and paths. |
| ingress.tls | list | `[]` | TLS configuration. |
| livenessProbe | object | `{"httpGet":{"path":"/api/ping","port":"http"},"periodSeconds":30,"timeoutSeconds":5}` | Liveness probe. |
| logLevel | string | `"info"` | Log level. |
| nameOverride | string | `""` | Override the chart name. |
| nodeSelector | object | `{}` | Node selector. |
| podAnnotations | object | `{}` | Pod annotations. |
| podLabels | object | `{}` | Pod labels. |
| podSecurityContext | object | `{"fsGroup":1001,"runAsGroup":1001,"runAsNonRoot":true,"runAsUser":1001,"seccompProfile":{"type":"RuntimeDefault"}}` | Pod security context (the image runs as appuser 1001:1001). |
| readinessProbe | object | `{"httpGet":{"path":"/api/ping","port":"http"},"periodSeconds":10,"timeoutSeconds":5}` | Readiness probe. |
| resources | object | `{"limits":{"memory":"1Gi"},"requests":{"cpu":"100m","memory":"256Mi"}}` | Resources. Merging reports can use a lot of memory for large suites. |
| securityContext | object | `{"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":true}` | Container security context. The root filesystem is read-only: `/app/data`, `/app/.tmp` and `/tmp` are volumes. |
| service.port | int | `3001` | Service port. |
| service.type | string | `"ClusterIP"` | Service type. |
| serviceAccount.annotations | object | `{}` | ServiceAccount annotations. |
| serviceAccount.create | bool | `true` | Create a ServiceAccount. |
| serviceAccount.name | string | `""` | ServiceAccount name (generated when empty). |
| startupProbe | object | `{"failureThreshold":60,"httpGet":{"path":"/api/ping","port":"http"},"periodSeconds":5}` | Startup probe (first start may replay the Litestream replica). |
| storage.fs.persistence.accessModes | list | `["ReadWriteOnce"]` | Access modes of the claim template. Immutable once installed. |
| storage.fs.persistence.annotations | object | `{}` | Annotations of the claim template. |
| storage.fs.persistence.enabled | bool | `true` | Persist `/app/data` on a PersistentVolumeClaim (fs storage), created from the StatefulSet `volumeClaimTemplates`. |
| storage.fs.persistence.existingClaim | string | `""` | Use an existing claim instead of the claim template. |
| storage.fs.persistence.size | string | `"10Gi"` | Size of the claim template. Immutable once installed (resize the PVC itself). |
| storage.fs.persistence.storageClass | string | `""` | Storage class of the claim template ("" = cluster default). Immutable once installed. |
| storage.s3.accessKeyKey | string | `"S3_ACCESS_KEY"` | Key of the access key in the Secret. |
| storage.s3.bucket | string | `"playwright-reports-server"` | Bucket (pre-created). |
| storage.s3.endpoint | string | `""` | S3 endpoint, hostname only (no scheme). |
| storage.s3.existingSecret | string | `""` | Existing Secret with the access and secret keys (required with `storage.type: s3`). |
| storage.s3.port | string | `""` | Custom port of the endpoint (self-hosted object storage). |
| storage.s3.region | string | `"us-east-1"` | Region (`auto` for Google Cloud Storage). |
| storage.s3.secretKeyKey | string | `"S3_SECRET_KEY"` | Key of the secret key in the Secret. |
| storage.s3.useSSL | bool | `true` | Use HTTPS to the endpoint. |
| storage.scratchSize | string | `"5Gi"` | Size of the scratch volume for `/app/data` with `storage.type: s3` (merges, uploads in flight). |
| storage.type | string | `"fs"` | `fs` (persistent volume) or `s3` (S3-compatible bucket; metadata replicated by Litestream). |
| tolerations | list | `[]` | Tolerations. |
