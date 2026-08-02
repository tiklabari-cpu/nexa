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
  // Authentication
  'auth.login',
  'auth.login_failed',
  'auth.password_reset',
  // An authenticated request was refused at the edge because the workspace's IP
  // allow-list did not admit its source address (FR-MOD-08.9.6). Recorded so a
  // locked-out admin — or a stolen token being used from outside the office —
  // is visible in the trail; the address itself is deliberately not stored here.
  'auth.ip_denied',
  // Team membership
  'member.invited',
  'member.invitation_revoked',
  'member.suspended',
  'member.unsuspended',
  // Workspace configuration
  'settings.security_updated',
  'settings.routing_rule_updated',
  'settings.chat_timeout_updated',
  'settings.widget_updated',
  'settings.trusted_domain_added',
  'settings.trusted_domain_removed',
  'settings.ip_allowlist_added',
  'settings.ip_allowlist_removed',
  'billing.subscription_updated',
  'billing.payment_method_updated',
  // Outbound webhooks (FR-MOD-08.8.4 / NFR-S7) — the platform's highest-risk
  // egress surface, and the "webhook değişimi" NFR-S12 names by hand. The entry
  // records the host and the subscription, never the full URL or the signing
  // secret the register response carries once.
  'webhook.created',
  'webhook.deleted',
  // Ticketing / HelpDesk (FR-MOD-13.6) — the lifecycle and structural changes an
  // async ticket goes through. Merge/unmerge affect data integrity across two
  // tickets, so they are recorded as much for the audit trail as for support.
  'ticket.status_changed',
  'ticket.priority_changed',
  'ticket.merged',
  'ticket.unmerged',
  'ticket.follower_added',
  'ticket.follower_removed',
  // Credentials
  'pat.created',
  'pat.revoked',
  // Data lifecycle — a retention sweep hard-deleted expired data (NFR-C8). The
  // record is metadata (counts), not the data itself, so it is safe to retain.
  'data.retention_pruned',
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
 * Drop any metadata key that looks like a credential.
 *
 * The callers in this codebase never pass a secret; this exists so that if one
 * ever starts to — a refactor that spreads a whole request body into metadata,
 * say — the secret is removed here rather than persisted forever in an
 * append-only table nobody can scrub. `request_id` is exempt: it is a
 * correlation id, not a credential, despite containing the substring.
 */
export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!metadata) return {};
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (key !== 'request_id' && FORBIDDEN_METADATA_KEY.test(key)) continue;
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
