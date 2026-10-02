#!/usr/bin/env bash
#
# The local edge rehearsal (tm 257.10): one of the pilot's two edges in front
# of a running api, a forged X-Forwarded-For sent through it, and the api's own
# request log as the judge. README.md next to this file has the whole story.
#
#   API_LOG=<file the api writes its log to> scripts/edge-rehearsal/run.sh tunnel
#   API_LOG=<file the api writes its log to> scripts/edge-rehearsal/run.sh caddy
#
# The api must listen on 127.0.0.1:4000, the port both edge configs name, with
# its request log on: `pnpm dev`'s api and the pilot stack's both qualify.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
EDGE="${1:-}"
API_LOG="${API_LOG:?set API_LOG to the file the api writes its log to}"
WORK="$(mktemp -d)"
edge_pid=''
follow_pid=''
container=''

cleanup() {
  [ -n "$edge_pid" ] && kill "$edge_pid" 2>/dev/null
  [ -n "$follow_pid" ] && kill "$follow_pid" 2>/dev/null
  [ -n "$container" ] && docker rm -f "$container" >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

# A host path as Docker sees it — Git Bash on Windows hands docker a Windows path.
host_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi
}

# Poll a command until it succeeds, for up to ten seconds.
await() {
  local i
  for i in $(seq 1 50); do
    if "$@"; then return 0; fi
    sleep 0.2
  done
  return 1
}

case "$EDGE" in
  tunnel)
    port="${EDGE_MIMIC_PORT:-8788}"
    EDGE_MIMIC_PORT="$port" node "$HERE/tunnel-mimic.mjs" >"$WORK/edge.log" 2>"$WORK/edge.err" &
    edge_pid=$!
    await grep -q 'tunnel-mimic:' "$WORK/edge.err" || {
      cat "$WORK/edge.err" >&2
      exit 1
    }
    cat "$WORK/edge.err"
    node "$HERE/probe.mjs" "http://[::1]:$port" "$API_LOG" "$WORK/edge.log"
    ;;

  caddy)
    image='caddy:2-alpine'
    if ! docker image inspect "$image" >/dev/null 2>&1; then
      printf '%s is not present locally, and this script does not pull it (docker pull %s).\n' \
        "$image" "$image" >&2
      exit 3
    fi
    port="${EDGE_CADDY_PORT:-8789}"
    example="$REPO/infra/pilot/Caddyfile.example"

    # The example as written must be valid Caddy, before it is adapted below.
    MSYS_NO_PATHCONV=1 docker run --rm -v "$(host_path "$example"):/etc/caddy/Caddyfile:ro" \
      "$image" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || {
      printf 'caddy validate refused infra/pilot/Caddyfile.example\n' >&2
      exit 1
    }

    # Runnable on one machine, with no certificate: every site on plain http,
    # each with an access log (the probe's record of what Caddy saw). On Linux
    # Caddy shares the host's network, so the example's 127.0.0.1 upstreams
    # stand as written; Docker Desktop has no host network, so they become
    # host.docker.internal. The routing, the panel's /api/* rule and the
    # absence of trusted_proxies are the example's own.
    if [ "$(uname -s)" = Linux ]; then
      site_port=":$port" upstream='127.0.0.1' network=(--network host)
    else
      site_port='' upstream='host.docker.internal' network=(-p "127.0.0.1:$port:80")
    fi
    awk -v site_port="$site_port" -v upstream="$upstream" '
      /^[a-z0-9.-]+\.example\.com \{$/ {
        sub(/ \{$/, "")
        print "http://" $0 site_port " {"
        print "\tlog"
        next
      }
      { gsub(/127\.0\.0\.1:/, upstream ":"); print }
    ' "$example" >"$WORK/Caddyfile"

    container="siyahtus-edge-rehearsal-$$"
    MSYS_NO_PATHCONV=1 docker run -d --name "$container" "${network[@]}" \
      -v "$(host_path "$WORK/Caddyfile"):/etc/caddy/Caddyfile:ro" "$image" >/dev/null
    docker logs -f "$container" >"$WORK/edge.log" 2>&1 &
    follow_pid=$!
    await grep -q 'serving initial configuration' "$WORK/edge.log" || {
      cat "$WORK/edge.log" >&2
      exit 1
    }
    printf 'caddy: %s on 127.0.0.1:%s, adapted from %s\n' "$image" "$port" "$example"
    node "$HERE/probe.mjs" "http://127.0.0.1:$port" "$API_LOG" "$WORK/edge.log"
    ;;

  *)
    printf 'usage: API_LOG=<api log> %s tunnel|caddy\n' "$0" >&2
    exit 2
    ;;
esac
