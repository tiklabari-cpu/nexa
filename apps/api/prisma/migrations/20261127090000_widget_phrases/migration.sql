-- A brand's own widget texts, per language (tm 344 · SiyahTuş analysis WG-05).
--
-- The widget's offline notice, queue line, message box placeholder and the
-- rest of `WIDGET_PHRASE_KEYS` (`@siyahtus/types`) are written into its code
-- in eight languages. A brand may now say them in its own voice: one row per
-- (brand, language, key) it rewrote. No row means the widget's own text, so a
-- brand that never opens the editor is exactly as before.
--
-- The key list is closed, but in the application, not here: a key added to the
-- list later must not need a migration. What the database holds is the shape:
-- one of the eight widget languages (K25: no Russian or Azerbaijani widget),
-- and a non-empty text no longer than the longest limit any key has.
--
-- Isolation is `widget_settings`' own (20260802130000_brand_scoped_settings):
-- the licence, and the brand when the request names one — a second brand's
-- wording must not reach the first brand's widget or editor.
--
-- Expand-only (CONVENTIONS 6.3): a new table nothing earlier reads or writes.

CREATE TABLE "widget_phrases" (
    "license_id" BIGINT         NOT NULL,
    "brand_id"   UUID           NOT NULL,
    "locale"     TEXT           NOT NULL,
    "key"        TEXT           NOT NULL,
    "text"       TEXT           NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "widget_phrases_pkey" PRIMARY KEY ("license_id", "brand_id", "locale", "key"),
    CONSTRAINT "widget_phrases_license_id_fkey"
      FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "widget_phrases_brand_id_fkey"
      FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    -- `WIDGET_UI_LOCALES` (`@siyahtus/types`).
    CONSTRAINT widget_phrases_locale_check
      CHECK (locale IN ('en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'ar')),
    CONSTRAINT widget_phrases_key_check CHECK (key ~ '^[a-zA-Z.]{1,64}$'),
    -- The longest `WIDGET_PHRASE_RULES` limit; each key's own is the endpoint's.
    CONSTRAINT widget_phrases_text_length CHECK (char_length(text) BETWEEN 1 AND 300)
);

-- The brand's cascade finds its rows (the primary key leads with the licence).
CREATE INDEX "widget_phrases_brand_id_idx" ON "widget_phrases"("brand_id");

ALTER TABLE widget_phrases ENABLE ROW LEVEL SECURITY;
CREATE POLICY widget_phrases_tenant ON widget_phrases
  USING (
    license_id = siyahtus_current_license()
    AND (siyahtus_current_brand() IS NULL OR brand_id = siyahtus_current_brand())
  )
  WITH CHECK (
    license_id = siyahtus_current_license()
    AND (siyahtus_current_brand() IS NULL OR brand_id = siyahtus_current_brand())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON widget_phrases TO siyahtus_app;
