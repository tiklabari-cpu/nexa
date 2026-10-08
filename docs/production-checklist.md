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

The public pilot (owner decision 2026-10-02, which replaced the controlled pilot of
2026-09-22) runs on one Docker host from [`docker-compose.pilot.yml`](../docker-compose.pilot.yml),
under `NODE_ENV=production` and `PILOT_MODE=true`, with no demo seed. Sign-up is open to anyone,
behind e-mail verification and daily caps (**Sign-up, caps and abuse limits**). Every region is
`us`. There are no payments: the billing surfaces are hidden, a trial lasts 14 days, and after it
the owner activates a workspace by hand (**Trial end and manual activation**). The compose file
publishes every port on `127.0.0.1` only. The edge in front of it runs on the host: a Cloudflare
Tunnel now (**Now: Cloudflare Tunnel**), Caddy on DNS-only records after a later move
(**After the move: Caddy**). DNS, the accounts and the host are the owner's. Sections 1–8 still
apply; this one is the order of operations for that stack.

**Opening gates, in order.** Bring the stack up with `SIGNUP_ENABLED=false` in `.env`, and
flip it to `true` only when every gate below has passed. Each one is explained in its own
subsection:

1. The mail domain authenticates its own mail (SPF, DKIM, DMARC all `pass` on a real message).
   A verification mail that lands in spam stops every new sign-up.
2. The opening-day measurement passes on the real edge, so `TRUST_PROXY_HOPS` is confirmed
   rather than assumed. The per-network sign-up limit depends on it.
3. `RETRIEVAL_THRESHOLD` was measured in the real embedding space (exit 0).
4. The privacy policy and the terms are published at the addresses `PRIVACY_POLICY_URL` and
   `TERMS_URL` name.
5. One backup was taken, restored, and copied off the host.

### Keys

`cp .env.production.example .env` next to the compose file (never committed — `.gitignore`
covers `.env`), then replace every `<…>`. Boot refuses a copy with one left in and names the
key. By name, what the pilot needs:

- Compose itself: `POSTGRES_PASSWORD`, `SIYAHTUS_APP_DB_PASSWORD` (hex, `openssl rand -hex 32`;
  the compose file builds `DATABASE_URL`, `DATABASE_APP_URL` and `REDIS_URL` from them and
  overrides those three lines of `.env`).
- Addresses: `API_BASE_URL`, `RTM_BASE_URL`, `WEB_APP_URL`, `WIDGET_BASE_URL`, `WEB_ORIGIN`
  (must contain `WIDGET_BASE_URL`'s origin), `INBOUND_EMAIL_DOMAIN`, `TRUST_PROXY_HOPS`.
  `RTM_BASE_URL` and `API_BASE_URL` are baked into the web and widget bundles at build time,
  so changing either means `up --build`.
- Secrets: `JWT_SIGNING_KEY`, `WEBHOOK_HMAC_SEED`, `CUSTOMER_TOKEN_SECRET`,
  `UPLOAD_SIGNING_KEY`, `AUDIT_CHAIN_SECRET`, `INBOUND_EMAIL_SECRET`.
- Pilot mode: `PILOT_MODE=true` (turns the stub providers into a boot failure and hides the
  mock surfaces) and `PILOT_CONTACT_EMAIL` (the address the trial-end notice and the notes on
  closed features show to users; public by design).
- Region and model: `SIYAHTUS_REGION`, `LLM_PROVIDER=openai`, `LLM_PROVIDER_REGION`,
  `LLM_API_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`.
- Embeddings: `EMBEDDING_PROVIDER=openai`, `EMBEDDING_PROVIDER_REGION`,
  `EMBEDDING_API_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_API_KEY` — five keys, and
  production refuses to boot without the region among them.
- Mail: `MAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`,
  `SMTP_FROM`. Optional: `ASSIGNEE_EMAIL_COOLDOWN_MS` (how long one e-mail to a chat's
  assignee covers that chat; default 15 min).
- Sign-up and its limits: `SIGNUP_ENABLED`, `SIGNUP_EMAIL_VERIFICATION=true`, the caps in
  **Sign-up, caps and abuse limits**.
- Legal: `PRIVACY_POLICY_URL`, `TERMS_URL`, `TERMS_VERSION`.

Values go into `.env` on the host and nowhere else — not into a ticket, a log, a commit or
this document. A tunnel's credentials and token are not `.env` values either (see **Now:
Cloudflare Tunnel**).

**Where each value comes from (tm 255.16 · 257.11).** Only names here, never values:

