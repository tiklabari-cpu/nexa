# @nexa/load — the load leg (k6)

NFR-M4 asks for five layers of testing: unit · integration · contract · E2E · **load**.
The first four have lived in this repo for a long time. This package is the fifth, and
until it existed the product's behaviour under load had never been measured once — NFR-P2
had a single-request median (43 ms) and nothing else, and NFR-P8's "~20k WS connections per
pod" was a number copied from a capacity note, not an observation.

The point of the package is therefore narrow and strict: **produce numbers, and refuse to
produce a stamp without them.**

## What is here, and what is not yet

| File                 | What it does                                    | Task  |
| -------------------- | ----------------------------------------------- | ----- |
| `lib/thresholds.js`  | NFR budgets → k6 thresholds (the gate)          | 161.1 |
| `lib/config.js`      | Where the run points, how hard it pushes        | 161.1 |
| `lib/session.js`     | OAuth 2.1 + PKCE sign-in against a seeded stack | 161.1 |
| `lib/http.js`        | The only door to `k6/http` — tags and counts    | 161.1 |
| `lib/metrics.js`     | Custom metrics (429 counter, fan-out trend)     | 161.1 |
| `lib/summary.js`     | stdout block + `results/<scenario>.json`        | 161.1 |
| `lib/protocol.js`    | RTM wire facts a Node test can re-check         | 161.3 |
| `lib/rtm-socket.js`  | One agent socket (`k6/websockets`, async)       | 161.3 |
| `lib/seed.js`        | Finding the seeded chat a write scenario drives | 161.3 |
| `scenarios/smoke.js` | Harness self-check — one read, end to end       | 161.1 |
| `scenarios/rest.js`  | List + transcript + send mix → NFR-P2           | 161.2 |
| `scenarios/rtm.js`   | N sockets + fan-out → **NFR-P1 / P8 / R2**      | 161.3 |

`smoke.js` is not a capacity measurement and must not be quoted as one. It exercises the
seams the real scenarios stand on — readiness answers, sign-in survives, a tagged read is
measured, a crossed threshold becomes a non-zero exit code — so that when `rest.js` or
`rtm.js` look wrong there is a way to tell a harness fault from a product fault.

## Installing k6

**k6 is not a Node package.** It is a single Go binary with its own JavaScript runtime, so
`pnpm install` does not bring it and `node scenarios/smoke.js` will never work. Install it
separately:

```sh
winget install --id Grafana.k6 -e     # Windows
choco install k6                      # Windows, alternative
brew install k6                       # macOS
docker run --rm -i grafana/k6 run - < scenarios/smoke.js   # no install at all
```

Pinned reference: the numbers in `HANDOFF.md` were produced with **k6 v2.2.0**
(`windows/amd64`). Record the version with each run — `k6 run` picks up `K6_VERSION` from
the environment and copies it into the results file:

```sh
K6_VERSION=$(k6 version) k6 run scenarios/smoke.js
```

### It is deliberately not in CI

CI runs on a shared runner whose CPU allocation varies between jobs. A latency threshold
measured there would fail for reasons that have nothing to do with the code in the pull
request, and the usual repair for that — widening the threshold until it stops flaking —
converts the gate into decoration. So this suite is **triggered by hand**, against a stack
whose conditions the operator can write down. `apps/e2e` stays the automated gate.

## Running

The load suite drives a **real, already-running stack**. Bring one up first:

```sh
make dev      # datastores + migrations + seed + all apps, from source (recommended)
# or
make demo     # the containerised stack (docker-compose.full.yml) + smoke test
```

Then, from this directory:

```sh
pnpm --filter @nexa/load load       # == k6 run scenarios/smoke.js
make load                           # the same thing, from the repo root
k6 run scenarios/smoke.js           # directly, when passing env knobs

pnpm --filter @nexa/load load:rest  # == k6 run scenarios/rest.js — NFR-P2
make load-rest                      # the same thing, from the repo root

pnpm --filter @nexa/load load:rtm   # == k6 run scenarios/rtm.js — NFR-P1 / NFR-P8
make load-rtm                       # the same thing, from the repo root
```

