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

## Development

```bash
pnpm typecheck      # tsc across the workspace
pnpm lint           # eslint
pnpm test:unit      # vitest, no external services needed
pnpm test:integration
pnpm test:e2e       # playwright (chromium)
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

Environment lives in `.env` (created from `.env.example` by `make env`). It is
gitignored; no secret is ever committed.

---

## Status

See [PLAN.md](PLAN.md) for what is done and what is next, and [HANDOFF.md](HANDOFF.md)
for the current state summary.
