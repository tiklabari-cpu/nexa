# Nexa

Live support + AI customer service platform. A working implementation built from the
requirement package in this repository root (`urun-gereksinim-dokumani-PRD.md`,
`rapor-1-fonksiyonel.md`, `rapor-2-teknik-mimari.md`, `v2-derin-analiz/`).

> **Schema source of truth:** PRD §8.4 + rapor-2 §5.3.
> The legacy `LiveChat_ER_Diyagram.mermaid` contradicts both and is not used.

---

## Quick start

Requires Node 24, pnpm 11 and a running Docker daemon.

```bash
make dev
```

That single command installs dependencies, starts Postgres and Redis, waits for them to
become healthy, applies migrations, seeds demo data, and starts every app.

| Surface         | URL                                       |
| --------------- | ----------------------------------------- |
| Agent app       | http://localhost:5173                     |
| REST API        | http://localhost:4000/api/v1              |
| RTM (WebSocket) | ws://localhost:4001/v1/agent/rtm/ws       |
| Widget          | http://localhost:5174                     |
| Postgres        | `localhost:5433` (user `nexa`, db `nexa`) |
| Redis           | `localhost:6380`                          |

Ports are offset from the defaults so Nexa never collides with a Postgres or Redis you
already run locally.

Check everything is alive:

```bash
curl -s http://localhost:4000/api/v1/health | jq
```

### Other useful targets

```bash
make help
```

| Target                       | Does                                                  |
| ---------------------------- | ----------------------------------------------------- |
| `make up` / `make down`      | Start / stop datastores (data volumes survive `down`) |
| `make clean`                 | Stop **and drop** the data volumes                    |
| `make migrate` / `make seed` | Apply migrations / load demo data                     |
| `make psql`                  | Open a psql shell inside the database container       |
| `make backup`                | Back up the dev datastore — see "Backups" below       |
| `make restore-drill`         | Prove that backup restores — see "Backups" below      |
| `make verify`                | Everything CI runs: typecheck, lint, tests            |
| `make test-e2e`              | Playwright end-to-end suite                           |

> `psql` is not required on the host — `make psql` runs it inside the container.

---

## Run the whole stack in containers

`make dev` needs Node, pnpm and this checkout. `make demo` needs none of them — every
app is built into its own image and the whole product comes up from one file:

```bash
make demo        # docker compose -f docker-compose.full.yml up --build -d + scripts/smoke.sh
```

The first build takes a while (it installs and compiles four apps); afterwards Docker's
layer cache makes it quick. When it finishes, `scripts/smoke.sh` checks the stack is
genuinely wired — both health endpoints, the agent app, its same-origin `/api` proxy into
the `api` container, the widget's loader and hosted Chat page, and a real sign-in with the
seeded demo account — and exits non-zero if any of them is wrong.

| Surface                    | URL                                                    |
| -------------------------- | ------------------------------------------------------ |
| Agent app                  | http://localhost:5173                                  |
| REST API                   | http://localhost:4000/api/v1                           |
| RTM (WebSocket)            | ws://localhost:4001/v1/agent/rtm/ws                    |
| Widget loader              | http://localhost:5174/loader.js                        |
| Hosted Chat page (visitor) | http://localhost:5174/chat.html?organization_id=`<id>` |

Sign in with the seeded owner of the demo workspace: `owner@acme.localhost` /
`nexa-demo-password`. Ports match `make dev`, so run one or the other, not both.

| Target            | Does                                             |
| ----------------- | ------------------------------------------------ |
| `make demo`       | Build the images, start the stack, smoke-test it |
| `make smoke`      | Re-run the smoke test against a running stack    |
| `make demo-logs`  | Follow every container's logs                    |
| `make demo-down`  | Stop it (its data volumes survive)               |
| `make demo-clean` | Stop it **and** drop its data volumes            |

**This is a local stack, not a deployment.** No DNS, no TLS, no real secrets, nothing
published past `127.0.0.1`. It loads `.env.example`'s development placeholders and
therefore runs as `NODE_ENV=development` on purpose: `parseEnv` refuses a `dev-only-…`
secret under `production`, and that guard is worth more than the appearance of a
production run. Uploads, spooled mail/push and the SIEM export are written inside the
containers and go away with them. `docker-compose.full.yml` explains each choice in place.

The dev datastores (`docker-compose.yml`, used by `make dev`) are a different compose
project with their own volumes, and this stack publishes no database or Redis port at
all, so the two never collide.

---

## Architecture

```
                    ┌──────────────────────┐
  customer's site   │  apps/widget         │   cross-origin iframe:
  ───────────────►  │  loader.js + iframe  │   the host page can never read
                    └──────────┬───────────┘   a conversation (NFR-S6)
                               │ Customer Chat API + customer RTM
                               ▼
  agent browser     ┌──────────────────────┐
  ───────────────►  │  apps/web (React)    │
                    └──────────┬───────────┘
                               │ REST /api/v1        │ WebSocket
                               ▼                     ▼
                    ┌──────────────────┐   ┌──────────────────┐
                    │  apps/api        │   │  apps/rtm        │
                    │  Fastify + Prisma│   │  ws + Redis      │
                    └────────┬─────────┘   └────────┬─────────┘
                             │                      │
                    ┌────────▼──────────────────────▼─────────┐
                    │  PostgreSQL 17 (pgvector) · Redis 7     │
                    │  RLS tenant isolation · Streams/pubsub  │
                    └─────────────────────────────────────────┘
```

