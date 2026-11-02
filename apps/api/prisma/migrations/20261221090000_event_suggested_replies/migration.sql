-- Event-bound suggested replies (IN-07 · tm 364), expand only.
--
--   canned_responses.suggest_on      the events a saved reply is offered as a chip
--       on: chat_started, chat_transferred, customer_idle, rated_good, rated_bad
--       (`SUGGEST_EVENTS` in @siyahtus/types). Empty (the default) = never
--       suggested, which is every reply that exists today.
--   canned_responses.suggest_order   the order among chips of one event (smaller
--       first, ties by shortcut).
--   canned_responses.category        'general' | 'promotion'. A promotion reply is
--       never suggested in a conversation whose player is kept from promotions
--       (EN-01, `isPromoSuppressed`).
--   inbox_settings.customer_idle_seconds   how long the player may stay silent
--       after the agent's last message before `customer_idle` fires. NULL = the
--       console's 180 s (`DEFAULT_CUSTOMER_IDLE_SECONDS`).
--   agent_memberships.suggestions_event_enabled   the member's own switch ("close
--       event suggestions for me"); on by default.
--
-- Safe beside the previous release (CONVENTIONS §6.3): every column is added with a
-- constant default (catalogue-only on PostgreSQL 11+, no rewrite) or NULL, and the
-- old release never reads or writes them. The CHECKs go in NOT VALID and are
-- validated in the same file: the defaults satisfy them, so VALIDATE finds nothing.
ALTER TABLE canned_responses ADD COLUMN suggest_on TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE canned_responses ADD COLUMN suggest_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE canned_responses ADD COLUMN category TEXT NOT NULL DEFAULT 'general';

ALTER TABLE canned_responses
  ADD CONSTRAINT canned_responses_suggest_on_check
  CHECK (suggest_on <@ ARRAY['chat_started','chat_transferred','customer_idle','rated_good','rated_bad']::text[])
  NOT VALID;
ALTER TABLE canned_responses
  ADD CONSTRAINT canned_responses_category_check
  CHECK (category IN ('general','promotion'))
  NOT VALID;
ALTER TABLE canned_responses
  ADD CONSTRAINT canned_responses_suggest_order_check
  CHECK (suggest_order BETWEEN 0 AND 1000)
  NOT VALID;
ALTER TABLE canned_responses VALIDATE CONSTRAINT canned_responses_suggest_on_check;
ALTER TABLE canned_responses VALIDATE CONSTRAINT canned_responses_category_check;
ALTER TABLE canned_responses VALIDATE CONSTRAINT canned_responses_suggest_order_check;

ALTER TABLE inbox_settings ADD COLUMN customer_idle_seconds INTEGER;
ALTER TABLE inbox_settings
  ADD CONSTRAINT inbox_settings_customer_idle_seconds_check
  CHECK (customer_idle_seconds IS NULL OR customer_idle_seconds BETWEEN 10 AND 86400);

ALTER TABLE agent_memberships ADD COLUMN suggestions_event_enabled BOOLEAN NOT NULL DEFAULT true;
