# Production checklist

Every line below is either a command you run against your own deployment or a pointer to
evidence already recorded in this repository — nothing here is "reviewed and looks fine."
If a line has no command, it names the exact file/test that proves the capability exists;
running it against your infrastructure is still your job, this repo has never seen a real
cluster (CLAUDE.md).

This is not a substitute for reading [README.md](../README.md) — most items below link back
to the section that explains the _why_. This document is the _what to check, in order_.

## 1. Configuration

- [ ] `NODE_ENV=production` is set on both `apps/api` and `apps/rtm`. Boot refuses to start
      otherwise and lists every problem at once — see `apps/api/src/config/env.test.ts`
      ("production configuration" suite) and `apps/api/test/integration/production-boot.test.ts`.
- [ ] All six key-material secrets are freshly generated for this deployment and none is the
      published `dev-only-…` placeholder: `JWT_SIGNING_KEY`, `WEBHOOK_HMAC_SEED`,
      `CUSTOMER_TOKEN_SECRET`, `UPLOAD_SIGNING_KEY`, `AUDIT_CHAIN_SECRET`, `INBOUND_EMAIL_SECRET`.
      Generate each independently — `openssl rand -hex 32`. See README
      ["Required — boot refuses without these"](../README.md#required--boot-refuses-without-these).
- [ ] `DATABASE_APP_URL` is set to the non-owner `nexa_app` role and is **different** from
      `DATABASE_URL` — pointing both at the owner role silently disables row-level security
      (tenant isolation) without failing any request. See README
      ["`DATABASE_URL` vs `DATABASE_APP_URL`"](../README.md#database_url-vs-database_app_url).
- [ ] `TRUST_PROXY_HOPS` is set to the number of reverse proxies actually in front of the
      process, using the table in README
      ["Choosing `TRUST_PROXY_HOPS`"](../README.md#choosing-trust_proxy_hops) — and a
      NetworkPolicy (or equivalent) guarantees that count, per
      [`infra/helm/nexa/templates/networkpolicy.yaml`](../infra/helm/nexa/templates/networkpolicy.yaml).
      Measured consequence of skipping the policy half:
      `apps/api/test/integration/trust-proxy.test.ts`.
- [ ] `WEB_ORIGIN` is set to the real panel origin(s) (comma-separated if more than one host
      serves the panel or a standalone chat page).
- [ ] Copy [`.env.production.example`](../.env.production.example) to `.env`, fill every
      placeholder, then boot once — a missing or placeholder value fails loudly with every
      problem listed together, not on the first request that happens to touch it.

## 2. Ops

- [ ] The orchestrator's liveness probe targets `/health/live` (no dependency checks) and its
      readiness probe targets `/health/ready` (checks Postgres/Redis) — never the same path for
      both. Evidence: `infra/helm/nexa/templates/deployment.yaml` (`livenessProbe`/
      `readinessProbe`), `apps/api/test/integration/health.test.ts`,
      `apps/rtm/test/integration/health.test.ts`.
- [ ] `SHUTDOWN_DRAIN_MS` is set at or above your readiness probe period (Kubernetes default
      10s) and comfortably under `terminationGracePeriodSeconds` (Kubernetes default 30s).
      Unset defaults to 5000ms in production. See README
      ["`SHUTDOWN_DRAIN_MS` and graceful shutdown"](../README.md#shutdown_drain_ms-and-graceful-shutdown).
- [ ] Verify the drain sequence against a running instance: send it `SIGTERM` and confirm
      `/health/ready` answers `503 {"status":"draining"}` while `/health/live` stays `200`,
      then the process exits within the drain window plus in-flight request time. Automated
      proof: `apps/api/test/integration/graceful-shutdown.test.ts` (5),
      `apps/rtm/test/integration/shutdown.test.ts` (5).
- [ ] `LOG_LEVEL` and the redaction list in `apps/api/src/lib/log-redact.ts` are active under
      `NODE_ENV=production` — proved unconditional (not test-only) by
      `apps/api/test/integration/log-profile.test.ts` and
      `apps/rtm/test/integration/log-profile.test.ts`.

## 3. Capacity

- [ ] A load test has been run against a build representative of this deployment and its
      numbers are the accepted basis for the resource/scale decisions below — re-run whenever
      the measured code path changes materially, not on a calendar. Commands (need a running
      stack + k6 on `PATH`, see [`apps/load/README.md`](../apps/load/README.md)): `make load-rest`
      (NFR-P2 REST read/write latency) and `make load-rtm` (NFR-P1/P8 WS fan-out latency +
      connection ceiling).
- [ ] Numbers on record for this repository's own measurement (§D127, `PLAN.md` `KM-LOAD`, one
      development laptop — re-measure on your own hardware before trusting these for capacity
      planning): REST p99 reads 116.2ms / writes 87.9ms (budgets 150/300ms); RTM fan-out stays
      under the 500ms budget up to 6000 concurrent sockets on one pod and degrades at 8000;
      per-socket cost ≈3–4ms to connect and ≈77–91µs per delivered frame; ≈36–66KB RSS per
      socket.
- [ ] `RTM_MAX_CONNECTIONS` is set from a measurement of the pod size you actually run (unset
      means unlimited — the pre-tm161 behaviour, not a safe production default). See README
      ["`RTM_MAX_CONNECTIONS` — the gateway's connection ceiling"](../README.md#rtm_max_connections--the-gateways-connection-ceiling).
- [ ] Resource `requests`/`limits` in
      [`infra/helm/nexa/values.yaml`](../infra/helm/nexa/values.yaml) reflect a measurement, not
      a guess, for the traffic you expect — the shipped defaults (api: 250m/256Mi requests,
      1/512Mi limits; rtm: 250m/128Mi requests, 1/512Mi limits; both HPA 1–4 replicas @ 70% CPU)
      are sized for this repo's own load-test hardware, not yours.

## 4. Scale

- [ ] Two-pod validation has passed: cross-pod fan-out delivers and exactly one scheduler
      leader is elected, measured with two real OS processes each for `apps/api` and
      `apps/rtm` (not two instances inside one test process). Evidence:
      `apps/api/test/integration/two-pod.test.ts` (8).
- [ ] Sticky sessions are **not** applied to `apps/rtm` — the two-pod result above is the
      reason: fan-out already crosses pods via Redis pub/sub, so a load balancer needs no
      session affinity in front of it. Applying stickiness anyway does not break anything, it
      is simply unnecessary; do not spend an infrastructure decision on it.
- [ ] `DATABASE_POOL_SIZE` is sized against your `max_connections` budget:
      `(api pool × api pods) + (rtm pool × rtm pods) + headroom ≤ max_connections`. See README
      ["Connection pool budget"](../README.md#connection-pool-budget).
- [ ] If a connection pooler (e.g. PgBouncer) sits in front of Postgres: `DATABASE_APP_URL`
      (and `DATABASE_REPLICA_URL` if set) carries `?pgbouncer=true`; `DATABASE_URL`
      (migrations) never goes through it. See README
      ["PgBouncer transaction-mode compatibility"](../README.md#connection-pool-budget).

## 5. Deployment

- [ ] The chart renders and validates offline (no cluster available or required — CLAUDE.md):
      `helm template nexa infra/helm/nexa -f infra/helm/nexa/values.yaml -f infra/helm/nexa/values.production.example.yaml`
      then `helm lint infra/helm/nexa`. Recorded result in this repo: `helm lint` exit 0; every
      rendered resource valid against real Kubernetes OpenAPI schemas via `kubeconform -strict`
      — 21/21 (default values), 20/20
      (production overlay). `kubectl apply --dry-run=client` does **not** work offline (it needs
      live API-server discovery even with `--validate=false`) — `kubeconform` is this repo's
      dry-run equivalent; see README ["Deployment"](../README.md#deployment) for the full
      reasoning.
- [ ] Migration strategy is applied as decided, not left at a per-pod default:
      `prisma migrate deploy` runs once per release from the pre-install/pre-upgrade Helm hook
      Job ([`templates/migrate-job.yaml`](../infra/helm/nexa/templates/migrate-job.yaml)), never
      from each pod's own entrypoint once replicas > 1 (that races `pg_advisory_lock` and a
      10s timeout turns into a crash-looping rollout). Full reasoning and the measured race
      behaviour: [CONVENTIONS.md §6](../CONVENTIONS.md#6-şema-göçü-migration-politikası--çok-replikalı-dağıtımda-güvenli-değişiklik-tm-1643).
- [ ] Every migration since adopting this decision follows expand → migrate → contract
      (CONVENTIONS.md §6.3) — no single release drops/renames a column, narrows a type, or adds
      `NOT NULL` without a `DEFAULT` while an old pod might still be running.
- [ ] [`values.production.example.yaml`](../infra/helm/nexa/values.production.example.yaml) is
      copied (not committed) and every placeholder is filled: image registry/tags, real
      hostnames, `TRUST_PROXY_HOPS`, `backup.storageClassName`, and the secret provisioning
      path (the file's own comments name three options and recommend one).

## 6. Backup

- [ ] A backup is scheduled:
      [`templates/backup-cronjob.yaml`](../infra/helm/nexa/templates/backup-cronjob.yaml)
      (nightly `pg_dump` into a PersistentVolumeClaim) for a real deployment, or `make backup`
      for the local/dev stack. Retention: `BACKUP_RETENTION_DAYS` (default 30).
- [ ] A restore drill has actually been run against a real backup — a backup **existing** is
      not the claim this repo makes, a backup **restoring** is: `make restore-drill` (backs up,
      then drills that backup) or `./scripts/restore-drill.sh --dump backups/db-….dump` (drill
      an archive you already have). Verified on every run, with exit codes: applied-migration
      set matches (none half-applied
      — the P3009 state); row counts for `organizations`/`accounts`/`chats`/`events` match; the
      row-level-security surface (every table, policy name, `USING`/`WITH CHECK` body) is
      identical; extensions and `SECURITY DEFINER` functions match; every `events` partition
      has RLS on with exactly one policy; connecting as the non-owner `nexa_app` role returns
      no rows without a tenant context and the right rows with one. See README
      ["Restore drill"](../README.md#restore-drill).
- [ ] `backup.storageClassName` in `values.production.example.yaml` names an at-rest-encrypted
      StorageClass — the PVC holds every tenant's personal data unencrypted at the application
      layer, so this is the single richest target the chart creates.
- [ ] The `nexa_app` role exists in the target cluster **before** restoring into a fresh one —
      a per-database `pg_dump` carries no `CREATE ROLE`. Run
      [`infra/db/init/00-extensions.sql`](../infra/db/init/00-extensions.sql) first, or capture
      globals separately with `pg_dumpall --globals-only`.

## 7. Observability

- [ ] `OTEL_EXPORTER=otlp` and `OTEL_EXPORTER_OTLP_ENDPOINT` point at a real collector this
      deployment can reach. The exporter selection itself is verified in this repo —
      `apps/api/src/telemetry/telemetry.test.ts` (5),
      `apps/rtm/src/telemetry/telemetry.test.ts` (12) — but connecting to a **real** collector
      is out of this repository's scope (CLAUDE.md: no real external providers; the mock→real
      switch is your deployment's job, not a code change here). Confirm reachability yourself,
      e.g. `curl -f "$OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces"` from a pod's network.
- [ ] After cutover, confirm the collector actually receives RTM's three instruments:
      `rtm.connections.active` (gauge), `rtm.fanout.delay` (histogram, seconds),
      `rtm.connections.closed` (counter, labelled by reason).

## 8. Compliance

- [ ] `RETENTION_*_DAYS` has been reviewed against your own legal/compliance requirement, not
      left at this repo's defaults (threads 365d, visitor telemetry 90d, spooled mail 30d,
      basic audit log 30d — NFR-C8).
- [ ] `RETENTION_ENABLED` is set deliberately, not left unexamined. It defaults to `false`
      everywhere, including with the scheduler otherwise on, because this is the one sweep
      that hard-deletes and a scheduled pass has no operator to confirm each run. `/health`
      always reports it explicitly (`enabled: false`, never simply absent). See README
      ["`SCHEDULER_ENABLED` and `RETENTION_ENABLED` defaults"](../README.md#scheduler_enabled-and-retention_enabled-defaults).
- [ ] Backups are covered by the same policy (NFR-C8), not exempt from it:
      `BACKUP_RETENTION_DAYS` deletes whole archive files past the window. An urgent
      single-subject erasure request that cannot wait for that window needs manual
      identification of the affected archive(s) — filenames are UTC timestamps — see README
      ["Backups"](../README.md#backups).

## Explicitly out of scope

This checklist stops at what a deployment built from this code needs to configure and verify
locally or offline. The following are **not "not done"** — they are outside this repository's
boundary (CLAUDE.md) and no amount of further work here produces them:

- TLS/DNS certificates and a real Ingress hostname.
- Any real external provider — LLM, SMTP, S3, Stripe, push, SIEM, AV, and the five messaging
  channels are all mocked by design. Swapping a mock for a real provider is a deployment-time
  integration decision, not a code change this repository makes for you.
- SOC2/ISO/BAA process artifacts — organizational and legal work, not code.

## Status

Every item above currently has evidence recorded in this repository (`PLAN.md`'s `§7.2` shows
`M-PROD-CFG`, `M-OPS`, `M-LOAD`, `M-SCALE`, `M-OTEL`, `M-IAC`, `M-BACKUP` all `✅`). None is
marked "pending (tm N)" as of this writing. If a future change reopens one of those rows,
update the corresponding section above rather than assuming it still holds.