### Workspace layout

| Package             | Role                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ |
| `packages/contract` | OpenAPI 3.1 document — the contract every other package derives from                 |
| `packages/types`    | `@nexa/types`: domain vocabulary, error taxonomy, scopes, ID strategy, RTM protocol  |
| `apps/api`          | REST API (Fastify + Prisma), migrations, seed                                        |
| `apps/rtm`          | WebSocket gateway: presence, push fan-out, missed-event sync                         |
| `apps/web`          | Agent SPA (React + Vite + Tailwind)                                                  |
| `apps/widget`       | Customer chat widget — loader + sandboxed iframe app                                 |
| `apps/mobile`       | Agent phone app (Expo / React Native) — Inbox, AI, CRM, Reports + push               |
| `apps/e2e`          | Playwright suite: drives the real servers on fixed ports against the seeded database |
| `packages/ai-mock`  | Deterministic LLM stand-in — no external model is ever called                        |

### Contract-first

Every feature starts in `packages/contract/openapi/`:

```bash
pnpm contract:generate     # bundle the spec → regenerate TypeScript types
```

Generated types are committed, and CI fails if they drift from the spec. Backend routes
and the web client both consume the same generated types, so a contract change that
breaks a consumer is a compile error rather than a runtime surprise.

### Locked decisions

The decisions that shape the code — API shape, error envelope, rate limits, routing
algorithm, the definition of an "AI resolution", trial behaviour — are recorded as ADRs in
[PLAN.md](PLAN.md) §0. Design tokens and the component inventory are in
[design-brief.md](design-brief.md).

### Notable engineering choices

**The API never connects to Postgres as the table owner.** PostgreSQL exempts owners and
superusers from row level security, so running the request path as the migration role
would silently disable every tenant isolation policy while all tests still passed.
Migrations use `DATABASE_URL`; the runtime uses `DATABASE_APP_URL` (`nexa_app`).

**Errors carry a machine-readable type, and the HTTP status is derived from it.** A route
cannot return `not_found` with a 403. Anything the caller may not see — including
resources belonging to another tenant — returns 404, so short IDs cannot be enumerated.

**Event IDs encode their thread and a sequence number** (`TJ1H8CFKRV_7`). Ordering inside
a thread is decidable from the ID alone, which is what makes lossless reconnect possible:
"everything after `TJ1H8CFKRV_7`" needs no timestamp comparison.

**The widget iframe has no `allow-same-origin`.** It runs on an opaque origin, so even a
fully compromised widget document cannot reach the host page's storage or cookies.

---

## Mobile app

`apps/mobile` is the agent phone app (Expo / React Native) — Inbox, Customers,
Reports, AI/Copilot and Settings, plus push. It talks to the same API and RTM
`make dev` already started; run it with `pnpm --filter @nexa/mobile start` in a
separate terminal. See [apps/mobile/README.md](apps/mobile/README.md) for
prerequisites, emulator/device networking (`localhost` doesn't mean the same
thing on an Android emulator or a physical phone), and demo login credentials.

---

## Development

```bash
pnpm typecheck      # tsc across the workspace
pnpm lint           # eslint
pnpm test:unit      # vitest; @nexa/api and @nexa/rtm need a live Postgres + Redis
                    # (each run gets its own isolated database — see below)
pnpm test:integration
pnpm test:e2e       # playwright (chromium) — see "End-to-end tests" below
pnpm format         # prettier
```

External services — Stripe, WhatsApp/Meta, LLM providers, SMTP, object storage — are
mocked behind interfaces. The LLM mock is deterministic so tests never flake.

### Test datastores are private to each run

`@nexa/api` and `@nexa/rtm` talk to a real Postgres and a real Redis, and every suite
starts by truncating. Two test runs against one database therefore destroy each other's
fixtures — and the damage lands as unique-constraint violations and 401s in whatever
happened to be running, not as anything to do with the change under test.

So each run gets its own. `pnpm test`, `test:unit` and `test:integration` in those two
packages go through `apps/api/scripts/with-test-datastores.ts`, which creates a
`nexa_test_<id>` database, migrates it, leases one of Redis' logical databases (1-15),
runs the command against them and drops both afterwards. A run that dies without
cleaning up leaves a lease that expires; the next run sweeps what it left behind.

Nothing in a test needs to know: the harness only rewrites `DATABASE_URL`,
`DATABASE_APP_URL` and `REDIS_URL`. Adds ~3 s per run. `NEXA_TEST_ISOLATION=off` runs
against the shared development database instead, for picking through the wreckage of a
failing test by hand.

The e2e suite is the exception — it drives the real servers on fixed ports against the
seeded development database, so two of those still cannot run at once.

