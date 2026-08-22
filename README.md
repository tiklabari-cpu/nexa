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

## Status

See [PLAN.md](PLAN.md) for what is done and what is next, and [HANDOFF.md](HANDOFF.md)
for the current state summary.