| Key(s)                                                                                                                                                                               | Where the owner gets it                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SMTP_USERNAME`, `SMTP_PASSWORD`                                                                                                                                                     | The PrivateEmail (Namecheap) mailbox that sends the pilot's mail. The username is the mailbox's full address. The password is that mailbox's password. |
| `SMTP_FROM`                                                                                                                                                                          | That same mailbox's address, bare (`name@domain`) — not a secret.                                                                                      |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`                                                                                                                                              | PrivateEmail's published settings, already in the template (587 + STARTTLS, or 465 with `SMTP_SECURE=true`).                                           |
| `LLM_API_KEY`, `EMBEDDING_API_KEY`                                                                                                                                                   | An API key from the OpenAI platform account (ADR `docs/adr/pilot-llm-embedding-provider.md` §9). The two may hold the same key.                        |
| `LLM_MODEL`                                                                                                                                                                          | The chat model id chosen in that account. `EMBEDDING_MODEL` stays `text-embedding-3-small` (the column is `vector(1536)`).                             |
| `SIYAHTUS_REGION`, `LLM_PROVIDER_REGION`, `EMBEDDING_PROVIDER_REGION`, `*_API_BASE_URL`                                                                                              | The owner's region decision (2026-10-02): all `us`, base URL `https://us.api.openai.com/v1`.                                                           |
| `POSTGRES_PASSWORD`, `SIYAHTUS_APP_DB_PASSWORD`, `JWT_SIGNING_KEY`, `WEBHOOK_HMAC_SEED`, `CUSTOMER_TOKEN_SECRET`, `UPLOAD_SIGNING_KEY`, `AUDIT_CHAIN_SECRET`, `INBOUND_EMAIL_SECRET` | Generated on the host: `openssl rand -hex 32`, one per key.                                                                                            |
| `API_BASE_URL`, `RTM_BASE_URL`, `WEB_APP_URL`, `WIDGET_BASE_URL`, `WEB_ORIGIN`, `INBOUND_EMAIL_DOMAIN`, `TRUST_PROXY_HOPS`                                                           | The owner's domain and the edge in front of the host.                                                                                                  |
| `PILOT_CONTACT_EMAIL`                                                                                                                                                                | An address the owner reads. It is printed on screens, so it is not a secret.                                                                           |
| `PRIVACY_POLICY_URL`, `TERMS_URL`, `TERMS_VERSION`                                                                                                                                   | The owner publishes both texts (https only; they are not in this repository) and picks the version label.                                              |

### Now: Cloudflare Tunnel

The edge today. A tunnel managed **locally** on the host, run by systemd, dialling the four
ports compose publishes on `127.0.0.1`. The repository's side of it is
[`infra/pilot/cloudflared/config.example.yml`](../infra/pilot/cloudflared/config.example.yml);
`apps/api/src/config/env.pilot.test.ts` reads that file and fails if the four names stop
matching the Caddyfile's, a rule leaves `127.0.0.1` or its port, the panel's `/api/` rule falls
below the catch-all, or the 404 rule goes. The Cloudflare account, the domain's name servers
and the host are the owner's.

A tunnel created in the Cloudflare dashboard, or installed with the
`cloudflared service install <token>` line the dashboard hands out, is **remotely managed**:
its routes live in the dashboard and `cloudflared` ignores the repository's YAML. The ingress
order and the one-hop rule would then guard nothing. Create the tunnel from the host's shell.

- [ ] The domain's DNS is on Cloudflare, and four names will point at the tunnel: the panel,
      the widget, the api and RTM. They become `WEB_APP_URL` and the first `WEB_ORIGIN` entry,
      `WIDGET_BASE_URL` and the second `WEB_ORIGIN` entry, `API_BASE_URL` (`https://`) and
      `RTM_BASE_URL` (`wss://`).
- [ ] Create the tunnel: `cloudflared tunnel login`, then `cloudflared tunnel create siyahtus-pilot`.
      It prints the tunnel's id and writes `~/.cloudflared/<id>.json`.
- [ ] Move the credentials where the service reads them, owner-only:
      `sudo install -d -m 700 /etc/cloudflared`, `sudo mv ~/.cloudflared/<id>.json /etc/cloudflared/`,
      `sudo chmod 600 /etc/cloudflared/<id>.json`. Whoever holds that file, or `cert.pem`, can
      serve the pilot's names. Neither it nor a tunnel token goes into `.env` — compose hands the
      whole of `.env` to the api and rtm containers — and `env.pilot.test.ts` rejects a
      `TUNNEL`/`CLOUDFLARE` key in the template.
- [ ] `sudo cp infra/pilot/cloudflared/config.example.yml /etc/cloudflared/config.yml`, then
      edit the id (twice) and the four names. If `.env` moves a port with a
      `SIYAHTUS_*_HOST_PORT` line, change the matching rule too.
- [ ] `cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate` exits 0.
- [ ] `cloudflared tunnel --config /etc/cloudflared/config.yml ingress rule https://panel.<domain>/api/v1/health/live`
      names the rule that carries `path: ^/api/` and the api's port — not the panel's catch-all.
      That rule order is what keeps the panel's REST calls at one proxy hop.
- [ ] `cloudflared tunnel route dns siyahtus-pilot panel.<domain>`, and the same for the widget,
      api and rtm names.
- [ ] Install the unit the example file's header shows at `/etc/systemd/system/cloudflared.service`
      (it runs `cloudflared --no-autoupdate --config /etc/cloudflared/config.yml tunnel run` and
      restarts on failure), then `sudo systemctl enable --now cloudflared` and
      `systemctl is-active cloudflared` prints `active`.
