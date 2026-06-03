FROM node:24-alpine AS build-base

# Pin pnpm to match repo
RUN npm install -g pnpm@10

# Build tools for native dependencies (better-sqlite3, esbuild)
RUN apk add --no-cache python3 make g++ libc6-compat

# CI=true prevents pnpm from prompting; PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD keeps
# @playwright/test from pulling chromium/firefox/webkit — we only run
# `playwright merge-reports`, not browsers.
ENV CI=true \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Runner base: minimal runtime image with Node, Litestream and curl (for healthcheck).
FROM node:24-alpine AS runner-base

ARG TARGETPLATFORM
ENV LITESTREAM_VERSION=0.3.13
RUN apk add --no-cache curl && \
    TARGETPLATFORM=${TARGETPLATFORM:-linux/amd64} && \
    LITESTREAM_ARCH=$(echo "${TARGETPLATFORM##*/}" | sed -e 's/x86_64/amd64/' -e 's/aarch64/arm64/') && \
    curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${LITESTREAM_ARCH}.tar.gz" \
      | tar -xz -C /usr/local/bin litestream && \
    chmod +x /usr/local/bin/litestream

ENV NODE_ENV=production \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install all workspace deps (including dev) from the monorepo root so the
# build stages have everything they need.
FROM build-base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./.npmrc ./
COPY packages/ ./packages/
COPY apps/ ./apps/

RUN pnpm install --frozen-lockfile --prefer-offline

# Build shared package first (backend + frontend depend on its dist output).
FROM build-base AS shared-builder
WORKDIR /app
COPY --from=deps /app/ ./
RUN pnpm --filter @playwright-reports/shared build

# Build frontend
FROM build-base AS frontend-builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY --from=shared-builder /app/packages/shared/dist ./packages/shared/dist

# Vite is configured to look at ./packages/shared inside the frontend dir
# when DOCKER_BUILD=true; symlink the workspace package into place.
RUN mkdir -p /app/apps/frontend/packages && \
    ln -sf /app/packages/shared /app/apps/frontend/packages/shared

ENV DOCKER_BUILD=true
RUN pnpm --filter @playwright-reports/frontend build:vite

# Build backend
FROM build-base AS backend-builder
WORKDIR /app
COPY --from=deps /app/ ./
COPY --from=shared-builder /app/packages/shared/dist ./packages/shared/dist
RUN pnpm --filter @playwright-reports/backend build

# Produce a self-contained backend bundle: dist + public + flat prod
# node_modules with only what backend imports transitively.
FROM backend-builder AS deployer
WORKDIR /app
RUN pnpm --filter @playwright-reports/backend deploy --prod --legacy /deploy && \
    find /deploy/dist -type f \( -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.js.map' \) -delete

# Production image
FROM runner-base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs appuser

# Self-contained backend bundle (dist, public, package.json, node_modules).
COPY --from=deployer --chown=appuser:nodejs /deploy ./apps/backend

# Frontend static assets served by @fastify/static.
COPY --from=frontend-builder --chown=appuser:nodejs /app/apps/frontend/dist ./apps/frontend/dist

# Root metadata and Litestream config.
COPY --chown=appuser:nodejs package.json ./package.json
COPY --chown=appuser:nodejs .env.example /app/.env.example
COPY --chown=appuser:nodejs litestream.yml /app/litestream.yml

RUN touch /app/.env && \
    chown appuser:nodejs /app/.env

ARG DATA_DIR=/app/data
ARG RESULTS_DIR=${DATA_DIR}/results
ARG REPORTS_DIR=${DATA_DIR}/reports
ARG TEMP_DIR=/app/.tmp
RUN mkdir -p ${DATA_DIR} ${RESULTS_DIR} ${REPORTS_DIR} ${TEMP_DIR} && \
    chown -R appuser:nodejs ${DATA_DIR} ${TEMP_DIR}

USER appuser

EXPOSE 3001

ENV PORT=3001
ENV FRONTEND_DIST=/app/apps/frontend/dist

CMD ["node", "apps/backend/dist/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:$PORT/api/ping || exit 1
