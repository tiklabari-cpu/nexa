# HANDOFF — Nexa

**Date:** 2026-07-23 · **Branch:** `main` · **Remote:** https://github.com/tiklabari-cpu/nexa

---

## What exists

A working live-support platform. The MVP critical path runs end to end: a visitor
messages from the widget, routing assigns it, the agent sees it live in their inbox,
replies, tags it, archives it, and it shows up in reports and billing.

| Slice | Scope                                                                        |               State               |
| ----- | ---------------------------------------------------------------------------- | :-------------------------------: |
| 1     | Monorepo, Postgres + Redis, `make dev`, health checks, CI                    |                ✅                 |
| 2     | OAuth 2.1 + PKCE, PAT, customer tokens, scopes, RLS tenant isolation         |                ✅                 |
| 3     | Full PRD §8.4 schema, event partitioning, database-enforced invariants, seed |                ✅                 |
| 4     | chat → thread → event, Agent Chat API                                        |                ✅                 |
| 5     | RTM gateway, fan-out, lossless reconnect                                     |                ✅                 |
| 6     | Customer Chat API + embeddable widget                                        |                ✅                 |
| 7     | 3-pane agent inbox                                                           |                ✅                 |
| 8     | Routing, capacity limits, queueing                                           |                ✅                 |
| 9     | Reports overview, metering, trial gate                                       |                ✅                 |
| 10    | Design system, shell + module screens                                        | ◐ 4 of 7 modules built; see below |

**414 tests green** — 131 unit, 283 integration. Typecheck, lint and format clean.
No schema drift.

---

## Running it

```bash
make dev
```

Datastores, migrations, seed and all apps. Then http://localhost:5173 —
`owner@acme.localhost` / `nexa-demo-password`.

The seed creates two organizations on purpose. Acme is the one to log into;
Northwind exists so a cross-tenant leak shows up as visibly wrong data rather
than as nothing at all.

---

## What is honestly incomplete

**Slice 10 is partial.** The token system, Tailwind mapping and accessibility
rules from `design-brief.md` exist, and Inbox, Reports, Team and Billing all use
them — no component hard-codes a colour.

What is still missing is **Customers, Playbook and Settings**, and they are
missing on both sides: there is no API for them either. An earlier draft of this
file claimed they had "API support but no UI", which was wrong — only Team,
Reports and Billing did, and those now have screens. The icon rail shows the
three remaining modules disabled rather than pretending otherwise.

Building any of them means starting at the contract (`packages/contract/openapi/`)
and working outward, as ADR-05 requires. `contract-parity.test.ts` will fail the
build if a route ships without a contract entry, which is how the last ten
endpoints got missed.

**Not started (v1 scope in the PRD, deliberately out of the MVP path):**
AI agent skill engine and RAG retrieval, Copilot, omnichannel adapters
(WhatsApp/Messenger/Twilio), tickets UI, campaigns and goals UI, canned-response
UI, the visual workflow editor (ADR-14 defers it to v2 — the table exists,
nothing writes to it).

**Mocked, as instructed:** Stripe (no external call; `usage_records` are real and
the arithmetic is real), LLM providers, SMTP, object storage.

**Known limits, chosen rather than overlooked:**

- Idempotency keys live in Redis with a 24-hour TTL, not in Postgres. `events` is
  partitioned, and a unique index on a partitioned table must include the
  partition key. If Redis is down, a retried send can duplicate a message.
- Customer tokens are stateless and cannot be revoked individually. TTL is short,
  and bans and licence expiry are checked per request against live data.
- The widget polls every four seconds rather than holding a socket. The gateway
  could serve it; a customer-side socket across sleeping laptops and mobile
  networks is more to keep alive than the conversation is worth.
- Rate limiting fails open if Redis is unavailable. Availability beats a
  perfectly enforced limit, and auth and RLS are unaffected.

---

## Things worth knowing before changing anything

**The API connects to Postgres as `nexa_app`, never as the owner.** Postgres
exempts table owners and superusers from row level security. Point the runtime at
`DATABASE_URL` instead of `DATABASE_APP_URL` and every tenant isolation policy
silently stops applying while the whole test suite still passes.
`test/integration/tenant-isolation.test.ts` asserts this rather than trusting it.

**Invariants live in the database.** One active chat per license+customer, one
active thread per chat, one fallback routing rule per kind. A rule checked only
in a service is one concurrent request away from being violated, and the
resulting corruption is permanent. The tests fire concurrent requests at these
rather than checking them sequentially.

**Errors derive their HTTP status from their type.** A route cannot return
`not_found` with a 403. Anything the caller may not see — including another
tenant's data — is 404, so short IDs cannot be enumerated.

**"AI resolution" is defined in exactly one place** (`services/billing/metering.ts`):
a thread that closed with no agent-authored event. Reports and billing both read
it. Two counters meant to agree will not, and the first anyone notices is a
customer disputing a bill.

**Event IDs encode thread and sequence** (`TJ1H8CFKRV_7`). Ordering is decidable
from the ID alone, which is what makes lossless reconnect possible. Do not switch
transcript ordering to timestamps: several events can share a millisecond.

**`pnpm test:integration` runs serially.** Both packages' suites truncate the same
database; running them at once makes each delete the other's fixtures, which
presents as flaky RTM tests.

---

## Where to look

| Question                     | File                                                   |
| ---------------------------- | ------------------------------------------------------ |
| Decisions and why            | [PLAN.md](PLAN.md) §0 (ADRs), §4 (deviations)          |
| Colours, spacing, a11y rules | [design-brief.md](design-brief.md)                     |
| API contract                 | `packages/contract/openapi/`                           |
| Tenant isolation             | `apps/api/src/lib/tenant.ts` + the RLS migration       |
| Conversation core            | `apps/api/src/services/chat/chat-service.ts`           |
| Reconnect                    | `apps/rtm/src/sync.ts`, `apps/web/src/lib/realtime.ts` |
| Routing algorithm            | `apps/api/src/services/routing/routing-service.ts`     |

---

## Suggested next steps

1. **Finish slice 10** — Customers, Playbook and Settings. Each needs a contract
   entry and API before a screen, since none of the three has either.
   Customers is the highest value: the `customers` and `visits` tables are
   populated and nothing surfaces them.
2. **AI agent (v1).** The schema, skill step types and pgvector index are in
   place and seeded; the compiler and retrieval orchestration are the work.
3. **Webhooks.** The table, HMAC design and SSRF requirements are specified in
   `v2-derin-analiz/v2-04` §6; nothing is implemented. Ship the HMAC and the
   SSRF guard with the first version — retrofitting them once integrators depend
   on the loose behaviour is a breaking change.
4. **Tickets.** The table and constraints exist; there is no API or UI.
