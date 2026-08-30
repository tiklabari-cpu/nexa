# Runbook: suspected cross-tenant data exposure

## Symptom

- A customer or agent reports seeing data (a chat, a ticket, a report row)
  that does not belong to their organization.
- Any observation that looks like row-level security (RLS) is not scoping a
  query the way it should.

Treat this as a security incident from the first report, not a "let's
confirm it's real first" investigation — the diagnosis below is read-only and
safe to run immediately.

## Diagnosis

All queries run via `make psql` (dev stack) or the demo stack's `db`
container — connect as the **owner** role (`nexa`) only to read catalogs; the
behavioral checks below deliberately connect as the **runtime** role
(`nexa_app`) instead, because RLS does not apply to table owners or
superusers and a check run as the owner would tell you nothing
(`README.md` "`DATABASE_URL` vs `DATABASE_APP_URL`").

1. **Which role is the runtime actually connecting as.** This is the single
   most common way this class of bug happens — `DATABASE_APP_URL` pointed at
   the owner role silently disables RLS with no error, no failing test, no
   visible difference except that every tenant's rows are now readable
   (README, same section). Check the deployed config directly: confirm
   `DATABASE_APP_URL` is set and is **not** equal to `DATABASE_URL`, and that
   its user is `nexa_app`.

2. **RLS surface — every table, every policy, verbatim.** (Same query
   `scripts/restore-drill.sh`'s `rls_surface()` uses to compare a restore
   against the live database — proven runnable.)

   ```sql
   SELECT c.relname, c.relrowsecurity, p.policyname, p.cmd,
          p.roles, p.qual, p.with_check
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
   LEFT JOIN pg_policies p ON p.schemaname = 'public' AND p.tablename = c.relname
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     AND (c.relrowsecurity OR p.policyname IS NOT NULL)
   ORDER BY 1;
   ```

   Every tenant-scoped table should show `relrowsecurity = t` with a policy
   whose `qual`/`with_check` references `nexa_current_license` (or the
   region/organization equivalent). A table with rows but no matching line
   here is the gap.

3. **`events` partitions specifically** — Postgres does not inherit RLS from
   the parent to a partition automatically; a partition queried by name
   bypasses the parent's policy (this was a real, fixed gap — tm 150,
   `#### KS4-PART` in `PLAN.md`). Confirm every partition still carries its
   own policy, not just the parent table (from `pg_inherits`, not a name
   pattern — a partition created outside the normal path would slip past a
   pattern match):

   ```sql
   SELECT child.relname, child.relrowsecurity,
          (SELECT count(*) FROM pg_policies pp
           WHERE pp.schemaname = 'public' AND pp.tablename = child.relname)
   FROM pg_inherits i
   JOIN pg_class child ON child.oid = i.inhrelid
   JOIN pg_class parent ON parent.oid = i.inhparent
   JOIN pg_namespace pn ON pn.oid = parent.relnamespace
   WHERE parent.relname = 'events' AND pn.nspname = 'public'
   ORDER BY 1;
   ```

4. **Behavioral check, as the runtime role, with no tenant context set** — the
   most direct proof of whether the gap is real. This should return `0` for
   every tenant-scoped table; the pattern is `scripts/restore-drill.sh`'s
   `psql_app()`:

   ```bash
   docker compose exec -T -e PGPASSWORD=nexa_app_dev_password db \
     psql -U nexa_app -h 127.0.0.1 -d nexa -v ON_ERROR_STOP=1 -qtAX \
     -c "SELECT count(*) FROM chats UNION ALL SELECT count(*) FROM events UNION ALL SELECT count(*) FROM audit_log"
   ```

   Any non-zero result here, with no `app.current_license`/`app.current_organization`
   set, is a confirmed cross-tenant read path — stop and move to Response.

5. **What actually happened, for the account(s) involved** — the tamper-evident
   audit trail (NFR-C6). With an admin bearer token holding `audit_log--all:ro`:

   ```bash
   curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
     "http://127.0.0.1:4000/api/v1/audit-log?actor_id=$SUSPECT_ACTOR_ID&date_from=$FROM&date_to=$TO"
   ```

   To pull the full trail for offline analysis and verify the hash chain
   itself hasn't been tampered with (`audit_log--export:ro`), check the
   response header — `true` means every exported row's chain verified:

   ```bash
   curl -sD - -H "Authorization: Bearer $ADMIN_TOKEN" \
     "http://127.0.0.1:4000/api/v1/audit-log/export" -o export.ndjson \
     | grep -i x-nexa-export-chain-ok
   ```

## Response

- **Cut access first, investigate second.** Revoke/rotate the specific
  session or PAT involved (token-service revocation) and, if the exposure
  path is a specific route rather than a specific credential, be prepared to
  take that route out of service rather than leave a confirmed gap open while
  gathering more evidence.
- **Do not repair and move on without confirming scope.** If diagnosis step 2
  or 3 finds a table/partition genuinely missing RLS, determine how long it's
  been that way (migration history, `git log` on the relevant migration) —
  the exposure window matters as much as the gap itself.
- **Preserve evidence before changing anything queryable.** The audit export
  (step 5) and the `rls_surface`/partition query output (steps 2-3) are the
  incident record — capture them before applying a fix, since a fix can
  change what the catalogs show.
- If the gap is a missing policy on a table, the fix pattern is the same one
  tm 150 used for `events` partitions: a migration that adds the same
  `USING`/`WITH CHECK` policy the sibling tables carry (`qual` referencing
  `nexa_current_license`), not a `REVOKE` — `ALTER DEFAULT PRIVILEGES` in
  `20260722090000_init_extensions` regrants DML to every new table, so a
  revoke only closes the gap until the next table/partition is created; a
  policy closes it permanently. See `PLAN.md` `#### KS4-PART` and the
  `20260826090000_events_partition_rls` migration for the worked precedent.

## After

- Re-run diagnosis steps 2-4 after any fix to confirm `0` reads with no
  tenant context and the correct rows with one — do not close the incident on
  "the migration ran," close it on the behavioral check passing again.
- Run the full RLS regression suite, not just the affected table —
  `apps/api/test/integration/data-model.test.ts`'s "row level security" suite
  covers every tenant table including partitions:

  ```bash
  pnpm --filter @nexa/api exec tsx scripts/with-test-datastores.ts \
    vitest run --dir test/integration data-model.test.ts
  ```

  (Passing `-- data-model` to the `test:integration` script itself does not
  filter — it runs the full ~86-file suite instead; go through the datastore
  harness directly, which is also what provisions the isolated test database.)

- Record the exposure window, the affected table(s)/tenant(s), and the audit
  export from step 5 — this is what a compliance/legal follow-up (NFR-C8)
  will need, and it is exactly the kind of record `docs/production-checklist.md`
  §8 assumes already exists rather than being reconstructed after the fact.
