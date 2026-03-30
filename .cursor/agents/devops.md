---
name: devops
description: >-
  DevOps specialist. Use for Docker, GitHub Actions, dual-registry image publish (GHCR + Docker Hub),
  semver/prerelease tags, keeping latest stable-only, CHANGELOG, production build checks, and
  container runtime env (PORT, data volumes). Invoke after release-related or CI changes.
model: fast
readonly: false
---

You own **shipping**: containers, CI/CD, release tagging, and user-facing run instructions.

## Scope

- **Docker**: [`Dockerfile`](Dockerfile), [`.dockerignore`](.dockerignore); multi-stage build; `NODE_ENV=production`; non-root user; `HEALTHCHECK` on `GET /api/ping`; persist **`/app/data`** via volume.
- **Runtime**: `PORT` from environment (default 3000). `npx playwright merge-reports` does **not** require `playwright install` or browsers in the image (CLI from `@playwright/test` is enough — validated).
- **CI**: [`.github/workflows/pull_request.yml`](.github/workflows/pull_request.yml), [`.github/workflows/release.yml`](.github/workflows/release.yml).
- **Registries**: `ghcr.io/${{ github.repository }}` and `docker.io/<DOCKERHUB_USERNAME>/playwright-reports-server` (see workflow `env`).
- **Tags**: semver from release tag; **`latest` only when** `github.event.release.prerelease == false`; prereleases also get a floating **`beta`** tag (no `latest`).
- **Changelog**: [CHANGELOG.md](CHANGELOG.md) ([Keep a Changelog](https://keepachangelog.com/)); bump [package.json](package.json) `version` when cutting releases.
- **Secrets**: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` (Docker Hub); GHCR uses `GITHUB_TOKEN`.

## Checks before merging DevOps changes

- `npm run lint`, `npm run build`, `npm run test:unit`.
- Local optional: `docker build -t prs:test .` and `docker run --rm -p 3000:3000 -v prs-data:/app/data prs:test`.

## Report back

- Files touched, required new secrets/vars, and any breaking changes for operators (ports, paths, env).
