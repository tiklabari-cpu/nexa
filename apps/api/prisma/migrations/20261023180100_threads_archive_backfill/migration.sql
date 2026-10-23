-- The archive filters' columns for the connections that closed before the
-- close wrote them (AR-02 · tm 336.1) -- the "move" step after
-- 20261023160000_threads_handled_by and 20261023180000 expanded the schema
-- (CONVENTIONS 6.3), in a file of its own.
--
--   handled_by  ADR-09a's predicate, `handledBySql` in
--               services/billing/ai-resolution.ts, spelled out once more
--               with its effective date as a literal -- the one place SQL
--               cannot import it. `archive-backfill.test.ts` replays this
--               file and holds every branch to `handledBySql`, so the two
--               cannot drift apart unnoticed; a new condition there must be
--               added here in the same change.
--   agent_ids   `agentIdsSql` (services/archive/archive-filters.ts), the
--               same test holding the two together.
--   risk_flags  every type raised in the connection, from `risk_flags`.
--
-- In batches of 2 000 connections, each committed on its own: a workspace
-- with a million closed connections is a long read of `events`, and one
-- transaction over all of it would hold row locks on `threads` -- every close,
-- every transfer -- until the end. A batch is keyed by id, so a re-run (or a
-- deploy that stopped halfway) resumes: only rows still NULL are read again.
-- Rows the new code closes meanwhile already carry both columns and are
-- skipped. Runs as the migration role, past row level security, over every
-- workspace.
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
           AND (t.handled_by IS NULL OR t.agent_ids IS NULL)
         ORDER BY t.id
         LIMIT 2000
      ) next_batch;
    EXIT WHEN batch IS NULL;

    UPDATE threads t
       SET handled_by = COALESCE(t.handled_by, (CASE
             WHEN (
               NOT t.active
               AND NOT EXISTS (
                 SELECT 1 FROM events e WHERE e.thread_id = t.id AND e.author_type = 'agent'
               )
               AND (
                 t.closed_at < '2026-11-01T00:00:00.000Z'::timestamptz
                 OR NOT EXISTS (
                   SELECT 1 FROM events e
                    WHERE e.thread_id = t.id
                      AND e.author_type = 'system'
                      AND (
                        (e.properties ->> 'system_event' = 'chat_transferred'
                          AND e.properties ->> 'reason' = ANY (ARRAY['ai_handoff', 'bot_handoff']))
                        OR (e.properties ->> 'system_event' = 'ai_mode_changed'
                          AND e.properties ->> 'reason' = ANY (ARRAY['ai_failure']))
                      )
                 )
               )
             ) THEN 'ai'
             WHEN EXISTS (
                    SELECT 1 FROM events e WHERE e.thread_id = t.id AND e.author_type = 'agent'
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM events e WHERE e.thread_id = t.id AND e.author_type = 'bot'
                  ) THEN 'human'
             ELSE 'mixed'
           END)),
           agent_ids = COALESCE(t.agent_ids, ARRAY(
             SELECT DISTINCT e.author_id::uuid FROM events e
              WHERE e.thread_id = t.id
                AND e.author_type = 'agent'
                AND e.recipients = 'all'
                AND e.author_id ~ '^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$'
              ORDER BY 1
           ))
     WHERE t.id = ANY (batch);

    last_id := batch[array_length(batch, 1)];
    COMMIT;
  END LOOP;

  -- Flags are few beside connections: one statement.
  UPDATE threads t
     SET risk_flags = f.types
    FROM (
      SELECT rf.thread_id, rf.license_id, array_agg(DISTINCT rf.type ORDER BY rf.type) AS types
        FROM risk_flags rf
       WHERE rf.thread_id IS NOT NULL
       GROUP BY rf.thread_id, rf.license_id
    ) f
   WHERE t.id = f.thread_id
     AND t.license_id = f.license_id
     AND t.risk_flags IS DISTINCT FROM f.types;
END;
$$;
