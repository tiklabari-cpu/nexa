-- An API-key connection for a marketplace app (FR-MOD-09.2, "Her biri OAuth/API
-- key" — the half of the acceptance criterion `provider: 'api_key'` never
-- reached, tm 202.1).
--
-- Two nullable columns, defaulting to NULL so every installation that already
-- exists (all of them OAuth) keeps behaving exactly as it did (expand-only,
-- CONVENTIONS §6.3):
--
--   * api_key_hash — SHA-256 of the key the admin pasted, the same one-way
--     treatment a personal access token gets (`lib/crypto.ts` `hashToken`).
--     Reversible storage would be the wrong trade here: the mock never calls
--     the provider back, so the key is never needed again, and a column that
--     cannot be decrypted cannot be leaked by anything downstream of it.
--   * api_key_last_four — the display hint, so an admin can tell which key is
--     stored and recognise a rotation without the key being readable.
--
-- Both or neither: an installation with a hash and no hint (or the reverse)
-- would be a row nothing could render honestly.
ALTER TABLE app_installations
  ADD COLUMN "api_key_hash" TEXT,
  ADD COLUMN "api_key_last_four" TEXT;

ALTER TABLE app_installations
  ADD CONSTRAINT app_installations_api_key_pair_check
    CHECK (("api_key_hash" IS NULL) = ("api_key_last_four" IS NULL)),
  ADD CONSTRAINT app_installations_api_key_last_four_check
    CHECK ("api_key_last_four" IS NULL OR char_length("api_key_last_four") = 4);