- [ ] **Cloudflare dashboard, for each of the four names.** The pilot's own measurements and
      tests assume all of these:
  - Bot Fight Mode is off, and no challenge rule covers the api, rtm or widget names. The
    widget's cross-origin `fetch` from a third party's page cannot read an HTML challenge, and no
    conversation would open.
  - Rocket Loader is off (the panel's inline script is pinned by a CSP hash). Email Address
    Obfuscation and automatic Web Analytics injection are off (`script-src 'self'`).
  - A cache bypass rule covers the api and rtm names.
  - WebSockets are on.
  - Pseudo IPv4 is not set to "Overwrite Headers", and the Managed Transform "Remove visitor IP
    headers" is off.
  - HSTS comes from nginx or from Cloudflare, not both. nginx already sends it, and the smoke
    test fails two copies.
  - `LLM_TIMEOUT_MS` stays under Cloudflare's roughly 100 s origin timeout (a 524).

**Opening-day measurement.** `TRUST_PROXY_HOPS=1` is the expectation; this measurement makes it
a fact. The api reads the visitor from `X-Forwarded-For` and trusts that many entries from the
right; it never reads `CF-Connecting-IP`. A wrong count is not cosmetic: too high lets a caller
choose the address that the sign-up limit, the IP ban and the agent allow-list see, and too low
turns the per-network sign-up limit into one limit for the whole deployment. Run it from the one
machine that does the measuring, with the stack up on the tunnel. IPv4 and IPv6 are measured
separately, `curl -4` and `curl -6`, each against its own result from the first step.

- [ ] `curl -s https://panel.<domain>/cdn-cgi/trace | grep '^ip='` — the address the edge saw.
      Call it V.
- [ ] `curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Forwarded-For: 203.0.113.77' -H "X-Request-Id: edge-probe-$(date +%s)-api" https://api.<domain>/api/v1/health/live`
      prints `200`. Do the same against `https://panel.<domain>/api/v1/health/live` with an id
      ending `-panel`. Note both ids.
- [ ] `docker compose -f docker-compose.pilot.yml logs api --since 10m | grep <id>` for each id:
      the line's `"remoteAddress"` is what the api used as the client.
- [ ] Read the result. **PASS** is `remoteAddress` equal to V for both names. Otherwise:
  - `203.0.113.77` — **FAIL**, one hop too many, or the request reached the origin without
    passing the edge. Stop the opening.
  - `127.0.0.1`, `::1` or a `172.x` address — **FAIL**, a hop too few. If the api name shows it
    too, `cloudflared` appends an entry of its own: set `TRUST_PROXY_HOPS=2` in `.env`, restart
    the api (`docker compose -f docker-compose.pilot.yml up -d api`), and run the measurement
    again — with `2` the forged `203.0.113.77` must not come back. Only that `.env` line
    changes. If only the panel name shows it, its `/api/` rule sits below the catch-all: go back
    to `ingress rule` above.
  - A Cloudflare address — there is one more proxy behind the edge (orange cloud plus Caddy).
    Not supported.
  - `240.x` — Pseudo IPv4 "Overwrite Headers" is on.
  - No line — the request log is off: `LOG_LEVEL` above `info`, or `req.remoteAddress` redacted.
    The measurement is blind until that is fixed.
- [ ] `SMOKE_PROFILE=pilot API_BASE=https://api.<domain> RTM_BASE=https://rtm.<domain> WEB_BASE=https://panel.<domain> WIDGET_BASE=https://widget.<domain> ./scripts/smoke.sh`
      exits 0. Its "Edge" part checks that RTM answers the WebSocket upgrade with 101 (otherwise
      WebSockets are off or a rule breaks the upgrade) and that the panel and `loader.js` carry
      HSTS exactly once (two copies: Cloudflare's HSTS is on as well; none:
      `X-Forwarded-Proto: https` is not arriving).
- [ ] `curl -sI https://panel.<domain>/ | grep -i content-security-policy` matches nginx's
      policy. In a browser, the panel and the widget embedded in a third party's test page show
      no CSP violation in the console, and a conversation opens.

The local rehearsal of this, and what it cannot prove, is in
[`scripts/edge-rehearsal/README.md`](../scripts/edge-rehearsal/README.md). Repeat the
measurement after any change to the tunnel, the Cloudflare settings or the edge.

### After the move: Caddy

[`infra/pilot/Caddyfile.example`](../infra/pilot/Caddyfile.example) is the other edge, for when
the host is reached directly. Caddy runs on the host, gets and renews the four names'
certificates itself, and dials the same four ports on `127.0.0.1`. The records are **DNS-only**
(grey cloud). A Caddy behind the orange cloud is a second proxy in front of the api and is not
supported: one number cannot describe it (**Now: Cloudflare Tunnel**, the "Cloudflare address"
result).

- [ ] The four names point at the host's public address, DNS-only.
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
- [ ] Run the opening-day measurement from **Now: Cloudflare Tunnel** against the public names
      (skip the Cloudflare dashboard list; the `cdn-cgi/trace` step does not exist without the
      edge, so take V from `curl -4 https://ifconfig.me` and `curl -6 https://ifconfig.me` run on
      the measuring machine). It must PASS, and the smoke test must exit 0.

### Switching edges

The two edges serve the same four names on the same ports, so moving from one to the other is
stopping one service and starting the other. Compose, `.env` and the built images stay as they are.

- [ ] Cloudflare to Caddy: `sudo systemctl disable --now cloudflared`, change the four records
      to DNS-only and point them at the host, `sudo systemctl enable --now caddy`. Caddy to
      Cloudflare: the reverse, with `cloudflared tunnel route dns` for the records.
- [ ] Run the opening-day measurement again, and the smoke test. The hop count is a property of
      the edge, not of the stack; a new edge is a new measurement.
- [ ] If a name changes, `docker compose -f docker-compose.pilot.yml up --build -d`:
      `RTM_BASE_URL` and `API_BASE_URL` are baked into the web and widget bundles. Update
      `WEB_APP_URL`, `WEB_ORIGIN` and `WIDGET_BASE_URL` first, and read the OAuth-callback item
      under **Run**.
- [ ] The mail-authentication check (**Mail authentication**) again, after the name servers
      have moved.

### Region and providers

One deployment, one region: every workspace is filed in `SIYAHTUS_REGION`, the sign-up form
sends no region, and with `PILOT_MODE=true` production refuses a model or embedding provider
declared anywhere else. The owner's decision (2026-10-02) is `us`, so all three of
`SIYAHTUS_REGION`, `LLM_PROVIDER_REGION` and `EMBEDDING_PROVIDER_REGION` are `us`, and both
`*_API_BASE_URL` keys are `https://us.api.openai.com/v1`. That needs no approval from OpenAI.
Region and base URL change together, never one alone; the global `api.openai.com` is refused.

- [ ] The OpenAI account accepts the standard data-processing agreement, and the project the key
      belongs to has a budget limit. That limit is the provider-side ceiling and sits on top of
      the application's own daily caps, not instead of them.
- [ ] `LLM_MODEL` is a chat model that answers without a reasoning phase. A reasoning model
      counts its hidden reasoning against `max_completion_tokens`, which the api sets from
      `LLM_MAX_OUTPUT_TOKENS` (default 400). It can use all of it on reasoning and return no
      text, and every customer question then goes to a human. The api logs this as a `warn` line
      with `event` `llm.failed`, `kind` `no_answer`, `reason` `length` and a `hint` field that
      names both fixes. If the account only offers reasoning models, raise
      `LLM_MAX_OUTPUT_TOKENS` (at most 16384) until the `hint` lines stop, and note that the
      output is billed at the higher count.
- [ ] `EMBEDDING_MODEL` stays `text-embedding-3-small`: the column is `vector(1536)`, and
      `EMBEDDING_DIMENSIONS` is an assertion, not a setting.

### Mail authentication (SPF, DKIM, DMARC) — a gate before sign-up opens

Sign-up verification sends its link from `SMTP_FROM`. If mail from that domain is not
authenticated, the major mailboxes put it in spam or refuse it, nobody can verify, and sign-up
is closed in practice while the form looks open. Nothing in this repository sets these records
(`docs/adr/smtp-transport.md` leaves them out of the code); they are DNS records at the
domain's DNS host — Cloudflare, once the name servers moved there — and settings in the mail
provider's panel.

- [ ] One SPF record at the `SMTP_FROM` domain: a single TXT value that starts with `v=spf1`
      and includes the mail provider's sending servers (copy the include from the provider's own
      page). Two `v=spf1` records are an SPF failure, not two chances.
      `dig +short TXT <SMTP_FROM domain>` shows exactly one.
