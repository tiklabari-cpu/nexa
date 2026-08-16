-- Push delivery targets, and the preferences that decide whether to use them
-- (FR-MOD-13.7 · 13.7-c, FR-MOD-13.8).
--
-- Two changes, one question. The question is "does this event reach this
-- person, and through what?", and until now the product could only answer half
-- of it on the server: `agent_memberships.notify_email` was the only preference
-- it held, while sound, desktop and the tab badge lived in one `localStorage`
-- key per browser. That split was defensible while every preference it hid
-- governed something also per-browser — a speaker, an OS permission. Push
-- breaks it: the *server* chooses the delivery target, so a preference the
-- server cannot read is a preference that does not apply to the one channel
-- that reaches somebody who has closed their laptop.
--
--   * agent_memberships gains notify_enabled / notify_sound / notify_desktop /
--     notify_push — the browser's three, plus push. Per user *and* per license,
--     like notify_email beside them, so the same person can stay reachable for
--     one workspace and go quiet for another (FR-MOD-08.2).
--   * device_tokens — one row per handset that has asked to receive a member's
--     notifications. Registration and revocation are this slice; sending is
--     13.7-d, and no code reads this table yet.
--
-- The structural statements are exactly what `prisma migrate diff` emits for the
-- schema change (minus the unrelated pgvector index it always reports — see
-- check-drift.ts). The CHECK constraints, the RLS policies and the GRANT are
-- invisible to Prisma and are added here by hand, the same way every other
-- tenant table does.

-- AlterTable
ALTER TABLE "agent_memberships" ADD COLUMN     "notify_desktop" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_push" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notify_sound" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL,
    "license_id" BIGINT NOT NULL,
    "account_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "device_tokens_license_id_account_id_revoked_at_idx" ON "device_tokens"("license_id", "account_id", "revoked_at");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_license_id_token_key" ON "device_tokens"("license_id", "token");

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_license_id_account_id_fkey" FOREIGN KEY ("license_id", "account_id") REFERENCES "agent_memberships"("license_id", "agent_id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE device_tokens IS
  'Handsets registered to receive a member''s push notifications (FR-MOD-13.7). token is a delivery address held in plain text on purpose — see the column comment — and is never returned, logged or audited.';
COMMENT ON COLUMN device_tokens.token IS
  'APNs/FCM delivery address. NOT hashed, unlike api_tokens.token_hash: nobody ever presents this value for comparison, the server hands the literal bytes to the push provider, so a digest would make the column useless for its only purpose (PLAN §C · 13.7-c).';

-- The composite foreign key above is the tenant guard, not decoration. A device
-- belongs to a *person in a workspace*, so pointing at an account alone would
-- leave a live delivery target behind when a membership is removed — a phone
-- still buzzing for a workspace its owner no longer works for. The cascade is
-- what makes "took them off the team" also mean "their phone stops".
--
-- The unique index is what makes registration idempotent. An app re-registers on
-- every launch; without it a handset opened daily would accumulate a row per
-- launch and be sent the same message once per row. It is scoped to the license
-- rather than global on purpose: a globally unique token would answer "is this
-- device registered to some other workspace?" — with a constraint violation, to
-- a caller with no right to that answer.

-- ---------------------------------------------------------------------------
-- What a device may be
-- ---------------------------------------------------------------------------
-- Mirrors DEVICE_PLATFORMS in @nexa/types. A row naming a platform no sender
-- knows how to reach is a delivery that silently never happens, and the person
-- it was meant for cannot tell that from "nothing was sent" — the same
-- reasoning as sla_breaches_target_check.
ALTER TABLE device_tokens
  ADD CONSTRAINT device_tokens_platform_check CHECK (platform IN ('ios', 'android'));

-- An empty token is not a device. It would pass every type check, occupy the
-- unique slot for the workspace's "" token, and address nothing.
-- The ceiling matches DEVICE_TOKEN_MAX_LENGTH in @nexa/types: a generous bound
-- whose job is refusing a payload posted into a credential field, not policing
-- a vendor's current token length.
ALTER TABLE device_tokens
  ADD CONSTRAINT device_tokens_token_check
    CHECK (length(token) BETWEEN 1 AND 512);

-- A device cannot have been last seen before it was registered, nor revoked
-- before it existed. Both would only arise from a caller writing a timestamp by
-- hand, and both would corrupt the two questions this table is asked: "which
-- handsets are live?" and "when did this one stop?".
ALTER TABLE device_tokens
  ADD CONSTRAINT device_tokens_last_seen_check CHECK (last_seen_at >= created_at);
ALTER TABLE device_tokens
  ADD CONSTRAINT device_tokens_revoked_check
    CHECK (revoked_at IS NULL OR revoked_at >= created_at);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- The plain licence match every other tenant table uses, and it is doing more
-- work here than usual. What sits in this table is the address of a physical
-- phone in somebody's pocket: a cross-tenant SELECT would hand one workspace a
-- list of another's staff devices, and a cross-tenant INSERT would point a
-- neighbour's handset at this workspace's conversations. The WITH CHECK half is
-- what makes the second impossible rather than merely unlikely.
ALTER TABLE device_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_tokens_tenant ON device_tokens
  USING (license_id = nexa_current_license()) WITH CHECK (license_id = nexa_current_license());

-- The API connects as nexa_app and reaches the table only through that policy.
-- Granted explicitly: the schema-wide GRANT in 20260722154008 covered only the
-- tables that existed then.
--
-- DELETE is included, unlike sla_breaches. A device token is not evidence of
-- anything a workspace might want to destroy — it is a live capability, and the
-- ability to remove one outright (rather than only mark it revoked) is what
-- makes NFR-C8's erasure of a departed colleague's data complete. Revocation
-- itself is still an UPDATE, so the ordinary path keeps the row.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens TO nexa_app;
