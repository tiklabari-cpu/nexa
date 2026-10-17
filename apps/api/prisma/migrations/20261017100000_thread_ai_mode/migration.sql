-- Who answers a connection, kept on the connection (tm 293.1 · SiyahTuş
-- analysis AI-11, owner decisions K9 and K10).
--
-- Today the AI answers every visitor message, whoever else is in the chat: an
-- agent and the AI talk to the same player at once, and a takeover does not
-- quieten it. From here on each connection (panel "Chat ID" = `threads.id`,
-- K1=A) has a mode:
--
--   NULL     the AI has not taken part — it may still answer;
--   'ai'     the AI took a turn and is answering;
--   'human'  a person has it — an agent wrote to the player, a supervisor took
--            it over, it was transferred, or a rule bot took it — and the AI
--            stays silent;
--   'paused' the AI is held back without a person having taken it.
--
-- The AI reads it before anything else (`AiResponder`), and its reply checks it
-- once more in the reply's own transaction, under the thread's row lock: an
-- agent who wrote while the model was thinking set 'human' first, and the
-- draft is not sent. `ai_conversations.mode` holds the same value with the who,
-- when and why — but only for a connection the AI took part in; this column
-- covers every connection and is what the Inbox's AI views filter on (tm 293.2).
--
-- Expand-only (CONVENTIONS §6.3): one nullable column the previous release
-- neither reads nor writes. Existing rows keep NULL — "the AI may answer",
-- which is what every connection was until now — and are not backfilled.
--
-- The CHECK scans `threads` once under this migration's lock; at today's size
-- (the pilot) that is milliseconds (the 20261015160000_conversation_day
-- reasoning). `AI_CONVERSATION_MODES` (@siyahtus/types) is the same list,
-- which `ai-mode-gate.test.ts` compares with the CHECK.
--
-- The Inbox's index on it is the next migration, on its own because it is
-- built CONCURRENTLY.
--
-- No RLS or grant change: `threads` carries its tenant policy and the runtime
-- role's UPDATE, and a new column inherits both.

ALTER TABLE threads ADD COLUMN ai_mode TEXT;

ALTER TABLE threads ADD CONSTRAINT threads_ai_mode_check
  CHECK (ai_mode IS NULL OR ai_mode IN ('ai', 'human', 'paused'));
