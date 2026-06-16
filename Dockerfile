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

# Bundle backend with esbuild — produces dist/index.js + inject.js + inject.css.
# All prod deps except externals get folded and tree-shaken.
FROM build-base AS backend-bundler
WORKDIR /app
COPY --from=deps /app/ ./
COPY --from=shared-builder /app/packages/shared/dist ./packages/shared/dist
RUN pnpm --filter @playwright-reports/backend bundle

# Runtime deps stage — fresh install of ONLY the externals into a flat node_modules tree.
FROM build-base AS runtime-deps
WORKDIR /runtime
COPY apps/backend/package.json ./backend-package.json
RUN node -e "const fs=require('fs');const src=JSON.parse(fs.readFileSync('backend-package.json'));const pkg={name:'playwright-reports-runtime',version:'0.0.0',private:true,dependencies:{'better-sqlite3':src.dependencies['better-sqlite3'],'@playwright/test':src.dependencies['@playwright/test']}};fs.writeFileSync('package.json',JSON.stringify(pkg,null,2));" && \
    rm backend-package.json
RUN npm install --omit=dev --no-audit --no-fund
# Strip docs/tests/typings/sourcemaps
RUN find node_modules \
      -not -path '*/@playwright/test*' \
      \( \
        -name '*.md' -o -name '*.markdown' \
        -o -name 'LICENSE*' -o -name 'license*' -o -name 'CHANGELOG*' \
        -o -name '*.d.ts' -o -name '*.d.ts.map' -o -name '*.js.map' \
        -o -name 'tests' -o -name '__tests__' \
        -o -name 'example' -o -name 'examples' -o -name 'docs' \
        -o -name '.github' \
      \) -prune -exec rm -rf {} + 2>/dev/null || true
# strip better-sqlite3 down to the runtime essentials: the prebuilt .node binding
# and its JS wrapper. Drops the bundled SQLite C source (deps/) and build
# intermediates (object files, makefiles).
RUN find node_modules/better-sqlite3 -mindepth 1 -maxdepth 1 \
      ! -name lib ! -name build ! -name package.json -exec rm -rf {} + && \
    find node_modules/better-sqlite3/build -mindepth 1 -maxdepth 1 \
      ! -name Release -exec rm -rf {} + && \
    find node_modules/better-sqlite3/build/Release -type f ! -name '*.node' -delete

# Production image
FROM runner-base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs appuser

# Bundled backend and its package.json so node treats the bundle as ESM
COPY --from=backend-bundler --chown=appuser:nodejs /app/apps/backend/dist ./apps/backend/dist
COPY --from=backend-bundler --chown=appuser:nodejs /app/apps/backend/package.json ./apps/backend/package.json

# Backend-served static assets (favicon.ico, logo.svg) reached via /api/static.
# The bundle layout resolves these at apps/backend/public (dist/../public).
COPY --from=backend-bundler --chown=appuser:nodejs /app/apps/backend/public ./apps/backend/public

# Runtime externals — better-sqlite3 native binding + playwright CLI.
COPY --from=runtime-deps --chown=appuser:nodejs /runtime/node_modules ./apps/backend/node_modules

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
