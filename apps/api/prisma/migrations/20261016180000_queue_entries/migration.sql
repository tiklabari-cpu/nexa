-- The queue record (tm 291 · SiyahTuş analysis RP-04, RP-04-S1; owner decision
-- K21: the data capture comes early, the report screen #371 later).
--
-- `threads.queued_at` is written when a connection enters the routing queue and
-- cleared when it leaves — on assignment (`RoutingService.drainQueue`) and on
-- close (`ChatService.#closeConversation`). The position numbering depends on
-- that, so it stays. But it means a finished wait cannot be read back: how long
-- players waited, and how many gave up, is lost the moment it ends. This table
-- keeps it:
--
--   `queue_entries` — one row per stay in the queue. Opened in the transaction
--   that creates a queued connection, closed (`left_at` + `outcome`) in the
--   transaction that takes it out: the drain, a takeover, a transfer, the close.
--   A connection may wait more than once (a transfer to another team, WG-03's
--   re-queue), never twice at once.
--
-- `group_id` is the team it waited for. Until team queues arrive (AU-01 · #305)
-- that is the connection's team (`threads.group_id`), else the chat's first
-- access group; AU-01 writes its queue team. No foreign key — the
-- `threads.group_id` rule: a deleted team must not erase what waited for it.
--
-- Retention: every row names its thread and goes with it (CASCADE), so the
-- retention sweep's thread delete and a customer's erasure take the stays with
-- the conversation — the rule `ai_jobs` and `ai_decision_logs` follow.
--
-- A record, not a work table: `siyahtus_app` may open a row and close it
-- (`left_at`, `outcome`), nothing else — no DELETE, no rewriting when it began.
--
-- Expand-only (CONVENTIONS 6.3): a new table, nothing an earlier release reads
-- or writes.

CREATE TABLE "queue_entries" (
    "id"          UUID           NOT NULL,
    "license_id"  BIGINT         NOT NULL,
    "thread_id"   VARCHAR(12)    NOT NULL,
    "group_id"    BIGINT,
    "entered_at"  TIMESTAMPTZ(6) NOT NULL,
    "left_at"     TIMESTAMPTZ(6),
    "outcome"     TEXT,

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "queue_entries_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "queue_entries_thread_id_fkey"
      FOREIGN KEY ("thread_id") REFERENCES "threads"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `QUEUE_ENTRY_OUTCOMES` (`@siyahtus/types`).
    CONSTRAINT queue_entries_outcome_check CHECK (
      outcome IS NULL
      OR outcome IN ('assigned', 'abandoned', 'closed_by_agent', 'transferred', 'timeout')
    ),
    -- A stay is either still waiting (neither) or over (both): a row that left
    -- without saying how, or names an outcome while still open, is not a record.
    CONSTRAINT queue_entries_left_pair_check CHECK ((left_at IS NULL) = (outcome IS NULL)),
    CONSTRAINT queue_entries_left_after_entered_check CHECK (left_at IS NULL OR left_at >= entered_at)
);

-- The reports read a workspace's stays by when they began.
CREATE INDEX "queue_entries_license_id_entered_at_idx" ON "queue_entries"("license_id", "entered_at");

-- One open stay per connection. Also the path every close takes (`thread_id`,
-- open only) and the sweep's safety net (every open row).
CREATE UNIQUE INDEX "queue_entries_thread_open_key" ON "queue_entries"("thread_id")
  WHERE left_at IS NULL;

-- The cascade from `threads` (retention, erasure) finds a thread's closed
-- stays too.
CREATE INDEX "queue_entries_thread_id_idx" ON "queue_entries"("thread_id");

ALTER TABLE queue_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY queue_entries_tenant ON queue_entries
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- The default privileges (20260722090000) grant all four; narrow them.
REVOKE UPDATE, DELETE, TRUNCATE ON queue_entries FROM siyahtus_app;
GRANT SELECT, INSERT ON queue_entries TO siyahtus_app;
GRANT UPDATE (left_at, outcome) ON queue_entries TO siyahtus_app;
