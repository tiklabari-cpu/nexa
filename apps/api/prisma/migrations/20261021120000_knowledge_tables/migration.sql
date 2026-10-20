-- Structured knowledge tables and the access information setting (tm 310.1 ·
-- SiyahTuş analysis AI-13, owner decision K13; ADR-14b §2.12 ·
-- `@siyahtus/types` `knowledge-tables.ts`).
--
--   * kb_payment_methods — what "my deposit has not arrived" is judged against:
--                          direction, limits, the expected time and the delay
--                          threshold, working hours, the reference a transfer
--                          carries, the usual errors.
--   * kb_bonuses         — a bonus's terms: wagering, contribution by game
--                          category, limits, how it is claimed, its campaign
--                          window.
--   * kb_kyc_documents   — a document the workspace asks for: what it accepts,
--                          when, how long a review takes, where it is uploaded.
--   * kb_rules           — one keyed limit or rule, as text and/or a number.
--   * ai_access_info     — K13: what the AI says when a player cannot reach the
--                          site — a knowledge source, a URL fetched when asked
--                          (cached, the last value when a fetch fails) or a
--                          fixed link. One row for every brand (`brand_id`
--                          NULL), at most one per brand.
--
-- Editing tables (ADR-14b §2.1, §2.12): no publish state — `kb_payment_methods.
-- active` is "on in this version" — every write goes through
-- `services/ai/config-draft.ts`, and tm 316 copies the rows into the AI
-- configuration package. They never take the fast path: a change always waits
-- for approval. `owner_id`, `reviewed_at` and `review_interval_days` are meta
-- fields (ADR-14b §2.2); a row is due a review `review_interval_days` after
-- `reviewed_at` (payment methods 14, bonuses 30 and at `active_to`, KYC and
-- rules 90 — AI-13-S2), warned about and still used.
--
-- Brands. The four tables carry `brand_ids` — the brands a row is for, empty
-- for every brand — like `knowledge_sources`: a row may be several brands', so
-- the brand filter is the reader's, never the policy's, and RLS is per licence
-- (`brand-isolation.test.ts`, BRAND_LIST_TABLES). An array holds no foreign
-- key; the ids are checked when written. `ai_access_info.brand_id` is one
-- brand: brand-scoped like `handoff_routes`, with a real foreign key guarded by
-- a trigger, because a foreign key is checked past RLS.
--
-- Uniqueness of a name, an alias, a document or a key holds within a direction
-- (payment methods) and an overlapping brand scope — two every-brand rows, or
-- two brand rows sharing a brand — while a brand's own row may repeat the
-- every-brand row's name: that is how it overrides it. No index expresses
-- that; `findKnowledgeTableConflicts` does, and the writer runs it.
--
-- Expand only (CONVENTIONS §6.3): five new tables nothing reads yet. Lengths by
-- byte, four per character: the development database is SQL_ASCII (the
-- 20261019210000 note). The structural statements are what `prisma migrate
-- diff` emits for the schema change, `NOT NULL` added on the arrays (the
-- `knowledge_sources` precedent); the CHECKs, the partial unique indexes, the
-- trigger, RLS and the GRANTs are invisible to Prisma and added by hand, and
-- `knowledge-tables-schema.test.ts` reads them back against `@siyahtus/types`.

