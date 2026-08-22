# syntax=docker/dockerfile:1
# Nexa widget (customer-facing loader + iframe) — multi-stage build (tm 140.2,
# M-CONTAINER-b). Local/dev images only: no production deploy, no real
# secrets baked in (CLAUDE.md / MASTER-PROMPT limits).
#
# No "correct origin" build arg is needed here, on purpose: Vite's asset base
# defaults to `/` (apps/widget/vite.config.ts sets no `base`), so every URL
# the built `loader.js`/`widget.html`/`chat.html` reference is root-relative —
# whatever host:port this image ends up published on automatically becomes
# the widget's origin. The customer-facing knob is `widgetOrigin` in the
# snippet's `window.__nexa` config (apps/widget/src/loader.ts), which already
# points at wherever this container is reachable; nothing here needs to know
# that address in advance or bake it in.
#
# The widget's own upstream API call defaults to `http://localhost:4000/api/v1`
# (apps/widget/src/widget.ts readConfig) — unlike the web app's relative
# `/api/v1`, so it isn't a same-origin path an nginx proxy could intercept.
# That default already matches this compose's api port-publishing convention
# (dev parity, `.env.example` API_PORT=4000), so it works unmodified for the
# local/yerel scope this task covers; a real deployment would set `?api=` on
# the loader's iframe URL, which is out of scope here (M-CONTAINER is local
# only).
ARG NODE_IMAGE=node:24-alpine
ARG PNPM_VERSION=11.15.1
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.27-alpine

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo
RUN pnpm config set store-dir /pnpm-store \
    && pnpm config set fetch-timeout 300000 \
    && pnpm config set fetch-retries 5

# ---- build: filtered workspace install (`@nexa/widget` + `@nexa/types`,
# skipping every other app's much larger dependency tree) + the two-pass
# `vite build` (loader IIFE, then the widget/chat app — see
# apps/widget/vite.config.ts's own comment on why it is two passes). ----
FROM base AS build
COPY . .
RUN --mount=type=cache,id=nexa-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter @nexa/widget...
RUN pnpm --filter @nexa/widget... run build

# ---------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime
# Same non-root rationale as apps/web/Dockerfile: `nginx-unprivileged` runs
# entirely as a non-root user on port 8080, no custom USER plumbing needed.
COPY --from=build --chown=nginx:nginx /repo/apps/widget/dist /usr/share/nginx/html
COPY apps/widget/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080
# `loader.js` is the one file every embed depends on being reachable; a
# customer's own page breaks the moment it 404s or hangs.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:8080/loader.js >/dev/null || exit 1
