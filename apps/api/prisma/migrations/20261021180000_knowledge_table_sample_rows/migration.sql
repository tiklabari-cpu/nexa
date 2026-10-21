-- The "örnek — doğrulayın" rows of the structured knowledge tables (tm 311.3 ·
-- SiyahTuş analysis AI-15-S1, AI-13).
--
-- The `igaming_core` pack writes example rows — Papara, bank transfer, a
-- welcome bonus, the KYC documents — so a fresh workspace sees the shape of a
-- filled table. They are examples, never facts: a third `source`, `sample`,
-- keeps them out of what the AI reads (`readFactTables`) and out of its
-- knowledge passages (`row-knowledge.ts`) until a person edits the row or
-- presses "Gözden geçirdim", which makes it `manual`.
--
-- Expand-only (CONVENTIONS §6.3): each table's meta CHECK takes one more
-- value. The previous release writes only `manual` / `integration`, and reads a
-- `sample` row as any hand-written one.

ALTER TABLE kb_payment_methods DROP CONSTRAINT kb_payment_methods_meta_check;
ALTER TABLE kb_payment_methods ADD CONSTRAINT kb_payment_methods_meta_check CHECK (
  source IN ('manual', 'integration', 'sample')
  AND review_interval_days BETWEEN 1 AND 365
  AND cardinality(brand_ids) <= 100 AND array_position(brand_ids, NULL) IS NULL
);

ALTER TABLE kb_bonuses DROP CONSTRAINT kb_bonuses_meta_check;
ALTER TABLE kb_bonuses ADD CONSTRAINT kb_bonuses_meta_check CHECK (
  source IN ('manual', 'integration', 'sample')
  AND review_interval_days BETWEEN 1 AND 365
  AND cardinality(brand_ids) <= 100 AND array_position(brand_ids, NULL) IS NULL
);

ALTER TABLE kb_kyc_documents DROP CONSTRAINT kb_kyc_documents_meta_check;
ALTER TABLE kb_kyc_documents ADD CONSTRAINT kb_kyc_documents_meta_check CHECK (
  source IN ('manual', 'integration', 'sample')
  AND review_interval_days BETWEEN 1 AND 365
  AND cardinality(brand_ids) <= 100 AND array_position(brand_ids, NULL) IS NULL
);

ALTER TABLE kb_rules DROP CONSTRAINT kb_rules_meta_check;
ALTER TABLE kb_rules ADD CONSTRAINT kb_rules_meta_check CHECK (
  source IN ('manual', 'integration', 'sample')
  AND review_interval_days BETWEEN 1 AND 365
  AND cardinality(brand_ids) <= 100 AND array_position(brand_ids, NULL) IS NULL
);
