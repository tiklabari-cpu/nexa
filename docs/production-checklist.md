# Production checklist

Every line below is either a command you run against your own deployment or a pointer to
evidence already recorded in this repository — nothing here is "reviewed and looks fine."
If a line has no command, it names the exact file/test that proves the capability exists;
running it against your infrastructure is still your job, this repo has never seen a real
cluster (CLAUDE.md).

This is not a substitute for reading [README.md](../README.md) — most items below link back
to the section that explains the _why_. This document is the _what to check, in order_.

This is a pre-deployment checklist, not an incident guide — for that, see
[`docs/runbooks/`](runbooks/): Postgres down, Redis down, webhook delivery backlog, RTM
connection storm, suspected cross-tenant data exposure, `events` partition maintenance
failing.

## 1. Configuration

- [ ] `NODE_ENV=production` is set on both `apps/api` and `apps/rtm`. Boot refuses to start
      otherwise and lists every problem at once — see `apps/api/src/config/env.test.ts`
      ("production configuration" suite) and `apps/api/test/integration/production-boot.test.ts`.
- [ ] All six key-material secrets are freshly generated for this deployment and none is the
      published `dev-only-…` placeholder: `JWT_SIGNING_KEY`, `WEBHOOK_HMAC_SEED`,
      `CUSTOMER_TOKEN_SECRET`, `UPLOAD_SIGNING_KEY`, `AUDIT_CHAIN_SECRET`, `INBOUND_EMAIL_SECRET`.
      Generate each independently — `openssl rand -hex 32`. See README
      ["Required — boot refuses without these"](../README.md#required--boot-refuses-without-these).
- [ ] `DATABASE_APP_URL` is set to the non-owner `siyahtus_app` role and is **different** from
      `DATABASE_URL` — pointing both at the owner role silently disables row-level security
      (tenant isolation) without failing any request. See README
      ["`DATABASE_URL` vs `DATABASE_APP_URL`"](../README.md#database_url-vs-database_app_url).
- [ ] `TRUST_PROXY_HOPS` is set to the number of reverse proxies actually in front of the
      process, using the table in README
      ["Choosing `TRUST_PROXY_HOPS`"](../README.md#choosing-trust_proxy_hops) — and a
      NetworkPolicy (or equivalent) guarantees that count, per
      [`infra/helm/siyahtus/templates/networkpolicy.yaml`](../infra/helm/siyahtus/templates/networkpolicy.yaml).
      Measured consequence of skipping the policy half:
      `apps/api/test/integration/trust-proxy.test.ts`.
- [ ] `WEB_ORIGIN` lists **every** origin a browser loads a SiyahTuş page from, comma-separated:
      the agent panel, any standalone chat page, **and `WIDGET_BASE_URL`'s origin**. The widget
      has no same-origin backend — its browser code calls the API cross-origin — so a list
      naming only the panel serves agents and refuses every customer conversation, silently.
      Boot refuses a list that omits the widget's origin (`apps/api/src/config/env.ts`);
      serving the widget from the panel's own host satisfies it without a second entry.
      Evidence: `apps/api/test/integration/production-boot.test.ts`.
- [ ] Copy [`.env.production.example`](../.env.production.example) to `.env`, fill every
      placeholder, then boot once — a missing or placeholder value fails loudly with every
      problem listed together, not on the first request that happens to touch it.

## 2. Ops

- [ ] The orchestrator's liveness probe targets `/health/live` (no dependency checks) and its
      readiness probe targets `/health/ready` (checks Postgres/Redis) — never the same path for
      both. Evidence: `infra/helm/siyahtus/templates/deployment.yaml` (`livenessProbe`/
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
- [ ] After `EMBEDDING_PROVIDER` or `EMBEDDING_MODEL` changes — the stub to a model, or one
      model to another — re-embed the stored knowledge base:
      `pnpm --filter @siyahtus/api knowledge:reembed`, then `… knowledge:reembed --status` must
      report `pendingChunks: 0`. Until a source is re-embedded, questions asked in the new space
      cannot find it and go to a human (never to a passage from the other space). The run is
      per source and atomic, resumable (`--limit N`, or just run it again) and reversible (run
      it with the previous provider configured). Evidence:
      `apps/api/test/integration/knowledge-reembed.test.ts`, PLAN §D182.
- [ ] After the first boot, the admin `GET /api/v1/health` body shows
      `event_partitions.last_status: "ok"` and `failed_months: []` — the API opened the
      `events` partitions from last month to three months ahead as the runtime role. Anything
      else is on a quarter's runway, not an outage: follow
      [`docs/runbooks/event-partitions.md`](runbooks/event-partitions.md). Something should be
      watching that field for the life of the deployment — the status code will not change
      when it fails. Evidence: `apps/api/test/integration/event-partition-maintenance.test.ts`,
      PLAN §D187.

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
      [`infra/helm/siyahtus/values.yaml`](../infra/helm/siyahtus/values.yaml) reflect a measurement, not
      a guess, for the traffic you expect — the shipped defaults (api: 250m/256Mi requests,
      1/512Mi limits; rtm: 250m/128Mi requests, 1/512Mi limits; both HPA 1–4 replicas @ 70% CPU)
      are sized for this repo's own load-test hardware, not yours.

## 4. Scale

- [ ] Two-pod validation has passed: cross-pod fan-out delivers and exactly one scheduler
      leader is elected, measured with two real OS processes each for `apps/api` and
      `apps/rtm` (not two instances inside one test process). Evidence:
      `apps/api/test/integration/two-pod.test.ts` (8).
- [ ] Uploads land somewhere **every** api pod can read them: `STORAGE_PROVIDER=s3` with
      `STORAGE_S3_ENDPOINT`, `STORAGE_S3_BUCKET`, `STORAGE_S3_ACCESS_KEY_ID` and
      `STORAGE_S3_SECRET_ACCESS_KEY` pointed at a real bucket — never `local` once more than
      one api pod can exist. `local` writes to the pod's own ephemeral disk, so an upload
      taken by one pod is a 404 from the next and a 400 ("a file this workspace uploaded") on
      any event carrying its `attachment_url`; a 400 is never retried and no 4xx pages anyone.
      That is not a prediction — it is the `local` control group in
      `apps/api/test/integration/two-pod.test.ts`, four real processes, alongside the `s3`
      pair that passes the same three steps. The chart ships `STORAGE_PROVIDER: s3` with
      `CHANGE_ME` placeholders ([`values.yaml`](../infra/helm/siyahtus/values.yaml)); left
      untouched every attachment answers 503 rather than silently falling back to local disk.
      `apps/api/src/config/chart-storage.test.ts` fails the build if the chart ever pairs
      pod-local uploads with an api replica ceiling above 1. Security parity between the two
      providers (fail-closed virus scan, signed PUT, type/size limits, served content type) is
      `apps/api/test/integration/uploads-parity.test.ts` — one expectation list, run twice.
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
      `helm template siyahtus infra/helm/siyahtus -f infra/helm/siyahtus/values.yaml -f infra/helm/siyahtus/values.production.example.yaml`
      then `helm lint infra/helm/siyahtus`. Recorded result in this repo: `helm lint` exit 0; every
      rendered resource valid against real Kubernetes OpenAPI schemas via `kubeconform -strict`
      — 21/21 (default values), 20/20
      (production overlay). `kubectl apply --dry-run=client` does **not** work offline (it needs
      live API-server discovery even with `--validate=false`) — `kubeconform` is this repo's
      dry-run equivalent; see README ["Deployment"](../README.md#deployment) for the full
      reasoning.
- [ ] Migration strategy is applied as decided, not left at a per-pod default:
      `prisma migrate deploy` runs once per release from the pre-install/pre-upgrade Helm hook
      Job ([`templates/migrate-job.yaml`](../infra/helm/siyahtus/templates/migrate-job.yaml)), never
      from each pod's own entrypoint once replicas > 1 (that races `pg_advisory_lock` and a
      10s timeout turns into a crash-looping rollout). Full reasoning and the measured race
      behaviour: [CONVENTIONS.md §6](../CONVENTIONS.md#6-şema-göçü-migration-politikası--çok-replikalı-dağıtımda-güvenli-değişiklik-tm-1643).
- [ ] Every migration since adopting this decision follows expand → migrate → contract
      (CONVENTIONS.md §6.3) — no single release drops/renames a column, narrows a type, or adds
      `NOT NULL` without a `DEFAULT` while an old pod might still be running.
- [ ] [`values.production.example.yaml`](../infra/helm/siyahtus/values.production.example.yaml) is
      copied (not committed) and every placeholder is filled: image registry/tags, real
      hostnames, `TRUST_PROXY_HOPS`, `backup.storageClassName`, and the secret provisioning
      path (the file's own comments name three options and recommend one).

## 6. Backup

- [ ] A backup is scheduled:
      [`templates/backup-cronjob.yaml`](../infra/helm/siyahtus/templates/backup-cronjob.yaml)
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
      has RLS on with exactly one policy; connecting as the non-owner `siyahtus_app` role returns
      no rows without a tenant context and the right rows with one. See README
      ["Restore drill"](../README.md#restore-drill).
- [ ] Uploads are covered by the **bucket's** own durability settings, not by this CronJob:
      the scheduled backup is `pg_dump` only, deliberately
      ([`values.yaml`](../infra/helm/siyahtus/values.yaml) `backup:` block explains why). With
      `STORAGE_PROVIDER=s3` the objects live outside the cluster, so versioning, lifecycle
      rules and any cross-region replication are settings on the bucket — check they exist
      there, because nothing in this chart checks them for you.
- [ ] `backup.storageClassName` in `values.production.example.yaml` names an at-rest-encrypted
      StorageClass — the PVC holds every tenant's personal data unencrypted at the application
      layer, so this is the single richest target the chart creates.
- [ ] The `siyahtus_app` role exists in the target cluster **before** restoring into a fresh one —
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

## 9. Pilot on Docker Compose

The controlled production pilot (owner decision 2026-09-22) runs on one Docker host from
[`docker-compose.pilot.yml`](../docker-compose.pilot.yml), under `NODE_ENV=production`, with
no demo seed. The file publishes every port on `127.0.0.1` only. The reverse proxy in front
of it runs on the host; **Reverse proxy** below gives a ready Caddy configuration for it. DNS
and the host are the owner's. Sections 1–8 still apply; this one is the order of operations
for that stack.

**Keys.** `cp .env.production.example .env` next to the compose file (never committed —
`.gitignore` covers `.env`), then replace every `<…>`. Boot refuses a copy with one left in
and names the key. By name, what the pilot needs:

- Compose itself: `POSTGRES_PASSWORD`, `SIYAHTUS_APP_DB_PASSWORD` (hex, `openssl rand -hex 32`;
  the compose file builds `DATABASE_URL`, `DATABASE_APP_URL` and `REDIS_URL` from them and
  overrides those three lines of `.env`).
- Addresses: `API_BASE_URL`, `RTM_BASE_URL`, `WEB_APP_URL`, `WIDGET_BASE_URL`, `WEB_ORIGIN`
  (must contain `WIDGET_BASE_URL`'s origin), `INBOUND_EMAIL_DOMAIN`, `TRUST_PROXY_HOPS`.
  `RTM_BASE_URL` and `API_BASE_URL` are baked into the web and widget bundles at build time,
  so changing either means `up --build`.
- Secrets: `JWT_SIGNING_KEY`, `WEBHOOK_HMAC_SEED`, `CUSTOMER_TOKEN_SECRET`,
  `UPLOAD_SIGNING_KEY`, `AUDIT_CHAIN_SECRET`, `INBOUND_EMAIL_SECRET`.
- Model: `LLM_PROVIDER=openai`, `LLM_PROVIDER_REGION`, `LLM_API_BASE_URL`, `LLM_MODEL`,
  `LLM_API_KEY`.
- Embeddings: `EMBEDDING_PROVIDER=openai`, `EMBEDDING_PROVIDER_REGION`,
  `EMBEDDING_API_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`.
- Mail: `MAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`,
  `SMTP_FROM`. Optional: `ASSIGNEE_EMAIL_COOLDOWN_MS` (how long one e-mail to a chat's
  assignee covers that chat; default 15 min).
- Sign-up: `SIGNUP_ENABLED` stays `true` until the pilot's workspaces exist, then `false`
  (see **Run** below).

Values go into `.env` on the host and nowhere else — not into a ticket, a log, a commit or
this document.

**Where each value comes from (tm 255.16).** Only names here, never values:

| Key(s)                                                                                                                                                                               | Where the owner gets it                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SMTP_USERNAME`, `SMTP_PASSWORD`                                                                                                                                                     | The PrivateEmail (Namecheap) mailbox that sends the pilot's mail. The username is the mailbox's full address. The password is that mailbox's password. |
| `SMTP_FROM`                                                                                                                                                                          | That same mailbox's address, bare (`name@domain`) — not a secret.                                                                                      |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`                                                                                                                                              | PrivateEmail's published settings, already in the template (587 + STARTTLS, or 465 with `SMTP_SECURE=true`).                                           |
| `LLM_API_KEY`, `EMBEDDING_API_KEY`                                                                                                                                                   | An API key from the OpenAI platform account (ADR `docs/adr/pilot-llm-embedding-provider.md` §9). The two may hold the same key.                        |
| `LLM_MODEL`                                                                                                                                                                          | The chat model id chosen in that account. `EMBEDDING_MODEL` stays `text-embedding-3-small` (the column is `vector(1536)`).                             |
| `LLM_PROVIDER_REGION`, `EMBEDDING_PROVIDER_REGION`, `*_API_BASE_URL`                                                                                                                 | The owner's region decision (ADR §11.2). `eu` needs OpenAI's EU data-residency approval first. The base URL must be that region's host.                |
| `POSTGRES_PASSWORD`, `SIYAHTUS_APP_DB_PASSWORD`, `JWT_SIGNING_KEY`, `WEBHOOK_HMAC_SEED`, `CUSTOMER_TOKEN_SECRET`, `UPLOAD_SIGNING_KEY`, `AUDIT_CHAIN_SECRET`, `INBOUND_EMAIL_SECRET` | Generated on the host: `openssl rand -hex 32`, one per key.                                                                                            |
| `API_BASE_URL`, `RTM_BASE_URL`, `WEB_APP_URL`, `WIDGET_BASE_URL`, `WEB_ORIGIN`, `INBOUND_EMAIL_DOMAIN`, `TRUST_PROXY_HOPS`                                                           | The owner's domain and the reverse proxy in front of the host.                                                                                         |

Two owner decisions come before the first real call (ADR §11): whether the OpenAI account and
its billing are accepted, and whether the pilot's region is `eu` or `us`. Once a key exists,
`RETRIEVAL_THRESHOLD` has to be measured once in the real embedding space. It was only
measured in the stub's space (tm 255.8, PLAN §D183 (5)): with the four `EMBEDDING_*` keys set,
run `pnpm --filter @siyahtus/api measure:knowledge-recall`. Exit 0 means PASS, 1 FAIL, 2 means it
was not measured, which is not a pass. The threshold is a setting since tm 256.6: the command
measures the value in `.env` (default `0.25`), marks it `*` in its sweep, and names the key.
If the sweep points to a different value, set `RETRIEVAL_THRESHOLD=<value>` in `.env` (a
number in `[-1, 1]`; an empty value stops the api at boot) and restart the api with
`docker compose -f docker-compose.pilot.yml up -d api`. No rebuild is needed. Run the command
again to confirm PASS at the new value.

**Choosing `LLM_MODEL` (tm 256.6).** Pick a chat model that answers without a reasoning phase.
A reasoning model counts its hidden reasoning against `max_completion_tokens`, which the api
sets from `LLM_MAX_OUTPUT_TOKENS` (default 400). It can use all of it on reasoning and return no
text, and every customer question then goes to a human. The api logs this as a `warn` line with
`event` `llm.failed`, `kind` `no_answer`, `reason` `length` and a `hint` field that names both
fixes. If the account only offers reasoning models, raise `LLM_MAX_OUTPUT_TOKENS` (at most 16384) until the `hint` lines stop, and note that the output is billed at the higher count.

**Reverse proxy (tm 256.5).** [`infra/pilot/Caddyfile.example`](../infra/pilot/Caddyfile.example)
is a ready configuration for Caddy on the pilot host. It serves four names, gets and renews
their certificates itself, and dials the four ports the compose file publishes on `127.0.0.1`.
Certificates, DNS records and the host itself are the owner's.

- [ ] Four DNS names point at the host: the panel, the widget, the api and RTM. They become
      `WEB_APP_URL` and the first `WEB_ORIGIN` entry, `WIDGET_BASE_URL` and the second
      `WEB_ORIGIN` entry, `API_BASE_URL` (`https://`) and `RTM_BASE_URL` (`wss://`).
- [ ] Copy the example to `/etc/caddy/Caddyfile` and replace `example.com`. If `.env` moves a
      port with a `SIYAHTUS_*_HOST_PORT` line, change the matching `reverse_proxy` line too.
      `caddy validate --config /etc/caddy/Caddyfile` exits 0, then `systemctl reload caddy`.
      Without Caddy installed, the same check runs in a container from the repository root:
      `docker run --rm -v "$PWD/infra/pilot/Caddyfile.example:/etc/caddy/Caddyfile:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`.
- [ ] `TRUST_PROXY_HOPS=1`, and it is right for every path only because of how the panel is
      routed. The panel's own nginx also proxies `/api/` and appends to `X-Forwarded-For`, so a
      panel request through it would reach the api with two hops while the widget's has one,
      and one number cannot describe both. The Caddyfile sends the panel's `/api/*` straight to
      the api instead, so all four names are one hop. Keep that `handle /api/*` block.
- [ ] Do not add `trusted_proxies` to the Caddyfile. Without it Caddy replaces any
      `X-Forwarded-For` the caller sent with the address it actually saw. With it, a caller
      can choose the address the api's rate limit, IP ban and agent allow-list see.
- [ ] Run the smoke test against the public names:
      `API_BASE=https://api.… RTM_BASE=https://rtm.… WEB_BASE=https://panel.… WIDGET_BASE=https://widget.… SMOKE_PROFILE=pilot ./scripts/smoke.sh`.
      It also checks that neither image serves source maps (both are built without them).

**Run.**

- [ ] `docker compose -f docker-compose.pilot.yml config --quiet` exits 0. A missing
      Compose variable fails here, by name, before any container exists.
- [ ] `docker compose -f docker-compose.pilot.yml up --build -d` (or `make pilot`, which also
      runs the smoke test). The api migrates on its own start (one replica — CONVENTIONS §6.1);
      rtm and web wait for a healthy api. A configuration production refuses stops the api
      with one `Invalid environment for NODE_ENV=production` block listing every problem:
      `docker compose -f docker-compose.pilot.yml logs api`.
- [ ] `docker compose -f docker-compose.pilot.yml ps` shows `db`, `redis`, `api`, `rtm`,
      `web` and `widget` all `healthy`.
- [ ] `SMOKE_PROFILE=pilot ./scripts/smoke.sh` exits 0 (`make pilot-smoke`). Beyond health
      and wiring it checks the part production adds: a CORS preflight from `WIDGET_BASE_URL`'s
      origin and from the panel's is answered, one from an unlisted origin is not. Point it at
      the public side with `API_BASE=… RTM_BASE=… WEB_BASE=… WIDGET_BASE=…` once the proxy is
      up.
- [ ] `WEB_APP_URL` is the address the panel is actually served from — its origin +
      `/auth/callback` is the OAuth redirect every workspace registers (tm 255.17 · PLAN
      §D189). A workspace signed up here gets exactly that one plus the mobile
      `siyahtus://auth/callback`; one that existed before gains it at the api's next start
      (one `registered this deployment’s console callback` info line; a failure is one
      `error` line and does not stop the boot). Production refuses a `WEB_APP_URL` that no
      sign-in could use (plain `http` off `localhost`). Changing the address later adds the
      new callback and keeps the old one — removing it is a manual step, not something a
      restart does: as the owner role, `array_remove` the old callback from
      `oauth_clients.redirect_uris` on the clients whose id matches `siyahtus-%-app-%`.
- [ ] Create the first workspace by signing up in the panel (there is no seed). Then run the
      smoke test once more with `SMOKE_ORGANIZATION_ID=<its id>` and
      `SMOKE_ADMIN_TOKEN=<the owner's access token>`: it mints a visitor token from the widget
      origin, cross-origin, and reads the admin `/health` — scheduler enabled and
      `event_partitions.last_status: ok` (tm 255.14).
- [ ] Close sign-up once the pilot's own workspaces exist (tm 256.3). Sign-up is anonymous
      and checks no email: while it is open, anyone who finds the address can create a
      workspace and spend the pilot's model key and mailbox. Set `SIGNUP_ENABLED=false` in
      `.env`, then `docker compose -f docker-compose.pilot.yml up -d` (Compose re-creates the
      containers whose environment changed; no rebuild). Only `true` and `false` are read —
      any other value, an empty one included, stops the api at boot with `SIGNUP_ENABLED`
      named in the log. Check it from outside:
      `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' <API_BASE_URL>/api/v1/auth/signup`
      prints `403` (the body says `not_allowed`, `details.reason: signup_closed`, and nothing
      is written). The panel's sign-up form says sign-up is closed. Teammates still join by
      invitation from Settings; to add another workspace later, open it for that one sign-up
      and close it again.
- [ ] Decide what happens when a pilot workspace's trial ends (tm 256.1). Every workspace
      starts a trial of `TRIAL_DAYS` days (default 14, read at sign-up) and turns read-only
      when it ends — agents cannot answer and visitors cannot write. The product's own way
      back is a plan plus a card on the Billing page, and the pilot takes no real payments.
      So either set `TRIAL_DAYS` in `.env` before the pilot workspaces sign up, long enough
      that no trial ends inside the pilot, or activate each pilot workspace by hand once it
      exists, as the owner role:
      `docker compose -f docker-compose.pilot.yml exec db psql -U siyahtus -d siyahtus -c "UPDATE licenses SET status = 'active', trial_ends_at = NULL WHERE organization_id = (SELECT id FROM organizations WHERE name = '<workspace name>') AND status IN ('trialing', 'read_only')"`.
      It prints `UPDATE 1`; two workspaces with the same name make it fail instead of
      guessing — use the organization id then. This path writes no audit entry (the
      audit chain is signed inside the api), so record who was activated and when
      somewhere of your own.

**Data.**

- [ ] The database lives on the named volume `siyahtus-pilot_siyahtus_pilot_pgdata`: it survives
      `down`, `up --build` and a reboot. `down -v` deletes it — never run it on this project
      (there is deliberately no `make` target for it).
- [ ] `SIYAHTUS_APP_DB_PASSWORD` is applied to `siyahtus_app` on the first start of an empty volume
      only ([`infra/db/pilot/10-app-role-password.sh`](../infra/db/pilot/10-app-role-password.sh)).
      To rotate it later, run `ALTER ROLE siyahtus_app PASSWORD '<new>'` through
      `docker compose -f docker-compose.pilot.yml exec db psql -U siyahtus -d siyahtus`, change
      `.env`, then `up -d`.
- [ ] Backups use the same scripts as §6, pointed at this file: `make pilot-backup`
      (`COMPOSE_FILE=docker-compose.pilot.yml ./scripts/backup.sh`) writes
      `backups/db-<UTC>.dump`, and `make pilot-restore-drill` proves one restores (on a
      database with no chat yet it fails "RLS enforcement not exercised" — it will not call
      isolation verified without rows to verify it on; run it again after the first
      conversation).
- [ ] Backups run every day without anyone remembering to (tm 256.5). A line in
      `/etc/cron.d/siyahtus-backup`, with the repository at `/opt/siyahtus`:
      `15 3 * * * root cd /opt/siyahtus && COMPOSE_FILE=docker-compose.pilot.yml ./scripts/backup.sh >>/var/log/siyahtus-backup.log 2>&1`.
      The script deletes its own archives older than `BACKUP_RETENTION_DAYS` (default 30,
      NFR-C8). Read the log after the first night: it ends in `Done.` and a size.
- [ ] A copy leaves the host. A backup on the same disk as the database is lost with it. The
      archives hold every workspace's personal data, so the copy is encrypted and the place
      it goes is the owner's. Any one of these, after the backup line:
  - an S3-compatible bucket in another account or provider, through `rclone` with a `crypt`
    remote: `45 3 * * * root rclone copy /opt/siyahtus/backups <remote>: --max-age 24h && rclone delete <remote>: --min-age 30d`;
  - another machine over SSH: `rsync -a --delete /opt/siyahtus/backups/ <user>@<host>:siyahtus-backups/`
    (`--delete` keeps the other side's retention equal to this one's);
  - at the least, the hosting provider's own volume snapshots. They survive a lost disk, not a
    lost account.

  Whichever it is, the other side also keeps no more than 30 days, or an erasure honoured in
  the database lives on there.

- [ ] Restore from the off-host copy, not only from the local file. Once a month: take a
      fresh backup (`make pilot-backup`), send it through the same copy, fetch it back into
      another directory, and drill the fetched file straight away:
      `COMPOSE_FILE=docker-compose.pilot.yml APP_DB_PASSWORD=<SIYAHTUS_APP_DB_PASSWORD> ./scripts/restore-drill.sh --dump <fetched file>`.
      It restores into a scratch database, verifies it and drops it; exit 0 is the claim. Do it
      at once because the drill compares row counts with the live database: last night's
      archive reports every chat written since as a failure. A copy that was never restored
      is not yet a backup.
- [ ] Something outside the host watches it (tm 256.5). Nothing in this stack reports its own
      death. The pilot has no monitoring stack, and when the host is down its mail is down
      too. Use an external uptime service that alerts somewhere other than the pilot's mailbox
      (another address, SMS, a phone app), and check every one to five minutes:
      `https://api.…/api/v1/health/ready` and `https://rtm.…/health/ready` (both 200 only with
      Postgres and Redis reachable), `https://panel.…/` and `https://widget.…/loader.js`. Most
      such services also take a heartbeat: add `&& curl -fsS <heartbeat URL>` to the backup
      line, and a night without a backup raises an alert too.
- [ ] `OTEL_EXPORTER=none` (the template sets it): there is no collector in the pilot, and
      the `console` default prints every span into the container log — measured, only 33 of
      566 lines in five minutes were the api's own log records. `docker compose -f docker-compose.pilot.yml logs api` should read
      as one JSON record per line.
- [ ] Uploads: the pilot keeps file sharing off (tm 255.13). A workspace that turns it on
      stores files under `/tmp` inside the api container; they do not survive `up --build`.

**Known risks at pilot readiness (tm 255.16, re-checked at the tm 256 closing gate, tm 256.11
on 2026-10-01).** Open, not fixed by this checklist:

- Courtesy mail is sent after the answer, and is not persisted. Until tm 256.4 the assignee's
  new-message notice, the chat transcript on close and the customer's ticket-status notice
  were sent inside the request that caused them, so a hung SMTP server held the visitor's
  message, the archive and the ticket update for about 33 s (3 × 10 s timeout + 1 + 2 s
  backoff, PLAN §D179). All three now go through `app.backgroundMail`, like the password
  reset: the request answers at once, and a mail that did not go out leaves one `warn` line
  with `event` `assignee_notification.mail`, `chat.transcript_mail` or `ticket.notice_mail`
  and the carrier's classification, never the address. What remains is the queue's nature:
  a mail in flight when the api stops is lost. A graceful stop waits for it, a crash does
  not. The assignee's e-mail is also held to one per chat and assignee per
  `ASSIGNEE_EMAIL_COOLDOWN_MS` (default 15 min, `0` mails every message), so a visitor typing
  twenty lines no longer sends twenty mails against the sending limit invitations and resets
  share. Handset push is not held.
- The AI Agent's and the rule bot's answers are written after the visitor's send returns, and
  are not persisted. Until tm 256.10 the send waited for them — up to `EMBEDDING_TIMEOUT_MS` +
  `LLM_TIMEOUT_MS` (10 s + 20 s) with the widget's Send button locked. They now run in the api
  process after the response, one message at a time per chat, followed by the assignee's
  notice; the widget receives the answer over its socket or its next poll, like an agent's
  reply. A graceful stop waits for answers already on their way, inside the same 15 s close
  ceiling a held request had; a crash, or a model call the ceiling cuts off, loses that answer
  and the message stays unanswered in the inbox for a human — the same outcome as a model
  error. A chat 20 messages behind leaves the next one for a human and logs `warn`
  `visitor follow-ups backed up; leaving this message for a human`. The per-chat order holds
  within one api process, which is what the pilot runs.
- Outgoing webhooks connect directly to the address their SSRF check approved (tm 256.9) and
  ignore `HTTP_PROXY`/`HTTPS_PROXY`: a proxy that resolved the name itself would undo the pin.
  The pilot host needs direct egress for webhooks; behind a mandatory egress proxy they fail
  with a logged network error.
- `pnpm audit --prod` on 2026-10-01 reported 27 advisories (7 moderate, 20 high). Every path
  starts at `apps/mobile` (the Expo tool chain); none reaches the api, rtm, web or widget
  images, and mobile is outside the pilot. New advisories arrive weekly (51 became 59 within
  tm 256.2), so run it again before go-live and read the paths, not the count.
- Memory pressure stalls requests without failing them. On the development machine a host
  paging under load froze Vite for 10 s and the api for 7.6 s at almost no CPU (tm 256.8,
  PLAN §D200), and nothing in the stack reports it. Give the pilot host enough RAM that the
  six containers do not swap, and watch the host's own memory and paging, not only the probe.
- The e2e suite is order-dependent (independent audit finding G9-GATE-a): full runs have
  failed on different single tests that each pass alone. That is test fixture state, not
  product code. At the tm 256 closing gate one full run failed an axe scan that measured the
  composer's tabs halfway through their 150 ms colour transition; the scan now finishes CSS
  transitions before it reads colours.
- Outside the pilot by the owner's decision (2026-09-22): payments/Stripe, messaging channels,
  mobile push, S3 + virus scanning + SIEM + load testing, the MCP protocol, social sign-in, and
  Kubernetes (the Helm chart is kept, not used).

## Explicitly out of scope

This checklist stops at what a deployment built from this code needs to configure and verify
locally or offline. The following are **not "not done"** — they are outside this repository's
boundary (CLAUDE.md) and no amount of further work here produces them:

- TLS/DNS certificates and a real Ingress hostname.
- Any real external provider beyond the pilot's three — S3, Stripe, push, SIEM, AV, and the
  five messaging channels are mocked by design. The LLM, embedding and SMTP adapters are real
  (tm 255.3 · 255.6 · 255.7) and §9 turns them on; their credentials and reachability are
  still the deployment's.
- SOC2/ISO/BAA process artifacts — organizational and legal work, not code.

## Status

Every item above currently has evidence recorded in this repository (`PLAN.md`'s `§7.2` shows
`M-PROD-CFG`, `M-OPS`, `M-LOAD`, `M-SCALE`, `M-OTEL`, `M-IAC`, `M-BACKUP` all `✅`). None is
marked "pending (tm N)" as of this writing. If a future change reopens one of those rows,
update the corresponding section above rather than assuming it still holds.
