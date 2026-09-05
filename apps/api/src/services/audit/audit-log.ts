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
 *   - **Chained** (NFR-C6 · C6-c). Every entry takes the next position in its
 *     workspace's chain and carries an HMAC over its own content and the entry
 *     before it, so a later deletion leaves a hole in the numbering and a later
 *     edit breaks the link. See `audit-chain.ts` for why that is an HMAC rather
 *     than a digest, and why the key is not in the database.
 *
 * Reading and exporting the log is out of scope here (v1) — this is only the
 * writer.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { TenantClient } from '../../lib/tenant.js';
import { chainRowHash, deriveChainKey } from './audit-chain.js';

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
  // A directory connector asked to provision an address whose domain this
  // workspace's identity provider has not been declared authoritative for
  // (NFR-S11 · PLAN §D116). `security.*` for the same reason the line above is:
  // the credential is genuine and the request is well-formed — what is refused
  // is the *claim*, that this workspace speaks for that domain. The SAML half
  // of the same rule is recorded as `auth.sso_login_failed` with reason
  // `email_domain_unverified`, because there it really is a sign-in being
  // turned away and an admin reading the sign-in failures should find it there.
  // Metadata carries the domain — the thing an admin has to add to fix it — and
  // deliberately not the address: this table is append-only, and the address
  // belongs to somebody who is not a member of this workspace.
  'security.provisioning_domain_rejected',
  // Two-factor authentication on somebody's own account (NFR-S11 ·
  // FR-MOD-00.1 · S11-2FA-d). `security.*` rather than `auth.*`: nothing is
  // being signed in to here — these record changes to *which credentials the
  // account has*, which is the question asked after a compromise ("when did the
  // second factor go away, and from what session"), not the question the
  // sign-in entries answer.
  //
  // Enrollment is recorded as well as activation, even though an unactivated
  // enrollment protects nothing. It is the entry that dates the moment a secret
  // was handed out, so a factor that appears from nowhere has a beginning; and
  // a run of enrollments with no activation is the shape of somebody probing an
  // account they hold a stolen session to.
  //
  // No entry carries a secret, a code or a hash — the metadata is a count at
  // most. An audit log is read by people who are not its subject, and is
  // designed never to be deleted.
  'security.two_factor_enrollment_started',
  'security.two_factor_enabled',
  'security.two_factor_disabled',
  // A fresh recovery sheet invalidates the previous one whole, so this entry is
  // the record that ten working second factors stopped working and ten others
  // started. Worth its own line rather than folding into `..._enabled`: it is
  // the one of these that happens repeatedly on an account that is already
  // protected.
  'security.two_factor_recovery_codes_regenerated',
  // The three the *sign-in* gate writes (S11-2FA-e). `security.*` like the rest
  // of the family rather than `auth.*`, even though these happen at the door:
  // what an incident review asks of them is "what happened to this account's
  // second factor", and splitting the challenge across two prefixes would mean
  // asking that question twice.
  //
  // A wrong code, and only a wrong code. A sign-in that arrives without one at
  // all leaves nothing here: the client that has not been told a code is needed
  // learns it from the refusal, and recording that exchange would fill the trail
  // with protocol noise and bury the entries that mean somebody is guessing.
  'security.two_factor_challenge_failed',
  // Signing in with a recovery code rather than the authenticator. Its own
  // entry, not metadata on `auth.login`, because it is the one second factor
  // that is *consumed* by being used: the sheet is finite, and "which sign-ins
  // spent one" is the question behind both "is this person locked out of their
  // authenticator" and "did somebody who is not them hold the sheet".
  'security.two_factor_recovery_code_used',
  // The workspace requires a second factor and this account has none, so no
  // session was minted. Not `auth.login_failed`: nothing about the credential
  // was wrong, and an admin reading the trail after switching the policy on
  // needs to see who is now shut out — which is a different list from who is
  // being attacked.
  'security.two_factor_enrollment_required',
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
  // A teammate's routing capacity was changed (FR-MOD-04.3.4). Not an authority
  // change, but it decides who is offered conversations and who is not — the
  // same reason `group.member_set` is recorded — and it is a change one person
  // makes to another's working day. From/to only, like the role entry.
  'member.chat_limit_changed',
  // A teammate's standing weekly availability was replaced (PRD §5.3-Vardiya).
  // Recorded because an admin can rewrite *someone else's* rostered hours, and
  // those hours are what the staffing forecast — and any later "why was nobody
  // covering Tuesday" question — is answered from. The entry names the agent
  // and the shape of the week (timezone, how many days are on), never the
  // individual start/end times.
  'work_schedule.updated',
  // Teams (FR-MOD-04.5). Membership is what routing resolves an agent
  // through (ADR-08 step 2), so adding or removing one silently changes who
  // is offered which conversations -- and deleting a team changes who can
  // see the ones it held. Recorded for the same reason `member.role_changed`
  // is: it is an authority change wearing the clothes of a settings edit.
  'group.created',
  'group.updated',
  'group.deleted',
  'group.member_set',
  'group.member_removed',
  // Workspace configuration
  'settings.security_updated',
  // Company details (FR-MOD-08.3 · M-CO-a): name/sector/address/timezone, the
  // billing/branding/report basis. Field names only, like most settings
  // entries — none of the four is sensitive on its own.
  'settings.company_updated',
  // Routing decides who is offered which conversations, so the whole life of a
  // rule is an authority change, not just an edit to it: adding one diverts
  // work to a team, and deleting one sends it somewhere else again — with the
  // fallback that means "wherever the next matching rule says", which nobody
  // chose deliberately.
  'settings.routing_rule_created',
  'settings.routing_rule_updated',
  'settings.routing_rule_deleted',
  'settings.chat_timeout_updated',
  'settings.widget_updated',
  // Sales tracking (FR-MOD-13.5). Recorded because this configuration decides
  // what the Ecommerce report claims: turning tracking on, changing the currency
  // revenue is recorded in, or widening the attribution window all move the
  // revenue figures a workspace reports. The entry names the changed fields only.
  'settings.sales_tracker_updated',
  // SLA targets (FR-MOD-11.5 · 11.5-d). Recorded with the *values*, not just the
  // changed field names — unlike most settings entries. A target is a promise
  // the workspace made about response time, and the question asked after an
  // unexpected month of breaches is "what were we promising, and since when?",
  // which a list of field names cannot answer. Nothing here is sensitive: three
  // numbers a workspace chose about itself.
  'settings.sla_updated',
  // A sale was reported through the widget's tracking snippet (FR-MOD-13.5).
  // The only write in the platform where a *visitor's browser* states a figure
  // the workspace then reports as revenue, so who reported what, and when, has
  // to be reconstructable — a disputed Ecommerce total is otherwise unanswerable.
  // Written once per sale, never on an idempotent repeat, so the trail counts
  // orders the same way the report does. Metadata carries the amount, currency
  // and whether it was attributed; the actor is the customer token.
  'sale.tracked',
  // A sandbox workspace was created (FR-MOD-11.5 · 11.5-f). Written into the
  // *parent's* trail, because that is the workspace the customer answers for:
  // a second tenant now exists on their account, holding data shaped like
  // production's, and "when did this appear and who asked for it" is the
  // question an auditor brings. There is deliberately no `sandbox_reset`
  // counterpart — a reset destroys the sandbox's own trail, and writing into
  // the parent's would be the one cross-licence write the slice exists to make
  // impossible, so `licenses.sandbox_reset_at` carries that fact instead.
  'settings.sandbox_created',
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
  // A delivery was given up on (M-SCHED-e) — every attempt used up, or the
  // webhook switched off while one was still queued. Recorded because the
  // failure mode it names is silent by nature: an integration that stopped
  // receiving looks exactly like one with nothing to receive, and without this
  // the workspace finds out when somebody notices the far end is missing data.
  // The delivery *payload* is deliberately not in the entry — the trail is
  // append-only and outlives every retention window that governs the content.
  'webhook.delivery_exhausted',
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
  // A handset was allowed to receive this workspace's conversations, or stopped
  // being allowed (FR-MOD-13.7 · 13.7-c). Recorded because a push registration
  // is a standing permission to deliver customer messages to a physical device
  // somebody carries out of the building — the same class of grant as a
  // credential, even though nobody presents it to get in. The *first*
  // registration of a device writes an entry; the app's re-registration on every
  // launch does not, or the trail would be a launch log. Metadata carries the
  // platform and nothing else — never the token, which is a live delivery
  // address (`sanitizeAuditMetadata` would strip it, and no writer offers it).
  'device.registered',
  'device.revoked',
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
  /**
   * The deployment's audit chain root (`AUDIT_CHAIN_SECRET`), from which this
   * workspace's key is derived (NFR-C6 · C6-c).
   *
   * Threaded through the context rather than read from a module-level global,
   * because this codebase has no ambient environment: a service that needs a
   * secret is handed it. Required, not optional — an optional key would mean a
   * caller that forgot it wrote an unchained entry, and an unchained entry is a
   * row nothing later can vouch for. Almost every caller gets it for free from
   * `request.auditContext()`.
   */
  chainSecret: string;
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
 * How many levels deep {@link sanitizeAuditMetadata} will walk into a nested
 * object or array before it stops trusting the shape of the input.
 *
 * No caller in this codebase nests metadata more than one level (`grep` for
 * `metadata: {` finds nothing with a second `{`), so this is headroom, not a
 * realistic ceiling — it exists to bound recursion depth against a caller
 * that spreads an arbitrarily deep value in by mistake, the same class of
 * refactor the doc comment below is written for. Anything past the limit is
 * dropped rather than walked, so a secret hidden below it can never survive
 * by being deep enough to outrun the scan (fail closed, not fail silent).
 */
