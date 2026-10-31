-- The missed-conversation reason for the connections that closed before the
-- close wrote it (RP-02 · tm 369.1) -- the "move" step after
-- 20261210090000_threads_missed_engagement expanded the schema (CONVENTIONS
-- 6.3), in a file of its own.
--
-- PARTIAL, and an estimate: a connection closed before then has no
-- `needs_human_since`, so whether it needed a person is inferred from what it
-- left behind -- an assignee at close, an entry in the queue record
-- (`queue_entries`), or an automatic hand-over in its transcript. The reason
-- is then the close's own rule (`services/reports/missed-engagement.ts`
-- `missedReasonSql`), spelled out once more -- the one place SQL cannot import
-- it; `missed-engagement.test.ts` replays this file and holds each branch to
-- the live rule. `needs_human_since` stays NULL on these rows: that is how the
-- report tells an estimate from a recorded value (`totals.estimated`, the
-- report's "not exact" note). `initiated_by` is not inferred: an old
-- connection's opener reads "unknown".
--
-- In batches of 2 000 connections, each committed on its own, keyed by id
-- (the 20261023180100_threads_archive_backfill shape): a long read of
-- `events` must not hold row locks on `threads` until the end, and a re-run
-- resumes. Rows the new code closes meanwhile carry `needs_human_since` when
-- they needed a person and are skipped. Runs as the migration role, past row
-- level security, over every workspace.
--
-- Alone in its file because COMMIT inside DO is allowed only when the block is
-- the whole statement Prisma sends, outside a transaction block.

DO $$
DECLARE
  last_id VARCHAR(12) := '';
  batch VARCHAR(12)[];
BEGIN
  LOOP
    SELECT array_agg(id ORDER BY id) INTO batch
      FROM (
        SELECT t.id FROM threads t
         WHERE t.id > last_id
           AND NOT t.active
           AND t.missed_reason IS NULL
           AND t.needs_human_since IS NULL
           AND t.first_response_at IS NULL
         ORDER BY t.id
         LIMIT 2000
      ) next_batch;
    EXIT WHEN batch IS NULL;

    UPDATE threads t
       SET missed_reason = (CASE
             WHEN handed.off THEN 'unanswered_after_ai'
             WHEN t.assignee_id IS NOT NULL THEN 'unanswered_assigned'
             ELSE 'queue_abandoned'
           END)
      FROM threads src
      CROSS JOIN LATERAL (
        SELECT EXISTS (
          SELECT 1 FROM events e
           WHERE e.thread_id = src.id
             AND e.author_type = 'system'
             AND (
               (e.properties ->> 'system_event' = 'chat_transferred'
                 AND e.properties ->> 'reason' = ANY (ARRAY['ai_handoff', 'bot_handoff']))
               OR (e.properties ->> 'system_event' = 'ai_mode_changed'
                 AND e.properties ->> 'reason' = ANY (ARRAY['ai_failure']))
             )
        ) AS off
      ) handed
     WHERE t.id = src.id
       AND t.id = ANY (batch)
       -- An agent's own conversation is not a player left waiting.
       AND t.opened_via IS DISTINCT FROM 'agent_start'
       AND t.opened_via IS DISTINCT FROM 'agent_reopen'
       -- It needed a person: someone held it, it waited, or it was handed over.
       AND (
         t.assignee_id IS NOT NULL
         OR handed.off
         OR EXISTS (SELECT 1 FROM queue_entries q WHERE q.thread_id = t.id)
       )
       -- And the AI did not handle it: a bot that answered and never handed
       -- over kept the conversation.
       AND (
         handed.off
         OR NOT EXISTS (SELECT 1 FROM events e WHERE e.thread_id = t.id AND e.author_type = 'bot')
       );

    last_id := batch[array_length(batch, 1)];
    COMMIT;
  END LOOP;
END;
$$;
