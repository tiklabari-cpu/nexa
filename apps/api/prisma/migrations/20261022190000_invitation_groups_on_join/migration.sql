-- An invitation's teams are applied when its invitee joins (tm 324.2 · RL-04-S1
-- · PLAN §D329).
--
-- `invitation_groups` (20261022180000) records the teams an invitation names
-- and which of them the invitee leads; `POST /invitations` writes it from this
-- release. The two functions that create a membership from an invitation now
-- put the new member on those teams, in the same transaction as the join:
--
--   * `auth_accept_invitation` — a verified account joining at the accept;
--   * `auth_join_pending_invitations` — an account joining once its address is
--     proven (tm 282).
--
-- Only a membership the join itself created gets the teams. An invitation that
-- merely re-touched an existing membership (`ON CONFLICT DO NOTHING`) changes
-- neither its role nor its teams — the same "re-touch does nothing" rule the
-- role already follows — so a lead mark can never land on someone whose role
-- the invitation did not set.
--
-- A team that requires areas of expertise (AU-01 · K14) is skipped unless the
-- new member already holds them all, which a newcomer does not: `POST
-- /invitations` refuses to name such a team, so this only bites a requirement
-- added while the invitation waited. Skipped, not refused — the join is the
-- person's, the requirement the workspace's, and an admin adds them once
-- trained (`setGroupMember`'s rule, under the same advisory lock it takes).
--
-- Expand-only (CONVENTIONS §6.3): same signatures and result columns, so an API
-- from before this release calls them unchanged; it never wrote
-- `invitation_groups`, so for it the new step inserts nothing.

-- --------------------------------------------------------------------------
-- 1. auth_apply_invitation_groups — the step both joins share
-- --------------------------------------------------------------------------
-- Not SECURITY DEFINER and not granted: only the two definer functions below
-- call it, and inside them it runs as their owner.
CREATE FUNCTION auth_apply_invitation_groups(
  p_invitation UUID,
  p_license    BIGINT,
  p_account    UUID
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM invitation_groups ig WHERE ig.invitation_id = p_invitation) THEN
    RETURN;
  END IF;

  -- `lockTeamStaffing`'s lock (services/team/group-service.ts), so a
  -- requirement added to a team right now is either seen here or added after
  -- this member is on it — never decided against a stale read.
  PERFORM pg_advisory_xact_lock(hashtext('siyahtus.team-staffing'), hashtext(p_license::TEXT));

  INSERT INTO group_agents (license_id, group_id, agent_id, priority, is_lead)
  SELECT ig.license_id, ig.group_id, p_account, 'normal',
         -- Leading is the Team Lead's (RL-01). `POST /invitations` already
         -- refuses a lead mark on any other role; this keeps the rule true of
         -- the row whatever wrote it.
         ig.is_lead AND m.role = 'team_lead'
    FROM invitation_groups ig
    JOIN agent_memberships m
      ON m.license_id = ig.license_id AND m.agent_id = p_account
   WHERE ig.invitation_id = p_invitation
     AND ig.license_id = p_license
     AND NOT EXISTS (
       SELECT 1 FROM group_expertise ge
        WHERE ge.license_id = ig.license_id
          AND ge.group_id = ig.group_id
          AND NOT EXISTS (SELECT 1 FROM agent_expertise ae
                           WHERE ae.license_id = ge.license_id
                             AND ae.agent_id = p_account
                             AND ae.expertise_id = ge.expertise_id))
  ON CONFLICT (license_id, group_id, agent_id) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION auth_apply_invitation_groups(UUID, BIGINT, UUID) FROM PUBLIC;

-- --------------------------------------------------------------------------
-- 2. auth_accept_invitation — 20261015120000's, plus the teams
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_accept_invitation(
  p_token_hash    TEXT,
  p_name          TEXT,
  p_password_hash TEXT,
  p_trial_days    INT DEFAULT NULL,
  p_hold_until    TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  joined_account        UUID,
  joined_license        BIGINT,
  joined_email          TEXT,
  joined_name           TEXT,
  joined_invitation     UUID,
  joined_role           TEXT,
  verification_required BOOLEAN,
  joined_organization   UUID
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invite     invitations%ROWTYPE;
  v_account    UUID;
  v_email      TEXT;
  v_name       TEXT;
  v_verified   BOOLEAN;
  v_has_member BOOLEAN;
BEGIN
  -- Locked, not spent: only the verified branch spends it.
  SELECT i.* INTO v_invite
    FROM invitations i
   WHERE i.token_hash = p_token_hash
     AND i.accepted_at IS NULL
     AND i.expires_at > now()
     FOR UPDATE;

  IF v_invite.id IS NULL THEN
    RETURN;
  END IF;

  SELECT a.id, a.email::TEXT, a.name, a.email_verified_at IS NOT NULL
    INTO v_account, v_email, v_name, v_verified
    FROM accounts a WHERE a.email = v_invite.email
     FOR UPDATE;

  IF v_account IS NULL THEN
    IF p_password_hash IS NULL THEN
      RAISE EXCEPTION 'siyahtus_password_required';
    END IF;
    v_account  := gen_random_uuid();
    v_email    := v_invite.email::TEXT;
    v_name     := COALESCE(p_name, split_part(v_invite.email::TEXT, '@', 1));
    v_verified := FALSE;
    INSERT INTO accounts (id, email, name, password_hash, email_verified_at)
    VALUES (v_account, v_invite.email, v_name, p_password_hash, NULL);
  ELSIF NOT v_verified THEN
    v_has_member := EXISTS (SELECT 1 FROM agent_memberships m WHERE m.agent_id = v_account);
    IF NOT v_has_member THEN
      IF p_password_hash IS NULL THEN
        RAISE EXCEPTION 'siyahtus_password_required';
      END IF;
      v_name := COALESCE(p_name, v_name);
      UPDATE accounts a SET password_hash = p_password_hash, name = v_name
       WHERE a.id = v_account;

      UPDATE oauth_refresh_tokens r SET revoked_at = now()
       WHERE r.account_id = v_account AND r.revoked_at IS NULL;
      UPDATE api_tokens k SET revoked_at = now()
       WHERE k.owner_id = v_account::TEXT
         AND k.kind IN ('pat', 'oauth', 'enrollment')
         AND k.revoked_at IS NULL;
      UPDATE email_verification_tokens t SET used_at = now()
       WHERE t.account_id = v_account AND t.used_at IS NULL;
    END IF;
  END IF;

  IF NOT v_verified THEN
    UPDATE invitations i
       SET pending_account_id = v_account,
           expires_at = GREATEST(i.expires_at, COALESCE(p_hold_until, i.expires_at))
     WHERE i.id = v_invite.id;

    RETURN QUERY SELECT v_account, v_invite.license_id, v_email, v_name,
                        v_invite.id, v_invite.role, TRUE, v_invite.organization_id;
    RETURN;
  END IF;

  UPDATE invitations i SET accepted_at = now() WHERE i.id = v_invite.id;

  INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
  VALUES (v_invite.license_id, v_account, v_invite.role, 'accepting_chats')
  ON CONFLICT (license_id, agent_id) DO NOTHING;

  -- FOUND: the insert above created the membership, rather than finding one.
  IF FOUND THEN
    PERFORM auth_apply_invitation_groups(v_invite.id, v_invite.license_id, v_account);
  END IF;

  RETURN QUERY SELECT v_account, v_invite.license_id, v_email, v_name,
                      v_invite.id, v_invite.role, FALSE, v_invite.organization_id;
END;
$$;

-- --------------------------------------------------------------------------
-- 3. auth_join_pending_invitations — 20261015120000's, plus the teams
-- --------------------------------------------------------------------------
-- A loop rather than the data-modifying CTEs it was: whether each membership
-- insert created a row decides whether that invitation's teams apply, and a
-- CTE cannot ask one row's insert that question before the next.
CREATE OR REPLACE FUNCTION auth_join_pending_invitations(p_account UUID)
RETURNS TABLE (
  joined_license      BIGINT,
  joined_organization UUID,
  joined_invitation   UUID,
  joined_role         TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_spent RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounts a
                  WHERE a.id = p_account AND a.email_verified_at IS NOT NULL) THEN
    RETURN;
  END IF;

  FOR v_spent IN
    UPDATE invitations i
       SET accepted_at = now()
      FROM accounts a
     WHERE a.id = p_account
       AND i.pending_account_id = p_account
       AND i.email = a.email
       AND i.accepted_at IS NULL
       AND i.expires_at > now()
    RETURNING i.id, i.license_id, i.organization_id, i.role
  LOOP
    INSERT INTO agent_memberships (license_id, agent_id, role, routing_status)
    VALUES (v_spent.license_id, p_account, v_spent.role, 'accepting_chats')
    ON CONFLICT (license_id, agent_id) DO NOTHING;

    IF FOUND THEN
      PERFORM auth_apply_invitation_groups(v_spent.id, v_spent.license_id, p_account);
    END IF;

    joined_license      := v_spent.license_id;
    joined_organization := v_spent.organization_id;
    joined_invitation   := v_spent.id;
    joined_role         := v_spent.role;
    RETURN NEXT;
  END LOOP;
END;
$$;
