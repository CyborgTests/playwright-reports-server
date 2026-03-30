# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Release tagging (Docker)

- **Stable GitHub Release** (prerelease unchecked): images are tagged with semver (e.g. `1.2.3`, `1.2`) and **`latest`** on both GHCR and Docker Hub.
- **Prerelease** (e.g. beta / RC): images get semver prerelease tags and a floating **`beta`** tag; **`latest` is not updated** so `docker pull …:latest` stays on the last stable build.

## [Unreleased]

### Added

- Multi-stage `Dockerfile`, `.dockerignore`, and release workflow publishing to **GHCR** and **Docker Hub**.
- `PORT` from environment for container deployments.
- Cursor **devops** subagent (`.cursor/agents/devops.md`) for CI/CD and release hygiene.