const MAX_METADATA_DEPTH = 6;

/** What a value becomes when it is dropped rather than walked. */
const MAX_DEPTH_MARKER = '[max_depth_exceeded]';
const CIRCULAR_MARKER = '[circular]';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recurse into a single metadata value, dropping forbidden keys at every
 * level rather than only the top one.
 *
 * `ancestors` holds the objects/arrays currently on the path from the root —
 * added before recursing into a container's contents and removed once that
 * container is done — so a genuine cycle (`obj.self = obj`) is caught, while
 * the same object reachable twice from two different, non-overlapping
 * branches (a DAG, not a cycle) is still sanitized both times.
 *
 * Anything that is not a plain object or array (a string, a Date, …) is
 * returned unchanged: this codebase's metadata is "JSON scalars/arrays by
 * construction" (see `writeAuditEntry`), and a value shaped like a class
 * instance is outside what this function was ever asked to understand —
 * passing it through unchanged matches the pre-recursive behaviour instead
 * of silently discarding it via `Object.entries`.
 */
function sanitizeValue(value: unknown, depth: number, ancestors: Set<object>): unknown {
  if (Array.isArray(value)) {
    if (ancestors.has(value)) return CIRCULAR_MARKER;
    if (depth >= MAX_METADATA_DEPTH) return MAX_DEPTH_MARKER;
    ancestors.add(value);
    const clean = value.map((item) => sanitizeValue(item, depth + 1, ancestors));
    ancestors.delete(value);
    return clean;
  }

  if (isPlainObject(value)) {
    if (ancestors.has(value)) return CIRCULAR_MARKER;
    if (depth >= MAX_METADATA_DEPTH) return MAX_DEPTH_MARKER;
    ancestors.add(value);
    const clean: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      if (!METADATA_KEY_ALLOWLIST.has(key) && FORBIDDEN_METADATA_KEY.test(key)) continue;
      if (entryValue === undefined) continue;
      clean[key] = sanitizeValue(entryValue, depth + 1, ancestors);
    }
    ancestors.delete(value);
    return clean;
  }

  return value;
}

