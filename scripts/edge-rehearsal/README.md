# Edge rehearsal (tm 257.10)

The pilot has two edges: a Cloudflare Tunnel now
([`infra/pilot/cloudflared/config.example.yml`](../../infra/pilot/cloudflared/config.example.yml)) and
Caddy, reached directly (DNS-only), later
([`infra/pilot/Caddyfile.example`](../../infra/pilot/Caddyfile.example)). Both are written for
`TRUST_PROXY_HOPS=1`. This folder checks that claim on one machine, before any real tunnel
exists. It puts one of the two edges in front of a running api, sends requests through it
with a forged `X-Forwarded-For: 203.0.113.77`, and lets the api's own request log decide.

## Run it

The api has to listen on `127.0.0.1:4000` (the port both edge configs name) and write its
log to a file. `pnpm dev`'s api and the pilot stack's api both log every request at
`info`; capture the output, for example:

```bash
set -a && . ./.env && set +a
(cd apps/api && npx tsx src/index.ts > /tmp/api.log 2>&1 &)

API_LOG=/tmp/api.log scripts/edge-rehearsal/run.sh tunnel
API_LOG=/tmp/api.log scripts/edge-rehearsal/run.sh caddy
```

Each run sends two requests through the edge, each with its own `X-Request-Id`
(`edge-probe-…`): one on the api's name and one on the panel's `/api/` path. For each, it
reads the address the edge saw (the edge's log) and the address the api derived (the
`remoteAddress` field of the api's `incoming request` line). Exit code 0 means both
passed.

| Reading                                   | Meaning                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `PASS`                                    | The api derived exactly the visitor the edge saw.                                                                                            |
| api derived `203.0.113.77`                | The api believed the forged entry: `TRUST_PROXY_HOPS` is higher than the hops on this path, or the request reached the api without the edge. |
| api derived another address (`127.0.0.1`) | `TRUST_PROXY_HOPS` is lower than the hops on this path: the edge, or a second proxy such as the panel's nginx, appended an entry of its own. |
| no api line                               | Request logging is off, `LOG_LEVEL` is above `info`, or `req.remoteAddress` is redacted.                                                     |

## The two halves

**`tunnel`** runs [`tunnel-mimic.mjs`](tunnel-mimic.mjs), a small Node proxy standing in
for the tunnel. It routes by the ingress rules of the example config, read from the file,
first match wins. It passes WebSocket upgrades through and answers unknown names with the
config's 404. Its header behaviour is the tunnel's documented **default**, nothing more: the
visitor's address is appended to whatever the visitor sent, and the service is dialled
from `127.0.0.1`. It listens on `[::1]`, so the local visitor is `::1`, which is neither the
forged entry nor the `127.0.0.1` the api sees as its peer.

**`caddy`** runs the real Caddy (`caddy:2-alpine`). It validates the example as written,
then adapts a copy so it can run on one machine without a certificate: every site on plain
http with an access log. On Docker Desktop, which has no host network, the upstreams become
`host.docker.internal`. The routing, the panel's `/api/*` rule and the absence of
`trusted_proxies` are the example's own. The script does not pull the image.

Two negative controls show that the probe can fail:

```bash
EDGE_MIMIC_APPEND_SELF=1 API_LOG=/tmp/api.log scripts/edge-rehearsal/run.sh tunnel  # one hop short
: > /tmp/empty.log
node scripts/edge-rehearsal/probe.mjs http://127.0.0.1:4000 /tmp/api.log /tmp/empty.log  # edge skipped
```

## What this proves, and what it cannot

It proves that, behind an edge that builds the header the way the tunnel does by default,
or the way Caddy does, the api reads the visitor on both public paths, and that a forged
entry gets nowhere. It also proves the panel's `/api/` rule sits above the catch-all in the
tunnel config, and that the Caddyfile is valid Caddy.

It does **not** prove that the real Cloudflare edge and the real cloudflared build the
header that way. The mimic is a model of the default, not a measurement of Cloudflare.
Zone settings can change the header (Pseudo IPv4 set to overwrite headers, the "Remove
visitor IP headers" managed transform), and a cloudflared release could append an entry of
its own. Neither shows up here. The real tunnel is measured on opening day, in the same
way: a forged `X-Forwarded-For` and an `X-Request-Id` sent to the real names, the
`remoteAddress` read from the api's log, compared with the address
`https://<panel name>/cdn-cgi/trace` reports for the same machine. If it reads one short,
the fix is `TRUST_PROXY_HOPS=2` in `.env`, and no code changes.

The mimic sends no `X-Forwarded-Proto` and terminates no TLS, so it says nothing about HSTS.
`SMOKE_PROFILE=pilot ./scripts/smoke.sh` checks HSTS and the rtm WebSocket upgrade against
the real https names.

**Both this rehearsal and the opening-day check read `req.remoteAddress` from the api's
request log.** Fastify's request serializer writes `request.ip` there, the address every
gate uses. If that field is ever redacted (`apps/api/src/server.ts`, `redact.paths`), or
production request logging is switched off, both measurements stop working. Provide
another way to read `request.ip` before you remove it.

## Measured (2026-10-02, Windows, Docker Desktop)

The `pnpm dev` api with the default `TRUST_PROXY_HOPS=1`:

| Edge                              | Visitor the edge saw | api derived    | Result  |
| --------------------------------- | -------------------- | -------------- | ------- |
| tunnel mimic (api, panel `/api/`) | `::1`                | `::1`          | PASS ×2 |
| Caddy (api, panel `/api/`)        | `172.17.0.1`         | `172.17.0.1`   | PASS ×2 |
| mimic appending its own entry     | `::1`                | `127.0.0.1`    | FAIL ×2 |
| probe straight at the api         | none                 | `203.0.113.77` | FAIL ×2 |
