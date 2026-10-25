# syntax=docker/dockerfile:1
# SiyahTuş admin (root / platform panel) — multi-stage build (tm 389.6). Same shape as
# apps/web/Dockerfile: local/dev images only, no production deploy, no real secrets baked in
# (CLAUDE.md / MASTER-PROMPT limits).
#
# What this app needs at *runtime* that a plain static build does not give it for free:
#
#   Platform API base — `ApiClient` defaults to the same-origin relative `/platform/v1`,
#     exactly what a reverse proxy in front of a static bundle wants. nginx.conf proxies
#     `/platform/` to the platform-api service over the compose network (`PLATFORM_UPSTREAM`)
#     so the browser never needs to know that container's address.
#
# There is no RTM/WebSocket, no widget URL and no second origin: nothing here is built in from
# a `VITE_*` argument, and the CSP's `connect-src` is `'self'` (test/nginx-security.test.ts).
ARG NODE_IMAGE=node:24-alpine
ARG PNPM_VERSION=11.15.1
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo
# BuildKit cache mount keeps the content-addressable store across separate `docker build`
# invocations; longer timeout/more retries because the registry is reached through a slow proxy
# (mirrors apps/api/Dockerfile's measured setting).
RUN pnpm config set store-dir /pnpm-store \
    && pnpm config set fetch-timeout 300000 \
    && pnpm config set fetch-retries 5

# ---- build: filtered workspace install (`@siyahtus/admin` + the workspace packages it depends
# on — `@siyahtus/types`, and `@siyahtus/contract` for its generated types, which are erased at
# build) + `vite build`. Both packages point "main"/"exports" at raw `src/*.ts`; Vite's esbuild
# transform handles `.ts` it resolves through node_modules like project source. ----
FROM base AS build
COPY . .
RUN --mount=type=cache,id=siyahtus-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter @siyahtus/admin...
# No source maps in the image: served from `/assets/`, a `.map` hands anyone the panel's
# original TypeScript, comments included. `vite.config.ts` turns them off on this one variable;
# a local `pnpm build` keeps them. The check after the build fails the image rather than
# trusting the switch — a map file, or a bundle still naming one, stops it here.
ENV SIYAHTUS_BUILD_SOURCEMAPS=false
RUN pnpm --filter @siyahtus/admin... run build     && if find apps/admin/dist -name '*.map' | grep -q .         || grep -rlq 'sourceMappingURL=' apps/admin/dist; then         echo 'apps/admin/dist still carries source maps' >&2; exit 1;     fi

# ---------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime
# `nginx-unprivileged` runs the master process as the image's own non-root user on an
# unprivileged port (8080) out of the box.
COPY --from=build --chown=nginx:nginx /repo/apps/admin/dist /usr/share/nginx/html
# The stock image's entrypoint renders every `*.template` under here through `envsubst`,
# restricted to names that are actually set as container env vars — nginx's own request
# variables (`$host`, `$http_upgrade`, ...) are never env vars, so they pass through untouched.
COPY apps/admin/nginx.conf /etc/nginx/templates/default.conf.template
ENV PLATFORM_UPSTREAM=http://platform-api:4002

EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:8080/index.html >/dev/null || exit 1