- [ ] DKIM: switch it on in the mail provider's panel and publish the selector record it
      gives (a TXT, or a CNAME, at `<selector>._domainkey.<domain>`). `dig +short TXT <selector>._domainkey.<domain>`
      (or `CNAME`) returns it.
- [ ] DMARC: a TXT at `_dmarc.<domain>`, starting at `v=DMARC1; p=none; rua=mailto:<an address you read>`.
      `dig +short TXT _dmarc.<domain>` shows it. Tighten to `p=quarantine` only after a few weeks
      of aggregate reports show the legitimate mail passing, and never before.
- [ ] Send a real password-reset mail to a mailbox you control (Gmail: the message's "Show
      original"). `SPF`, `DKIM` and `DMARC` all say `PASS`, and the message is in the inbox, not
      in spam. A message that reaches a second provider's inbox too is better evidence than one.
- [ ] **Cloudflare trap.** Moving the domain's name servers to Cloudflare replaces the whole zone:
      the MX, SPF, DKIM and DMARC records must exist in Cloudflare's zone afterwards, DNS-only
      (mail records are never proxied). Repeat the four checks above after the edge change, not
      only before it.

### Sign-up, caps and abuse limits

Sign-up stays open: that is what a public pilot is. What keeps it from being a gift of the
owner's model key and mailbox is the set below. Every key lives in `.env` and takes effect at
the api's next start (`docker compose -f docker-compose.pilot.yml up -d`).

- [ ] **`SIGNUP_ENABLED=false` is the emergency brake.** Set it, then `up -d`: sign-up answers
      403 (`not_allowed`, `details.reason: signup_closed`), nothing is written, invitations keep
      working, and the panel's form says sign-up is closed. Only `true` and `false` are read — any
      other value, an empty one included, stops the api at boot with `SIGNUP_ENABLED` named in
      the log. Check it from outside:
      `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' <API_BASE_URL>/api/v1/auth/signup`
      prints `403` while it is closed. To add one workspace by hand while closed, open sign-up for
      that one and close it again.
- [ ] `SIGNUP_EMAIL_VERIFICATION=true` (`PILOT_MODE=true` makes production require it, and it needs
      `MAIL_PROVIDER=smtp`). A new owner proves the address with the mailed link and a password
      before the first sign-in; a taken address gets the same 202 and a different mail, so sign-up
      is not an address oracle.
- [ ] Unverified sign-ups are swept. A scheduled job deletes an account nobody verified, with
      the empty workspace it signed up with, once `UNVERIFIED_SIGNUP_TTL_HOURS` has passed and
      its latest link has lapsed. It keeps anything with a chat, a ticket, a second member or
      an open invitation. It runs only while verification is on: the admin `/health` shows
      `unverified_signups` with `enabled: true`, and each deletion logs `signup.unverified_purged`
      with a count only.

The keys, with the code's defaults. The owner's value column is what to set before opening; a
value left at its default is a decision too, and the defaults are deliberately cautious.

| Key                                       | What it does                                                                       | Default   | Owner's value                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | --------- | ---------------------------------------------------- |
| `SIGNUP_VERIFICATION_TTL_HOURS`           | How long a verification link works (1–168)                                         | 24        | Default                                              |
| `UNVERIFIED_SIGNUP_TTL_HOURS`             | How long an unverified, still-empty sign-up is kept (1–8760)                       | 72        | Default                                              |
| `SCHEDULE_UNVERIFIED_SIGNUPS_MS`          | How often the sweep runs                                                           | 3600000   | Default                                              |
| `RATE_LIMIT_SIGNUP_PER_HOUR`              | Sign-ups per IPv4 address, or per IPv6 `/64`, per hour                             | 10        | Default; a shared office or school may need more     |
| `RATE_LIMIT_PUBLIC_CONFIG_PER_MIN`        | `GET /deployment` (the panel reads it on every load), per IP                       | 600       | Default                                              |
| `RATE_LIMIT_TOKEN_PER_MIN`                | `POST /auth/token` (sign-in's code exchange, every refresh), per IP                | 300       | Default; more only for 100+ agents on one address    |
| `MAIL_DAILY_PER_WORKSPACE`                | Everything one workspace sends, per UTC day                                        | 200       | Default                                              |
| `MAIL_DAILY_EXTERNAL_PER_WORKSPACE`       | Mail one workspace sends outside itself (invitations, ticket notices, transcripts) | 50        | Default                                              |
| `MAIL_DAILY_GLOBAL`                       | Everything the deployment sends, per UTC day                                       | 400       | **At most the mail provider's own daily limit**      |
| `MAIL_SECURITY_RESERVE`                   | Top of the global cap kept for account mail; must be below `MAIL_DAILY_GLOBAL`     | 50        | Default                                              |
| `AI_DAILY_LLM_TOKENS_PER_WORKSPACE`       | LLM tokens (input + output) one workspace may use per UTC day                      | 200000    | Raise after reading a day's usage                    |
| `AI_DAILY_LLM_TOKENS_GLOBAL`              | The same for the whole deployment                                                  | 2000000   | Below what the provider budget limit allows in a day |
| `AI_DAILY_EMBEDDING_TOKENS_PER_WORKSPACE` | Embedding tokens one workspace may use per UTC day                                 | 2000000   | Default                                              |
| `AI_DAILY_EMBEDDING_TOKENS_GLOBAL`        | The same for the whole deployment                                                  | 20000000  | Default                                              |
| `TRIAL_DAYS`                              | Trial length of workspaces that sign up from now on                                | 14        | Default                                              |
| `RTM_MAX_CONNECTIONS`                     | WebSocket connections one rtm process holds before it refuses upgrades with a 503  | unlimited | See below                                            |

- [ ] `MAIL_DAILY_GLOBAL` is set under the mail account's own daily sending limit, which is in the
      provider's terms and is the owner's to read. A provider that suspends the mailbox stops every
      password reset and verification too. Mail over a cap is not sent until UTC midnight: an
      invitation reports `cap_reached` and the copy-link path still works, courtesy mail leaves one
      `warn` line, and a password reset or verification answers the same 202 as always. Account
      mail is also held to five per address per day, which is accepted: it means five resets of
      one address use up that day's reset.
- [ ] At an AI cap a visitor's message waits for a human, and Copilot and the preview answer 429
      `ai_daily_cap` until UTC midnight (the answer names the meter that ran out). Counts live in
      Postgres. The owner's queries, through
      `docker compose -f docker-compose.pilot.yml exec db psql -U siyahtus -d siyahtus -c "<query>"`:
      `SELECT day, license_id, meter, reserved, used FROM ai_daily_usage ORDER BY day DESC, meter, used DESC`
      and `SELECT day, license_id, meter, sent FROM mail_daily_usage WHERE meter <> 'recipient' ORDER BY day DESC, sent DESC`.
      Read both after the first day and after the first week, then set the global caps.
- [ ] `RTM_MAX_CONNECTIONS` is set to what one rtm process actually holds on this host. Unset it is
      unlimited, which is the gateway's old behaviour and not a decision. The repository measured at
      least 8000 sockets on one laptop core, with the fan-out budget holding to about 6000
      recipients per broadcast (PLAN §D127) — that machine's numbers, not a constant. Above the
      ceiling an upgrade is refused with 503 `connection_limit_reached`. The template carries a
      commented suggestion line.
- [ ] `docker compose -f docker-compose.pilot.yml exec db psql -U siyahtus -d siyahtus -c "SELECT count(*) FROM accounts WHERE email_verified_at IS NULL"`
      is a number to look at once a day in the first week: a count that only grows means the
      verification mail is not arriving (**Mail authentication**), or a script is signing up.

### Legal links

Public sign-up needs two documents the owner writes and hosts: a privacy policy and terms of
service. Their texts are not in this repository; only the three keys are.

- [ ] `PRIVACY_POLICY_URL` and `TERMS_URL` are `https://` addresses that load, and `TERMS_VERSION`
      is a label without whitespace (a date such as `2026-10-01` works). Production refuses to boot
      while `PILOT_MODE=true` without all three. The sign-in, sign-up and invitation pages link to
      both documents, and the widget's footer links to the privacy policy.
- [ ] Sign-up records the accepted version on the workspace. When the terms change, publish the
      new text, raise `TERMS_VERSION`, and `up -d`: a sign-up form loaded before the change is
      refused as `terms_outdated` and reloads. Workspaces that already accepted an older version
      are not asked again. The record is
      `SELECT id, terms_version, terms_accepted_at FROM licenses ORDER BY id DESC`.

### Measuring `RETRIEVAL_THRESHOLD` (`measure:knowledge-recall`)

The retrieval threshold was chosen in the stub's embedding space (tm 255.8, PLAN §D183 (5)); in
OpenAI's space it has to be measured once. The measurement **cannot run on the pilot host or in
the pilot's images**, and must never be pointed at the pilot's stores:

- `tsx` is a development dependency, and the images install production dependencies only.
- The golden set's file is not in the image.
- It loads the repository's root `.env` only, and a value exported by the shell wins over it.
- The pilot's database publishes no host port.
- The harness creates and drops a scratch database on the server it is pointed at and writes to
  Redis database 0. Against the pilot's data stores it would do that to live data.

It runs in the owner's development checkout, on the same commit as the pilot, against throwaway
development stores.

- [ ] `git checkout <the pilot's commit>`, `pnpm install --frozen-lockfile`,
      `docker compose up -d db redis`, and a root `.env` copied from `.env.example` if the
      checkout has none (it supplies the development `DATABASE_URL` and `REDIS_URL`). Never start
      the development compose file on the pilot host: it publishes 5433 and 6380 on every
      interface with a known development password.
- [ ] A file **outside the repository**, mode 600, LF line endings, holding only these names:
      `EMBEDDING_PROVIDER`, `EMBEDDING_PROVIDER_REGION`, `EMBEDDING_API_BASE_URL`,
      `EMBEDDING_MODEL`, `EMBEDDING_API_KEY` and, if the pilot sets one, `RETRIEVAL_THRESHOLD`.
      A `RETRIEVAL_THRESHOLD=` left empty stops the boot: delete the line instead.
- [ ] `( set -a; . <that file>; set +a; pnpm --filter @siyahtus/api measure:knowledge-recall > recall-report.json ); echo "exit $?"`
      prints `exit 0` for PASS, `exit 1` for FAIL, `exit 2` for SKIPPED. Exit 2 means nothing was
      measured and is not a pass; so is a past PASS from another model. The JSON carries a sweep
      that marks the configured threshold and names the key.
- [ ] If the sweep points at a different value, put `RETRIEVAL_THRESHOLD=<value>` (a number in
      `[-1, 1]`) in the pilot's `.env`, run
      `docker compose -f docker-compose.pilot.yml up -d api` — no rebuild — and measure again at
      that value for a PASS.
- [ ] `shred -u <that file>`. It held the embedding key.

`knowledge:reembed` also needs `tsx`: it is not something this host runs. A database that stored
knowledge under the stub first is re-embedded from a development checkout, against that database,
or the knowledge is added again; a pilot database that starts on `openai` has nothing to
re-embed.

### Run

- [ ] `docker compose -f docker-compose.pilot.yml config --quiet` exits 0. A missing
      Compose variable fails here, by name, before any container exists.
- [ ] `docker compose -f docker-compose.pilot.yml up --build -d` (or `make pilot`, which also
      runs the smoke test). The api migrates on its own start (one replica — CONVENTIONS §6.1);
      rtm and web wait for a healthy api. A configuration production refuses stops the api
      with one `Invalid environment for NODE_ENV=production` block listing every problem, by key
      name: `docker compose -f docker-compose.pilot.yml logs api`.
- [ ] `docker compose -f docker-compose.pilot.yml ps` shows `db`, `redis`, `api`, `rtm`,
      `web` and `widget` all `healthy`.
- [ ] `SMOKE_PROFILE=pilot ./scripts/smoke.sh` exits 0 (`make pilot-smoke`). Beyond health
      and wiring it checks the part production adds: a CORS preflight from `WIDGET_BASE_URL`'s
      origin and from the panel's is answered, one from an unlisted origin is not. Point it at
      the public side with `API_BASE=… RTM_BASE=… WEB_BASE=… WIDGET_BASE=…` once the edge is
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
- [ ] Open sign-up (`SIGNUP_ENABLED=true`, then `up -d`) once the opening gates have passed, and
      create the owner's own workspace first, through the panel (there is no seed): the verification
      mail arrives, the link and a password open it, and the first sign-in works. Then run the smoke
      test once more with `SMOKE_ORGANIZATION_ID=<its id>` and
      `SMOKE_ADMIN_TOKEN=<the owner's access token>`: it mints a visitor token from the widget
      origin, cross-origin, and reads the admin `/health` — scheduler enabled and
      `event_partitions.last_status: ok` (tm 255.14). `scripts/pilot-owner-token.mjs` prints both
      (the token, or the id with `--organization-id`) from `PILOT_OWNER_EMAIL` /
      `PILOT_OWNER_PASSWORD` in the environment and `--api=` / `--web=` set to the public
      addresses; it writes nothing to disk. The pilot profile also requires pilot mode
      (tm 257.12): `/deployment` says `pilot_mode: true` and every closed surface answers 403
      `pilot_mode` — a pilot whose api runs with the flag off fails the smoke test. A clean run
      over the https names counts 45 passed with both inputs (27 without); the header of
      `scripts/smoke.sh` has the other totals.

### Trial end and manual activation

Every workspace starts a trial of `TRIAL_DAYS` days (default 14, read at sign-up) and turns
read-only when it ends: agents cannot answer and visitors cannot write. The pilot takes no real
payments, so the billing surfaces are hidden and the trial-end notice, shown to every role,
carries `PILOT_CONTACT_EMAIL` instead of a "subscribe" button; the same address is what the notes
on closed features show. A workspace's way back is the owner.

- [ ] Activate a workspace by hand, as the database owner role:
      `docker compose -f docker-compose.pilot.yml exec db psql -U siyahtus -d siyahtus -c "UPDATE licenses SET status = 'active', trial_ends_at = NULL WHERE organization_id = (SELECT id FROM organizations WHERE name = '<workspace name>') AND status IN ('trialing', 'read_only')"`.
      It prints `UPDATE 1`; two workspaces with the same name make it fail instead of
      guessing — use the organization id then.
- [ ] Know what this path does not do: it writes no audit entry (the audit chain is signed inside
      the api) and it does not lift `past_due`. Record who was activated, when and why somewhere
      of your own. Or set `TRIAL_DAYS` in `.env` long enough that no trial ends inside the pilot,
      before the workspaces sign up.

### Data and backups

- [ ] The database lives on the named volume `siyahtus-pilot_siyahtus_pilot_pgdata`: it survives
      `down`, `up --build` and a reboot of the machine **once the Docker daemon is up again** (see
      **The host**). `down -v` deletes it — never run it on this project (there is deliberately no
      `make` target for it).
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
      conversation). Take the first backup on opening day, before sign-up opens.
- [ ] Backups run every day without anyone remembering to (tm 256.5), and nobody else can read
      them: the dump holds every workspace's personal data, and a cron job's default umask makes
      it world-readable. A line in `/etc/cron.d/siyahtus-backup`, with the repository at
      `/opt/siyahtus`:
      `15 3 * * * root umask 077; cd /opt/siyahtus && COMPOSE_FILE=docker-compose.pilot.yml ./scripts/backup.sh >>/var/log/siyahtus-backup.log 2>&1`.
      The script deletes its own archives older than `BACKUP_RETENTION_DAYS` (default 30,
      NFR-C8). Read the log after the first night: it ends in `Done.` and a size, and
      `ls -l /opt/siyahtus/backups` shows no file readable by anyone but root.
- [ ] A copy leaves the host. A backup on the same disk as the database is lost with it, and the
      home server is one machine. The archives hold every workspace's personal data, so the copy is
      encrypted and the place it goes is the owner's. Any one of these, after the backup line:
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
- [ ] Dumps stay out of the Docker build context. `.dockerignore` excludes `backups/` and the
      env, key and tunnel-credential patterns (tm 257.10), but earlier builds on a host that kept
      dumps in the repository directory left them in cached build layers: run
      `docker builder prune` once on the existing host. Then check the context itself:
      `docker build --no-cache -f - . <<'EOF'` with the three lines `FROM busybox`, `COPY . /ctx`
      and `RUN test ! -e /ctx/backups && test ! -e /ctx/.env` (it fails if either is in the
      context). The README's Backups section says the same.
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

### The host

The pilot runs on a home Ubuntu machine. Every service in the compose file has
`restart: unless-stopped`, which only helps once the Docker daemon is running, and
`make pilot-down` (`down`) removes the containers, so nothing comes back after it until the next
`up`. The machine has to come back from a power cut, a reboot and a quiet night on its own.

- [ ] Docker Engine from the distribution's `docker-ce` packages, not Docker Desktop, starts at
      boot: `sudo systemctl enable --now docker.service containerd.service`, and
      `systemctl is-enabled docker.service` prints `enabled`. Cron runs the backup line:
      `systemctl is-enabled cron` prints `enabled`.
- [ ] The machine never suspends: `sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target`.
      On a laptop also set `HandleLidSwitch=ignore` and `HandleLidSwitchExternalPower=ignore` in
      `/etc/systemd/logind.conf`, then `sudo systemctl restart systemd-logind` (it can end the
      current login session; do it from the console or expect an SSH drop).
- [ ] Optional: the BIOS or firmware setting "power on after AC loss", so a power cut does not
      leave the host off until someone presses the button.
- [ ] The reboot test, before opening: `sudo reboot`, then, over SSH without any desktop login,
      `docker compose -f docker-compose.pilot.yml ps` shows all six services `healthy`,
      `systemctl is-active cloudflared` (or `caddy`) prints `active`, and the external uptime
      check is green again.
- [ ] Every maintenance step ends with `docker compose -f docker-compose.pilot.yml up -d`. A
      `down` that is not followed by `up -d` is an outage.
- [ ] The host has enough RAM that the six containers do not swap (see **Known risks**).

### Known risks

Open, not fixed by this checklist (tm 255.16, re-checked at the tm 256 closing gate on
2026-10-01 and at tm 257.11 on 2026-10-03):

- A stranger can use up a workspace's daily AI cap. A visitor's message triggers the AI Agent, so
  anyone who can open a workspace's chat can spend that workspace's day of tokens, and that
  workspace's AI is then off until UTC midnight: messages wait for a human. The caps bound the
  provider's bill, not the nuisance.
- The widget's token and sign-up endpoints have no CAPTCHA (no Turnstile; ADR
  `docs/adr/pilot-public-readiness.md` K-e(5)). Limits are per network, so a script spread over many
  networks is slowed, not stopped. Three accepted consequences: one address can be sent only five
  account mails a day (so five resets use up the day's), customers can fill a workspace's external
  mail allowance, and a wrong `TRUST_PROXY_HOPS` turns the per-network sign-up limit into one
  limit for everybody.
- RTM's `/health` has no rate ceiling (PLAN §D137), and the tunnel makes it reachable from the
  internet.
- `RTM_MAX_CONNECTIONS` unset means no connection ceiling. Set it (**Sign-up, caps and abuse
  limits**).
- Manual activation writes no audit entry and does not lift `past_due`.
- The MCP `summarize_chat` tool answers from the `ai-mock` summarizer, not from the model the
  panel's summary button uses, so its text differs from the panel's. MCP itself is outside the
  pilot.
- There is no persisted AI queue (PLAN §D201). The AI Agent's and the rule bot's answers are
  written after the visitor's send returns and are not persisted. They run in the api process,
  one message at a time per chat, followed by the assignee's notice; the widget receives the
  answer over its socket or its next poll. A graceful stop waits for answers already on their
  way, inside the same 15 s close ceiling a held request had; a crash, or a model call the
  ceiling cuts off, loses that answer and the message stays unanswered in the inbox for a
  human — the same outcome as a model error. A chat 20 messages behind leaves the next one for
  a human and logs `warn` `visitor follow-ups backed up; leaving this message for a human`.
  The per-chat order holds within one api process, which is what the pilot runs.
- Courtesy mail is sent after the answer, and is not persisted. The assignee's new-message
  notice, the chat transcript on close and the customer's ticket-status notice go through
  `app.backgroundMail`, like the password reset: the request answers at once, and a mail that
  did not go out leaves one `warn` line with `event` `assignee_notification.mail`,
  `chat.transcript_mail` or `ticket.notice_mail` and the carrier's classification, never the
  address. A mail in flight when the api stops is lost: a graceful stop waits for it, a crash
  does not. The assignee's e-mail is also held to one per chat and assignee per
  `ASSIGNEE_EMAIL_COOLDOWN_MS` (default 15 min, `0` mails every message). Handset push is not
  held. In the pilot a ticket notice ends with a line that this mailbox does not read replies.
- One home server is one point of failure. The database, the tunnel and the backup line all live
  on it; the off-host copy of the backup is what makes a lost machine survivable, and the external
  uptime check is the only thing that notices it is down.
- Memory pressure stalls requests without failing them. On the development machine a host
  paging under load froze Vite for 10 s and the api for 7.6 s at almost no CPU (tm 256.8,
  PLAN §D200), and nothing in the stack reports it. Give the pilot host enough RAM that the
  six containers do not swap, and watch the host's own memory and paging, not only the probe.
- Outgoing webhooks connect directly to the address their SSRF check approved (tm 256.9) and
  ignore `HTTP_PROXY`/`HTTPS_PROXY`: a proxy that resolved the name itself would undo the pin.
  The pilot host needs direct egress for webhooks; behind a mandatory egress proxy they fail
  with a logged network error.
- A sign-up deleted by the unverified-sign-up sweep can leave one orphaned row (a customer the
  widget created at that very moment), and a resend or reset request arriving in that instant can
  get a 500. Neither affects another workspace.
- The invitation flow can be used to open an account with someone else's address: the inviter
  receives the accept link in the response and can set a password for the invited address
  (found at tm 257.7, ADR K-e(1) note; present before the verification flag).
- `pnpm audit --prod` on 2026-10-01 reported 27 advisories (7 moderate, 20 high). Every path
  starts at `apps/mobile` (the Expo tool chain); none reaches the api, rtm, web or widget
  images, and mobile is outside the pilot. New advisories arrive weekly (51 became 59 within
  tm 256.2), so run it again before go-live and read the paths, not the count.
- The e2e suite is order-dependent (independent audit finding G9-GATE-a): full runs have
  failed on different single tests that each pass alone. That is test fixture state, not
  product code. At the tm 256 closing gate one full run failed an axe scan that measured the
  composer's tabs halfway through their 150 ms colour transition; the scan now finishes CSS
  transitions before it reads colours.
- Outside the pilot by the owner's decisions (2026-09-22 and 2026-10-02): payments/Stripe,
  messaging channels, mobile push, S3 + virus scanning + SIEM + load testing, the MCP protocol,
  social sign-in, uploads, OpenTelemetry collection, and Kubernetes (the Helm chart is kept, not
  used).

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
