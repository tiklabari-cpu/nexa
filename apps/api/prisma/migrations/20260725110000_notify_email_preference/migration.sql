-- E-mail notification channel preference (FR-MOD-13.8 / 08.2).
--
-- The e-mail channel already fires for a chat's assigned agent; this column is
-- the per-user, per-license opt-out that FR-MOD-08.2 requires ("ses/masaüstü/
-- e-posta/tarayıcı bildirim tercihleri ... kullanıcı bazında"). It lives on the
-- membership rather than the account because a person is a member of each
-- license separately, and the same person can want e-mail on one workspace and
-- off on another. Defaults to true so the existing behaviour is unchanged until
-- an agent turns it off; the server reads it before sending.
ALTER TABLE agent_memberships
  ADD COLUMN notify_email BOOLEAN NOT NULL DEFAULT true;