### End-to-end tests

```bash
pnpm --filter @nexa/e2e exec playwright install chromium   # one-time browser download
pnpm test:e2e
```

Playwright starts five real servers for you (api, rtm, web, widget, mock-idp) on their
usual ports, then a global setup step reseeds the demo tenant with `NEXA_SEED_RESET=1`.

**This resets your local dev database** — the reset truncates the tenant tables (it
neither drops the database nor touches the schema) so every run starts from the same
fixture instead of piling more fixtures onto the last one. If you have local data in
`make dev`'s database you care about, back it up first (`make psql` → `pg_dump`, or just
re-seed afterwards with `make seed`). Because it drives fixed ports against that one
database, two `test:e2e` runs — or windows — cannot execute at the same time.

### Environment

Environment lives in `.env` (created from `.env.example` by `make env`). `make` targets
export it automatically (`Makefile` does `include .env` + `export`), but a bare `pnpm`
command run from your shell does not load it — nothing in this repo calls `dotenv`, so
`apps/api`/`apps/rtm`/Prisma read `process.env` directly. `pnpm db:migrate` and
`pnpm test:e2e` both need `DATABASE_URL` (and friends) in the shell's environment first:

```bash
set -a; source .env; set +a
pnpm db:migrate
```

or use the `make` targets (`make migrate`, `make test-e2e`), which already export `.env`
for you. It is gitignored; no secret is ever committed.

---

## Background jobs

`apps/api` runs six sweeps in-process, each on its own timer (`SCHEDULER_ENABLED`,
default: on outside tests). A Redis lock (`SET NX`, one key per job) keeps two running
instances from double-running the same pass; `GET /health` reports each job's interval,
enabled flag, and last run's time/status.

| Job                  | Default interval | What it does                                         |
| -------------------- | ---------------- | ---------------------------------------------------- |
| `chat_timeout`       | 60 s             | Closes idle chats (FR-MOD-08.7.3)                    |
| `sla`                | 60 s             | Marks first-response SLA breaches (11.5-d)           |
| `siem`               | 5 min            | Exports the SIEM audit sink (NFR-C6 · C6-d)          |
| `scheduled_reports`  | 60 s             | Delivers due scheduled reports (07.9)                |
| `retention`          | 1 h              | Hard-deletes data past its retention window (NFR-C8) |
| `webhook_redelivery` | 60 s             | Retries failed outbound webhooks (08.8.4 · NFR-S7)   |

Override an interval with `SCHEDULE_<JOB>_MS`, and spread instances from one deploy so
they don't all tick together with `SCHEDULE_JITTER_PCT` (default 10%) — see
`.env.example` for every key. To turn a background sweep off entirely and drive it from
outside the app instead (a host cron, a managed job runner), set `SCHEDULER_ENABLED=false`;
the first five each keep their own `pnpm --filter @nexa/api <job>:run` CLI script, which is
what that outside trigger calls. Webhook redelivery has no CLI equivalent — it is not a pass
an operator would ever want to force, and a hand-run one would race the scheduled one for the
same rows.

`retention` stays off even when the scheduler is otherwise on: `RETENTION_ENABLED=false`
by default. It is the one sweep here that deletes, and unlike the CLI's `--apply` flag — an
operator confirming a specific run — a scheduled pass has no operator to ask. `/health`
still lists it (`enabled: false`, never simply absent) so its being off is visible, not
silent. Review the policy (`RETENTION_*_DAYS` in `.env.example`) before setting
`RETENTION_ENABLED=true`.

`webhook_redelivery` is the one sweep that talks to the outside world. An outbound webhook is
tried three times inside the request that fired it; if all three fail the delivery stays
queued in `webhook_deliveries` with the body to re-send, and this job carries it on a widening
backoff (4 min, 8, 16 …) up to `WEBHOOK_MAX_ATTEMPTS` attempts in total (default 8, about four
hours). Giving up writes a `webhook.delivery_exhausted` audit entry, so an integration that
quietly stopped receiving is discoverable rather than silent. An event is queued in exactly one
place — a partial unique index, not a convention — so no restart, no second instance and no
overlapping tick delivers the same event twice.

---

## Production configuration

`.env.production.example` is the production sibling of `.env.example` (see "Environment"
above) — copy it to `.env` on the host running `apps/api`/`apps/rtm` and fill in every
placeholder. It has no real secrets in it: each one is either a value you must supply for
your infrastructure or a generation instruction. `parseEnv`
(`apps/api/src/config/env.ts`, `apps/rtm/src/config/env.ts`) validates the result once at
boot and refuses to start — with every problem listed at once, not just the first — rather
than fail at the first request that happens to touch a missing value.

**This repository has no production deploy of its own** (CLAUDE.md) — no DNS, no TLS, no
real secret ever committed. This section documents what a deployment built from this code
needs to configure, not a hosted instance of it.

### Required — boot refuses without these

