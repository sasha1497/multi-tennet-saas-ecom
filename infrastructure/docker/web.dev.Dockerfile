# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Development image for the Next.js apps (storefront-web and merchant-web).
#
# Keeps dev dependencies and runs `next dev`, so the bind-mounted `src/` and
# `packages/` recompile on save. Never use this in production — that is what
# web.Dockerfile builds.
#
# As with the production image, one file serves both apps via APP_NAME.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim

ARG APP_NAME
ARG APP_PORT=3000

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json ./
COPY apps/${APP_NAME}/package.json ./apps/${APP_NAME}/
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/validation/package.json ./packages/validation/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/ui/package.json ./packages/ui/
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/eslint-config/package.json ./packages/eslint-config/

RUN pnpm install --frozen-lockfile --filter @retailos/${APP_NAME}...

COPY packages ./packages
COPY apps/${APP_NAME} ./apps/${APP_NAME}

# Built once at image build time. The compose file bind-mounts ./packages over
# this, so `pnpm dev` at the repo root (or a rebuild) is what refreshes them.
RUN pnpm --filter @retailos/types --filter @retailos/config \
         --filter @retailos/validation --filter @retailos/api-client \
         --filter @retailos/ui run build

ENV NODE_ENV=development
ENV PORT=${APP_PORT}
ENV HOSTNAME=0.0.0.0
EXPOSE ${APP_PORT}

WORKDIR /app/apps/${APP_NAME}
CMD ["pnpm", "dev"]
