# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Development image for the API and worker.
#
# Keeps dev dependencies and the TypeScript toolchain so `nest start --watch`
# can recompile against the bind-mounted source. Never use this in production —
# that is what api.Dockerfile builds.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY database/package.json ./database/
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/validation/package.json ./packages/validation/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/

RUN pnpm install --frozen-lockfile --filter @retailos/api... --filter @retailos/database...

COPY packages ./packages
COPY database ./database
COPY apps/api ./apps/api

ENV MASTER_DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV TENANT_SHADOW_DATABASE_URL="postgresql://build:build@localhost:5432/build"

RUN pnpm --filter @retailos/types --filter @retailos/config \
         --filter @retailos/validation --filter @retailos/api-client run build \
 && pnpm --filter @retailos/database run build

ENV NODE_ENV=development
ENV TENANT_MIGRATIONS_DIR=/app/database/tenant/migrations
WORKDIR /app/apps/api
EXPOSE 4000

CMD ["pnpm", "dev"]