| Variable                | Why it's required                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`          | Migration/owner connection. Always required, in every `NODE_ENV`.                                                                                                                           |
| `DATABASE_APP_URL`      | Runtime connection, required specifically under `NODE_ENV=production`. See "DATABASE_URL vs DATABASE_APP_URL" below — this is the one most likely to be skipped by habit and worst to skip. |
| `REDIS_URL`             | Presence, rate limiting, pub/sub. Always required.                                                                                                                                          |
| `JWT_SIGNING_KEY`       | Signs agent session tokens. Always required; production additionally refuses the published `dev-only-…` placeholder.                                                                        |
| `WEBHOOK_HMAC_SEED`     | Signs outbound webhook payloads (NFR-S7). Same production-only placeholder refusal.                                                                                                         |
| `CUSTOMER_TOKEN_SECRET` | Signs widget customer tokens — must be byte-identical between `apps/api` and `apps/rtm`. Same production-only placeholder refusal.                                                          |
| `UPLOAD_SIGNING_KEY`    | Signs upload URLs. Same production-only placeholder refusal.                                                                                                                                |
| `AUDIT_CHAIN_SECRET`    | Roots the audit hash chain (NFR-C6) — deliberately not stored in the database. Same production-only placeholder refusal.                                                                    |
| `INBOUND_EMAIL_SECRET`  | Authenticates the inbound mail webhook, required specifically under `NODE_ENV=production` — unset, the recipient address is the only routing key, and it's handed to customers.             |

Generate each secret independently, per deployment — never reuse a value across
environments:

```bash
openssl rand -hex 32
```

### `DATABASE_URL` vs `DATABASE_APP_URL`

Two connection strings to the same database, and the distinction is a tenant-isolation
control, not a style choice. Migrations run as the table owner (`DATABASE_URL`); the
request path runs as `nexa_app` (`DATABASE_APP_URL`), a role with no owner/superuser
privilege. PostgreSQL exempts owners and superusers from row level security — so a
deployment that (accidentally or "temporarily") points the runtime at the owner connection
does not error, does not fail a test, and does not look different in any way except that
every tenant's rows are now readable by every other tenant's queries. `parseEnv` closes
that gap the only way that actually holds: it refuses to boot in production without
`DATABASE_APP_URL` set to something other than the owner connection.

### Connection pool budget

Every process that reaches Postgres — `apps/api`, `apps/rtm`, and each of the five
standalone job scripts (`retention:run`, `chat-timeout:run`, `scheduled-reports:run`,
`siem:run`, `sla:run`) — opens its own Prisma connection pool. Left unset, Prisma sizes
a pool from the CPU count (`num_physical_cpus * 2 + 1`), which is a reasonable default
for one process on a laptop and the wrong one the moment pod count becomes a scaling
knob: two pods do not halve each pool, they double the total held against the database.
`docker-compose.yml` runs Postgres with `max_connections=200` — a hard ceiling the
server enforces no matter what any client asks for — so the budget across a deployment
is, roughly:

```
(api pool size × api pod count) + (rtm pool size × rtm pod count) + headroom <= max_connections
```

"Headroom" covers the standalone job scripts (each opens a short-lived pool of its own
when invoked) and Postgres' own `superuser_reserved_connections` (3 by default); leave
at least 10-20 connections unclaimed by either pool.

Set `DATABASE_POOL_SIZE` (see `.env.example`) to size both pools explicitly instead of
leaving them at the CPU-derived default — both `apps/api` and `apps/rtm` read the same
key and apply it as Prisma's `connection_limit` query parameter on the runtime
connection. A URL that already names `connection_limit` is left alone.

**PgBouncer transaction-mode compatibility (NFR-S4).** This repo's tenant scoping
(`apps/api/src/lib/tenant.ts#withTenant`) is already compatible with PgBouncer running
in transaction-pooling mode: it sets `app.current_license`/`app.current_organization`/
`app.current_brand` with `SET LOCAL` inside a `$transaction`, which unwinds when the
transaction commits or rolls back rather than persisting on the pooled connection — the
one property transaction-mode pooling requires, since the next transaction on that
connection may belong to a different tenant. The two advisory locks in the codebase
(`token-service.ts`'s per-owner session cap, `siem-sink.ts`'s per-license delivery lock)
use `pg_advisory_xact_lock`, the transaction-scoped variant, for the same reason — the
session-scoped `pg_advisory_lock` would leak across whichever tenant's transaction
happens to reuse that connection next. Nothing in the request path uses `LISTEN`/`NOTIFY`
or a session-scoped `SET`.

