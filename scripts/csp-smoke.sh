#!/usr/bin/env bash
#
# The production Content-Security-Policy in a real browser (tm 434 · audit F16).
#
# The e2e suite runs on Vite's dev servers, which send no CSP; the policy lives
# only in the images' nginx configs. This script measures the built images:
#
#   1. builds and starts docker-compose.full.yml's api, rtm, web and widget
#      (with their db, redis and the migrate + seed `init`) under a compose
#      project of its own, so the demo stack's volumes are never touched, and on
#      ports of its own (scripts/csp-smoke.compose.yml: 14000, 14001, 15173,
#      15174), so a running `pnpm dev` is no obstacle;
#   2. runs apps/e2e/tests/csp-smoke.spec.ts (`playwright.csp.config.ts`):
#      the panel's sign-in, inbox and RTM socket, and the widget embedded in a
#      customer's page sending a message — red on any CSP violation the browser
#      reports, and red if a document arrives without a policy at all;
#   3. removes the project and its volumes again (`down -v`, same `-p`).
#
#   scripts/csp-smoke.sh
#
# Options, all environment variables:
#   CSP_SMOKE_PROJECT=<name>  the compose project (default siyahtus-csp-smoke-<pid>)
#   CSP_SMOKE_BUILD=0         start the images as they are, without `--build`
#   CSP_SMOKE_KEEP=1          leave the stack running afterwards (the line that
#                             removes it is printed)
#   CSP_SMOKE_{API,RTM,WEB,WIDGET}_PORT  the published ports, if the defaults are taken
#
# Run it after a change that makes the panel or the widget load anything from
# a new place — an image host, a font, a frame, another API — and before a
# pilot release (docs/production-checklist.md §9, "Now: Cloudflare Tunnel").
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

project="${CSP_SMOKE_PROJECT:-siyahtus-csp-smoke-$$}"
compose=(docker compose -p "$project" -f docker-compose.full.yml -f scripts/csp-smoke.compose.yml)

# The config and the spec read the same variables (apps/e2e/tests/csp-smoke-stack.ts).
export CSP_SMOKE_API_PORT="${CSP_SMOKE_API_PORT:-14000}"
export CSP_SMOKE_RTM_PORT="${CSP_SMOKE_RTM_PORT:-14001}"
export CSP_SMOKE_WEB_PORT="${CSP_SMOKE_WEB_PORT:-15173}"
export CSP_SMOKE_WIDGET_PORT="${CSP_SMOKE_WIDGET_PORT:-15174}"

for port in "$CSP_SMOKE_API_PORT" "$CSP_SMOKE_RTM_PORT" "$CSP_SMOKE_WEB_PORT" "$CSP_SMOKE_WIDGET_PORT"; do
  if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/"; then
    printf 'csp-smoke: something already answers on 127.0.0.1:%s — pick another CSP_SMOKE_*_PORT.\n' \
      "$port" >&2
    exit 2
  fi
done

cleanup() {
  if [ "${CSP_SMOKE_KEEP:-0}" = 1 ]; then
    printf 'csp-smoke: left running — %s down -v\n' "${compose[*]}"
    return
  fi
  "${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT

build=(--build)
[ "${CSP_SMOKE_BUILD:-1}" = 0 ] && build=()

printf 'csp-smoke: starting the built images (project %s)\n' "$project"
"${compose[@]}" up "${build[@]}" -d --wait api rtm web widget

printf 'csp-smoke: running the browser check\n'
pnpm --filter @siyahtus/e2e test:csp
