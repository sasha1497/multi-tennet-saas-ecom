# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# RetailOS Next.js apps (storefront-web and merchant-web).
#
# ONE Dockerfile builds BOTH apps — they differ only in which workspace package
# is compiled and which port it listens on, so the app name is a build argument:
#
#   docker build -f infrastructure/docker/web.Dockerfile \
#     --build-arg APP_NAME=storefront-web --build-arg APP_PORT=3000 \
#     -t retailos/storefront-web .
#
# Build context is the REPO ROOT: both apps consume five local workspace
# packages, and Next's `output: 'standalone'` traces files across the monorepo.
# ---------------------------------------------------------------------------

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

# ----------------------------------------------------------------- deps -----
# Manifests only, so this layer survives every source-only change.
FROM base AS deps
ARG APP_NAME
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/${APP_NAME}/package.json ./apps/${APP_NAME}/
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/validation/package.json ./packages/validation/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/ui/package.json ./packages/ui/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/
# `<pkg>...` pulls in the workspace dependencies too, so the API and the
# database package are never installed into a web image.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @retailos/${APP_NAME}...

# ---------------------------------------------------------------- build -----
FROM deps AS build
ARG APP_NAME
COPY packages ./packages
COPY apps/${APP_NAME} ./apps/${APP_NAME}

# The shared packages are consumed as compiled `dist/` output, so they must be
# built before Next resolves them. @retailos/ui is transpiled by Next itself
# (see `transpilePackages`) but still needs its Tailwind preset and tokens.
RUN pnpm --filter @retailos/types --filter @retailos/config \
         --filter @retailos/validation --filter @retailos/api-client \
         --filter @retailos/ui run build \
 && pnpm --filter @retailos/${APP_NAME} run build

# -------------------------------------------------------------- runtime -----
# `output: 'standalone'` emits a self-contained server plus exactly the
# node_modules it traced, which is far smaller than a full prod install.
FROM base AS runtime
ARG APP_NAME
ARG APP_PORT=3000
ENV NODE_ENV=production
ENV PORT=${APP_PORT}
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN mkdir -p /app && chown -R node:node /app

COPY --from=build --chown=node:node /app/apps/${APP_NAME}/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/${APP_NAME}/.next/static ./apps/${APP_NAME}/.next/static
COPY --from=build --chown=node:node /app/apps/${APP_NAME}/public ./apps/${APP_NAME}/public

USER node
EXPOSE ${APP_PORT}

# The standalone bundle keeps the workspace layout, so the entrypoint lives at
# apps/<name>/server.js. APP_NAME is a build arg and is not present at run time,
# which is why it is baked into the command rather than referenced as $APP_NAME.
WORKDIR /app/apps/${APP_NAME}
CMD ["node", "server.js"]
