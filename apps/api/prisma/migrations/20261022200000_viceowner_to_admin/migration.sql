-- The vice owner retires (tm 324.3 · SiyahTuş analysis RL-01, owner decision
-- K6): every membership holding `viceowner` becomes `admin`, and every move is
-- recorded as a `member.role_changed` audit entry, `via: 'migration'`.
--
-- K6 settles the role set as Kurucu / Yönetici / Ekip Lideri / Ekip Üyesi. A
-- vice owner's scopes were already an admin's (`defaultScopesForRole`), so the
-- move takes no power from anyone and no session or token needs reissuing; what
-- changes is rank. A vice owner sat above admins (`ROLE_RANK` 3 against 2), so
-- no admin could change their role; from here they are peers. Since tm 324.2 no
-- request assigns `viceowner` (400 `role_retired`), so the set moved here can
-- only have shrunk by the time this runs.
--
-- Irreversible, and there is no down step: after this statement the only
-- record of who *was* a vice owner is the audit entries it leaves. That is why
-- they are written in the statement that makes the change — one statement, one
-- transaction, no moment where a role has moved and its entry does not exist.
--
-- Why the entries go to `pending_audit_entries` and not to `audit_log`: the log
-- is a tamper-evident chain (NFR-C6 · C6-c, 20260815160000) whose key is derived
-- from `AUDIT_CHAIN_SECRET`, which the application holds and the database
-- deliberately does not. A row inserted here could not be chained, and an
-- unchained row written after a workspace's chain began is exactly what the
-- verifier reports as tampering (`unchained_entry`). So the migration records
-- what happened and the API signs it: at boot it writes each pending entry
-- into the chain inside the workspace's own transaction and deletes it there
-- (`services/audit/pending-audit.ts`), so an entry is signed once and never
-- lost between the two tables. The table is general — the next data migration
-- that has to leave an audit trail has the same problem — and it holds rows
-- only between a deploy and the next boot.
--
-- Expand only (CONVENTIONS §6.3): a table and a function the previous release
-- never reads, and an UPDATE to a role every release accepts. The role CHECK
-- still admits `viceowner`: dropping it is the later contraction, once no
-- running release can write it. A release older than tm 324.2 still running
-- during the rollout could assign `viceowner` after this statement; that
-- member keeps an admin's powers, and the contraction repeats this move first.

-- CreateTable
CREATE TABLE "pending_audit_entries" (
    "id" BIGSERIAL NOT NULL,
    "license_id" BIGINT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_audit_entries_license_id_id_idx" ON "pending_audit_entries"("license_id", "id");

-- AddForeignKey
ALTER TABLE "pending_audit_entries" ADD CONSTRAINT "pending_audit_entries_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE pending_audit_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY pending_audit_entries_tenant ON pending_audit_entries
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- The application signs and deletes; it never writes one. An entry the API
-- could insert here would be signed as if a migration had recorded it.
REVOKE ALL ON pending_audit_entries FROM siyahtus_app;
GRANT SELECT, DELETE ON pending_audit_entries TO siyahtus_app;

-- Which workspaces have entries waiting, so the boot pass opens a transaction
-- for those and not for every tenant. SECURITY DEFINER for the same reason as
-- `retention_list_tenants()`: it answers "which tenants", across them, and
-- reads nothing else.
CREATE FUNCTION pending_audit_tenants()
RETURNS TABLE (license_id BIGINT, organization_id UUID)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT l.id, l.organization_id
  FROM licenses l
  WHERE EXISTS (SELECT 1 FROM pending_audit_entries p WHERE p.license_id = l.id)
  ORDER BY l.id;
$$;

REVOKE EXECUTE ON FUNCTION pending_audit_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pending_audit_tenants() TO siyahtus_app;

-- The move. The entry carries what the route's own `member.role_changed`
-- carries (from, to, the member as `account:<id>`), plus how and where it was
-- made; the signer adds `occurred_at`.
WITH moved AS (
  UPDATE agent_memberships
     SET role = 'admin'
   WHERE role = 'viceowner'
  RETURNING license_id, agent_id
)
INSERT INTO pending_audit_entries (license_id, action, target, metadata)
SELECT license_id,
       'member.role_changed',
       'account:' || agent_id::text,
       jsonb_build_object(
         'from', 'viceowner',
         'to', 'admin',
         'via', 'migration',
         'migration', '20261022200000_viceowner_to_admin'
       )
  FROM moved
 ORDER BY license_id, agent_id;