-- CreateTable
CREATE TABLE "kb_payment_methods" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "brand_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "name" TEXT NOT NULL,
    "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "direction" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TRY',
    "min_amount" DECIMAL(18,2),
    "max_amount" DECIMAL(18,2),
    "expected_minutes" INTEGER,
    "delay_threshold_minutes" INTEGER,
    "working_hours" JSONB,
    "requires_site_request" BOOLEAN NOT NULL DEFAULT false,
    "reference_instructions" TEXT,
    "reference_format" TEXT NOT NULL DEFAULT 'none',
    "receipt_required" BOOLEAN NOT NULL DEFAULT false,
    "third_party_allowed" BOOLEAN NOT NULL DEFAULT false,
    "networks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "common_errors" JSONB NOT NULL DEFAULT '[]',
    "customer_notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "owner_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "review_interval_days" INTEGER NOT NULL DEFAULT 14,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_bonuses" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "brand_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "name" TEXT NOT NULL,
    "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "type" TEXT NOT NULL DEFAULT 'other',
    "min_deposit" DECIMAL(18,2),
    "wagering_multiplier" DECIMAL(8,2),
    "wagering_base" TEXT,
    "contributing" JSONB NOT NULL DEFAULT '[]',
    "min_odds" DECIMAL(8,2),
    "max_bet" DECIMAL(18,2),
    "max_cashout" DECIMAL(18,2),
    "validity_days" INTEGER,
    "claim_method" TEXT NOT NULL DEFAULT 'auto',
    "promo_code" TEXT,
    "excluded_method_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "active_from" TIMESTAMPTZ(6),
    "active_to" TIMESTAMPTZ(6),
    "terms_text" TEXT,
    "owner_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "review_interval_days" INTEGER NOT NULL DEFAULT 30,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_bonuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_kyc_documents" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "brand_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "doc_type" TEXT NOT NULL,
    "acceptance_criteria" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "when_required" TEXT,
    "review_hours" INTEGER,
    "upload_path_text" TEXT,
    "chat_upload_allowed" BOOLEAN NOT NULL DEFAULT false,
    "owner_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "review_interval_days" INTEGER NOT NULL DEFAULT 90,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_rules" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "brand_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "title" TEXT NOT NULL,
    "value_text" TEXT,
    "numeric_value" DECIMAL(20,4),
    "unit" TEXT,
    "description" TEXT,
    "owner_id" UUID,
    "reviewed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "review_interval_days" INTEGER NOT NULL DEFAULT 90,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_access_info" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "brand_id" UUID,
    "source_type" TEXT NOT NULL,
    "kb_source_id" UUID,
    "url" TEXT,
    "cache_seconds" INTEGER NOT NULL DEFAULT 300,
    "last_value" TEXT,
    "last_fetched_at" TIMESTAMPTZ(6),
    "fixed_text" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_access_info_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kb_payment_methods_license_id_direction_idx" ON "kb_payment_methods"("license_id", "direction");

-- CreateIndex
CREATE INDEX "kb_bonuses_license_id_idx" ON "kb_bonuses"("license_id");

-- CreateIndex
CREATE INDEX "kb_kyc_documents_license_id_idx" ON "kb_kyc_documents"("license_id");

-- CreateIndex
CREATE INDEX "kb_rules_license_id_category_idx" ON "kb_rules"("license_id", "category");

-- CreateIndex
CREATE INDEX "ai_access_info_license_id_idx" ON "ai_access_info"("license_id");

