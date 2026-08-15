/**
 * Append-only audit trail (NFR-S12).
 *
 * The `audit_log` table and its row level security were created in slice 12, but
 * nothing ever wrote to it — an audit log with no writer is a table, not a
 * control. This is the single writer. Every security-relevant action funnels
 * through `writeAuditEntry`, so there is one place to get the invariants right:
 *
 *   - **Append-only.** The migration grants the application role INSERT and
 *     SELECT on `audit_log` and revokes UPDATE/DELETE, so an actor who could
 *     erase the record of what they did cannot. This module never issues an
 *     UPDATE or DELETE against the table; the database enforces the rest.
 *   - **Tenant-scoped.** The row carries `license_id` and the INSERT policy is
 *     `WITH CHECK (license_id = nexa_current_license())`. `writeAuditEntry` must
 *     therefore run inside a `withTenant` transaction, and it writes the row for
 *     that tenant — an entry can never be planted in another workspace's log.
 *   - **PII-minimal.** Passwords, tokens and secrets never belong in an audit
 *     record. Callers pass identifiers (account id, object id, changed field
 *     names), and `sanitizeAuditMetadata` strips any key that looks like a
 *     credential as a second line of defence against a careless caller.
 *
 * Reading and exporting the log is out of scope here (v1) — this is only the
 * writer.
 */
import type { Prisma } from '@prisma/client';
import type { TenantClient } from '../../lib/tenant.js';

/**
 * The security-relevant actions Nexa records. Kept as a closed vocabulary so a
 * typo becomes a compile error rather than an un-queryable action string, and
 * so the set of things we audit is reviewable in one place.
 */
