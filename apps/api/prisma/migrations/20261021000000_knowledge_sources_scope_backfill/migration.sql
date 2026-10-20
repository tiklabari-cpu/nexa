-- Who every older source is for (tm 309.2 · SiyahTuş analysis AI-14, owner
-- decision K11 · `docs/adr/single-knowledge-store.md` §2.8 step 2, "move").
--
-- From this release retrieval reads a source's scope rather than the agent
-- record it is filed under: the AI agent answers players from
-- `audiences @> '{ai_agent}'` for its own `ai_agent_ids` (or every agent's),
-- Copilot drafts from every audience, and `GET /copilot/knowledge` lists
-- `audiences = '{copilot}'`. 20261020220000 gave the sources that already
-- existed the column defaults — `{ai_agent,copilot}`, every agent — which,
-- read now, would put a Copilot source in front of players and give one AI
-- agent's sources to every other. tm 309.1 has written every new source in
-- these terms (`config-draft.ts` `knowledgeScopeOfFiling`); this writes them
-- for the rest, by the same mapping:
--
--   * filed under an `ai_agent` record   → `{ai_agent,copilot}`, that agent;
--   * filed under any other (Copilot's)  → `{copilot}`, no agent — a kind this
--                                          does not know is for agents only,
--                                          never for players.
--
-- A row already in those terms is not written, so a replay changes nothing;
-- no person has set these two columns yet — the release before this one gave
-- no way to. `brand_ids` (every brand), `valid_until` (no end), `reviewed_at`
-- (20261020220100), `updated_at` and the chunks are left as they are: no
-- vector moves and nothing is embedded again. A KB article's source exists
-- only from this release.
--
-- In a file of its own so `knowledge-scope.test.ts` can replay it as the one
-- statement it is.

UPDATE knowledge_sources s
   SET audiences = CASE WHEN a.kind = 'ai_agent'
                        THEN ARRAY['ai_agent', 'copilot']::text[]
                        ELSE ARRAY['copilot']::text[] END,
       ai_agent_ids = CASE WHEN a.kind = 'ai_agent'
                           THEN ARRAY[s.ai_agent_id]
                           ELSE ARRAY[]::uuid[] END
  FROM ai_agents a
 WHERE a.id = s.ai_agent_id
   AND s.kb_article_id IS NULL
   AND (s.audiences, s.ai_agent_ids) IS DISTINCT FROM (
         CASE WHEN a.kind = 'ai_agent'
              THEN ARRAY['ai_agent', 'copilot']::text[]
              ELSE ARRAY['copilot']::text[] END,
         CASE WHEN a.kind = 'ai_agent'
              THEN ARRAY[s.ai_agent_id]
              ELSE ARRAY[]::uuid[] END);
