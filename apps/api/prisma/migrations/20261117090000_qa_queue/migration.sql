-- The AI quality control (QA) queue (tm 319.1 · SiyahTuş analysis AI-24 ·
-- `@siyahtus/types` `qa.ts`).
--
--   - `qa_settings` — a workspace's QA settings (Ayarlar › AI kalite): the
--     day's random share (1–20 %, AI-24-S1), whether the model pre-scores
--     (AI-24-S2) and the conflict-of-interest check. No row reads as the
--     defaults.
--   - `qa_rubrics` — the workspace's rubric, versioned: version 1 is the
--     platform rubric, a later one the workspace's edit; one active at a time.
--     A review names the version it was scored against.
--   - `qa_reviews` — one connection the AI took part in (panel "Chat ID",
--     `thread_id`), queued for review: why (`reasons`), how pressing
--     (`priority`, `QA_PRIORITY_RANK`), by when (`due_at`), the masked
--     excerpt it is judged on (`excerpt_masked`, AI-26) and, once reviewed,
--     the scores and verdict. `thread_id` names the connection without a
--     foreign key: the retention sweep deletes closed threads, and the QA
--     evidence stays (AI-24 "Saklama"). The chat is a foreign key: erasing
--     the player deletes their chats, and the reviews about them go too. One
--     review per connection: a connection picked again — another reason, a
--     re-run of the same day — adds its reasons to the one row.
--     `team_id`, `brand_id` and `config_version_id` are the connection's when
--     it was queued — a Team Lead reviews their teams' (tm 319.2); none has a
--     foreign key, a team or brand deleted later leaves its id behind.
--   - `qa_calibrations`, `qa_calibration_scores` — the monthly calibration
--     round: the same reviews scored by every Team Lead (AI-24 §7).
--   - `qa_sampling_runs` — one row per workspace and sampled conversation
--     day: the sampler's idempotency mark, and the volumes the queue's
--     workload is watched by ("zorunlu kategori hacmi izlenmeli").
--
-- The CHECKs and the constants of `qa.ts` are one list (`qa-sampling.test.ts`
-- compares them).
--
-- Expand only (CONVENTIONS §6.3): new tables the previous release does not read.

CREATE TABLE "qa_settings" (
    "license_id"       BIGINT         NOT NULL,
    "sample_percent"   SMALLINT       NOT NULL DEFAULT 5,
    "prescore_enabled" BOOLEAN        NOT NULL DEFAULT true,
    "conflict_check"   BOOLEAN        NOT NULL DEFAULT true,
    "updated_by"       UUID,
    "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_settings_pkey" PRIMARY KEY ("license_id"),
    CONSTRAINT "qa_settings_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `QA_SAMPLE_PERCENT_MIN`, `QA_SAMPLE_PERCENT_MAX`.
    CONSTRAINT qa_settings_sample_percent_check CHECK (sample_percent BETWEEN 1 AND 20)
);

CREATE TABLE "qa_rubrics" (
    "id"         UUID           NOT NULL,
    "license_id" BIGINT         NOT NULL,
    "version"    INTEGER        NOT NULL,
    "criteria"   JSONB          NOT NULL,
    "active"     BOOLEAN        NOT NULL DEFAULT false,
    -- The account that saved it; null for the platform's version 1. No
    -- foreign key: a rubric outlives its author.
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_rubrics_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "qa_rubrics_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT qa_rubrics_version_check CHECK (version >= 1),
    -- `QA_RUBRIC_CRITERIA_MAX`; the criteria themselves are `qaRubricProblem`'s.
    CONSTRAINT qa_rubrics_criteria_check CHECK (
      jsonb_typeof(criteria) = 'array' AND jsonb_array_length(criteria) BETWEEN 1 AND 20
    )
);

CREATE UNIQUE INDEX "qa_rubrics_license_id_version_key" ON "qa_rubrics"("license_id", "version");
-- One active rubric per workspace.
CREATE UNIQUE INDEX "qa_rubrics_one_active_key" ON "qa_rubrics"("license_id") WHERE active;