export const AUDIT_ACTIONS = [
  // Workspace lifecycle. The first row a workspace ever gets — recorded
  // because it is the anchor everything else in the trail, and `C4-h`'s region
  // question, are asked against.
  'workspace.created',
  // Authentication
  'auth.login',
  'auth.login_failed',
  // Federated sign-in through a SAML identity provider (NFR-S11 · S11-d).
  // Recorded separately from `auth.login` because the two answer different
  // questions after an incident: a password sign-in says the person knew a
  // secret we hold, an SSO sign-in says an *external* system vouched for them,
  // and the workspace's response to a compromise differs accordingly. The
  // failure entry carries the refusal reason — expired, wrong audience, replay,
  // signature-wrapped — which is the only place that reason is legible, since
  // the endpoint deliberately tells the caller nothing beyond "failed".
  'auth.sso_login',
  'auth.sso_login_failed',
  'auth.password_reset',
  // A bearer token (access or refresh) was revoked through `/auth/revoke`
  // (RFC 7009). No entry is written when the presented token matches nothing —
  // the endpoint answers 200 either way, so the trail only ever names a
  // credential that genuinely existed in this workspace.
  'auth.token_revoked',
  // `/auth/token` refused a grant that still resolves to a known workspace: a
  // replayed or expired authorization code, a code whose PKCE verifier does
  // not match, or a refresh token already rotated away (the signature of a
  // stolen one). An invalid client or a code/token nobody issued writes
  // nothing — there is no workspace to write it into, and doing so from
  // caller-supplied input would let an outsider plant rows in a workspace they
  // do not hold (C1).
  'auth.token_exchange_failed',
  // An authenticated request was refused at the edge because the workspace's IP
  // allow-list did not admit its source address (FR-MOD-08.9.6). Recorded so a
  // locked-out admin — or a stolen token being used from outside the office —
  // is visible in the trail; the address itself is deliberately not stored here.
  'auth.ip_denied',
  // A request for this workspace arrived at a region that does not hold it
  // (NFR-C4 · C4-b). Not `auth.*`, because nothing is wrong with the
  // credential — it is genuine, and the refusal is about *where* the door is,
  // which is a residency fact rather than an authentication one. The entry
  // carries the licence and the region that was asked for and nothing else: no
  // address, no token, no person. Naming one would mean this region writing
  // down a member of a workspace it is not allowed to hold.
  'security.region_rejected',
  // The workspace accepted the HIPAA Business Associate Agreement (NFR-C4 ·
  // C4-d). `compliance.*` rather than `settings.*`: the other settings entries
  // record a configuration somebody can change back, while this one records a
  // commitment the workspace entered into on a date — the thing an auditor
  // asks for by name, and the thing C4-e's constraints key off. Written once,
  // on the acceptance that actually set the timestamp; a repeated click is not
  // a second agreement and leaves no second line. Metadata carries the region
  // that made it permissible, which is the other half of the NFR-C4 condition.
  'compliance.baa_signed',
  // An AI feature was refused because running it would have sent a covered
  // workspace's content to a model outside its region (NFR-C4 · C4-e). The
  // entry exists because the question an auditor asks is not "is the gate
  // configured" but "did anything covered ever leave" — and a gate with no
  // trail can only answer the first. It names the two regions and the provider;
  // the content that was about to be sent is, necessarily, not in it.
  'compliance.ai_region_blocked',
  // Team membership.
  //
  // Shared with SCIM provisioning (NFR-S11 · S11-f) rather than duplicated: a
  // directory connector creating a member, deactivating one and reactivating
  // one are the same three facts an admin's invitation and suspension record,
  // and an owner asking "who was cut off from this workspace, and when" wants
  // one answer, not two vocabularies to remember to union. What differs is
  // recorded where it belongs — in the entry's own metadata (`via: 'scim'` and
  // the credential's id), not in a parallel set of action names.
  'member.invited',
  // The moment an invitation is actually redeemed and the person gains access
  // (SOC 2 CC6.1) — a different fact from `member.invited`, which only records
  // that access was offered. The invitee's email is deliberately not carried;
  // the invitation named it already.
  'member.joined',
  'member.invitation_revoked',
  'member.suspended',
  'member.unsuspended',
  // A teammate was moved between roles — the "rol değişimi" NFR-S12 names by
  // hand. Bounded by a privilege ceiling at the route (no self-change, the
  // owner is immutable, and no grant above the actor's own rank); the entry
  // records only the from/to roles, never the whole membership.
  'member.role_changed',
  // A teammate's standing weekly availability was replaced (PRD §5.3-Vardiya).
  // Recorded because an admin can rewrite *someone else's* rostered hours, and
  // those hours are what the staffing forecast — and any later "why was nobody
  // covering Tuesday" question — is answered from. The entry names the agent
  // and the shape of the week (timezone, how many days are on), never the
  // individual start/end times.
  'work_schedule.updated',
  // Workspace configuration
  'settings.security_updated',
  'settings.routing_rule_updated',
  'settings.chat_timeout_updated',
  'settings.widget_updated',
  // Sales tracking (FR-MOD-13.5). Recorded because this configuration decides
  // what the Ecommerce report claims: turning tracking on, changing the currency
  // revenue is recorded in, or widening the attribution window all move the
  // revenue figures a workspace reports. The entry names the changed fields only.
  'settings.sales_tracker_updated',
  // A sale was reported through the widget's tracking snippet (FR-MOD-13.5).
  // The only write in the platform where a *visitor's browser* states a figure
  // the workspace then reports as revenue, so who reported what, and when, has
  // to be reconstructable — a disputed Ecommerce total is otherwise unanswerable.
  // Written once per sale, never on an idempotent repeat, so the trail counts
  // orders the same way the report does. Metadata carries the amount, currency
  // and whether it was attributed; the actor is the customer token.
  'sale.tracked',
  'settings.trusted_domain_added',
  'settings.trusted_domain_removed',
  'settings.ip_allowlist_added',
  'settings.ip_allowlist_removed',
  'billing.subscription_updated',
  'billing.payment_method_updated',
  'billing.api_package_purchased',
  // Outbound webhooks (FR-MOD-08.8.4 / NFR-S7) — the platform's highest-risk
  // egress surface, and the "webhook değişimi" NFR-S12 names by hand. The entry
  // records the host and the subscription, never the full URL or the signing
  // secret the register response carries once.
  'webhook.created',
  'webhook.deleted',
  // Scheduled report exports (PRD §5.3-Reports) — the unaudited twin of
  // webhook.*: recurring, unattended egress of report data, just mailed
  // instead of posted. The recipient addresses are the one thing withheld —
  // they are the sole reason this surface is gated on `reports_manage`, and
  // copying them into the append-only log would defeat that gate for anyone
  // who can read the trail.
  'scheduled_export.created',
  'scheduled_export.updated',
  // Ticketing / HelpDesk (FR-MOD-13.6) — the lifecycle and structural changes an
  // async ticket goes through. Merge/unmerge affect data integrity across two
  // tickets, so they are recorded as much for the audit trail as for support.
  'ticket.status_changed',
  'ticket.priority_changed',
  'ticket.merged',
  'ticket.unmerged',
  'ticket.follower_added',
  'ticket.follower_removed',
  // Supervision (FR-MOD-08.6.3 / NFR-S12). A supervisor forcibly took a chat
  // from whoever held it — an authority action on someone *else's* conversation,
  // so it is recorded. The entry names the actor, the chat and the previous
  // assignee; never the transcript or any message content.
  'chat.taken_over',
  // Denying a visitor service (FR-MOD-08.9.2) — a moderation decision, not a
  // configuration change, so only the transition is recorded: repeating a ban
  // that already holds, or lifting one already lifted, leaves no second line.
  // No metadata — the customer id is the target, and their name, email, phone
  // and the moderator's free-text reason are deliberately not copied in.
  'customer.banned',
  'customer.unbanned',
  // External connections
  //
  // A marketplace integration was connected (FR-MOD-09.1) — the OAuth grant
  // that hands the app a credential to read this workspace's data. Its own
  // action rather than folding into `partner_app.*`: those record a third
  // party being handed a credential to call *Nexa*, this records Nexa being
  // handed one to call somewhere else. Disconnecting one already writes
  // `data.deleted` (`apps.ts`).
  'app.connected',
  // An inbound channel — email/SMS/WhatsApp/etc. (FR-MOD-08.5.3-.6) — was
  // wired to or unwired from an address. The address itself lives on the
  // `channels` row already; the entry names only the channel type and brand.
  'channel.connected',
  'channel.disconnected',
  // Credentials
  'pat.created',
  'pat.revoked',
  // SCIM provisioning credentials (NFR-S11 · S11-e). Its own pair rather than
  // reusing `pat.*`, because the two answer different questions for whoever
  // reads the trail: a PAT acts as one person within what that person may
  // already do, while a SCIM token manages the *membership* of the whole
  // workspace — creating, suspending and removing people. "Somebody minted a
  // credential that can provision users" is the kind of line an owner should be
  // able to find without first working out which PAT was special.
  'scim_token.created',
  'scim_token.revoked',
  // Partner apps (FR-MOD-09.4). Registering an OAuth client hands a third party
  // a credential that can later act on this workspace, and its scopes, redirect
  // allowlist and secret are the whole of what bounds it — the same class of
  // change as a webhook subscription, which NFR-S12 names by hand. Rotation
  // matters most: it invalidates a live secret instantly, so both a legitimate
  // re-key and an attacker locking the owner out of their own app look like this
  // entry. Metadata carries the client type, granted scopes and how many
  // redirect URIs there are — never a secret, and never the URIs themselves.
  'partner_app.created',
  'partner_app.updated',
  'partner_app.deleted',
  'partner_app.secret_rotated',
  // MCP tool calls (FR-MOD-08.8.3). An MCP client (Claude, ChatGPT, …) invoked a
  // tool against the workspace. Recorded because these calls read tenant data
  // through an automated agent that can chain many requests, so the trail of
  // *which* tool ran under *whose* token matters. Metadata carries only the tool
  // name and the scope that authorised it — never the arguments (a search query
  // is user content) or the result.
  'mcp.tool_called',
  // Data lifecycle — a retention sweep hard-deleted expired data (NFR-C8). The
  // record is metadata (counts), not the data itself, so it is safe to retain.
  'data.retention_pruned',
  // A targeted, single-record delete an agent chose to make (as opposed to the
  // automatic sweep above) — the "veri silme" NFR-S12 names by hand. One shared
  // action across the settings-family kinds it covers; metadata carries only
  // `kind`, never the deleted record's name, body or values.
  'data.deleted',
  // Public knowledge base (PRD §5.3, PUBKB-b). Publishing an article, or turning
  // the workspace's KB on/off, changes what an anonymous audience can see — the
  // moment content crosses from private to public — so each is recorded. The
  // entry names the article or the new switch state, never the body or the
  // public address.
  'kb.article_published',
  'kb.article_unpublished',
  'kb.settings_updated',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Mirrors the `audit_log_actor_type_check` constraint in the schema. */
export type AuditActorType = 'agent' | 'bot' | 'customer' | 'system';

/**
 * Who acted and from where. Built once per request (see `request.auditContext`)
 * and reused for every entry that request writes.
 */
export interface AuditContext {
  /** The tenant the entry belongs to. Must equal the surrounding `withTenant`. */
  licenseId: bigint;
  /** The acting account/bot/customer id, or null when the actor is unknown. */
  actorId?: string | null;
  actorType?: AuditActorType;
  /** Correlates the entry with the request log line and the `X-Request-Id`. */
  requestId?: string | null;
  ip?: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  /** The object acted on, as `<kind>:<id>` (e.g. `token:…`, `invitation:…`). */
  target?: string | null;
  /** Non-sensitive detail. Field *names*, counts, roles — never values or PII. */
  metadata?: Record<string, unknown>;
}

/**
 * Keys that must never reach the audit log even if a caller passes them by
 * mistake. Matched case-insensitively against the metadata's own keys.
 */
const FORBIDDEN_METADATA_KEY = /pass|secret|token|verifier|credential|hash|authorization|cookie/i;

/**
 * The keys whose *name* trips the rule above while their *value* is a
 * reference, not a secret.
 *
 * Both are identifiers of something the log is meant to point at, and both are
 * already stored in plain sight elsewhere — `request_id` in every log line and
 * the `X-Request-Id` header, `scim_token_id` as the primary key of an
 * `api_tokens` row whose secret half is only ever held as a digest. Naming them
 * one at a time, rather than loosening the pattern, keeps the default answer
 * "dropped": a key nobody thought about is still removed.
 *
 * `scim_token_id` earns its place because a SCIM entry has nowhere else to say
 * who acted. A provisioning connector is not a person, so `actor_id` is null and
 * `actor_type` is `system` (`plugins/audit.ts`) — and a workspace may hold
 * several live connectors at once, so without this the trail can say a member
 * was deprovisioned by "the system" and not which credential did it.
 */
const METADATA_KEY_ALLOWLIST = new Set(['request_id', 'scim_token_id']);

/**
 * Drop any metadata key that looks like a credential.
 *
 * The callers in this codebase never pass a secret; this exists so that if one
 * ever starts to — a refactor that spreads a whole request body into metadata,
 * say — the secret is removed here rather than persisted forever in an
 * append-only table nobody can scrub.
 */
export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!METADATA_KEY_ALLOWLIST.has(key) && FORBIDDEN_METADATA_KEY.test(key)) continue;
    if (value === undefined) continue;
    clean[key] = value;
  }
  return clean;
}