The one incompatibility is Prisma's own prepared statements: transaction-mode pooling
can hand two consecutive transactions on the same client different physical
connections, and a statement prepared on one is not visible on the other — Postgres
answers with `prepared statement "s0" does not exist`. Prisma's documented fix is a
connection-string flag, not a code change: append `?pgbouncer=true` to whatever URL a
deployment points at PgBouncer's port, which tells the query engine to skip named
prepared statements. `DATABASE_URL` (migrations) must keep reaching Postgres directly,
never through PgBouncer — `prisma migrate` relies on session-level locking that
transaction-mode pooling does not provide, which is also why this repo already keeps it
separate from the pooled `DATABASE_APP_URL` runtime connection (see above). This
repository has no PgBouncer instance to point at (CLAUDE.md's deploy boundary); a
deployment that adds one sets
`DATABASE_APP_URL=postgresql://…@pgbouncer-host:6432/nexa?pgbouncer=true` and leaves
`DATABASE_URL` aimed at Postgres' own port.

### Read replica

`DATABASE_REPLICA_URL` is optional and unset everywhere in this repo. Set it and the
report read path — every `GET /reports/*` group, `GET /reports/export`,
`GET /reports/access-review` and the scheduled-report sweep's CSV — runs against that
connection instead of the primary. Leave it unset and those reads go to the primary
exactly as they always have; there is no third behaviour, and no deployment here has a
standby to point it at (CLAUDE.md's infrastructure boundary), so the seam is what ships,
not the replica.

The point is NFR-P7. A report is a full-window aggregation over `chats`, `threads` and
`events` that one caller can aim at a quarter of history, and it competes for the same
connection pool as the live inbox — the surface least able to absorb a slow query.
NFR-R4 wants the same split from the other direction: a read replica is the bottleneck
relief a growing deployment reaches for first.

Three rules the seam holds to, each of which is enforced rather than documented:

- **The replica may not be more privileged than the primary.** It must connect as the
  same non-owner role `DATABASE_APP_URL` uses. PostgreSQL exempts table owners from row
  level security, so a replica carrying the owner's credentials would return _every_
  tenant's rows through an endpoint whose only isolation is RLS — and would look like a
  working replica while doing it, since the responses get bigger, not broken. `parseEnv`
  refuses that combination at boot, in every environment, not just production.
- **The read path is read-only.** `withTenantRead` opens the transaction with
  `SET TRANSACTION READ ONLY`, so a report builder that grows a write fails immediately
  rather than passing here and failing against a real standby later. This holds with no
  replica configured too — which is what makes the constraint testable in a repo that has
  none.
- **Anything that reads its own writes stays on the primary.** `GET /billing/subscription`
  and every mutation keep using `withTenant`. Replication lag makes a chat-volume chart
  slightly stale; it makes a seat count or an ADR-09 `ai_resolutions` total _wrong_, and
  a caller who just changed their plan seeing the old one is a support ticket.

Tenant isolation is unchanged on the replica: `withTenantRead` sets the same
`app.current_license` / `app.current_organization` / `app.current_brand` through
`SET LOCAL`, so the same RLS policies apply to the same rows.
`test/integration/read-replica.test.ts` runs a second client against the same database to
prove all of it — equal responses, cross-tenant reads still empty, writes still refused.

The replica's pool is sized by the same `DATABASE_POOL_SIZE`, so remember it in the budget
above: a two-pod API with a replica holds `2 × pool` connections on the primary and
`2 × pool` on the standby.

### Choosing `TRUST_PROXY_HOPS`

`request.ip` — the anonymous rate-limit bucket, the customer IP ban and the agent IP
allow-list — is derived from `X-Forwarded-For`, and `TRUST_PROXY_HOPS` says how many
entries from the right of that header to trust. Get it wrong in either direction and it's a
security bug, not a cosmetic one:

- **Too high** (more than the proxies actually in front of the process): a caller can put
  an allow-listed address in the header themselves and be believed — the allow-list is
  bypassed by a header anyone can send.
- **Too low** (fewer than the real count, most commonly left at the default with none):
  every request appears to come from the last proxy's address, which silently collapses
  the rate limit, the IP ban and the allow-list onto one address.

Count the reverse proxies between the internet and this process, not including the process
itself:

| Topology                                                   | `TRUST_PROXY_HOPS` |
| ---------------------------------------------------------- | ------------------ |
| Nothing in front — the process is reached directly         | `0`                |
| One reverse proxy (e.g. the compose stack's nginx sidecar) | `1` (default)      |
| A CDN/load balancer in front of that reverse proxy         | `2`                |
| Each additional hop that appends to `X-Forwarded-For`      | `+1`               |

Capped at `8` — past a handful this stops describing a topology and starts meaning "trust
the whole chain", which is what the setting exists to prevent.

**Counting is only half of it: something has to guarantee the count.** Hops are counted
from the right because the entries a real proxy appended are the ones nobody else could
have written — but that reasoning holds only for a request that actually crossed those
proxies. A caller who reaches the process _beside_ the proxy instead of _through_ it
writes the one entry itself and is believed, at any non-zero count. Measured, not argued:
in [`apps/api/test/integration/trust-proxy.test.ts`](apps/api/test/integration/trust-proxy.test.ts)
an enforced IP allow-list answers `200` to an invented address at `TRUST_PROXY_HOPS=1`,
and refuses the identical header on the identical server once a proxy really appended to
it. Raising the count does not help — the direct caller just prepends one more entry.

So `TRUST_PROXY_HOPS` is worth exactly what the network guarantees about which paths
reach the process, and the two have to be set together. In the Helm chart that guarantee
is [`templates/networkpolicy.yaml`](infra/helm/nexa/templates/networkpolicy.yaml) (on by
default), which is why that file and the `TRUST_PROXY_HOPS` value in `values.yaml` each
tell you to re-read the other. It is also what makes a _second_ public path to the API a
decision rather than a convenience: two paths with different hop counts cannot share one
number.

The local stacks make no such guarantee, and do not need to — `make demo` publishes the
API's own port (`4000`) beside the nginx that also proxies it, which is exactly the shape
described above. That is fine there and only there: a single-host development stack on
`NODE_ENV=development`, not a deployment (see "Run the whole stack in containers").

### `WEB_ORIGIN`

Comma-separated list of origins the API answers cross-origin (only production enforces
it). Left at the `.env.example` localhost default, every real browser request is refused by
CORS — this has to be set to the panel's actual origin(s), and a second origin if a chat
page is hosted separately (FR-MOD-08.5.9). A value that isn't a bare `scheme://host[:port]`
fails the boot rather than silently matching nothing.

### `SCHEDULER_ENABLED` and `RETENTION_ENABLED` defaults

Both are read by `apps/api` only (see "Background jobs" above for what each of the six
jobs does):

- `SCHEDULER_ENABLED` — unset already means **on** under `NODE_ENV=production` (it only
  defaults off under test, so suites don't race a sweep against their own fixtures). Set it
  to `false` explicitly if this deployment drives the jobs from a host cron instead; each
  job keeps its own `pnpm --filter @nexa/api <job>:run` script for that.
- `RETENTION_ENABLED` — defaults to **off** in every environment, scheduler on or not. It
  is the one sweep that hard-deletes data, and unlike the CLI's `--apply` flag — an operator
  confirming one specific run — a scheduled pass has no operator to ask. Review
  `RETENTION_*_DAYS` before setting it to `true`; `/health` reports the job as
  `enabled: false` until you do, never simply absent.

### `SHUTDOWN_DRAIN_MS` and graceful shutdown

On `SIGTERM`, both `apps/api` and `apps/rtm` drain before they close, in this order:

1. readiness turns false — `/health/ready` answers `503 {"status":"draining"}` while the
   process keeps serving normally, and `apps/rtm` also starts refusing new WebSocket
   upgrades. Liveness (`/health/live`) stays `200`: the process has not failed, and killing
   it here would only add a SIGKILL to the deploy.
2. `SHUTDOWN_DRAIN_MS` elapses. This is the window your orchestrator needs to notice step 1
   and stop routing here; anything it already routed is answered, not refused.
3. in-flight requests finish, the scheduler's Redis leader locks are handed back (so the
   next instance sweeps at its next tick instead of waiting out the lock TTL), open
   WebSockets get close code `1001` — which clients read as reconnect, handing the session
   to the missed-event sync (NFR-R2) — and the Postgres/Redis connections close.

Unset, the window is **5000 ms in production and 0 everywhere else**: nothing probes a
`make dev`, and every suite that closes a server would otherwise pay the wait. Size it at or
above your readiness probe period (Kubernetes defaults to 10s), and keep it well under the
orchestrator's own grace period — Kubernetes' `terminationGracePeriodSeconds` defaults to
30s, and when that expires SIGKILL truncates exactly the requests this drain exists to
protect. A second `SIGTERM` skips the wait and exits immediately.

### `RTM_MAX_CONNECTIONS` — the gateway's connection ceiling

How many concurrent WebSocket connections one `apps/rtm` process holds before it starts
refusing upgrades. **Unset means unlimited**, which is what the gateway did before this key
existed — there is no environment-following default, deliberately.

Set it, and an upgrade arriving at a full instance gets `503` with
`{"error":{"type":"service_unavailable","details":{"reason":"connection_limit_reached"}}}`
instead of being accepted. The refusal names the reason but never the number: the fact that
an instance is full is what a client and a load balancer need, and it is what separates "the
pod refused me" from "my client ran out of ephemeral ports"; the configured number is
capacity intelligence and stays behind `/health`'s admin gate, next to the live count:

```json
{ "status": "ok", "service": "rtm", "connections": 4102, "max_connections": 8000 }
```

`max_connections` is `null` when unset — stated rather than omitted, since an absent field
reads as "this build does not report it".

Why it is not defaulted: the number belongs to the pod, not to the code. Load measurement
(tm 161, §D127) put this repo's gateway at **≥ 8000 concurrent sockets** on a single laptop
core, with the NFR-P1 fan-out budget holding to **~6000 recipients per broadcast** — beyond
which acceptance and fan-out start competing for the one JS thread and the cost shows up as
latency for everyone already connected rather than as a refusal. Those are that machine's
numbers under one tenant. Measure yours and set it from that; capacity past a single pod is
a horizontal-scale question, not a ceiling question.

A client refused this way reconnects on the usual jittered exponential backoff (500ms
doubling to 15s, `apps/web/src/lib/realtime.ts`) rather than immediately — a shedding
mechanism whose retries add load would not be one.

---

## Deployment

`infra/helm/nexa/` is a Helm chart for the four M-CONTAINER images (api, rtm, web,
widget) — Deployment + Service per app, a ConfigMap/Secret pair, PodDisruptionBudgets,
HorizontalPodAutoscalers, a pre-install/pre-upgrade migration Job, a nightly backup
CronJob with its PersistentVolumeClaim, and a NetworkPolicy. It is a different
thing from "Run the whole stack in containers" above: that section boots this same set of
images locally with `docker compose`, on one host, for a demo. This chart describes how a
real Kubernetes deployment of the same images would be shaped — its manifests have **never
been applied to a cluster** (CLAUDE.md / MASTER-PROMPT limit: no production deploy). Render
it, read it, adapt it; do not `helm install` it against anything that matters without a
review this repo cannot give it.

Render the chart (needs Helm; not required for anything else in this repo):

```bash
helm template nexa infra/helm/nexa \
  -f infra/helm/nexa/values.yaml \
  -f infra/helm/nexa/values.production.example.yaml
```

[`values.production.example.yaml`](infra/helm/nexa/values.production.example.yaml) is the
production overlay — every value a real deployment has to fill in (image registry/tags,
public URLs, `TRUST_PROXY_HOPS`, secret material), one line of reasoning each, no real
secrets, exactly the discipline [`.env.production.example`](.env.production.example)
follows for the non-container path. It also documents the recommended way to supply real
secret values (an externally managed Secret / secret-manager sync into the same
`<release>-secrets` name, `secrets.enabled: false`) rather than passing them through
`helm install --set`.

Migration strategy — where `prisma migrate deploy` runs in a multi-replica deployment, the
race that ruled out running it from each pod's own entrypoint, and the expand/contract
rule for writing a migration that survives a rolling upgrade — is a deliberate decision,
not a default; it is documented once, in [CONVENTIONS.md](CONVENTIONS.md) §6, and this
section does not repeat it.

[`templates/networkpolicy.yaml`](infra/helm/nexa/templates/networkpolicy.yaml)
(`networkPolicy.enabled`, **on by default**) restricts ingress to the api pods to this
release's web pods. It is not a generic hardening extra: it is the half of
`TRUST_PROXY_HOPS` that the application cannot enforce for itself, and "Choosing
`TRUST_PROXY_HOPS`" above explains why neither half is sound alone. Two things a real
deployment has to decide are listed in `values.yaml` under `networkPolicy` — an Ingress
controller that reaches the API directly (required to serve the widget, and it changes the
hop-count question), and whether the cluster's CNI enforces policy against kubelet probe
traffic. rtm is deliberately **not** covered; that file says why.

**What is verified, and how:**

- `helm lint infra/helm/nexa` — passes (one non-blocking suggestion: add a chart icon).
- `helm template` — renders successfully: 4 Deployments, 4 Services, 4 PodDisruptionBudgets,
  3 HorizontalPodAutoscalers (api/rtm/web — widget opts out, see `values.yaml`), 1
  ConfigMap, 1 Job, 1 CronJob, 1 PersistentVolumeClaim, 1 NetworkPolicy, and 1 Secret
  (0 with the production overlay's `secrets.enabled: false`) — 21 or 20 resources
  depending on that flag, and one fewer again with `networkPolicy.enabled: false`.
- Every rendered resource validates against real Kubernetes OpenAPI schemas, fully
  offline, with [`kubeconform`](https://github.com/yannh/kubeconform) `-strict`: 21/21
  valid (default values) and 20/20 valid (production overlay).
- `kubectl apply --dry-run=client` against the rendered YAML was attempted and does **not**
  work on a machine with no reachable cluster: even with `--validate=false`, `kubectl
apply` still needs live API-server discovery to compute its strategic-merge patch, and
  fails with a connection error before evaluating anything client-side. This is a property
  of `kubectl apply`'s dry-run mode, not of the chart — `kubeconform` above is the offline
  equivalent this repo actually runs, consistent with §D124's "no real cluster" decision.

**What this cannot verify, stated rather than implied:** whether the chart actually
reconciles cleanly against a live API server, whether the images it names exist in the
registry it points at, and everything downstream of "a cluster accepts this YAML" — TLS
termination, DNS, an Ingress certificate, and real (non-`dev-only-…`) secret values. None
of that is in this repository's scope.

---

## Backups

[`scripts/backup.sh`](scripts/backup.sh) (`make backup`) backs up the dev/demo
datastore: a `pg_dump` of Postgres — via `docker compose exec`, the same
container-side pattern `make psql` uses, since psql/pg_dump are not assumed to be on
the host — plus a tar of `.data/uploads` (`STORAGE_LOCAL_DIR`, what
`STORAGE_PROVIDER=local` writes to). Output lands in `backups/` (gitignored, never
committed) as `db-<timestamp>.dump` + `uploads-<timestamp>.tar.gz`.

**Retention policy (NFR-C8 — backups are subject to the retention policy too, not
exempt from it):** backups older than `BACKUP_RETENTION_DAYS` (default 30,
overridable) are deleted whole-file on the next run — a `pg_dump` archive has no
smaller deletable unit than itself. 30 days mirrors GDPR Art. 12(3)'s one-month
response window for an Art. 17 erasure request (the live-database side of NFR-C8 is
[`apps/api/src/services/retention/policy.ts`](apps/api/src/services/retention/policy.ts)):
a request honoured live today is gone from every backup within roughly the same
window. For an urgent single-subject erasure that cannot wait that long: identify
which backup(s) were taken between the subject's creation and the erasure (filenames
are UTC timestamps) and delete those files by hand — there is no partial-file
redaction, deleting the archive is the procedure.

The Helm chart's analogue is
[`infra/helm/nexa/templates/backup-cronjob.yaml`](infra/helm/nexa/templates/backup-cronjob.yaml)
(schedule/image/retention in `values.yaml`'s `backup:` block) — a daily `pg_dump`
into a PersistentVolumeClaim (`templates/backup-pvc.yaml`), pruned by the same
whole-file retention window. **Database only**, stated rather than hidden: the chart
mounts no shared volume for uploads (`STORAGE_PROVIDER` only has a `local` provider
today, ephemeral to each pod — see
[`apps/api/src/services/storage/object-store.ts`](apps/api/src/services/storage/object-store.ts)),
so there is nothing durable yet for a CronJob to archive alongside the database.

**That volume holds every tenant's personal data in the clear**, which makes it the
richest single target the chart creates and the one object whose contents outlive
every pod — so set `backup.storageClassName` to an at-rest-encrypted StorageClass
(`values.production.example.yaml` names it). Left empty the claim omits the field and
inherits whatever class the cluster administrator made default, which the chart can
make no claim about. The CronJob's own pod is scoped to match: it gets `DATABASE_URL`
alone rather than the whole Secret — a backup pod holding `AUDIT_CHAIN_SECRET` would
hand one attacker both the rows and the key to recompute a chain that hides a deleted
one — and it runs as uid 70, non-root, with no service-account token.

### Restore drill

A backup existing is not the same claim as a backup being restorable, so
[`scripts/restore-drill.sh`](scripts/restore-drill.sh) (`make restore-drill`) measures
the second one:

```bash
make restore-drill                                  # back up, then drill that backup
./scripts/restore-drill.sh --dump backups/db-….dump # drill an archive you already have
```

It takes a fresh backup, creates a **scratch** database, restores into it, verifies,
and drops it again — including when a check fails or the run is interrupted. `nexa` is
only ever read from: the sole DDL is `CREATE`/`DROP DATABASE` against a name that has
to match `nexa_restore_drill_<digits>`, enforced in the script (`DRILL_DB=nexa` is
refused), so CLAUDE.md's "no DB drop" boundary holds by construction rather than by
care. Same discipline as
[`apps/api/scripts/test-datastores.ts`](apps/api/scripts/test-datastores.ts), which
provisions and drops the per-run `nexa_test_<id>` databases.

Verified on every run, with exit codes: the applied-migration set matches (and none is
half-applied — the P3009 state, `CONVENTIONS.md` §6.2) · row counts for
`organizations`/`accounts`/`chats`/`events` match · the row-level-security surface
(every table, policy name, `USING` and `WITH CHECK` body) is identical · so are the
extensions and the `SECURITY DEFINER` functions including their `SET search_path` ·
every `events` partition came back with RLS on and exactly one policy (the hole tm 150
found lives per-partition, not on the parent) · and, connecting as the non-owner
`nexa_app` role, the restore hands out **no** rows without a tenant context and the
right rows once `app.current_license` is set.

That last check needs both halves. Measured while building it: an archive restored with
every policy deliberately filtered out does **not** leak — `relrowsecurity` rides on the
table entry rather than the policy entries, and a table with RLS on and no policy denies
everyone, so unscoped reads still return 0. What breaks is the other direction: the
correct tenant's rows return 0 as well. A lost policy produces a silently _empty_
application, not an open one, so "sees nothing" is not evidence of a good restore.

**One thing the archive does not carry, stated because it is a restore step:** roles are
cluster-wide, and a per-database `pg_dump` has no `CREATE ROLE` in it. This archive
references `nexa_app` 146 times (grants, policy roles) and creates it zero times.
Restoring into a _fresh_ cluster therefore aborts on the first
`GRANT USAGE ON SCHEMA public TO nexa_app` with `role "nexa_app" does not exist`
(measured, and green once the role exists). Create it first with
[`infra/db/init/00-extensions.sql`](infra/db/init/00-extensions.sql) — which the
compose stack runs automatically — or capture globals separately with
`pg_dumpall --globals-only`.

---

## Status

See [PLAN.md](PLAN.md) for what is done and what is next, and [HANDOFF.md](HANDOFF.md)
for the current state summary. Before taking any of this to production, work through
[docs/production-checklist.md](docs/production-checklist.md) — every item there is a
command to run or a piece of evidence already recorded in this repository, not a box to
tick from memory. If something is already on fire, [docs/runbooks/](docs/runbooks/) covers
five incident scenarios (Postgres down, Redis down, a webhook delivery backlog, an RTM
connection storm, suspected cross-tenant data exposure), each as symptom → diagnosis
command → response → what to record afterward.