`rest.js` **sends real messages** into the seed's one live conversation and
needs `RATE_LIMIT_AGENT_PER_MIN` raised on the stack under test first — see
§"Staying under the rate limit" below before running it.

k6 exits non-zero if any threshold is crossed. That exit code is the result — a green
summary with a non-zero exit is not a pass.

> **Do not run this while `pnpm -w test:e2e` is running.** Both want ports 4000/4001/5173/5174
> and both write to the seeded `nexa` database. Two writers against one seed produce
> failures on both sides that look like product defects and are not (the same collision
> `apps/e2e` documents for two simultaneous windows).

### Knobs

All optional; the defaults target a local `make dev` stack.

| Variable              | Default                               | Meaning                                |
| --------------------- | ------------------------------------- | -------------------------------------- |
| `LOAD_API_ORIGIN`     | `http://localhost:4000`               | API origin; `/api/v1` is appended      |
| `LOAD_RTM_ORIGIN`     | `ws://localhost:4001`                 | RTM origin, socket and `/health` alike |
| `LOAD_EMAIL`          | `owner@acme.localhost`                | Seeded owner to sign in as             |
| `LOAD_PASSWORD`       | `nexa-demo-password`                  | Its demo password                      |
| `LOAD_ORG_PREFIX`     | `Acme`                                | Which membership to use                |
| `LOAD_REDIRECT_URI`   | `http://localhost:5173/auth/callback` | Registered panel redirect              |
| `LOAD_VUS`            | `2`                                   | Virtual users at the plateau           |
| `LOAD_DURATION`       | `30s`                                 | Plateau length                         |
| `LOAD_RAMP_UP`        | `10s`                                 | Ramp to the plateau                    |
| `LOAD_RAMP_DOWN`      | `5s`                                  | Ramp back to zero                      |
| `LOAD_PACING_SECONDS` | `1`                                   | Seconds a VU sleeps between iterations |
| `LOAD_NOTE`           | —                                     | Free text: hardware, stack kind        |
| `LOAD_RESULTS_DIR`    | `results`                             | Where the JSON summary is written      |

`rtm.js` has its own set — one rung of the capacity ladder, not a profile to tune once:

| Variable                    | Default | Meaning                                                   |
| --------------------------- | ------- | --------------------------------------------------------- |
| `LOAD_RTM_CONNECTIONS`      | `200`   | Sockets held open at the plateau — **the rung**           |
| `LOAD_RTM_SOCKETS_PER_VU`   | `25`    | Sockets one VU owns (a VU is a whole JS runtime)          |
| `LOAD_RTM_CONNECT_RATE`     | `200`   | Sockets opened per second, run-wide                       |
| `LOAD_RTM_PUBLISHES`        | `20`    | Messages published once every socket is up                |
| `LOAD_RTM_PUBLISH_INTERVAL` | `2`     | Seconds between two published messages                    |
| `LOAD_RTM_RECONNECT_EVERY`  | `10`    | Every Nth socket does one reconnect + `sync`; `0` off     |
| `LOAD_RTM_SETTLE`           | `5`     | Slack seconds before the first and after the last publish |

Everything else about a rung is derived from those (`lib/config.js#rtmPlan`), because the parts
have to agree: the publisher must not start before the last socket is up, and no socket may
close before the last message has had time to arrive. Four independent knobs would let an
operator produce a run whose "missing deliveries" are the schedule's fault.

The run ramps rather than starting flat, on purpose: a cold Node process is still JITting,
the connection pool is still opening sockets and Prisma is still compiling queries during
the first seconds. Folded into a flat run those costs land in the same p99 the thresholds
judge, and the run fails on warm-up rather than on the product.

## The thresholds, and where they come from

