-- Conversation day on chats + how a connection opened (tm 286.1 · SiyahTuş
-- analysis ID-02, owner decision K1 = A).
--
-- K1 = A: a chat ("Thread ID" in the panel) is the member's conversation for
-- one day; a thread ("Chat ID") is one connection inside it. The day is a
-- workspace fact, computed only by `localDayKey` (@siyahtus/types) in the
-- boundary of 20261015150000_day_boundary — SQL never derives one. Three
-- columns:
--
--   * `chats.local_day` DATE   — the day the chat is filed under. Written once,
--     when the chat opens, and never recomputed: a later change of the
--     boundary must not move a day that already happened
--     (docs/adr/conversation-day-ids.md).
--   * `chats.day_tz` TEXT      — the IANA zone that day was counted in, so the
--     row still says which boundary it opened under after the setting moves.
--   * `threads.opened_via` TEXT — how the connection came to exist, one of
--     `CONNECTION_OPENED_VIA` (@siyahtus/types), which `data-model.test.ts`
--     compares with the CHECK below.
--
-- Expand-only (CONVENTIONS §6.3): three nullable columns the previous release
-- neither reads nor writes. Existing rows keep NULL — "filed under no day",
-- the old model — and are deliberately not backfilled: their threads span many
-- days, and inventing one day for them would file several days under one
-- Thread ID. Every CHECK below accepts the all-NULL row, so nothing the
-- previous release writes is refused.
--
-- The CHECKs scan `chats` and `threads` once under this migration's lock;
-- at today's size (the pilot) that is milliseconds. A large table would want
-- them added NOT VALID and validated separately.
--
-- The one-chat-per-member-per-day rule is the unique index of the next
-- migration, on its own because it is built CONCURRENTLY.
--
-- No RLS change: `chats` and `threads` carry their tenant policies, and a new
-- column inherits them.

ALTER TABLE chats
  ADD COLUMN local_day DATE,
  ADD COLUMN day_tz TEXT;

-- A day and the zone it was counted in are one fact: both or neither.
ALTER TABLE chats ADD CONSTRAINT chats_local_day_tz_pair
  CHECK ((local_day IS NULL) = (day_tz IS NULL));

-- Not blank. Whether the value is a real zone is the API's check (`Intl`, as
-- for `inbox_settings.day_boundary_tz`): a CHECK against a frozen list would
-- refuse a zone a newer engine accepts.
ALTER TABLE chats ADD CONSTRAINT chats_day_tz_check
  CHECK (day_tz IS NULL OR length(btrim(day_tz)) > 0);

ALTER TABLE threads ADD COLUMN opened_via TEXT;

ALTER TABLE threads ADD CONSTRAINT threads_opened_via_check
  CHECK (opened_via IS NULL OR opened_via IN (
    'first_of_day', 'same_day_return', 'agent_start', 'agent_reopen', 'day_rollover'
  ));
