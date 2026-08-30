# Runbook: webhook delivery backlog

## Symptom

- `webhook_deliveries` (see `apps/api/prisma/schema.prisma`'s `WebhookDelivery`
  model) has a growing number of `state = 'pending'` rows.
- A specific integration stops receiving events, or receives them very late.

## Diagnosis

All queries via `make psql` (dev stack) or the demo stack's `db` container.

1. How big is the backlog, and how is it distributed across states:

   ```sql
   SELECT state, count(*) FROM webhook_deliveries GROUP BY state ORDER BY 2 DESC;
   ```

2. Which webhooks are actually backed up (an evenly-spread backlog across many
   webhooks points at the scheduler itself; concentration on one `webhook_id`
   points at one endpoint being down):

   ```sql
   SELECT webhook_id, count(*) AS pending, min(next_attempt_at) AS oldest_due
   FROM webhook_deliveries
   WHERE state = 'pending'
   GROUP BY webhook_id
   ORDER BY pending DESC
   LIMIT 20;
   ```

3. Attempt distribution — a pile-up at low `attempt` numbers means the sweep
   isn't running; a pile-up near `WEBHOOK_MAX_ATTEMPTS` (default 8) means
   deliveries are genuinely failing and about to be given up on:

   ```sql
   SELECT attempt, count(*) FROM webhook_deliveries
   WHERE state = 'pending' GROUP BY attempt ORDER BY 1;
   ```

4. Is the `webhook_redelivery` job actually ticking? With an admin bearer
   token:

   ```bash
   curl -s -H "Authorization: Bearer $ADMIN_TOKEN" http://127.0.0.1:4000/api/v1/health \
     | jq '.scheduler.jobs[] | select(.name == "webhook_redelivery")'
   ```

   Fields are `interval_ms`, `enabled`, `last_run_at`, `last_status`, and
   `last_error_class` if the last pass errored (`apps/api/src/services/scheduler/scheduler.ts`).

5. Deliveries that have already given up write a `webhook.delivery_exhausted`
   audit entry (README "Background jobs") — this is how to find integrations
   that silently stopped receiving, not just ones currently retrying:

   ```sql
   SELECT license_id, action, count(*)
   FROM audit_log
   WHERE action = 'webhook.delivery_exhausted' AND created_at > now() - interval '1 day'
   GROUP BY license_id, action
   ORDER BY 3 DESC;
   ```

## Response

- **There is no CLI to force-run this sweep** — unlike the other five
  background jobs, `webhook_redelivery` has no `pnpm --filter @nexa/api
<job>:run` script, deliberately: a hand-run pass would race the scheduled
  one for the same rows (README "Background jobs"). Do not write one for this
  incident; let the scheduled pass carry the backlog.
- If diagnosis step 4 shows the job not ticking (`SCHEDULER_ENABLED=false`, or
  `last_status` consistently an error), that's the actual incident — fix the
  scheduler/environment issue, not the queue. The 60s default interval and
  `SCHEDULE_WEBHOOK_REDELIVERY_MS` override are in `.env.example`.
- If the backlog is concentrated on one `webhook_id` (step 2) and that
  endpoint is confirmed down on the customer's side, the fastest mitigation is
  disabling that one webhook subscription rather than waiting for
  `WEBHOOK_MAX_ATTEMPTS` (default 8, backoff 4/8/16/… minutes, ~4 hours total)
  to exhaust it — it stops burning delivery attempts against a target that
  will keep failing.
- The backoff schedule and attempt ceiling are configuration
  (`WEBHOOK_MAX_ATTEMPTS`, and the backoff base is fixed in code, not env) —
  raising the attempt ceiling only makes sense if the receiving side is
  expected to recover within the extended window, not as a generic fix for a
  growing backlog.

## After

- Re-run the state-count query (step 1) a few minutes apart to confirm the
  `pending` count is trending down, not just present.
- Review the `webhook.delivery_exhausted` entries from step 5 — each one is an
  integration that stopped receiving and needs a follow-up with its owner;
  the sweep itself will not retry past `WEBHOOK_MAX_ATTEMPTS`.
- If the root cause was the scheduler not running, confirm `scheduler.jobs[]`
  for `webhook_redelivery` shows a recent `last_run_at` with `last_status: "ok"`
  before closing the incident.
