# syntax=docker/dockerfile:1
# Nexa RTM (realtime WebSocket gateway) — multi-stage build (tm 140.1,
# M-CONTAINER-a). Local/dev images only: no production deploy, no real secrets
# baked in (CLAUDE.md / MASTER-PROMPT limits).
#
# @nexa/rtm has no `prisma/schema.prisma` of its own (apps/api owns the schema —
# see apps/rtm/src/*.ts importing `@prisma/client` directly); it only consumes
# the client @nexa/api's schema generates. Both apps depend on the exact same
# `@prisma/client` version (pnpm-lock.yaml), so they share one physical copy in
# pnpm's content-addressable store — `prisma generate` run once against
# apps/api/prisma/schema.prisma, with @nexa/api pulled into this build's install
# scope purely to provide that schema + the `prisma` CLI, populates the copy
# @nexa/rtm's own `@prisma/client` symlink resolves to as well.
#
# Like apps/api/Dockerfile, the runtime stage keeps the monorepo's relative
# layout (apps/rtm/dist next to packages/types) rather than flattening to a
# single package. @nexa/types's package.json "main" points at src/index.ts for
# local dev, where `tsx`/vitest rewrite `./foo.js` internal specifiers to the
# sibling `.ts` file; plain Node does not do that rewrite — it only strips
# types, so running the *.ts source directly under `node` throws
# `ERR_MODULE_NOT_FOUND` on the first internal `./domain.js` import (measured).
# The runtime stage ships @nexa/types's compiled `dist/` output instead, with a
# copy of package.json patched to point "main"/exports at it (see `build`).
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

# ---- build: filtered install — @nexa/rtm + its workspace deps, plus @nexa/api
# (schema + `prisma` CLI only, api itself never ships in the RTM image) — so the
# generated client lands in the shared store entry both apps resolve to.
# `--filter` (not `pnpm fetch`, which has no `--filter` and pulls the whole
# lockfile — apps/mobile's Expo/React Native tree included) keeps this to only
# what these two projects declare. Compiles @nexa/rtm and @nexa/types. ------
FROM base AS build
COPY . .
RUN --mount=type=cache,id=nexa-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter @nexa/rtm... --filter @nexa/api
# Must run BEFORE `tsc` — `@prisma/client` ships an unusable stub module until
# `generate` overwrites it (apps/rtm's src imports `PrismaClient` directly).
# `prisma generate` only needs DATABASE_URL to be a well-formed URL, not a
# reachable one.
RUN --mount=type=cache,id=nexa-pnpm-store,target=/pnpm-store \
    DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    pnpm --filter @nexa/api exec prisma generate
RUN pnpm --filter @nexa/rtm... run build
# Point @nexa/types at its compiled output. Only this build stage's checked-out
# copy is touched — the real repo file (which tsx/vitest need pointed at src)
# is untouched.
RUN node -e " \
    const fs = require('node:fs'); \
    const file = 'packages/types/package.json'; \
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8')); \
    pkg.main = './dist/index.js'; \
    pkg.types = './dist/index.d.ts'; \
    pkg.exports = { '.': './dist/index.js' }; \
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n'); \
    "

# ---- prod-deps: a second, production-only install, kept in its own stage so
# devDependencies (typescript/eslint/vitest, and @nexa/api's own runtime deps —
# api itself never ships in the RTM image) never reach the runtime image. ---
FROM base AS prod-deps
COPY . .
RUN --mount=type=cache,id=nexa-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --prod --filter @nexa/rtm... --filter @nexa/api
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
# Third-party deps: root store (holds the generated @prisma/client) + rtm's
# symlinks into it.
COPY --from=prod-deps --chown=nexa:nexa /repo/node_modules ./node_modules
COPY --from=prod-deps --chown=nexa:nexa /repo/apps/rtm/node_modules ./apps/rtm/node_modules
# Workspace deps (workspace:* protocol — always symlinked to real source, never
# through the store): @nexa/types only (@nexa/rtm's sole workspace dependency),
# compiled — see the patch step in `build` above.
COPY --from=build --chown=nexa:nexa /repo/packages/types/dist ./packages/types/dist
COPY --from=build --chown=nexa:nexa /repo/packages/types/package.json ./packages/types/package.json
# Compiled output + manifest (Node needs a nearest package.json with
# "type": "module" to load dist/**/*.js as ESM).
COPY --from=build --chown=nexa:nexa /repo/apps/rtm/dist ./apps/rtm/dist
COPY --from=build --chown=nexa:nexa /repo/apps/rtm/package.json ./apps/rtm/package.json

WORKDIR /repo/apps/rtm
USER nexa
EXPOSE 4001
# /health/ready (not /health/live, M-OPS-a) — same reasoning as apps/api/Dockerfile.
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
    CMD curl -fsS "http://127.0.0.1:${RTM_PORT:-4001}/health/ready" || exit 1

CMD ["node", "dist/src/index.js"]
