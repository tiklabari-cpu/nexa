# syntax=docker/dockerfile:1
# Nexa API — multi-stage build (tm 140.1, M-CONTAINER-a). Local/dev images only:
# no production deploy, no real secrets baked in (CLAUDE.md / MASTER-PROMPT limits).
#
# @nexa/api imports two workspace packages at runtime, @nexa/types and
# @nexa/ai-mock (@nexa/contract is test-only — grep confirms no apps/api/src
# file outside test/ touches it). Their package.json "main" points at
# src/index.ts for local dev, where `tsx`/vitest rewrite `./foo.js` internal
# specifiers to the sibling `.ts` file; plain Node does not do that rewrite —
# it only strips types, so running their *.ts source directly under `node`
# throws `ERR_MODULE_NOT_FOUND` on the very first internal `./domain.js`
# import (measured). The runtime stage therefore ships their compiled `dist/`
# output instead, with a copy of package.json patched to point "main"/exports
# at it — see the `build` stage below. The monorepo's relative layout
# (apps/api/dist next to packages/*) is otherwise kept because a workspace
# symlink cannot point outside the image it was copied into.
ARG NODE_IMAGE=node:24-slim
ARG PNPM_VERSION=11.15.1

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
# Without a real `libssl` present, `prisma generate`/postinstall can't detect
# an OpenSSL version and silently defaults to a `openssl-1.1.x` engine binary —
# which then fails to load in a runtime image whose actual libssl doesn't
# match. Installing it here means generate picks the binary the runtime stage
# (also node:24-slim, so the same libssl) will actually be able to load.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /repo
# A BuildKit cache mount (below) keeps the content-addressable store across
# separate `docker build` invocations — without it every retry re-downloads
# the entire dependency set from scratch. Longer timeout/more retries because
# this environment reaches the registry through a slow proxy (individual
# tarballs measured well under the 50 KiB/s pnpm warns about by default).
RUN pnpm config set store-dir /pnpm-store \
    && pnpm config set fetch-timeout 300000 \
    && pnpm config set fetch-retries 5

# ---- build: filtered workspace install (@nexa/api + the workspace packages it
# depends on — not the whole monorepo, so this skips apps/web's, apps/mobile's
# and apps/e2e's much larger dependency trees entirely) + compile. `--filter
# @nexa/api...` resolves/downloads only what those projects declare, unlike
# `pnpm fetch` (whole-lockfile, no `--filter` support) which pulled in every
# workspace member — including apps/mobile's Expo/React Native tree — and, over
# this environment's proxied registry connection, timed out before finishing. ---
FROM base AS build
COPY . .
RUN --mount=type=cache,id=nexa-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter @nexa/api...
# Must run BEFORE `tsc` — `@prisma/client` ships an unusable stub module until
# `generate` overwrites it (measured: skipping this first makes `tsc` fail
# across every file that touches `Prisma.InputJsonValue`/`InputJsonObject`, not
# just database code). `prisma generate` only needs DATABASE_URL to be a
# well-formed URL, not a reachable one.
RUN --mount=type=cache,id=nexa-pnpm-store,target=/pnpm-store \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    pnpm --filter @nexa/api exec prisma generate
RUN pnpm --filter @nexa/api... run build
# Point the two runtime-consumed workspace packages at their compiled output.
# Only this build stage's checked-out copy is touched — the real repo files
# (which tsx/vitest need pointed at src) are untouched.
RUN node -e " \
    const fs = require('node:fs'); \
    for (const p of ['packages/types', 'packages/ai-mock']) { \
      const file = p + '/package.json'; \
      const pkg = JSON.parse(fs.readFileSync(file, 'utf8')); \
      pkg.main = './dist/index.js'; \
      pkg.types = './dist/index.d.ts'; \
      pkg.exports = { '.': './dist/index.js' }; \
      fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n'); \
    } \
    "

# ---- prod-deps: a second, production-only install, kept in its own stage
# (rather than pruning `build`'s node_modules) so devDependencies such as
# typescript/eslint/vitest never reach the runtime image. `prisma` (the CLI) is
# a `dependency` of @nexa/api on purpose — the entrypoint below runs
# `prisma migrate deploy` inside the running container, so it must be here. ---
FROM base AS prod-deps
COPY . .
RUN --mount=type=cache,id=nexa-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --prod --filter @nexa/api...
RUN --mount=type=cache,id=nexa-pnpm-store,target=/pnpm-store \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    pnpm --filter @nexa/api exec prisma generate

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system nexa \
    && useradd --system --gid nexa --home-dir /repo --shell /usr/sbin/nologin nexa

WORKDIR /repo
# Third-party deps: root store + apps/api's symlinks into it.
COPY --from=prod-deps --chown=nexa:nexa /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=nexa:nexa /repo/apps/api/node_modules ./apps/api/node_modules
# Workspace deps (workspace:* protocol — always symlinked to real source, never
# through the store): @nexa/types + @nexa/ai-mock, compiled (see the patch step
# in `build` above), not raw source — @nexa/contract is intentionally absent,
# it is test-only for @nexa/api. `apps/api/node_modules/@nexa/contract` above
# is left as a dangling symlink; harmless, since it's never imported.
COPY --from=build --chown=nexa:nexa /repo/packages/types/dist ./packages/types/dist
COPY --from=build --chown=nexa:nexa /repo/packages/types/package.json ./packages/types/package.json
COPY --from=build --chown=nexa:nexa /repo/packages/ai-mock/dist ./packages/ai-mock/dist
COPY --from=build --chown=nexa:nexa /repo/packages/ai-mock/package.json ./packages/ai-mock/package.json
# Compiled output + migrations (source of the query engine's schema) + manifest
# (Node needs a nearest package.json with "type": "module" to load dist/**/*.js as ESM).
COPY --from=build --chown=nexa:nexa /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=nexa:nexa /repo/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=nexa:nexa /repo/apps/api/package.json ./apps/api/package.json
COPY --chown=nexa:nexa apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
RUN chmod +x ./apps/api/docker-entrypoint.sh

WORKDIR /repo/apps/api
USER nexa
EXPOSE 4000
# /health/ready (not /health/live, M-OPS-a): a process with no dependency
# reachable is not ready to receive traffic, and the orchestrator should not
# route to it — but should also not kill it, which is exactly what a
# liveness probe pointed at the same URL would eventually do.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
    CMD curl -fsS "http://127.0.0.1:${API_PORT:-4000}/api/v1/health/ready" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/src/index.js"]