-- AddForeignKey
ALTER TABLE "kb_payment_methods" ADD CONSTRAINT "kb_payment_methods_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_bonuses" ADD CONSTRAINT "kb_bonuses_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_kyc_documents" ADD CONSTRAINT "kb_kyc_documents_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_rules" ADD CONSTRAINT "kb_rules_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_access_info" ADD CONSTRAINT "ai_access_info_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_access_info" ADD CONSTRAINT "ai_access_info_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------------------------
-- What the four tables share
-- --------------------------------------------------------------------------
-- `KNOWLEDGE_TABLE_ROW_SOURCES`; `KNOWLEDGE_REVIEW_INTERVAL_DAYS` bounds; a
-- brand list of at most `KNOWLEDGE_SCOPE_IDS_MAX` ids, never a NULL (so "for
-- this brand" is a plain `= ANY`).
ALTER TABLE kb_payment_methods ADD CONSTRAINT kb_payment_methods_meta_check CHECK (
  source IN ('manual', 'integration')
  AND review_interval_days BETWEEN 1 AND 365
  AND cardinality(brand_ids) <= 100 AND array_position(brand_ids, NULL) IS NULL
);
ALTER TABLE kb_bonuses ADD CONSTRAINT kb_bonuses_meta_check CHECK (
  source IN ('manual', 'integration')
  AND review_interval_days BETWEEN 1 AND 365
  AND cardinality(brand_ids) <= 100 AND array_position(brand_ids, NULL) IS NULL
);
ALTER TABLE kb_kyc_documents ADD CONSTRAINT kb_kyc_documents_meta_check CHECK (
  source IN ('manual', 'integration')
  AND review_interval_days BETWEEN 1 AND 365
  AND cardinality(brand_ids) <= 100 AND array_position(brand_ids, NULL) IS NULL
);
ALTER TABLE kb_rules ADD CONSTRAINT kb_rules_meta_check CHECK (
  source IN ('manual', 'integration')
  AND review_interval_days BETWEEN 1 AND 365
  AND cardinality(brand_ids) <= 100 AND array_position(brand_ids, NULL) IS NULL
);

-- --------------------------------------------------------------------------
-- Payment methods
-- --------------------------------------------------------------------------
-- A name of at most 80 characters; at most 20 aliases; `PAYMENT_DIRECTIONS`;
-- ISO 4217; `PAYMENT_REFERENCE_FORMATS`; at most 10 networks and 20 usual
-- errors; the notes' lengths.
ALTER TABLE kb_payment_methods ADD CONSTRAINT kb_payment_methods_fields_check CHECK (
  btrim(name) <> '' AND octet_length(name) <= 320
  AND cardinality(aliases) <= 20 AND array_position(aliases, NULL) IS NULL
  AND direction IN ('deposit', 'withdrawal')
  AND currency ~ '^[A-Z]{3}$'
  AND reference_format IN
    ('none', 'username', 'digits', 'alphanumeric', 'txid_trc20', 'txid_evm', 'phone', 'email')
  AND (reference_instructions IS NULL OR octet_length(reference_instructions) <= 4000)
  AND cardinality(networks) <= 10 AND array_position(networks, NULL) IS NULL
  AND jsonb_typeof(common_errors) = 'array' AND jsonb_array_length(common_errors) <= 20
  AND (customer_notes IS NULL OR octet_length(customer_notes) <= 8000)
  AND (working_hours IS NULL OR jsonb_typeof(working_hours) = 'object')
);

-- AI-13 §6: the minimum never above the maximum, the delay threshold never
-- below the expected time; amounts not negative, times within 30 days.
ALTER TABLE kb_payment_methods ADD CONSTRAINT kb_payment_methods_limits_check CHECK (
  (min_amount IS NULL OR min_amount >= 0)
  AND (max_amount IS NULL OR max_amount >= 0)
  AND (min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount)
  AND (expected_minutes IS NULL OR expected_minutes BETWEEN 0 AND 43200)
  AND (delay_threshold_minutes IS NULL OR delay_threshold_minutes BETWEEN 0 AND 43200)
  AND (expected_minutes IS NULL OR delay_threshold_minutes IS NULL
       OR delay_threshold_minutes >= expected_minutes)
);

-- --------------------------------------------------------------------------
-- Bonuses
-- --------------------------------------------------------------------------
-- `BONUS_TYPES`, `BONUS_WAGERING_BASES` (a base only with a multiplier, and
-- the other way round), `BONUS_CLAIM_METHODS` (`code` names its code), the
-- campaign window in order, the limits positive.
ALTER TABLE kb_bonuses ADD CONSTRAINT kb_bonuses_fields_check CHECK (
  btrim(name) <> '' AND octet_length(name) <= 320
  AND cardinality(aliases) <= 20 AND array_position(aliases, NULL) IS NULL
  AND type IN ('welcome', 'deposit', 'reload', 'cashback', 'free_spins', 'free_bet',
               'loss_bonus', 'loyalty', 'other')
  AND jsonb_typeof(contributing) = 'array' AND jsonb_array_length(contributing) <= 20
  AND cardinality(excluded_method_ids) <= 50 AND array_position(excluded_method_ids, NULL) IS NULL
  AND (terms_text IS NULL OR octet_length(terms_text) <= 40000)
);

ALTER TABLE kb_bonuses ADD CONSTRAINT kb_bonuses_terms_check CHECK (
  (min_deposit IS NULL OR min_deposit >= 0)
  AND (wagering_multiplier IS NULL OR wagering_multiplier BETWEEN 0.01 AND 1000)
  AND (wagering_base IS NULL OR wagering_base IN ('bonus', 'bonus_plus_deposit'))
  AND ((wagering_multiplier IS NULL) = (wagering_base IS NULL))
  AND (min_odds IS NULL OR min_odds >= 1)
  AND (max_bet IS NULL OR max_bet > 0)
  AND (max_cashout IS NULL OR max_cashout > 0)
  AND (validity_days IS NULL OR validity_days BETWEEN 1 AND 3650)
  AND claim_method IN ('auto', 'live_support', 'code')
  AND (promo_code IS NULL OR promo_code ~ '^[A-Za-z0-9_-]{1,40}$')
  AND (claim_method <> 'code' OR promo_code IS NOT NULL)
  AND (active_from IS NULL OR active_to IS NULL OR active_from <= active_to)
);

-- --------------------------------------------------------------------------
-- KYC documents
-- --------------------------------------------------------------------------
ALTER TABLE kb_kyc_documents ADD CONSTRAINT kb_kyc_documents_fields_check CHECK (
  btrim(doc_type) <> '' AND octet_length(doc_type) <= 320
  AND cardinality(acceptance_criteria) <= 20
  AND array_position(acceptance_criteria, NULL) IS NULL
  AND (when_required IS NULL OR octet_length(when_required) <= 4000)
  AND (review_hours IS NULL OR review_hours BETWEEN 0 AND 720)
  AND (upload_path_text IS NULL OR octet_length(upload_path_text) <= 4000)
);

-- --------------------------------------------------------------------------
-- Limits and rules
-- --------------------------------------------------------------------------
-- `KB_RULE_KEY_PATTERN`, `KB_RULE_CATEGORIES`; a rule says something — text,
-- a number, or both.
ALTER TABLE kb_rules ADD CONSTRAINT kb_rules_fields_check CHECK (
  key ~ '^[a-z][a-z0-9_]{0,62}$'
  AND category IN ('limits', 'account', 'betting', 'withdrawal', 'other')
  AND btrim(title) <> '' AND octet_length(title) <= 480
  AND (value_text IS NULL OR octet_length(value_text) <= 8000)
  AND (unit IS NULL OR (btrim(unit) <> '' AND octet_length(unit) <= 80))
  AND (description IS NULL OR octet_length(description) <= 8000)
  AND (value_text IS NOT NULL OR numeric_value IS NOT NULL)
);

-- --------------------------------------------------------------------------
-- Access information (K13)
-- --------------------------------------------------------------------------
-- `AI_ACCESS_INFO_SOURCE_TYPES`, each with what it needs: a knowledge source,
-- or an http(s) URL. The cache window's bounds; a last value only with the
-- moment it was fetched.
ALTER TABLE ai_access_info ADD CONSTRAINT ai_access_info_source_check CHECK (
  CASE source_type
    WHEN 'kb_row' THEN kb_source_id IS NOT NULL
    WHEN 'dynamic_url' THEN url IS NOT NULL
    WHEN 'fixed_link' THEN url IS NOT NULL
    ELSE false
  END
  AND (url IS NULL OR (url ~ '^https?://[^\s]+$' AND octet_length(url) <= 2048))
  AND cache_seconds BETWEEN 30 AND 86400
  AND (last_value IS NULL OR octet_length(last_value) <= 8000)
  AND ((last_value IS NULL) = (last_fetched_at IS NULL))
  AND (fixed_text IS NULL OR (btrim(fixed_text) <> '' AND octet_length(fixed_text) <= 4000))
);

-- One row for every brand, and one per brand (`brand_id` NULL is not equal to
-- itself in a plain unique index).
CREATE UNIQUE INDEX "ai_access_info_every_brand_key" ON "ai_access_info"("license_id")
  WHERE brand_id IS NULL;
CREATE UNIQUE INDEX "ai_access_info_brand_key" ON "ai_access_info"("license_id", "brand_id")
  WHERE brand_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- Row-level security
-- --------------------------------------------------------------------------
-- The four tables per licence: the brand list is the reader's filter.
ALTER TABLE kb_payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY kb_payment_methods_tenant ON kb_payment_methods
  USING (license_id = siyahtus_current_license())
  WITH CHECK (license_id = siyahtus_current_license());

ALTER TABLE kb_bonuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY kb_bonuses_tenant ON kb_bonuses
  USING (license_id = siyahtus_current_license())
  WITH CHECK (license_id = siyahtus_current_license());

ALTER TABLE kb_kyc_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY kb_kyc_documents_tenant ON kb_kyc_documents
  USING (license_id = siyahtus_current_license())
  WITH CHECK (license_id = siyahtus_current_license());

ALTER TABLE kb_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY kb_rules_tenant ON kb_rules
  USING (license_id = siyahtus_current_license())
  WITH CHECK (license_id = siyahtus_current_license());

-- Access information brand-scoped like `handoff_routes`: no brand context is
-- every brand of the licence; a set one narrows to that brand's row and the
-- every-brand row, which applies to it too.
ALTER TABLE ai_access_info ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_access_info_tenant ON ai_access_info
  USING (
    license_id = siyahtus_current_license()
    AND (siyahtus_current_brand() IS NULL OR brand_id IS NULL OR brand_id = siyahtus_current_brand())
  )
  WITH CHECK (
    license_id = siyahtus_current_license()
    AND (siyahtus_current_brand() IS NULL OR brand_id IS NULL OR brand_id = siyahtus_current_brand())
  );

-- A foreign key is checked as the table owner, past RLS: on its own it would
-- let one workspace write access information, under its own licence, for
-- another workspace's brand id (the `handoff_routes` pattern, 20261020180000).
CREATE FUNCTION ai_access_info_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.brand_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM brands b
     WHERE b.id = NEW.brand_id
       AND b.license_id = NEW.license_id
  ) THEN
    RAISE EXCEPTION 'ai_access_info: brand % is not this workspace''s', NEW.brand_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ai_access_info_before_write
  BEFORE INSERT OR UPDATE OF brand_id, license_id ON ai_access_info
  FOR EACH ROW
  EXECUTE FUNCTION ai_access_info_before_write();

-- The default privileges (20260722090000) grant all four; a workspace never
-- empties these tables wholesale.
REVOKE TRUNCATE ON kb_payment_methods, kb_bonuses, kb_kyc_documents, kb_rules, ai_access_info
  FROM siyahtus_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON kb_payment_methods, kb_bonuses, kb_kyc_documents, kb_rules, ai_access_info
  TO siyahtus_app;
