# @nexa/load — the load leg (k6)

NFR-M4 asks for five layers of testing: unit · integration · contract · E2E · **load**.
The first four have lived in this repo for a long time. This package is the fifth, and
until it existed the product's behaviour under load had never been measured once — NFR-P2
had a single-request median (43 ms) and nothing else, and NFR-P8's "~20k WS connections per
pod" was a number copied from a capacity note, not an observation.

The point of the package is therefore narrow and strict: **produce numbers, and refuse to
produce a stamp without them.**

## What is here, and what is not yet

| File                 | What it does                                    | Task      |
| -------------------- | ----------------------------------------------- | --------- |
| `lib/thresholds.js`  | NFR budgets → k6 thresholds (the gate)          | 161.1     |
| `lib/config.js`      | Where the run points, how hard it pushes        | 161.1     |
| `lib/session.js`     | OAuth 2.1 + PKCE sign-in against a seeded stack | 161.1     |
| `lib/http.js`        | The only door to `k6/http` — tags and counts    | 161.1     |
| `lib/metrics.js`     | Custom metrics (429 counter, fan-out trend)     | 161.1     |
| `lib/summary.js`     | stdout block + `results/<scenario>.json`        | 161.1     |
| `scenarios/smoke.js` | Harness self-check — one read, end to end       | 161.1     |
| `scenarios/rest.js`  | List + transcript + send mix → **NFR-P2**       | **161.2** |
| `scenarios/rtm.js`   | N sockets + fan-out → **NFR-P1 / NFR-P8**       | **161.3** |

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
pnpm --filter @nexa/load load     # == k6 run scenarios/smoke.js
make load                         # the same thing, from the repo root
k6 run scenarios/smoke.js         # directly, when passing env knobs
```

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
| `LOAD_RTM_ORIGIN`     | `ws://localhost:4001`                 | RTM origin (used by 161.3)             |
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

NFR-P8 (20 000 connections per pod) has no threshold here. It is not a budget a scenario
either meets or crosses; it is a number to be _found_, by ramping connections until the
single pod degrades. 161.3 defines "degrades" before it measures, and 161.4 decides what
the resulting number means.

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

## Gate behaviour

This package joins `pnpm -w typecheck`, `pnpm -w lint` and `pnpm -w test` and has no
`build` — there is nothing to compile. `typecheck` covers `test/**` only: the k6 sources are
JavaScript for k6's runtime, and `k6/http` resolves to nothing a Node `tsc` can see.
`lib/thresholds.js` is deliberately free of `k6/*` imports so the guard test can import it
under Node.