CREATE TABLE "qa_reviews" (
    "id"                UUID           NOT NULL,
    "license_id"        BIGINT         NOT NULL,
    "chat_id"           VARCHAR(12)    NOT NULL,
    "thread_id"         VARCHAR(12)    NOT NULL,
    "ai_agent_id"       UUID           NOT NULL,
    "config_version_id" UUID,
    "team_id"           BIGINT,
    "brand_id"          UUID,
    "reasons"           TEXT[]         NOT NULL,
    "priority"          SMALLINT       NOT NULL DEFAULT 0,
    "status"            TEXT           NOT NULL DEFAULT 'ready',
    -- The conversation day the sampler took it from; null for one added by hand.
    "sample_day"        DATE,
    "assigned_to"       UUID,
    "claimed_at"        TIMESTAMPTZ(6),
    "due_at"            TIMESTAMPTZ(6) NOT NULL,
    "rubric_id"         UUID           NOT NULL,
    "prescore"          JSONB,
    "scores"            JSONB          NOT NULL DEFAULT '{}',
    "final"             TEXT,
    "critical_fail"     BOOLEAN        NOT NULL DEFAULT false,
    "excerpt_masked"    JSONB          NOT NULL DEFAULT '[]',
    "reviewer_id"       UUID,
    "reviewed_at"       TIMESTAMPTZ(6),
    "comments"          TEXT,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_reviews_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "qa_reviews_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- Erasure deletes the customer, and with it the chats: the reviews go too.
    CONSTRAINT "qa_reviews_chat_id_fkey"
      FOREIGN KEY ("chat_id") REFERENCES "chats"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "qa_reviews_ai_agent_id_fkey"
      FOREIGN KEY ("ai_agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "qa_reviews_rubric_id_fkey"
      FOREIGN KEY ("rubric_id") REFERENCES "qa_rubrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "qa_reviews_assigned_to_fkey"
      FOREIGN KEY ("assigned_to") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "qa_reviews_reviewer_id_fkey"
      FOREIGN KEY ("reviewer_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    -- `QA_REASONS`: at least one, each once.
    CONSTRAINT qa_reviews_reasons_check CHECK (
      cardinality(reasons) >= 1
      AND reasons <@ ARRAY['random', 'risk_flag', 'low_bsat', 'repeat_72h', 'guardrail_scan', 'mandatory_handoff', 'handoff_insufficient', 'consistency', 'manual']::text[]
    ),
    -- `QA_PRIORITY_RANK`.
    CONSTRAINT qa_reviews_priority_check CHECK (priority BETWEEN 0 AND 2),
    -- `QA_REVIEW_STATUSES`.
    CONSTRAINT qa_reviews_status_check CHECK (status IN ('pending_prescore', 'ready', 'in_review', 'completed')),
    -- `QA_FINALS`.
    CONSTRAINT qa_reviews_final_check CHECK (final IS NULL OR final IN ('pass', 'fail')),
    -- Completed exactly when it has a verdict and a moment.
    CONSTRAINT qa_reviews_completed_check CHECK (
      (status = 'completed') = (final IS NOT NULL) AND (status = 'completed') = (reviewed_at IS NOT NULL)
    ),
    -- A critical criterion failed fails the review (a NULL `final` is no fail).
    CONSTRAINT qa_reviews_critical_check CHECK (NOT critical_fail OR final IS NOT DISTINCT FROM 'fail'),
    CONSTRAINT qa_reviews_claimed_check CHECK ((claimed_at IS NULL) OR status IN ('in_review', 'completed')),
    -- `QA_COMMENTS_MAX`.
    CONSTRAINT qa_reviews_comments_check CHECK (
      comments IS NULL OR char_length(btrim(comments)) BETWEEN 1 AND 4000
    ),
    CONSTRAINT qa_reviews_excerpt_check CHECK (jsonb_typeof(excerpt_masked) = 'array'),
    CONSTRAINT qa_reviews_scores_check CHECK (jsonb_typeof(scores) = 'object'),
    CONSTRAINT qa_reviews_prescore_check CHECK (prescore IS NULL OR jsonb_typeof(prescore) = 'object')
);

-- One review per connection: the sampler and a hand add merge into it.
CREATE UNIQUE INDEX "qa_reviews_license_id_thread_id_key" ON "qa_reviews"("license_id", "thread_id");
-- The queue: a workspace's reviews by status, soonest due first.
CREATE INDEX "qa_reviews_license_id_status_due_at_idx" ON "qa_reviews"("license_id", "status", "due_at");
-- A Team Lead's: their teams' reviews by status.
CREATE INDEX "qa_reviews_license_id_team_id_status_idx" ON "qa_reviews"("license_id", "team_id", "status");
CREATE INDEX "qa_reviews_chat_id_idx" ON "qa_reviews"("chat_id");
CREATE INDEX "qa_reviews_rubric_id_idx" ON "qa_reviews"("rubric_id");

CREATE TABLE "qa_calibrations" (
    "id"         UUID           NOT NULL,
    "license_id" BIGINT         NOT NULL,
    -- The month, as its first day.
    "period"     DATE           NOT NULL,
    "rubric_id"  UUID           NOT NULL,
    -- The reviews every Team Lead scores; no foreign key on an array.
    "review_ids" UUID[]         NOT NULL,
    "status"     TEXT           NOT NULL DEFAULT 'open',
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at"  TIMESTAMPTZ(6),

    CONSTRAINT "qa_calibrations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "qa_calibrations_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "qa_calibrations_rubric_id_fkey"
      FOREIGN KEY ("rubric_id") REFERENCES "qa_rubrics"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT qa_calibrations_period_check CHECK (period = date_trunc('month', period)::date),
    -- `QA_CALIBRATION_SIZE`.
    CONSTRAINT qa_calibrations_size_check CHECK (cardinality(review_ids) BETWEEN 1 AND 20),
    -- `QA_CALIBRATION_STATUSES`.
    CONSTRAINT qa_calibrations_status_check CHECK (status IN ('open', 'closed')),
    CONSTRAINT qa_calibrations_closed_check CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);

CREATE UNIQUE INDEX "qa_calibrations_license_id_period_key" ON "qa_calibrations"("license_id", "period");
CREATE INDEX "qa_calibrations_rubric_id_idx" ON "qa_calibrations"("rubric_id");

CREATE TABLE "qa_calibration_scores" (
    "id"             UUID           NOT NULL,
    "license_id"     BIGINT         NOT NULL,
    "calibration_id" UUID           NOT NULL,
    "review_id"      UUID           NOT NULL,
    "reviewer_id"    UUID           NOT NULL,
    "scores"         JSONB          NOT NULL,
    "final"          TEXT           NOT NULL,
    "critical_fail"  BOOLEAN        NOT NULL DEFAULT false,
    "submitted_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_calibration_scores_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "qa_calibration_scores_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "qa_calibration_scores_calibration_id_fkey"
      FOREIGN KEY ("calibration_id") REFERENCES "qa_calibrations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "qa_calibration_scores_review_id_fkey"
      FOREIGN KEY ("review_id") REFERENCES "qa_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "qa_calibration_scores_reviewer_id_fkey"
      FOREIGN KEY ("reviewer_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT qa_calibration_scores_final_check CHECK (final IN ('pass', 'fail')),
    CONSTRAINT qa_calibration_scores_critical_check CHECK (NOT critical_fail OR final = 'fail'),
    CONSTRAINT qa_calibration_scores_scores_check CHECK (jsonb_typeof(scores) = 'object')
);

-- One score per lead and conversation in a round.
CREATE UNIQUE INDEX "qa_calibration_scores_calibration_id_review_id_reviewer_id_key"
  ON "qa_calibration_scores"("calibration_id", "review_id", "reviewer_id");
CREATE INDEX "qa_calibration_scores_review_id_idx" ON "qa_calibration_scores"("review_id");
CREATE INDEX "qa_calibration_scores_reviewer_id_idx" ON "qa_calibration_scores"("reviewer_id");

CREATE TABLE "qa_sampling_runs" (
    "license_id"     BIGINT         NOT NULL,
    -- The conversation day sampled (`localDayKey`, the workspace's boundary).
    "day"            DATE           NOT NULL,
    "sample_percent" SMALLINT       NOT NULL,
    -- AI connections that closed that day.
    "eligible"       INTEGER        NOT NULL DEFAULT 0,
    -- Picked by the draw, and by a mandatory category (one may be both).
    "random"         INTEGER        NOT NULL DEFAULT 0,
    "mandatory"      INTEGER        NOT NULL DEFAULT 0,
    -- Connections the queue holds for the day after the run.
    "queued"         INTEGER        NOT NULL DEFAULT 0,
    "ran_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "qa_sampling_runs_pkey" PRIMARY KEY ("license_id", "day"),
    CONSTRAINT "qa_sampling_runs_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT qa_sampling_runs_counts_check CHECK (
      eligible >= 0 AND random >= 0 AND mandatory >= 0 AND queued >= 0
    )
);

-- --------------------------------------------------------------------------
-- The workspace's own rows only
-- --------------------------------------------------------------------------

-- A foreign key proves the row exists, not that it is this workspace's. Read
-- as the writer, under its RLS: another workspace's agent, connection, team or
-- rubric is not there to find. The connection is checked only when it is
-- written: the retention sweep deletes it later and the review stays.
CREATE FUNCTION qa_reviews_before_write() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  -- PL/pgSQL does not promise to stop an `OR` before `OLD`, which an
  -- INSERT has none of: what moved is decided first, branch by branch.
  conversation_moved BOOLEAN := TRUE;
  team_moved BOOLEAN := TRUE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    conversation_moved := NEW.thread_id IS DISTINCT FROM OLD.thread_id
      OR NEW.chat_id IS DISTINCT FROM OLD.chat_id;
    team_moved := NEW.team_id IS DISTINCT FROM OLD.team_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM ai_agents a
     WHERE a.id = NEW.ai_agent_id AND a.license_id = NEW.license_id AND a.kind = 'ai_agent'
  ) THEN
    RAISE EXCEPTION 'qa_reviews: ai agent % is not this workspace''s', NEW.ai_agent_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF conversation_moved AND NOT EXISTS (
    SELECT 1 FROM threads t
     WHERE t.id = NEW.thread_id AND t.chat_id = NEW.chat_id AND t.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'qa_reviews: thread % is not this workspace''s chat %',
      NEW.thread_id, NEW.chat_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.team_id IS NOT NULL AND team_moved THEN
    IF NOT EXISTS (
      SELECT 1 FROM groups g WHERE g.id = NEW.team_id AND g.license_id = NEW.license_id
    ) THEN
      RAISE EXCEPTION 'qa_reviews: team % is not this workspace''s', NEW.team_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM qa_rubrics r WHERE r.id = NEW.rubric_id AND r.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'qa_reviews: rubric % is not this workspace''s', NEW.rubric_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER qa_reviews_before_write
  BEFORE INSERT OR UPDATE OF ai_agent_id, chat_id, thread_id, team_id, rubric_id, license_id
  ON qa_reviews
  FOR EACH ROW
  EXECUTE FUNCTION qa_reviews_before_write();

CREATE FUNCTION qa_calibrations_before_write() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM qa_rubrics r WHERE r.id = NEW.rubric_id AND r.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'qa_calibrations: rubric % is not this workspace''s', NEW.rubric_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.review_ids) AS listed(id)
     WHERE NOT EXISTS (
       SELECT 1 FROM qa_reviews q WHERE q.id = listed.id AND q.license_id = NEW.license_id
     )
  ) THEN
    RAISE EXCEPTION 'qa_calibrations: a listed review is not this workspace''s'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER qa_calibrations_before_write
  BEFORE INSERT OR UPDATE OF rubric_id, review_ids, license_id
  ON qa_calibrations
  FOR EACH ROW
  EXECUTE FUNCTION qa_calibrations_before_write();

-- A score belongs to its round's workspace, to a review the round lists, and
-- to a member of the workspace.
CREATE FUNCTION qa_calibration_scores_before_write() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM qa_calibrations c
     WHERE c.id = NEW.calibration_id AND c.license_id = NEW.license_id
       AND NEW.review_id = ANY (c.review_ids)
  ) THEN
    RAISE EXCEPTION 'qa_calibration_scores: review % is not in this workspace''s round %',
      NEW.review_id, NEW.calibration_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM agent_memberships m
     WHERE m.agent_id = NEW.reviewer_id AND m.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'qa_calibration_scores: % is not a member of this workspace', NEW.reviewer_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER qa_calibration_scores_before_write
  BEFORE INSERT OR UPDATE OF calibration_id, review_id, reviewer_id, license_id
  ON qa_calibration_scores
  FOR EACH ROW
  EXECUTE FUNCTION qa_calibration_scores_before_write();

