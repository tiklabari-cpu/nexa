# HANDOFF — Nexa

**Date:** 2026-07-23 · **Branch:** `main` · **Remote:** https://github.com/tiklabari-cpu/nexa

---

## What exists

A working live-support platform. The MVP critical path runs end to end: a visitor
messages from the widget, routing assigns it, the agent sees it live in their inbox,
replies, tags it, archives it, and it shows up in reports and billing.

| Slice | Scope                                                                        | State |
| ----- | ---------------------------------------------------------------------------- | :---: |
| 1     | Monorepo, Postgres + Redis, `make dev`, health checks, CI                    |  ✅   |
| 2     | OAuth 2.1 + PKCE, PAT, customer tokens, scopes, RLS tenant isolation         |  ✅   |
| 3     | Full PRD §8.4 schema, event partitioning, database-enforced invariants, seed |  ✅   |
| 4     | chat → thread → event, Agent Chat API                                        |  ✅   |
| 5     | RTM gateway, fan-out, lossless reconnect                                     |  ✅   |
| 6     | Customer Chat API + embeddable widget                                        |  ✅   |
| 7     | 3-pane agent inbox                                                           |  ✅   |
| 8     | Routing, capacity limits, queueing                                           |  ✅   |
| 9     | Reports overview, metering, trial gate                                       |  ✅   |
| 10    | Design system, shell + module screens                                        |  ✅   |

**595 tests green** — 219 unit, 353 integration, 23 end-to-end. Typecheck, lint and format clean.
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

**Slice 10 is done.** All seven modules are built and reachable, all using the
tokens from `design-brief.md` — no component hard-codes a colour.

**The AI is a deterministic stub, not a model.** `packages/ai-mock` derives
embeddings from text (hashed bag of words, 1536 dims, L2-normalised) and
compiles instructions with rules. Retrieval ranks by real lexical overlap, so it
behaves like retrieval rather than looking like it — but "delivery" and
"shipping" stay unrelated, as they would to any lexical method. Swapping in a
real provider means replacing `embed()` and `compileInstruction()`; nothing else
knows how the numbers were produced.

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

## What to build next

**Read `PLAN.md` §3 first.** It is the authority, and it is now a projection of the
PRD's own phase and module structure — every work item carries an `FR-MOD` id.

An audit on 2026-07-23 found that finishing the ten original slices was not the same
as finishing the PRD's MVP: of the 52 requirements the PRD labels `Must/Should (MVP)`,
**18 had no code at all**, and Playbook — shipped under slice 10 — is a v1 feature that
had jumped ahead of them. `PLAN.md` §1.3 records this; §3 lists every gap with its
evidence.

~~1. Ticketing~~ — **done** (slice 11). `/tickets` list/create/get/patch, the Tickets
group in the inbox, "Create ticket" on a conversation, and `total_cases` in Reports.
Two pieces were moved out rather than rushed: email→ticket (`08.5.3`) belongs with the
channel surface in slice 13, and "Copy chat link" (part of `02.6`) with slice 14.

The order, and why:

1. **Account lifecycle** (`00.2`–`00.4`, `04.3.1`, `04.4`) — slice 12. There is no
   signup; every account comes from the seed. The trial rules (ADR-10) have never run
   against an account the product created itself.
   (`08.5.1/.2/.9`, `08.5.3`, `08.9.4`, `11.2`) — slice 13. File sharing carries the
   security shape here: NFR-S10 wants type/size limits and scanning, and those belong in
   the first version rather than a retrofit.
2. **Checkout, notifications, ⌘K** (`10.1.x`, `13.8`, `01.1.3`, `02.6` copy link) — slice 14.

**Webhooks (`FR-MOD-08.8.4`) is v1, not MVP** — worth flagging because an earlier
version of this file recommended it first. When it is built, ship the HMAC signing and
the SSRF guard with the first version (NFR-S7, risk R2, `v2-derin-analiz/v2-04` §6);
retrofitting them once integrators depend on the loose behaviour is a breaking change.

When every phase in `PLAN.md` is closed, run the mandatory closing sweep in **PLAN.md §F**
before reporting the work finished.
