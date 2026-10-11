-- The language a member reads the panel in (tm 265), for the mail sent to them
-- later — a visitor's message, a chat transcript, a scheduled report — when no
-- request of theirs is there to say it. Recorded by `GET /auth/me` from the
-- panel's `X-SiyahTus-Locale` header.
--
-- Expand-only (CONVENTIONS §6.3): nullable, no default, no backfill. NULL means
-- "not seen yet" and reads as English — exactly what every member got before.
-- On the membership rather than the account, beside the notification
-- preferences it is read with.
ALTER TABLE agent_memberships
  ADD COLUMN "locale" TEXT;

ALTER TABLE agent_memberships
  ADD CONSTRAINT agent_memberships_locale_check
    CHECK ("locale" IS NULL OR "locale" IN ('en', 'tr'));
