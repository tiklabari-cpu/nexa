-- Saved replies (IN-06 · tm 363), step 1 of 4 — expand.
--
--   canned_responses.owner_account_id   the author of a personal reply
--       (`visibility = 'private'`); NULL on every shared reply. A personal reply
--       goes with its author's account (ON DELETE CASCADE): nobody else can see
--       it, so nobody else could use, fix or delete it either.
--   canned_responses_visibility_check   gains the third legal state: `private`
--       carries an owner and no team; the two shared states carry no owner.
--   canned_response_settings   one row per licence: `fallback_text`, what the
--       composer inserts for a variable it has no value for. No row, or NULL,
--       reads as the console's own default.
--
-- Safe beside the previous release (CONVENTIONS §6.3): it only ever writes
-- ('all', NULL) or ('group', <team>) with no owner, both still legal; the new
-- column is nullable with no default. The shortcut uniqueness moves to two
-- partial indexes in steps 2–3 and the old index is dropped in step 4.
ALTER TABLE canned_responses ADD COLUMN owner_account_id UUID;
ALTER TABLE canned_responses
  ADD CONSTRAINT canned_responses_owner_account_id_fkey
  FOREIGN KEY (owner_account_id) REFERENCES accounts(id) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE canned_responses DROP CONSTRAINT canned_responses_visibility_check;
ALTER TABLE canned_responses
  ADD CONSTRAINT canned_responses_visibility_check
    CHECK (
      (visibility = 'all' AND group_id IS NULL AND owner_account_id IS NULL)
      OR (visibility = 'group' AND group_id IS NOT NULL AND owner_account_id IS NULL)
      OR (visibility = 'private' AND group_id IS NULL AND owner_account_id IS NOT NULL)
    );

CREATE TABLE "canned_response_settings" (
    "license_id"    BIGINT         NOT NULL,
    "fallback_text" TEXT,
    "updated_by"    UUID,
    "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canned_response_settings_pkey" PRIMARY KEY ("license_id"),
    CONSTRAINT "canned_response_settings_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `CANNED_FALLBACK_MAX` in the route; a blank phrase would insert nothing.
    CONSTRAINT canned_response_settings_fallback_text_check
      CHECK (fallback_text IS NULL OR char_length(btrim(fallback_text)) BETWEEN 1 AND 100)
);

ALTER TABLE canned_response_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY canned_response_settings_tenant ON canned_response_settings
  USING (license_id = siyahtus_current_license()) WITH CHECK (license_id = siyahtus_current_license());
