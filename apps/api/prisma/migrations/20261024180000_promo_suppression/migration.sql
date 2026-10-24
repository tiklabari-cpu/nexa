-- Promotions and a flagged player (tm 350 · SiyahTuş analysis EN-01 ·
-- `@siyahtus/types` `isPromoSuppressed`): a player a risk flag keeps from
-- promotions is shown no campaign, and the card says how many were not.
--
-- No second flag table: EN-01's `customer_risk_flags` is `risk_flags`
-- (tm 302.1), whose every row carries the player (`customer_id`).
--
-- `campaign_sends.suppressed_at` / `suppressed_reason`: a send the campaign
-- engine held back because of a flag — at the fire (the visitor was flagged
-- already), at the raise (the flag landed on a send still owed) or at the
-- poll (the last gate). The reason is the flag type that did it. A suppressed
-- send is never delivered later, even once the flag is cleared: the unique
-- (campaign, customer) pair keeps it the only send of its campaign to that
-- player (EN-01 "Kalıcılık"). Both or neither, by CHECK.
--
-- `risk_flag_settings.promo_block_fraud` / `promo_block_complaint`: the
-- workspace's half of the rule (EN-01 karar 2) — suspected fraud keeps a
-- player from promotions unless switched off, a formal complaint does not
-- unless switched on. Responsible gaming's four are locked and have no column.
--
-- Expand only (CONVENTIONS §6.3): nullable columns and columns with defaults
-- the previous release neither reads nor writes. No new index — the poll's
-- read stays on `campaign_sends_pending_by_customer_idx` (`delivered_at IS
-- NULL`) and filters the rare suppressed row on top.

ALTER TABLE "campaign_sends"
  ADD COLUMN "suppressed_at"     TIMESTAMPTZ(6),
  ADD COLUMN "suppressed_reason" TEXT;

ALTER TABLE "campaign_sends"
  ADD CONSTRAINT campaign_sends_suppressed_pair_check
    CHECK ((suppressed_at IS NULL) = (suppressed_reason IS NULL)),
  -- `RISK_FLAG_TYPES`.
  ADD CONSTRAINT campaign_sends_suppressed_reason_check
    CHECK (suppressed_reason IS NULL OR suppressed_reason IN (
      'rg_signal', 'self_exclusion_request', 'underage_suspected', 'self_harm',
      'complaint_formal', 'fraud_suspected', 'account_takeover_suspected',
      'multi_account', 'abusive', 'account_security'
    ));

ALTER TABLE "risk_flag_settings"
  ADD COLUMN "promo_block_fraud"     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "promo_block_complaint" BOOLEAN NOT NULL DEFAULT false;
