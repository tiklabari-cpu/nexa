#!/usr/bin/env bash
#
# Smoke test for the containerised stack (tm 140.3, M-CONTAINER-c).
#
# Answers one question with exit codes rather than opinion: after
# `docker compose -f docker-compose.full.yml up --build -d`, is the product
# actually reachable and actually wired to itself? Each check below is a seam
# that a container stack breaks in a way `pnpm dev` never does — a service name
# that does not resolve, a proxy pointing at nothing, an app started before its
# schema existed, a seed that never ran.
#
# Run it directly (`./scripts/smoke.sh`) or through `make demo`, which brings
# the stack up first. Needs only `curl` and a shell.
#
# Override any base URL to point at a stack published elsewhere:
#   API_BASE=http://127.0.0.1:4000 ./scripts/smoke.sh
set -uo pipefail

API_BASE="${API_BASE:-http://localhost:4000}"
RTM_BASE="${RTM_BASE:-http://localhost:4001}"
WEB_BASE="${WEB_BASE:-http://localhost:5173}"
WIDGET_BASE="${WIDGET_BASE:-http://localhost:5174}"

# How long to keep retrying before calling the stack dead. A cold `up` has to
# initialise Postgres, apply every migration and run the seed before the api
# answers at all; on a first run that is minutes, not seconds.
READY_TIMEOUT_S="${READY_TIMEOUT_S:-300}"
# Seeded owner of the "Acme Bikes" demo workspace (apps/api/prisma/seed.ts).
DEMO_EMAIL="${DEMO_EMAIL:-owner@acme.localhost}"
DEMO_PASSWORD="${DEMO_PASSWORD:-nexa-demo-password}"

passed=0
failed=0
body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

pass() {
  passed=$((passed + 1))
  printf '  ok    %s\n' "$1"
}

fail() {
  failed=$((failed + 1))
  printf '  FAIL  %s\n' "$1"
  [ -n "${2:-}" ] && printf '        %s\n' "$2"
  return 0
}

# Set to send a cross-origin request the way a browser would; empty means
# same-origin, which is when a browser sends no `Origin` header at all.
origin_header=''

# GET/POST once. Writes the body to $body_file, echoes the status code.
request() {
  local method="$1" url="$2" data="${3:-}"
  local args=(-sS -o "$body_file" -w '%{http_code}' -X "$method" --max-time 15)
  [ -n "$origin_header" ] && args+=(-H "Origin: $origin_header")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' --data "$data")
  curl "${args[@]}" "$url" 2>/dev/null || echo 000
}

# One check: status code must match, and (optionally) the body must contain a
# string. A body assertion is what separates "something answered on that port"
# from "the thing we meant answered".
check() {
  local label="$1" method="$2" url="$3" want_status="$4" want_body="${5:-}" data="${6:-}"
  local status
  status="$(request "$method" "$url" "$data")"
  if [ "$status" != "$want_status" ]; then
    fail "$label" "expected HTTP $want_status from $url, got $status"
    return 1
  fi
  if [ -n "$want_body" ] && ! grep -q -- "$want_body" "$body_file"; then
    fail "$label" "HTTP $want_status from $url but the body does not contain '$want_body'"
    return 1
  fi
  pass "$label"
  return 0
}

# Poll until a URL answers 200, or the deadline passes. Used once, on the api's
# health endpoint: everything else in the stack depends on it, so waiting here
# means the rest of the checks either pass or have failed for their own reason.
wait_for() {
  local label="$1" url="$2"
  local deadline=$((SECONDS + READY_TIMEOUT_S)) status=000
  printf '  ...   waiting for %s (up to %ss)\n' "$label" "$READY_TIMEOUT_S"
  while [ "$SECONDS" -lt "$deadline" ]; do
    status="$(request GET "$url")"
    [ "$status" = "200" ] && return 0
    sleep 3
  done
  fail "$label is not answering" "last status $status from $url after ${READY_TIMEOUT_S}s"
  return 1
}

printf '\nNexa smoke test — containerised stack\n'
printf '  api %s · rtm %s · web %s · widget %s\n\n' \
  "$API_BASE" "$RTM_BASE" "$WEB_BASE" "$WIDGET_BASE"

