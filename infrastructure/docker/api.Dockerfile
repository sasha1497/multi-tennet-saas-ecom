# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# RetailOS API + worker.
#
# One image, two entrypoints (`dist/main.js` and `dist/worker.js`), because they
# share every module — only the composition root differs. Building twice would
# just double the CI time and risk drift between them.
#
# Build context is the REPO ROOT: this is a pnpm workspace and the API depends on
# five local packages plus the generated Prisma clients.
#
#   docker build -f infrastructure/docker/api.Dockerfile -t retailos/api .
# ---------------------------------------------------------------------------

# bookworm-slim (not alpine) because Prisma's query engine ships a glibc build;
# the musl variant is an extra download and a recurring source of surprises.
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# OpenSSL is required by Prisma; curl is used by the healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# ---------------------------------------------------------------- deps ------
# Manifests only, so this layer is cached until a dependency actually changes.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY database/package.json ./database/
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/validation/package.json ./packages/validation/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @retailos/api... --filter @retailos/database...

# --------------------------------------------------------------- build ------
FROM deps AS build
COPY packages/tsconfig ./packages/tsconfig
COPY packages/eslint-config ./packages/eslint-config
COPY packages/types ./packages/types
COPY packages/config ./packages/config
COPY packages/validation ./packages/validation
COPY packages/api-client ./packages/api-client
COPY database ./database
COPY apps/api ./apps/api

# Prisma needs the datasource env vars present at generate time. These are
# placeholders — the real URLs arrive at runtime from the environment.
ENV MASTER_DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV TENANT_SHADOW_DATABASE_URL="postgresql://build:build@localhost:5432/build"

RUN pnpm --filter @retailos/types --filter @retailos/config \
         --filter @retailos/validation --filter @retailos/api-client run build \
 && pnpm --filter @retailos/database run build \
 && pnpm --filter @retailos/api run build

# ---------------------------------------------------------- prod deps -------
# A second, dev-dependency-free install. Smaller image and a smaller attack
# surface than shipping the build toolchain.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json ./apps/api/
COPY database/package.json ./database/
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/validation/package.json ./packages/validation/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts \
      --filter @retailos/api... --filter @retailos/database...

# ------------------------------------------------------------- runtime ------
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Run as a non-root user. `node` already exists in the base image.
RUN mkdir -p /app/.storage && chown -R node:node /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=prod-deps --chown=node:node /app/database/node_modules ./database/node_modules
COPY --from=prod-deps --chown=node:node /app/packages ./packages

COPY --chown=node:node package.json pnpm-workspace.yaml ./
COPY --chown=node:node apps/api/package.json ./apps/api/
COPY --chown=node:node database/package.json ./database/

# Compiled output for every workspace package the API imports.
COPY --from=build --chown=node:node /app/packages/types/dist ./packages/types/dist
COPY --from=build --chown=node:node /app/packages/config/dist ./packages/config/dist
COPY --from=build --chown=node:node /app/packages/config/tailwind-preset.js ./packages/config/
COPY --from=build --chown=node:node /app/packages/validation/dist ./packages/validation/dist
COPY --from=build --chown=node:node /app/packages/api-client/dist ./packages/api-client/dist
COPY --from=build --chown=node:node /app/database/dist ./database/dist

# Generated Prisma clients, including their native query engines.
COPY --from=build --chown=node:node /app/database/generated ./database/generated

# Master migrations (for `prisma migrate deploy`) and the tenant SQL migrations,
# which the runtime migration runner reads from disk when provisioning a tenant.
COPY --from=build --chown=node:node /app/database/master ./database/master
COPY --from=build --chown=node:node /app/database/tenant ./database/tenant

COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist

WORKDIR /app/apps/api
USER node

ENV TENANT_MIGRATIONS_DIR=/app/database/tenant/migrations
EXPOSE 4000

# Node's own signal handling plus Nest's shutdown hooks drain connections
# cleanly, so no init shim is needed.
CMD ["node", "dist/main.js"]
