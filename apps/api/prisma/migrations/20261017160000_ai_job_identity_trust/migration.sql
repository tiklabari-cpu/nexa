-- How the visitor who wrote a message proved who they are, carried by the AI
-- job that answers it (tm 294 · SiyahTuş analysis AI-02; owner decision K4).
--
-- A connection's first AI turn reads the summaries of the day's earlier
-- connections (`ai_conversations.digest`). How much of them it may use depends
-- on whether the visitor is provably the same member: a member token this
-- workspace signed (`verified`), a customer this browser was just given
-- (`session`), or nothing signed — the one-time adoption of a bare
-- `customer_id` (`claimed`), which sees no detail at all. The request that
-- wrote the message knows it (its customer token says how it was minted); the
-- job runs later, in whichever process claims it, so the fact travels with the
-- job — the `page_url` reasoning (20261016160000_ai_jobs_followups).
--
-- Per message, not per connection: an agent may open the connection, and a
-- visitor's token may be re-minted mid-day; what matters is who wrote the
-- message the AI is answering.
--
-- Expand-only (CONVENTIONS §6.3): one nullable column the previous release
-- neither reads nor writes. NULL — a job written before this, or by a path
-- that recorded no proof — reads as `claimed`, the least the AI may say.
-- `IDENTITY_TRUSTS` (@siyahtus/types) is the same list, which
-- `ai-daily-memory.test.ts` compares with the CHECK.
--
-- No RLS or grant change: `ai_jobs` keeps its tenant policy and the runtime
-- role's INSERT, which a new column inherits.

ALTER TABLE ai_jobs ADD COLUMN identity_trust TEXT;

ALTER TABLE ai_jobs ADD CONSTRAINT ai_jobs_identity_trust_check
  CHECK (identity_trust IS NULL OR identity_trust IN ('verified', 'session', 'claimed'));