| Threshold                     | Budget        | Requirement              |
| ----------------------------- | ------------- | ------------------------ |
| `http_req_duration{op:read}`  | p99 < 150 ms  | NFR-P2 (read)            |
| `http_req_duration{op:write}` | p99 < 300 ms  | NFR-P2 (write)           |
| `nexa_rtm_fanout_ms`          | p99 < 500 ms  | NFR-P1 = NFR-U3          |
| `nexa_rtm_login_success`      | rate ≥ 0.999  | NFR-U1 (floor)           |
| `nexa_rtm_connect_failed`     | count == 0    | NFR-P8 degradation (2)   |
| `nexa_rtm_socket_dropped`     | count == 0    | NFR-P8 degradation (3)   |
| `nexa_rtm_sync_recovered`     | rate == 1.00  | NFR-R2 (opt-in)          |
| `http_req_failed`             | rate < 0.0005 | NFR-U2 (floor)           |
| `nexa_rate_limited`           | count == 0    | ADR-07 (see below)       |
| `nexa_measured{op:…}`         | count > 0     | see "empty is not green" |
| `checks`                      | rate == 1.00  | —                        |

None of those numbers is written by hand in a scenario. They live in `lib/thresholds.js`,
and `test/budgets.test.ts` **re-reads PRD §7.1 and §7.4 on every `pnpm -w test`** and fails
if the two ever disagree — in either direction. A tightened requirement nobody propagated
and a threshold quietly widened to make a red run green are both defects, and only one of
them is obvious. That guard is the difference between this suite and a report.

### Empty is not green

k6 evaluates a percentile threshold on a metric with **no samples as passing**. Measured on
the first green run of `smoke.js`: it reported `http_req_duration{op:write} p(99)<300` as
PASS while sending zero writes. A budget nothing exercised then looks exactly like a budget
that was met.

Two things close that, and a new scenario inherits both:

1. A scenario **declares** which budgets it drives — `restThresholds({ write: false })` for
   a read-only one — so it never claims a budget it cannot exercise.
2. Every latency budget is paired with `nexa_measured{op:…} count>0`, incremented by
   `lib/http.js` from the same call that applies the `op` tag. (`count` is not a legal
   aggregation on a k6 trend, so the proof has to be a counter beside it.) `budgets.test.ts`
   walks every p99 threshold and fails if it has no such proof.

The two availability entries are _run-scoped floors_, not SLO verification. A single run
can falsify 99.95% availability — a run that drops 1% of requests plainly is not meeting it
— but it can never confirm it, because availability is a property of a 30-day window. The
results file labels them as floors for exactly that reason.

NFR-P8 (20 000 connections per pod) has no budget threshold, because it is not a budget a
scenario either meets or crosses — it is a number to be _found_. What it has instead is a
definition of failure, written before the measurement; see the next section.

## Finding NFR-P8

`rtm.js` runs **one rung** of a ladder. Raise `LOAD_RTM_CONNECTIONS`, run it again, and the
first rung that exits non-zero is the degradation point — the threshold that failed says
which kind of degradation it was. Each rung leaves its own `results/rtm-<n>.json`, because
comparing rungs is the whole exercise.

### "Degraded" — written down before measuring

Four kinds, three of them thresholds (`lib/thresholds.js#rtmThresholds`) and the fourth a
per-socket check, so none of them is an after-the-fact judgement call:

1. **Too slow** — `nexa_rtm_fanout_ms p(99) ≥ 500 ms`. Every socket is still there; delivery
   has left NFR-P1's budget.
2. **Refusing connections** — `nexa_rtm_connect_failed > 0`. A socket could not be opened, or
   opened and could not log in.
3. **Dropping connections** — `nexa_rtm_socket_dropped > 0`. A socket that was live went away
   without the scenario asking it to.
