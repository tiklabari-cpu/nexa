# Runbook: Postgres is down

## Symptom

- `GET /health/ready` on `apps/api` and/or `apps/rtm` answers `503`.
- `apps/api` requests that touch the database start returning `5xx`.
- An orchestrator (or `docker compose`) stops routing traffic to the affected
  pod/container — this is the readiness probe doing its job, not a second
  incident.

## Diagnosis

1. Confirm it's the database, not the process — liveness stays `200` while
   readiness goes `503` (`apps/api/src/routes/health.ts`):

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/api/v1/health/live   # expect 200
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/api/v1/health/ready  # 503 = a dependency is down
   ```

   (`apps/api`'s routes live under `/api/v1` — `apps/rtm`'s health routes do
   not, see `infra/helm/nexa/values.yaml`'s per-app `probes.liveness`/`.readiness`.)

   As an admin bearer token, `GET /api/v1/health` names which dependency and its
   latency/error class (`dependencies.database.status`/`.error`) — the driver
   message itself is never surfaced, only the error class, so this narrows the
   cause without leaking a connection string.

2. Check the container (dev stack `docker-compose.yml`, or the demo stack
   `docker-compose.full.yml` — service name is `db` in both):

   ```bash
   docker compose ps db
   docker compose logs --tail=100 db
   # demo stack:
   docker compose -f docker-compose.full.yml ps db
   docker compose -f docker-compose.full.yml logs --tail=100 db
   ```

3. If the container is up but the process still reports the database down,
   check the connection budget — `docker-compose.yml` runs Postgres with
   `max_connections=200`; a pool sized without `DATABASE_POOL_SIZE` scales
   with pod count and can exhaust that ceiling under a multi-pod rollout (see
   README ["Connection pool budget"](../../README.md#connection-pool-budget)).

4. If a migration was in flight when Postgres went down, `prisma migrate
deploy` may be stuck on `pg_advisory_lock(72707369)` (10s timeout, then
   `P1002`) or may have left a half-applied migration (`_prisma_migrations`
   row with `finished_at IS NULL`, rejected on the next attempt with `P3009`)
   — see CONVENTIONS.md §6.2. Check the migration Job/entrypoint logs
   specifically, not just the API's.

## Response

- Nothing to do for traffic routing — readiness already pulled the
  instance(s) out of rotation the moment the probe first failed. There is no
  "re-enable" step: once Postgres answers again, the next readiness probe
  passes and traffic resumes on its own.
- If the container itself is the problem (crashed, out of disk, corrupted
  data directory), restart/repair it:

  ```bash
  docker compose restart db          # dev stack
  docker compose -f docker-compose.full.yml restart db   # demo stack
  ```

- If step 4 found a stuck migration lock past its 10s timeout, the migration
  attempt already exited `P1002` — safe to retry once Postgres is reachable
  again (`pnpm db:migrate` / the Helm hook Job's next run). If it instead left
  a `P3009` half-applied row, follow CONVENTIONS.md §6.2's manual recovery:
  `prisma migrate resolve --rolled-back <name>` or `--applied`, whichever
  matches what's actually in the schema — do not guess.

## After

- Confirm `/health/ready` is `200` on every instance, not just one:

  ```bash
  curl -s http://127.0.0.1:4000/api/v1/health/ready
  ```

- Run the drift check — an interrupted migration is exactly what this catches:

  ```bash
  pnpm -w db:check-drift
  ```

- Record how long readiness was `503` and whether any migration needed manual
  `migrate resolve` — that detail is what the next capacity/backup review
  needs (see `docs/production-checklist.md` §6 Backup, §5 Deployment).