printf 'Readiness\n'
wait_for 'the api' "$API_BASE/api/v1/health"

printf '\nServices\n'
# `/health` probes Postgres and Redis for real rather than reporting a cached
# flag, so "status":"ok" here is also the datastores' result.
check 'api /health is ok (Postgres + Redis reachable)' \
  GET "$API_BASE/api/v1/health" 200 '"status":"ok"'
# The six background sweeps (M-SCHED) tick inside the api process. A stack
# where none of them run looks identical to one with nothing to do — which is
# why /health reports the scheduler and why this asserts on it.
check 'api /health reports the scheduler enabled' \
  GET "$API_BASE/api/v1/health" 200 '"enabled":true'
check 'rtm /health is ok' \
  GET "$RTM_BASE/health" 200 '"status":"ok"'

printf '\nStatic surfaces\n'
check 'web serves the agent app' GET "$WEB_BASE/" 200 '<div id="root">'
# Any client-routed path has to resolve to the same document, or a reload
# anywhere inside the app 404s.
check 'web SPA fallback serves a client route' GET "$WEB_BASE/app/inbox" 200 '<div id="root">'
# The snippet a customer pastes into their own page. Asserting on the IIFE's
# global name, not just the status: an SPA fallback in front of the wrong
# service answers 200 for any path at all (measured — it passed this check
# against the agent app until the body assertion was added).
check 'widget serves loader.js' GET "$WIDGET_BASE/loader.js" 200 '__nexaLoader'
# The hosted Chat page (FR-MOD-08.5.9) — the demo entry point for the customer
# half of the product in this stack, since the dev-only `demo.html` host page
# is a Vite dev-server document (it loads `/src/loader.ts`) and is not part of
# the built image.
check 'widget serves the hosted Chat page' GET "$WIDGET_BASE/chat.html" 200 'nexa-widget-root'

printf '\nWiring\n'
# The seam this stack adds and `pnpm dev` does not have: the browser calls the
# agent app's own origin, and nginx forwards to the `api` service by name over
# the compose network. If that resolves to nothing, the app loads and then
# fails at every request.
check 'web proxies /api to the api service' \
  GET "$WEB_BASE/api/v1/health" 200 '"status":"ok"'
# Proves the schema was migrated AND the seed ran AND password auth works —
# one request that fails if any of the three did not happen.
check 'seeded demo owner can sign in' \
  POST "$API_BASE/api/v1/auth/login" 200 '"memberships"' \
  "{\"email\":\"$DEMO_EMAIL\",\"password\":\"$DEMO_PASSWORD\"}"
# Reuse that response rather than hard-coding a UUID the seed regenerates.
organization_id="$(grep -o '"organization_id":"[^"]*"' "$body_file" | head -1 | cut -d'"' -f4)"

# The other half of the product: a visitor's browser, on the widget's origin,
# minting a customer token from the api's. Cross-origin, so it also exercises
# the CORS decision this stack's NODE_ENV setting turns on.
if [ -n "$organization_id" ]; then
  origin_header="$WIDGET_BASE"
  check 'a visitor can mint a customer token from the widget origin' \
    POST "$API_BASE/api/v1/customer/token" 200 '"token"' \
    "{\"organization_id\":\"$organization_id\",\"host_origin\":\"$WIDGET_BASE\"}"
  origin_header=''
else
  fail 'a visitor can mint a customer token from the widget origin' \
    'sign-in did not return an organization_id to try it with'
fi

printf '\n%s passed, %s failed\n' "$passed" "$failed"
if [ "$failed" -gt 0 ]; then
  printf '\nStack state:\n'
  docker compose -f docker-compose.full.yml ps 2>/dev/null || true
  printf '\nRecent logs:\n'
  docker compose -f docker-compose.full.yml logs --tail 40 2>/dev/null || true
  exit 1
fi
printf 'Stack is up and wired.\n'
printf '  agent app   %s   (%s / %s)\n' "$WEB_BASE" "$DEMO_EMAIL" "$DEMO_PASSWORD"
[ -n "$organization_id" ] &&
  printf '  visitor     %s/chat.html?organization_id=%s\n' "$WIDGET_BASE" "$organization_id"
exit 0
