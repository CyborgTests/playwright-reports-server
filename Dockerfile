FROM node:24-alpine AS build-base

# Install pnpm globally
RUN npm install -g pnpm

# Install build tools for native dependencies (better-sqlite3, sharp, esbuild)
RUN apk add --no-cache python3 make g++ libc6-compat curl

# Set CI environment variable for pnpm
# This prevents pnpm from prompting for input when removing node_modules
ENV CI=true

# Runner base: minimal runtime image with only Node.js and Litestream
FROM node:24-alpine AS runner-base

# Install Litestream for SQLite replication
# Supports: linux/amd64, linux/arm64, linux/armv6, linux/armv7
# TARGETPLATFORM is automatically set by Docker buildkit when using --platform
ARG TARGETPLATFORM
ENV LITESTREAM_VERSION=0.3.13
RUN apk add --no-cache curl && \
    TARGETPLATFORM=${TARGETPLATFORM:-linux/amd64} && \
    LITESTREAM_ARCH=$(echo "${TARGETPLATFORM##*/}" | sed -e 's/x86_64/amd64/' -e 's/aarch64/arm64/') && \
    curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${LITESTREAM_ARCH}.tar.gz" | tar -xz && \
    mv litestream /usr/local/bin/litestream && \
    chmod +x /usr/local/bin/litestream && \
    apk del curl

ENV NODE_ENV=production

# Install all dependencies for monorepo from the ROOT
# This is critical: pnpm install must run from root where pnpm-workspace.yaml
# and root package.json with overrides are located
FROM build-base AS deps
WORKDIR /app

# Copy workspace configuration files first
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./.npmrc ./

# Copy all workspace packages so pnpm can resolve local dependencies
COPY packages/ ./packages/
COPY apps/ ./apps/

# Install dependencies from root with frozen lockfile
# This reads the overrides from root package.json and onlyBuiltDependencies from pnpm-workspace.yaml
RUN pnpm install --frozen-lockfile

# Build shared package first using pnpm filter from root
FROM build-base AS shared-builder
WORKDIR /app

# Copy the entire workspace structure with node_modules from deps
COPY --from=deps /app/ ./

# Build shared package using pnpm filter from root
# This ensures workspace context is preserved
RUN pnpm --filter @playwright-reports/shared build

# Build frontend
FROM build-base AS frontend-builder
WORKDIR /app

# Copy the entire workspace structure with node_modules from deps
COPY --from=deps /app/ ./

# Copy the built shared package
COPY --from=shared-builder /app/packages/shared/dist ./packages/shared/dist

# Create symlink for shared package in frontend directory
# The Vite config expects ./packages/shared when DOCKER_BUILD=true
# but the actual shared package is at /app/packages/shared
RUN mkdir -p /app/apps/frontend/packages && \
    ln -sf /app/packages/shared /app/apps/frontend/packages/shared

# Build frontend using pnpm filter from root
ENV DOCKER_BUILD=true
RUN pnpm --filter @playwright-reports/frontend build:vite

# Build backend
FROM build-base AS backend-builder
WORKDIR /app

# Copy the entire workspace structure with node_modules from deps
COPY --from=deps /app/ ./

# Copy the built shared package
COPY --from=shared-builder /app/packages/shared/dist ./packages/shared/dist

# Build backend using pnpm filter from root
RUN pnpm --filter @playwright-reports/backend build

# Prune dev dependencies from the entire workspace
# This removes dev dependencies from all workspace packages
# --ignore-scripts prevents running prepare scripts which would fail without dev deps
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# Production image
FROM runner-base AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs appuser

# Copy root node_modules (contains all dependencies)
COPY --from=backend-builder --chown=appuser:nodejs /app/node_modules ./node_modules

# Copy workspace package node_modules (pnpm symlinks for workspace resolution)
COPY --from=backend-builder --chown=appuser:nodejs /app/apps/backend/node_modules ./apps/backend/node_modules

# Copy shared package (needed as workspace dependency)
COPY --from=backend-builder --chown=appuser:nodejs /app/packages/shared ./packages/shared

# Copy only the backend dist folder (not full source code)
COPY --from=backend-builder --chown=appuser:nodejs /app/apps/backend/dist ./apps/backend/dist

# Copy backend public folder (static assets like logo.svg, favicon.ico)
COPY --from=backend-builder --chown=appuser:nodejs /app/apps/backend/public ./apps/backend/public

# Copy backend package.json for version/metadata access
COPY --from=backend-builder --chown=appuser:nodejs /app/apps/backend/package.json ./apps/backend/package.json

# Copy frontend dist
COPY --from=frontend-builder --chown=appuser:nodejs /app/apps/frontend/dist ./apps/frontend/dist

# Copy environment configuration (for default values)
COPY --chown=appuser:nodejs .env.example /app/.env.example
COPY --chown=appuser:nodejs package.json ./package.json

# Copy Litestream configuration (internal, not exposed as env var)
COPY --chown=appuser:nodejs litestream.yml /app/litestream.yml

# Create empty .env for runtime overrides
RUN touch /app/.env && \
    chown appuser:nodejs /app/.env

# Create folders required for storing results and reports
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

WORKDIR /app

CMD ["node", "apps/backend/dist/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:$PORT/api/ping || exit 1
