# Runbook: RTM connection storm

## Symptom

- WebSocket connection count on `apps/rtm` spikes.
- Fan-out delay to already-connected agents degrades (NFR-P1's 500ms budget)
  even though the pod isn't CPU-saturated — tm 161.4 measured this exact shape
  (`PLAN.md` `§D127`, `KM-LOAD`): the bottleneck is single-threaded
  accept/fan-out contention, not CPU. Watching CPU alone during a storm will
  look calm while agents are already affected.

## Diagnosis

1. The three metrics that exist for exactly this
   (`apps/rtm/src/telemetry/telemetry.ts`, tm 163.2): `rtm.connections.active`
   (gauge), `rtm.fanout.delay` (histogram, seconds), `rtm.connections.closed`
   (counter, tagged `reason` — see step 3). Read them from whatever collector
   `OTEL_EXPORTER_OTLP_ENDPOINT` points at; a real collector is outside this
   repo's boundary (CLAUDE.md), so if none is wired yet, fall back to the
   process logs below.

2. Check whether the gateway is already refusing new connections at its
   configured ceiling — it logs this once per ceiling episode, not once per
   refused socket (`apps/rtm/src/server.ts`):

   ```bash
   docker compose logs --tail=500 rtm | grep -i 'connection ceiling'
   # demo stack:
   docker compose -f docker-compose.full.yml logs --tail=500 rtm | grep -i 'connection ceiling'
   ```

   A match ("rtm at connection ceiling: refusing new upgrades") means
   `RTM_MAX_CONNECTIONS` did its job: existing connections are protected and
   new ones get a clean `connection_limit_reached` close instead of degraded
   service for everyone. This is the intended failure mode, not a bug to
   silence.

3. `rtm.connections.closed`'s `reason` label
   (`apps/rtm/src/telemetry/telemetry.ts`'s `DISCONNECT_REASONS`) tells you
   what kind of storm this is:
   - `identity_timeout` / `idle_timeout` spiking together with a rising
     connection count usually means a client-side reconnect loop (a released
     client build, a network flap) rather than real new traffic.
   - `protocol_violation` spiking means malformed clients, not load.
   - `server_shutdown` on every closed socket means this is a deploy/rolling
     restart, not an incident — check for one in progress before treating it
     as a storm.
   - Mostly `normal` closes with a high open count is the real-traffic case.
   - There is deliberately **no** `rate_limit` reason: the WS rate limit
     (ADR-07, 10 msg/sec/connection) throttles by design rather than
     disconnecting, because dropping a connection over a burst would cost the
     agent their live conversation (`apps/rtm/src/telemetry/telemetry.ts`
     comment on `DISCONNECT_REASONS`). A message-flood storm shows up as
     fan-out delay, not as connection churn.

## Response

- If the gateway is already at `RTM_MAX_CONNECTIONS` (step 2), it is doing
  the right thing on its own — no action needed to protect existing
  connections. The response is capacity, not code:
  - Scale out manually. The chart's HPA (`infra/helm/nexa/values.yaml`,
    `apps.rtm.hpa`: `minReplicas: 1`, `maxReplicas: 4`,
    `targetCPUUtilizationPercentage: 70`) tracks CPU, which tm 161.4 measured
    as the _wrong_ signal for this app — the machine was ~96% idle at the
    load step where fan-out broke. Scaling on `rtm.connections.active` needs
    a custom-metrics adapter this chart does not deploy (out of scope,
    CLAUDE.md). During a real storm, bump replica count directly rather than
    waiting for the CPU-based HPA to react.
  - Do **not** add sticky sessions as a fix. Fan-out already crosses pods via
    Redis pub/sub (`apps/rtm/src/fanout.ts`); the two-pod test
    (`apps/api/test/integration/two-pod.test.ts`) is what proves that, and
    `docs/production-checklist.md` §4 says explicitly not to spend an
    infrastructure decision on it — it doesn't address a connection storm.
  - Respect `pdb.maxUnavailable: 1` (`infra/helm/nexa/values.yaml`) if a
    rolling restart is part of the response — it still bounds how many pods
    can be down at once during voluntary disruption.
- If it's a reconnect loop (`identity_timeout`/`idle_timeout` dominant), the
  fix is on the client side (a bad release, a network issue upstream) — adding
  RTM capacity treats the symptom, not the cause.
- If `RTM_MAX_CONNECTIONS` is unset (`null` = unlimited, the pre-tm161
  default per `apps/rtm/src/config/env.ts`), the gateway has no ceiling and
  will degrade fan-out for everyone instead of refusing new sockets — this
  itself may be the finding: set it from a real measurement of the pod size in
  use (see `docs/production-checklist.md` §3 Capacity).

## After

- Confirm `rtm.connections.active` is back under any configured ceiling and
  `rtm.fanout.delay` p99 is back under the 500ms budget.
- Pull the `rtm.connections.closed` reason breakdown for the storm window —
  it's the record of what actually happened (client bug vs. real traffic vs.
  deploy) and is what a capacity review needs, not a guess after the fact.
- If the ceiling was hit, note the replica count and `RTM_MAX_CONNECTIONS` at
  the time — `docs/production-checklist.md` §3's numbers are this repo's own
  single-pod measurement (tm 161.4) and may not match the hardware actually
  in use.
