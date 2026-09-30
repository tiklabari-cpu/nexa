# syntax=docker/dockerfile:1
# SiyahTuş widget (customer-facing loader + iframe) — multi-stage build (tm 140.2,
# M-CONTAINER-b). Local/dev images only: no production deploy, no real
# secrets baked in (CLAUDE.md / MASTER-PROMPT limits).
#
# No "correct origin" build arg is needed here, on purpose: Vite's asset base
# defaults to `/` (apps/widget/vite.config.ts sets no `base`), so every URL
# the built `loader.js`/`widget.html`/`chat.html` reference is root-relative —
# whatever host:port this image ends up published on automatically becomes
# the widget's origin. The customer-facing knob is `widgetOrigin` in the
# snippet's `window.__siyahtus` config (apps/widget/src/loader.ts), which already
# points at wherever this container is reachable; nothing here needs to know
# that address in advance or bake it in.
#
# The widget's own upstream API call is the one address that DOES have to be
# baked in: unlike the web app's relative `/api/v1` it is cross-origin, so no
# nginx proxy here can intercept it, and the loader never forwards one to the
# iframe. `VITE_API_BASE_URL` (the build stage below) sets it; unset, it
# defaults to `http://localhost:4000/api/v1` (apps/widget/src/widget.ts
# readConfig), which is the demo stack's published api port and nothing else.
# The pilot compose passes its public API_BASE_URL (tm 255.15) — before that,
# a widget built from this file called the visitor's own localhost.
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

# ---- build: filtered workspace install (`@siyahtus/widget` + `@siyahtus/types`,
# skipping every other app's much larger dependency tree) + the two-pass
# `vite build` (loader IIFE, then the widget/chat app — see
# apps/widget/vite.config.ts's own comment on why it is two passes). ----
FROM base AS build
ARG VITE_API_BASE_URL=http://localhost:4000/api/v1
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY . .
RUN --mount=type=cache,id=siyahtus-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --filter @siyahtus/widget...
# No source maps in the image (tm 256.5), for the same reason as
# apps/web/Dockerfile: `vite.config.ts` turns them off on this variable for
# both passes, and the check fails the image if either pass left one behind.
ENV SIYAHTUS_BUILD_SOURCEMAPS=false
RUN pnpm --filter @siyahtus/widget... run build     && if find apps/widget/dist -name '*.map' | grep -q .         || grep -rlq 'sourceMappingURL=' apps/widget/dist; then         echo 'apps/widget/dist still carries source maps' >&2; exit 1;     fi

# ---------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime
# Same non-root rationale as apps/web/Dockerfile: `nginx-unprivileged` runs
# entirely as a non-root user on port 8080, no custom USER plumbing needed.
COPY --from=build --chown=nginx:nginx /repo/apps/widget/dist /usr/share/nginx/html
# Templated since M-PROD-CFG-b (it used to be copied straight to conf.d): the
# security profile has to name the API origin the widget document may call, and
# unlike the web app the widget has no same-origin backend to fall back on, so
# an unset value would break every install rather than merely tighten it. The
# default matches `apps/widget/src/widget.ts`'s own `apiBaseUrl` default and
# this compose's api port-publishing convention; a deployment sets its real API
# origin. The stock entrypoint renders `/etc/nginx/templates/*.template` into
# /etc/nginx/conf.d — see apps/web/Dockerfile for why nginx's own `$uri` and
# friends survive that pass untouched.
COPY apps/widget/nginx.conf /etc/nginx/templates/default.conf.template
ENV CSP_CONNECT_EXTRA="http://localhost:4000 ws://localhost:4001"

EXPOSE 8080
# `loader.js` is the one file every embed depends on being reachable; a
# customer's own page breaks the moment it 404s or hangs.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:8080/loader.js >/dev/null || exit 1
