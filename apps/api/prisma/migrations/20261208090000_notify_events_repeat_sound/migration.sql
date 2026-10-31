-- Event-based notification preferences and the repeating sound (IN-10 · tm 367).
--
--   agent_memberships.notify_events        which events interrupt this member, as
--       a JSON object keyed by event (`incoming_chat`, `transferred_to_me`,
--       `transferred_to_my_team`, `queue_waiting`, `new_ticket`, `ticket_reply`).
--       DEFAULT '{}': a key the object lacks reads as the event's default
--       (`@siyahtus/types` · `DEFAULT_NOTIFICATION_EVENTS`), so existing members
--       and a build that predates a new event need no backfill.
--   agent_memberships.notify_repeat_sound  keep chiming every 10 s until the
--       message is read. Off by default.
--
-- Safe beside the previous release (CONVENTIONS §6.3): both columns are new and
-- defaulted, and the previous build neither reads nor writes them.
ALTER TABLE agent_memberships
  ADD COLUMN notify_events jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN notify_repeat_sound boolean NOT NULL DEFAULT false;

ALTER TABLE agent_memberships
  ADD CONSTRAINT agent_memberships_notify_events_object
  CHECK (jsonb_typeof(notify_events) = 'object');