-- --------------------------------------------------------------------------
-- RLS and grants
-- --------------------------------------------------------------------------

ALTER TABLE qa_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY qa_settings_tenant ON qa_settings
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());
ALTER TABLE qa_rubrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY qa_rubrics_tenant ON qa_rubrics
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());
ALTER TABLE qa_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY qa_reviews_tenant ON qa_reviews
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());
ALTER TABLE qa_calibrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY qa_calibrations_tenant ON qa_calibrations
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());
ALTER TABLE qa_calibration_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY qa_calibration_scores_tenant ON qa_calibration_scores
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());
ALTER TABLE qa_sampling_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY qa_sampling_runs_tenant ON qa_sampling_runs
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());

-- The default privileges (20260722090000) grant every verb. QA evidence is
-- written, scored and kept; it goes with its chat, its agent or its workspace,
-- never by the API's hand. A rubric version is never edited: a change is a
-- new version, and the old one only stops being active.
REVOKE ALL ON qa_settings, qa_rubrics, qa_reviews, qa_calibrations, qa_calibration_scores,
  qa_sampling_runs FROM siyahtus_app;
GRANT SELECT, INSERT, UPDATE ON qa_settings, qa_rubrics, qa_reviews, qa_calibrations,
  qa_calibration_scores, qa_sampling_runs TO siyahtus_app;

-- The root panel counts reviews (tm 389.19, `OPTIONAL_SOURCES.qaReviews`) and
-- shows the rubric; it never writes QA evidence.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'siyahtus_platform') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON qa_settings, qa_rubrics, qa_reviews,
      qa_calibrations, qa_calibration_scores, qa_sampling_runs FROM siyahtus_platform;
    GRANT SELECT ON qa_settings, qa_rubrics, qa_reviews, qa_calibrations,
      qa_calibration_scores, qa_sampling_runs TO siyahtus_platform;
  END IF;
END
$$;