4. **Deaf sockets** — a socket that stayed open and stopped receiving. No aggregate threshold
   can see this (the run's total delivery count stays high while one socket goes quiet), so
   every socket checks its own count at close and `checks rate==1.00` fails the run.

A fifth reading is recorded but not thresholded: `nexa_rtm_connections_observed`, sampled
from the gateway's own `/health` while the plateau is up. "We opened 8000 sockets" and "the
pod is holding 8000 sockets" are different claims and only the second one is NFR-P8; the
`max` of that trend is the number to quote.

### Reading a red run: the pod, or this laptop?

Degradation (2) has two completely different causes that look identical from inside k6, and
a report that does not separate them feeds the next decision the wrong number:

- **The pod refused.** A product finding.
- **The load generator ran out of local resources.** Not a product finding at all. On Windows
  the ceiling is the ephemeral port range — `netsh int ipv4 show dynamicport tcp`, **16384
  ports** on the machine these numbers were taken on — and every closed socket holds its port
  in `TIME_WAIT` for ~2 minutes afterwards. Two 8000-socket rungs back to back therefore
  compete with each other, not with the gateway.

  Check it, do not assume it: `netstat -an | grep -c TIME_WAIT` before a rung, and wait for it
  to drain between rungs. On Linux the equivalents are `ulimit -n` and
  `net.ipv4.ip_local_port_range`.

There is a third caveat that applies to _every_ rung on a single machine: k6, the API, the
gateway, Postgres and Redis are all on the same CPU. Past a few thousand sockets the load
generator is competing with the thing it is measuring, so a latency figure from a big rung is
pessimistic by an unknown amount. That does not make it useless — a _green_ rung is still
honest evidence, because the product met the budget despite the handicap — but a red one at
the top of the ladder is a reason to re-measure on separate hardware before concluding
anything about the product.

### Measured (2026-08-27)

Conditions: one dev laptop (Windows 11 26200), `api` and `rtm` from source under `tsx`,
Postgres 17 + Redis 7 in Docker, k6 v2.2.0 on the same machine. Profile per rung: 50 sockets
per VU, opened at 200/s, 20 messages published 2 s apart, 1 socket in 25 doing a reconnect +
`sync` cycle mid-run.

| Sockets asked for | Held (pod's own count) | fan-out p99 | connect p99 | Refused | Verdict                    |
| ----------------- | ---------------------- | ----------- | ----------- | ------- | -------------------------- |
| 200               | 200                    | 101 ms      | 38 ms       | 0       | ✅ green                   |
| 1 000             | 1 000                  | 219 ms      | 170 ms      | 0       | ✅ green                   |
| 2 000             | 2 000                  | 273 ms      | 162 ms      | 0       | ✅ green                   |
| 4 000             | 4 000                  | 332 ms      | 376 ms      | 0       | ✅ green                   |
| 6 000             | 6 000                  | 466 ms      | 601 ms      | 0       | ✅ green — at the edge     |
| 8 000             | 8 000                  | **599 ms**  | 577 ms      | **60**  | ❌ degradation (1) and (2) |

So the pod degrades **between 6 000 and 8 000 connections on this hardware**, in two ways at
once and in neither of the other two: it never dropped a live socket, and every socket that
connected received every message (`nexa_rtm_socket_dropped 0`, delivery check 7 940 / 7 940).

The 60 refusals at 8 000 have a named cause, printed by the scenario itself:
`connectex: No connection could be made because the target machine actively refused it` — the
listen queue overflowing, not a resource the gateway had run out of. The obvious next question
is whether that is about the connection *count* or about how fast they arrive, so it was
tested rather than argued: the same rung re-run at **half the open rate** (100/s, so the
connect phase takes 85 s instead of 45 s) refused **67** — no better. Arrival rate is not the
variable; 8 000 held sockets on this hardware is. Fan-out came down only slightly on that run
(p99 550 ms) and was still outside the budget.

The reconnect leg (NFR-R2) held at every rung, including the red one:
`nexa_rtm_sync_recovered rate 1.00` — every reconnecting socket came back and recovered the
messages it had missed, at 8 000 sockets as readily as at 5.

### Two harness defects this ladder had to fix first

Both produced confident and entirely wrong product findings, and both are worth knowing about
because the next scenario can make either mistake again:

1. **A tenth of the fan-out samples vanished into card-number masking** — §"The product edits
   this text on the way in", below. Every threshold stayed green while 10% of the evidence was
   being thrown away.
2. **The publisher's schedule slipped past the sockets' close.** Sleeping a fixed interval
   _after_ each publish makes an iteration cost the interval **plus** its requests; at 8 000
   sockets that stretched to ~4 s, and the last messages went out after every socket had
   already closed. It read as the gateway failing 7 949 sockets. The publisher now sleeps the
   _remainder_ of the interval, and a check named `a publish iteration fits inside its
   interval` fails the run if it ever cannot — so a slipped schedule says so in its own words
   instead of being misread as a delivery failure.

Deciding what this means for NFR-P8's stated ~20 000/pod is **161.4's** job, not this file's.
What is recorded here is what was measured and under what handicap.

## Staying under the rate limit

An agent account is capped at **180 requests/min, burst 30** (ADR-07), and every VU here
shares one account. The arithmetic:

```
requests/min ≈ vus ÷ pacing_seconds × 60 × requests_per_iteration
```

The default profile is `2 ÷ 1 × 60 × 1 = 120/min` — inside the cap with room to spare. Push
`LOAD_VUS` past 3 at the default pacing and the run starts collecting 429s.

That matters more than it sounds, and it is not a theory. Measured on this harness
(`LOAD_VUS=10 LOAD_PACING_SECONDS=0.1`, ≈6000 req/min against the 180/min cap): the run made
1266 reads, **1082 of them were 429s**, and `http_req_duration{op:read}` still reported
**p99 66.2 ms — inside the 150 ms budget**. A rate-limited request is answered in
microseconds without touching Postgres, so tripping the limiter _improves_ the percentile
while the rejected requests never reach the code under test. Read the latency line alone and
that run looks like a pass at 33× the traffic.

`nexa_rate_limited count==0` is what stops it: the run exited 99 with three thresholds
crossed. The latency number is only evidence when the 429 counter is zero.

Two honest ways to buy headroom, for 161.2 and 161.3 to choose between and **write down**:

1. **Several seeded agents.** The seed writes `agent1@acme.localhost` … alongside the
   owner, all on the same demo password; spreading VUs across them raises the ceiling
   without touching the product's configuration. Closest to real traffic.
2. **A raised limit on the stack under test**, e.g. `RATE_LIMIT_AGENT_PER_MIN=5000`, the way
   `apps/e2e` already raises `RATE_LIMIT_ANON_PER_MIN` for its own suite. Simpler, but it
   measures a configuration nobody deploys — so say so next to the number.

Sign-in itself is anonymous traffic (30/min per IP), which is why `lib/session.js` runs in
`setup()` **once per run** and hands the token to every VU. A per-VU sign-in spends the
whole run's anonymous quota during ramp-up.

### `rest.js`'s choice: option 2, a raised limit

`rest.js` sends 3 requests/iteration (list + transcript + send), so even the _default_
profile (`LOAD_VUS=2`, `LOAD_PACING_SECONDS=1`) asks for `2 ÷ 1 × 60 × 3 = 360` req/min —
already twice the 180/min cap on one account. Option 1 (several seeded agents) does not
scale out of this: a richDemo tenant has exactly three identities (owner + 2 agents), so
spreading VUs across them caps headroom at 3× no matter the profile, and the strategy would
need re-deciding the moment someone raises `LOAD_VUS` past 3. Option 2 does not have that
ceiling, so that is what `rest.js` uses — every VU shares the one session `setup()` signs in
(same as `smoke.js`), and the precondition is on the stack, not the script:

```sh
export RATE_LIMIT_AGENT_PER_MIN=5000   # comfortably above LOAD_VUS ÷ LOAD_PACING_SECONDS × 60 × 3
make dev                               # (or restart an already-running `pnpm dev`)
```

A shell-exported value wins over `.env` (`apps/api/src/config/load-env-file.ts` skips a key
that is already set), and `RATE_LIMIT_AGENT_PER_MIN` is already in `turbo.json`'s passthrough
env list, so this reaches every app `turbo run dev` starts without editing `.env` by hand.
Forgetting this step is not silently wrong: the shared `nexa_rate_limited count==0`
threshold still trips and the run exits non-zero, the same way it did in the deliberate
over-quota run 161.1 recorded in `HANDOFF.md`.

## Where the numbers go

Each run writes `results/<scenario>.json`: thresholds with pass/fail, every metric k6 kept
(including `p(99)`, which k6's default trend stats omit), and the run _conditions_ — target,
profile, k6 version, and `LOAD_NOTE`. `results/` is gitignored; the artefacts belong to one
machine on one afternoon.

The record is elsewhere, and writing it is 161.4's job:

- **PLAN §7.2** — the NFR-P1 / P2 / P8 rows carry the measured value and the conditions it
  was measured under.
- **`## K. Kanıt Geçmişi` → `#### KM-LOAD`** — the evidence entry (CONVENTIONS §1.2: the
  table cell holds a stamp and a reference, never the evidence).
- **HANDOFF.md** — the numbers plus the hardware, because a latency figure without the
  machine it came from is a rumour.

A target the measurement does not meet is written down as not met. §D122's lesson, in one
line: **nothing gets stamped that was not measured.**

## Cleaning up after a write scenario

`rest.js` (161.2) sends real messages and grows the seeded database. Reset it with the seed,
never with a drop — `pnpm db:reset` re-runs migrations and reseeds; dropping the `nexa`
development database is out of bounds (CLAUDE.md).

For a Claude Code window specifically: `prisma migrate reset` now refuses to run for an AI
agent without a human's explicit, freshly-given consent (its own built-in guard, not
something this repo added) — so `pnpm db:reset` will stop and ask rather than run. Measured
running `rest.js` once: it replies with the same message text every iteration
(`` `load rest.js — VU ${__VU} iter ${__ITER}` ``), so the honest and much smaller-blast-radius
fix is a targeted delete rather than a full reset:

```sh
docker exec -i nexa-db psql -U nexa -d nexa \
  -c "DELETE FROM events WHERE text LIKE 'load rest.js — VU%';"
```

This removes exactly the rows the run added and nothing else — no schema touched, no other
tenant's data touched, no consent gate to clear. Reach for `pnpm db:reset` only when a human
is present to approve it (e.g. the seed itself needs restoring, not just this scenario's
messages).

`rtm.js` writes into the same conversation and marks its rows the same way:

```sh
docker exec -i nexa-db psql -U nexa -d nexa \
  -c "DELETE FROM events WHERE text LIKE 'load rtm.js — %';"
```

### The product edits this text on the way in

Worth knowing before inventing a new marker. `POST /chats/:id/events` masks card numbers
before persisting (`apps/api/src/lib/cc-mask.ts` — FR-MOD-08.9.5 / PCI SAQ A): a run of 13–19
digits that passes the Luhn checksum is replaced by `**** **** **** 1234`. An epoch-ms
timestamp is exactly 13 digits, and a mod-10 checksum over a free-running counter passes
**one time in ten** — so the first version of `rtm.js`'s marker lost 10% of its fan-out
samples to masking, silently, while every threshold stayed green.

The fix is a `.` between the seconds and the milliseconds (`t1787856673.075`), which keeps the
longest digit run below the detector's minimum. `test/budgets.test.ts` re-reads the detector's
own pattern and fails if a marker ever becomes a candidate again. Any future marker that
carries digits belongs under the same guard.

This repo had already been bitten once: `apps/e2e/tests/demo-flow.spec.ts` truncates its own
`Date.now()` to six digits for exactly this reason, and says so in a comment. The lesson had
simply never been written anywhere a *new* suite would find it — so it is here now, and it is
a test rather than a comment.

## Gate behaviour

This package joins `pnpm -w typecheck`, `pnpm -w lint` and `pnpm -w test` and has no
`build` — there is nothing to compile. `typecheck` covers `test/**` only: the k6 sources are
JavaScript for k6's runtime, and `k6/http` resolves to nothing a Node `tsc` can see.
`lib/thresholds.js` is deliberately free of `k6/*` imports so the guard test can import it
under Node.