/**
 * Drop any metadata key that looks like a credential — at any depth, not
 * only the top one.
 *
 * The callers in this codebase never pass a secret; this exists so that if
 * one ever starts to — a refactor that spreads a whole request body into
 * metadata, say — the secret is removed here rather than persisted forever
 * in an append-only table nobody can scrub. That request body is exactly the
 * shape most likely to nest (`{ details: { password: '…' } }`), which is why
 * this walks in rather than only checking the object's own keys.
 *
 * Deliberately not sharing `FORBIDDEN_METADATA_KEY`'s fragment list with
 * `lib/log-redact.ts`'s `SENSITIVE_QUERY_KEY`, despite both being "keys that
 * look like a credential" lists: they test different things. This one is an
 * unanchored substring test against an arbitrary object key (`'pass'` must
 * catch `password_hash`, `user_password`, …); that one is an exact match
 * against a URL query key between `?`/`&` and `=` (its `'password'` would
 * not match a query key with `pass` as a mere substring). Building one list's
 * pattern out of the other's fragments would either narrow this function's
 * matching (an exact `'password'` fragment stops catching `passphrase`) or
 * widen the URL masker's (a bare `'pass'` alternative would need its own
 * anchoring to avoid becoming a substring test URLs were never meant to get).
 * Keeping the two lists next to their one caller each, with this note
 * pointing between them, is safer than forcing a shared shape onto two
 * different problems.
 */