/**
 * Write exactly one append-only audit entry inside the caller's tenant
 * transaction.
 *
 * `tx` must come from `withTenant` (or the request's `withTenant`): the row is
 * inserted for `ctx.licenseId`, and the RLS `WITH CHECK` refuses it unless the
 * transaction's `nexa_current_license()` matches — so a mismatched context
 * fails loudly rather than writing to the wrong log.
 */
export async function writeAuditEntry(
  tx: TenantClient,
  ctx: AuditContext,
  entry: AuditEntry,
): Promise<void> {
  if (typeof ctx.licenseId !== 'bigint' || ctx.licenseId <= 0n) {
    throw new TypeError(`audit entry needs a valid tenant license id: ${String(ctx.licenseId)}`);
  }

  const metadata = sanitizeAuditMetadata({
    ...entry.metadata,
    // Recorded as metadata rather than a column: the schema has no request_id
    // field and does not change for this task. Present on every entry so a log
    // line and its audit record can be tied together after the fact.
    ...(ctx.requestId ? { request_id: ctx.requestId } : {}),
  });

  await tx.auditLogEntry.create({
    data: {
      licenseId: ctx.licenseId,
      actorId: ctx.actorId ?? null,
      actorType: ctx.actorType ?? 'agent',
      action: entry.action,
      target: entry.target ?? null,
      // Values are JSON scalars/arrays by construction; the cast bridges the
      // structural gap between `unknown` values and Prisma's `InputJsonValue`.
      metadata: metadata as Prisma.InputJsonObject,
      ip: ctx.ip ?? null,
    },
  });
}
