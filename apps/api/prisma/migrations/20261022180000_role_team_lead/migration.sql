-- The Team Lead role (tm 324.1 · SiyahTuş analysis RL-01, RL-04, owner
-- decision K6 · `@siyahtus/types` `AGENT_ROLES`, `INVITATION_ROLES`).
--
--   - `team_lead` joins both role CHECKs. A membership may now hold it; an
--     invitation may carry it. `viceowner` stays a membership role until its
--     holders move to `admin` (a later migration, tm 324.3) and is still not
--     invitable. The one-owner index is untouched.
--   - `group_agents.is_lead`: whether a member leads the team. One person may
--     lead several (RL-01-S2); "the teams this person leads" is the partial
--     index below, the question RL-03's team-bounded checks ask.
--   - `invitation_groups`: the teams an invitation names, and which the
--     invitee leads (RL-04-S1). Both keys carry the licence, so a row cannot
--     pair one workspace's invitation with another's team; it goes with the
--     invitation and with the team, as a membership goes with the team.
--
-- The CHECKs and the constants are one list (`role-set-schema.test.ts`
-- compares them).
--
-- Expand only (CONVENTIONS §6.3): wider CHECKs, a defaulted column, a unique
-- key over columns that are unique already, and a table the previous release
-- does not read.

ALTER TABLE agent_memberships
  DROP CONSTRAINT agent_memberships_role_check,
  ADD CONSTRAINT agent_memberships_role_check
    CHECK (role IN ('owner', 'viceowner', 'admin', 'team_lead', 'agent'));

-- `owner` is absent on purpose: ownership transfers deliberately, not by an
-- email someone can forward. `viceowner` is offered to nobody new (K6).
ALTER TABLE invitations
  DROP CONSTRAINT invitations_role_check,
  ADD CONSTRAINT invitations_role_check CHECK (role IN ('admin', 'team_lead', 'agent'));

-- AlterTable
ALTER TABLE "group_agents" ADD COLUMN     "is_lead" BOOLEAN NOT NULL DEFAULT false;

-- Hand-written: Prisma cannot spell the WHERE.
CREATE INDEX group_agents_lead_agent_id_idx ON group_agents (agent_id) WHERE is_lead;

-- CreateIndex
CREATE UNIQUE INDEX "invitations_id_license_id_key" ON "invitations"("id", "license_id");

-- CreateTable
CREATE TABLE "invitation_groups" (
    "invitation_id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "group_id" BIGINT NOT NULL,
    "is_lead" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "invitation_groups_pkey" PRIMARY KEY ("invitation_id","group_id")
);

-- CreateIndex
CREATE INDEX "invitation_groups_license_id_group_id_idx" ON "invitation_groups"("license_id", "group_id");

-- AddForeignKey
ALTER TABLE "invitation_groups" ADD CONSTRAINT "invitation_groups_invitation_id_license_id_fkey" FOREIGN KEY ("invitation_id", "license_id") REFERENCES "invitations"("id", "license_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitation_groups" ADD CONSTRAINT "invitation_groups_license_id_group_id_fkey" FOREIGN KEY ("license_id", "group_id") REFERENCES "groups"("license_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE invitation_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitation_groups_tenant ON invitation_groups
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- Written by `POST /invitations` (tm 324.2): a re-invite replaces the set.
REVOKE ALL ON invitation_groups FROM siyahtus_app;
GRANT SELECT, INSERT, DELETE ON invitation_groups TO siyahtus_app;