export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const ancestors = new Set<object>([metadata]);
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!METADATA_KEY_ALLOWLIST.has(key) && FORBIDDEN_METADATA_KEY.test(key)) continue;
    if (value === undefined) continue;
    clean[key] = sanitizeValue(value, 1, ancestors);
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
  options: { now?: Date } = {},
): Promise<void> {
  if (typeof ctx.licenseId !== 'bigint' || ctx.licenseId <= 0n) {
    throw new TypeError(`audit entry needs a valid tenant license id: ${String(ctx.licenseId)}`);
  }
  if (typeof ctx.chainSecret !== 'string' || ctx.chainSecret.length === 0) {
    throw new TypeError('audit entry needs the chain secret: an unchained entry proves nothing');
  }

  const metadata = sanitizeAuditMetadata({
    ...entry.metadata,
    // Recorded as metadata rather than a column: the schema has no request_id
    // field and does not change for this task. Present on every entry so a log
    // line and its audit record can be tied together after the fact.
    ...(ctx.requestId ? { request_id: ctx.requestId } : {}),
  });

  // The id and the timestamp are assigned here rather than by the database,
  // because the hash has to commit to both and there is no second chance to add
  // them: `audit_log` has no UPDATE grant, so an entry cannot be inserted and
  // then stamped. Excluding them instead would leave the two fields an attacker
  // most wants to move — which entry this is, and when it happened —outside the
  // evidence.
  //
  // It also tightens C6-b's horizon rather than loosening it. `CURRENT_TIMESTAMP`
  // is the *start* of the writing transaction, so an entry could carry a stamp a
  // whole transaction-lifetime older than the moment it became visible; this is
  // the moment of the write itself, so the window an in-flight transaction can
  // hide in shrinks to the time between here and commit.
  const now = options.now ?? new Date();
  const id = randomUUID();

  const slot = await reserveChainSlot(tx, ctx.licenseId, now);
  const hash = chainRowHash(deriveChainKey(ctx.chainSecret, ctx.licenseId), {
    id,
    licenseId: ctx.licenseId,
    chainSeq: slot.seq,
    action: entry.action,
    actorId: ctx.actorId ?? null,
    actorType: ctx.actorType ?? 'agent',
    target: entry.target ?? null,
    metadata,
    ip: ctx.ip ?? null,
    createdAt: now,
    prevHash: slot.prevHash,
  });

  await tx.auditLogEntry.create({
    data: {
      id,
      licenseId: ctx.licenseId,
      actorId: ctx.actorId ?? null,
      actorType: ctx.actorType ?? 'agent',
      action: entry.action,
      target: entry.target ?? null,
      // Values are JSON scalars/arrays by construction; the cast bridges the
      // structural gap between `unknown` values and Prisma's `InputJsonValue`.
      metadata: metadata as Prisma.InputJsonObject,
      ip: ctx.ip ?? null,
      createdAt: now,
      chainSeq: slot.seq,
      prevHash: slot.prevHash,
      hash,
    },
  });

  // Publish the new head so the next writer links onto this entry. Last, so a
  // failure anywhere above leaves the head exactly where it was — although in
  // practice the caller's transaction takes that decision: every statement here
  // is inside it, so a rollback un-reserves the position too and the chain never
  // acquires a hole from a request that failed.
  await tx.$executeRaw`
    UPDATE audit_chain_heads
       SET hash = ${hash}, updated_at = now()
     WHERE license_id = ${ctx.licenseId}`;
}

interface ChainSlot {
  seq: bigint;
  prevHash: string | null;
}

/**
 * Take the next position in this workspace's chain.
 *
 * The `UPDATE … RETURNING` is doing two jobs at once. It hands back the new
 * sequence number *and* the hash still sitting on the head — which is the
 * previous entry's, because this statement has not written the new one yet — and
 * it takes a row lock that is held until the caller's transaction commits. That
 * lock is the whole concurrency story: two requests writing audit entries for
 * the same workspace are serialised here, so they cannot both build on the same
 * predecessor and fork the chain into two branches that each look intact.
 *
 * A licence writing its first entry has no head row, so the update matches
 * nothing and one is seeded. `ON CONFLICT DO NOTHING` rather than a check-then-
 * insert: two first writes can race, and the loser needs to fall through to the
 * update rather than fail.
 */
async function reserveChainSlot(
  tx: TenantClient,
  licenseId: bigint,
  now: Date,
): Promise<ChainSlot> {
  const advanced = await advanceChainHead(tx, licenseId);
  if (advanced) return advanced;

  await tx.$executeRaw`
    INSERT INTO audit_chain_heads (license_id, seq, hash, genesis_at, created_at, updated_at)
    VALUES (${licenseId}, 0, NULL, ${now}, now(), now())
    ON CONFLICT (license_id) DO NOTHING`;

  const seeded = await advanceChainHead(tx, licenseId);
  if (seeded) return seeded;

  // Unreachable through RLS-correct callers: the insert above either created
  // the row or found it. Reaching here means the row exists but this
  // transaction cannot see it, which is a tenant-context mismatch — the same
  // class of error the RLS `WITH CHECK` raises on the insert below, and it must
  // not be answered by writing an unchained entry.
  throw new Error(
    `audit chain head for licence ${licenseId} is unreachable from this tenant context`,
  );
}

async function advanceChainHead(tx: TenantClient, licenseId: bigint): Promise<ChainSlot | null> {
  const rows = await tx.$queryRaw<Array<{ seq: bigint; hash: string | null }>>`
    UPDATE audit_chain_heads
       SET seq = seq + 1, updated_at = now()
     WHERE license_id = ${licenseId}
    RETURNING seq, hash`;

  const row = rows[0];
  return row ? { seq: row.seq, prevHash: row.hash } : null;
}
