-- AI-12 · tm 307.2: the expertise whoever takes a connection must hold.
--
--   * threads.required_expertise_id — set when the AI hands a connection to a
--                                     route that requires an expertise (the
--                                     "Responsible Gambling trained" one,
--                                     AI-12-S3). Read by the queue drain while
--                                     the connection waits, so it reaches a
--                                     trained agent or nobody — never the
--                                     first free one. Every team hand-off
--                                     writes it (null when it requires none).
--
-- A soft reference to `expertise.id`, like `handoff_routes.required_expertise_id`:
-- an expertise deleted later is held by nobody, so the connection waits rather
-- than reach an untrained agent. Nullable and read by new code only: an old
-- replica mid-rollout neither reads nor writes it (CONVENTIONS §6.3 — expand).

-- AlterTable
ALTER TABLE "threads" ADD COLUMN     "required_expertise_id" BIGINT;
