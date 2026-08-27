# syntax=docker/dockerfile:1
# Nexa web (agent app) — multi-stage build (tm 140.2, M-CONTAINER-b). Local/dev
# images only: no production deploy, no real secrets baked in (CLAUDE.md /
# MASTER-PROMPT limits).
#
# Two things this app needs at *runtime* that a plain static build does not
# give it for free:
#
#   API base  — `ApiClient` already defaults to a same-origin relative
#     `/api/v1` (apps/web/src/lib/api-client.ts:89), exactly what a reverse
#     proxy in front of a static bundle wants. nginx.conf below proxies
#     `/api/` to the api service over the compose network (`API_UPSTREAM`,
#     default `http://api:4000`) so the browser never needs to know the api
#     container's address. No source change needed.
#
#   RTM base  — the RTM client is a WebSocket, and a WebSocket URL's scheme
#     must be `ws`/`wss` up front (the constructor resolves a bare relative
#     path against the page's http(s) origin and then rejects it — measured
#     against the WHATWG spec, not guessed), so it cannot default to a plain
#     relative path the way the HTTP client does. `useInbox.ts` already reads
#     `import.meta.env['VITE_RTM_URL']` before falling back to a hard-coded
#     `ws://localhost:4001/...` — this is the "build-time env" option the
#     task text offers as an alternative to an nginx proxy, and it needs no
#     source change either. The default below assumes the rtm container's
#     port is published to the host as 4001, matching `.env.example`'s
#     RTM_PORT and dev parity; override `--build-arg VITE_RTM_URL=...` if a
#     compose file (tm 140.3) publishes it differently, or point it at this
#     image's own published host:port and use the `/v1/agent/rtm/ws` proxy
#     location nginx.conf also carries, to route RTM through nginx instead of
#     dialling the rtm container directly.
ARG NODE_IMAGE=node:24-alpine
ARG PNPM_VERSION=11.15.1
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo
# BuildKit cache mount keeps the content-addressable store across separate
# `docker build` invocations; longer timeout/more retries because this
# environment reaches the registry through a slow proxy (mirrors
# apps/api/Dockerfile's measured setting).
RUN pnpm config set store-dir /pnpm-store \
    && pnpm config set fetch-timeout 300000 \
    && pnpm config set fetch-retries 5

# ---- build: filtered workspace install (`@nexa/web` + the workspace packages
# it depends on — just `@nexa/types`, so this skips apps/api's, apps/rtm's and
# apps/mobile's much larger dependency trees) + `vite build`. `@nexa/types`'s
# package.json points "main"/"exports" at raw `src/index.ts` (unlike the
# compiled-dist patch apps/api/Dockerfile needs for plain `node`) — Vite's
# esbuild transform handles `.ts` files it resolves through node_modules the
# same way it handles project source, so no patch step is needed here. ----
FROM base AS build
COPY . .
RUN --mount=type=cache,id=nexa-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter @nexa/web...
ARG VITE_RTM_URL=ws://localhost:4001/v1/agent/rtm/ws
ENV VITE_RTM_URL=${VITE_RTM_URL}
RUN pnpm --filter @nexa/web... run build

# ---------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime
# `nginx-unprivileged` runs the master process as the image's own non-root
# user on an unprivileged port (8080) out of the box — the same "no root in
# the running container" goal as apps/api|rtm's `nexa` user, without needing
# to reimplement nginx's own privilege-drop plumbing.
COPY --from=build --chown=nginx:nginx /repo/apps/web/dist /usr/share/nginx/html
# The stock image's own entrypoint (`/docker-entrypoint.d/20-envsubst-on-templates.sh`)
# renders every `*.template` under here through `envsubst`, restricted to
# names that are actually set as container env vars — nginx's own request
# variables (`$host`, `$http_upgrade`, ...) are never env vars, so they pass
# through untouched. That is what makes `${API_UPSTREAM}`/`${RTM_UPSTREAM}`
# safe to leave unbraced-`$`-free in nginx.conf: only those two get replaced.
COPY apps/web/nginx.conf /etc/nginx/templates/default.conf.template
# `CSP_CONNECT_EXTRA` is the origin list the panel's Content-Security-Policy
# allows on top of `'self'` (M-PROD-CFG-b). Same-origin REST needs nothing here;
# the RTM WebSocket does, because its address is baked into the bundle by
# VITE_RTM_URL above and a WebSocket URL can never be same-origin-relative. The
# default therefore has to track that build arg's default — both schemes,
# because whether the deployment is behind TLS is not this image's decision.
# Set to empty to drop RTM from the policy, or to your own RTM origin.
ENV API_UPSTREAM=http://api:4000 \
    RTM_UPSTREAM=http://rtm:4001 \
    CSP_CONNECT_EXTRA="ws://localhost:4001 wss://localhost:4001"

EXPOSE 8080
# BusyBox `wget` ships in the base Alpine image already — no extra package
# for a healthcheck the way apps/api|rtm's `curl` needed installing.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:8080/index.html >/dev/null || exit 1
