-- Closing the password door (NFR-S11 · S11-h).
--
-- Everything before this made federation *possible*: a workspace could add an
-- identity provider, and its members could sign in through it. Nothing stopped
-- them signing in with a password instead, which is the whole reason an
-- enterprise buys SAML — the IdP is where MFA, conditional access and device
-- posture live, and a password that still works routes around all three.
--
-- One flag turns the connection from an option into the rule. It sits on the
-- connection rather than on the license because it is the *connection* a
-- workspace trusts: the row that names the certificate is the row that gets to
-- say "and nothing else gets in". A license with two federations has two
-- switches, and the door is closed while any of them is thrown.
ALTER TABLE sso_connections
  ADD COLUMN enforced BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN sso_connections.enforced IS
  'Refuse password sign-in for this license while the connection is also enabled. Read through the enabled AND enforced pair, never alone: a disabled connection enforces nothing, which is how a workspace whose IdP has broken gets its password door back.';

-- Deliberately NOT a CHECK constraint pairing `enforced` with `enabled`.
--
-- Making "enforced but disabled" unrepresentable is tempting and would be
-- wrong here. The state exists for exactly one reason — the incident where a
-- workspace's IdP stops answering — and the fix in that incident is to switch
-- the connection off. A constraint would refuse `enabled = false` on its own
-- and demand two fields be changed in one call, in the middle of the outage the
-- change exists to end. The precedent is `activePreviousCertificate`: a lapsed
-- rotation overlap is not deleted from the row either, it simply reads as
-- absent through the one function allowed to interpret it. Enforcement reads
-- the same way, and the resolver below is that one function.

-- ---------------------------------------------------------------------------
-- The memberships a person may sign in to, now saying which of them still
-- accept a password.
-- ---------------------------------------------------------------------------
-- The enforcement decision has to travel with the membership, not be looked up
-- beside it. `/auth/login` and `/auth/authorize` both already call this to find
-- out which workspaces an account holds; answering "and may this one be entered
-- with the password you just proved?" in the same row is what keeps the two
-- endpoints from drifting apart on the answer — the drift that would leave the
-- listing screen showing a door the authorize step refuses.
--
-- `sso_enforced_connection_id` is one column and not a boolean beside an id on
-- purpose. Two columns can disagree; a NULL cannot. It carries the connection
-- to send the person to instead, which is the only thing that makes a refusal
-- actionable rather than a dead end — and it is not a secret: the caller has
-- just proved both the account password and a membership in that license, and
-- the id is a URL they are about to be sent to anyway.
--
-- The `enabled AND enforced` pair is applied here, once. A connection that was
-- enforced and later switched off matches nothing, so the password door reopens
-- by itself — see the note above the constraint that is not there.
DROP FUNCTION IF EXISTS auth_list_memberships(UUID);

CREATE FUNCTION auth_list_memberships(p_account_id UUID)
RETURNS TABLE (
  license_id BIGINT,
  organization_id UUID,
  role TEXT,
  license_status TEXT,
  organization_name TEXT,
  client_id TEXT,
  sso_enforced_connection_id UUID
)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT m.license_id, l.organization_id, m.role, l.status, o.name,
         (SELECT c.id FROM oauth_clients c
           WHERE c.organization_id = l.organization_id
           ORDER BY c.created_at
           LIMIT 1),
         -- Ordered so a license federating two providers always names the same
         -- one; `name` is what the workspace calls it and what the screen sorts
         -- by, with the id breaking a tie between two identical labels.
         (SELECT s.id FROM sso_connections s
           WHERE s.license_id = m.license_id
             AND s.enabled
             AND s.enforced
           ORDER BY s.name, s.id
           LIMIT 1)
  FROM agent_memberships m
  JOIN licenses l      ON l.id = m.license_id
  JOIN organizations o ON o.id = l.organization_id
  WHERE m.agent_id = p_account_id
    AND NOT m.suspended
  ORDER BY l.id;
$$;

REVOKE EXECUTE ON FUNCTION auth_list_memberships(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_list_memberships(UUID) TO nexa_app;

-- ---------------------------------------------------------------------------
-- Is there a key to the break-glass door?
-- ---------------------------------------------------------------------------
-- The self-lockout guard, in the shape tm 80's IP allow-list established: a
-- configuration that would exclude the person saving it is refused at the write
-- rather than discovered at the next sign-in. There it was "the list must still
-- admit the address you are connecting from"; here it is "you must still be
-- able to get in when the identity provider cannot answer".
--
-- "You" is exact, not rhetorical. A license has exactly one owner
-- (`uq_license_single_owner`, a partial unique index from the first auth
-- migration), and the write surface is `exactRole: 'owner'` — so the account
-- this counts and the account making the change are the same person. That makes
-- this the IP allow-list guard almost literally, with "the address you are
-- connecting from" replaced by "the credential you would have left".
--
-- The break-glass door is that owner's password (§C-A17.7), so what has to be
-- true is that the door has a key: an owner whose account holds a password
-- hash. An owner provisioned by the identity provider has `password_hash` NULL
-- — the SSO-only shape `auth_provision_sso_account` writes — which is not an
-- exotic case at all: it is what a workspace looks like after its own owner
-- first signs in through SAML. Enforcing on top of that would mean a broken IdP
-- locks out the one account that could undo the enforcement, with no support
-- channel to appeal to.
--
-- A suspended owner does not count. `auth_list_memberships` already refuses
-- them a sign-in, so counting one would be counting a key to a bricked-up door.
-- Unreachable through the API today (a suspended member's token stops resolving,
-- so they cannot make this request either), and kept anyway: this function and
-- the sign-in path must answer "can this person get in" the same way, or a
-- later change to one silently invalidates the other. `awaiting_approval` is
-- deliberately left alone — it gates joining, not signing in.
--
-- SECURITY DEFINER because `accounts` is global and its RLS policy shows a row
-- only to a license that shares a membership with it. Those are exactly the
-- rows counted here, so a tenant-scoped read would work today — but it would
-- pull `password_hash` into the application to test it for NULL, and a column
-- whose whole discipline is "never leaves the database" should not start
-- leaving it to answer a boolean.
CREATE OR REPLACE FUNCTION auth_has_break_glass_owner(p_license_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM agent_memberships m
    JOIN accounts a ON a.id = m.agent_id
    WHERE m.license_id = p_license_id
      AND m.role = 'owner'
      AND NOT m.suspended
      AND a.password_hash IS NOT NULL
  );
$$;

REVOKE EXECUTE ON FUNCTION auth_has_break_glass_owner(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_has_break_glass_owner(BIGINT) TO nexa_app;
