/**
 * The root panel's audit trail (tm 389.5 · FR-ADMIN-05/06 · design.md §B2, §C
 * audit).
 *
 * Every operator action lands in `platform_audit_log`, one HMAC chain for the
 * whole deployment (scope `platform`, `audit-chain.ts`), keyed by a sub-key of
 * `PLATFORM_SETTINGS_KEY` (`lib/platform-keys.ts`) — so, like the tenant chain,
 * whoever holds only the database can delete a row but cannot rebuild the
 * chain around the hole.
 *
 * Four rules, all enforced here rather than at the routes, because a route is
 * one caller and a later module's service is another:
 *
 *   - **A closed vocabulary.** {@link PLATFORM_AUDIT_ACTIONS}: a typo is a
 *     compile error, not an action nobody can filter on. Its domains are the
 *     root panel's modules ({@link PLATFORM_AUDIT_DOMAINS}).
 *   - **A reason on every business action.** Only the operator's own session
 *     events ({@link PLATFORM_SELF_ACTIONS} — signing in, a code, signing out)
 *     are recorded without one; anything else without a 3–500 character
 *     reason is refused before a row is written.
 *   - **Double entry for a workspace.** An entry naming a workspace
 *     (`licenseId`) is also written to that workspace's own `audit_log`, as
 *     `actor_type = 'platform'` with the action's tenant wording
 *     (`platform.<domain>_<verb>`), in the same transaction: if the workspace's
 *     entry cannot be written, neither is the platform's, and neither is the
 *     action — {@link PlatformAuditLog.run} wraps all three. The tenant entry
 *     carries the platform chain position, never the reason or the payload:
 *     an operator's notes are not the customer's to read.
 *   - **Positions, not clocks.** `chain_seq` comes from the single
 *     `platform_audit_chain_head` row, taken under its row lock, so two
 *     writers are serialised and the chain cannot fork. The head is always
 *     locked before a workspace's head, never after, so the double entry
 *     cannot deadlock against itself.
 *
 * No secret reaches a payload: `sanitizeAuditMetadata` (the tenant writer's
 * filter) runs over every one, and a key change records only the names of
 * what changed (design.md §F).
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { derivePlatformKey } from '../../lib/platform-keys.js';
import type { TenantClient } from '../../lib/tenant.js';
import {
  canonicalJson,
  PLATFORM_CHAIN_SCOPE,
  platformChainRowHash,
  signExportPage,
  verifyChain,
  type ChainFinding,
  type ChainVerification,
} from '../audit/audit-chain.js';
import {
  AUDIT_ACTIONS,
  sanitizeAuditMetadata,
  writeAuditEntry,
  type AuditAction,
} from '../audit/audit-log.js';
import {
  listAuditLog,
  type AuditLogItem,
  type AuditLogListOptions,
} from '../audit/audit-log-reader.js';

/** The root panel's modules — the first segment of every action. */
export const PLATFORM_AUDIT_DOMAINS = [
  'admin',
  'workspace',
  'account',
  'billing',
  'settings',
  'ai_settings',
  'impersonation',
  'security',
] as const;

/**
 * Everything the root panel records. The `admin.*` entries have writers today
 * (tm 389.4's routes, the bootstrap CLI); the rest are the actions of
 * design.md §C, named once here so the module that implements each one
 * (389.9–389.18) writes a word the trail, the filters and the workspace's
 * screen already know. A module may rename one of its own before it ships.
 */
export const PLATFORM_AUDIT_ACTIONS = [
  // The operator's own session (no reason).
  'admin.bootstrapped',
  'admin.signed_in',
  'admin.sign_in_failed',
  'admin.invite_accepted',
  'admin.totp_enrollment_started',
  'admin.totp_enrolled',
  'admin.totp_verified',
  'admin.totp_failed',
  'admin.totp_reverified',
  'admin.recovery_codes_regenerated',
  'admin.other_sessions_ended',
  'admin.signed_out',
  // Operator management.
  'admin.invited',
  'admin.invite_revoked',
  'admin.role_changed',
  'admin.disabled',
  'admin.enabled',
  'admin.two_factor_reset',
  'admin.sessions_revoked',
  // One workspace (389.9/389.10).
  'workspace.note_added',
  'workspace.trial_extended',
  'workspace.activated',
  'workspace.plan_changed',
  'workspace.suspended',
  'workspace.unsuspended',
  'workspace.read_only_set',
  'workspace.active_set',
  'workspace.cancelled',
  'workspace.resumed',
  'workspace.overrides_changed',
  'workspace.ai_caps_changed',
  'workspace.owner_verification_resent',
  'workspace.sandbox_reset',
  'workspace.ownership_transferred',
  'workspace.deletion_scheduled',
  'workspace.deletion_cancelled',
  // One account (389.11).
  'account.verification_resent',
  'account.password_reset_forced',
  'account.sessions_revoked',
  'account.tokens_revoked',
  'account.two_factor_reset',
  'account.suspended',
  'account.unsuspended',
  'account.exported',
  'account.erased',
  // Billing and payments (389.12/389.18).
  'billing.plan_saved',
  'billing.package_saved',
  'billing.credit_granted',
  'billing.manual_subscription_created',
  'billing.payment_address_sent',
  'billing.payment_confirmed',
  'billing.payment_request_cancelled',
  'billing.swift_marked_paid',
  'billing.providers_updated',
  'billing.bank_details_updated',
  'billing.issuer_profile_updated',
  // Deployment settings (389.13) and AI settings (389.17).
  'settings.updated',
  'settings.maintenance_changed',
  'ai_settings.updated',
  'ai_settings.connection_tested',
  'ai_settings.reembed_started',
  // "Enter as the customer" (389.15).
  'impersonation.started',
  'impersonation.ended',
  // Sign-up abuse (389.16).
  'security.blocklist_added',
  'security.blocklist_removed',
  'security.unverified_signups_purged',
] as const;

export type PlatformAuditAction = (typeof PLATFORM_AUDIT_ACTIONS)[number];

/** The operator's own session events — the only entries without a reason. */
export const PLATFORM_SELF_ACTIONS: ReadonlySet<PlatformAuditAction> = new Set([
  'admin.bootstrapped',
  'admin.signed_in',
  'admin.sign_in_failed',
  'admin.invite_accepted',
  'admin.totp_enrollment_started',
  'admin.totp_enrolled',
  'admin.totp_verified',
  'admin.totp_failed',
  'admin.totp_reverified',
  'admin.recovery_codes_regenerated',
  'admin.other_sessions_ended',
  'admin.signed_out',
]);

/**
 * The actions that can concern one workspace, and so are written to its own
 * trail as well. `workspace.*` and `impersonation.*` always name one; an
 * `account.*` or a billing entry does when the writer passes the workspace.
 */
export const PLATFORM_TENANT_ACTIONS: ReadonlySet<PlatformAuditAction> = new Set(
  PLATFORM_AUDIT_ACTIONS.filter(
    (action) =>
      action.startsWith('workspace.') ||
      action.startsWith('account.') ||
      action.startsWith('impersonation.') ||
      [
        'billing.credit_granted',
        'billing.manual_subscription_created',
        'billing.payment_address_sent',
        'billing.payment_confirmed',
        'billing.payment_request_cancelled',
        'billing.swift_marked_paid',
      ].includes(action),
  ),
);

/** Actions that cannot be recorded without the workspace they act on. */
function requiresWorkspace(action: PlatformAuditAction): boolean {
  return action.startsWith('workspace.') || action.startsWith('impersonation.');
}

/**
 * The tenant wording of a workspace-touching action: `platform.` and the
 * action with its dot flattened (`workspace.suspended` →
 * `platform.workspace_suspended`) — one rule, so the two vocabularies cannot
 * drift apart; `platform-audit.test.ts` holds `AUDIT_ACTIONS` to it.
 */
export function tenantActionOf(action: PlatformAuditAction): AuditAction | null {
  if (!PLATFORM_TENANT_ACTIONS.has(action)) return null;
  const tenant = `platform.${action.replace('.', '_')}`;
  return (AUDIT_ACTIONS as readonly string[]).includes(tenant) ? (tenant as AuditAction) : null;
}

/** What an entry is about — `target_type`. */
export const PLATFORM_AUDIT_TARGETS = [
  'admin',
  'invite',
  'session',
  'workspace',
  'account',
  'plan',
  'package',
  'invoice',
  'payment_request',
  'credit',
  'settings',
  'blocklist',
  'impersonation',
] as const;

export type PlatformAuditTarget = (typeof PLATFORM_AUDIT_TARGETS)[number];

/**
 * A platform route's audit declaration (`config.platform.audit`,
 * `plugins/platform-audit.ts`): the action it records and what it acts on.
 */
export interface PlatformAuditRouteConfig {
  action: PlatformAuditAction;
  target: PlatformAuditTarget;
  /** The path parameter holding the target's id (`adminId`). */
  targetParam?: string;
}

/** `reason`'s bounds — the contract's `PlatformReasonRequest`. */
export const PLATFORM_REASON_MIN = 3;
export const PLATFORM_REASON_MAX = 500;

/** The trimmed reason, or null when it is missing or out of bounds. */
export function normalizeReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= PLATFORM_REASON_MIN && trimmed.length <= PLATFORM_REASON_MAX
    ? trimmed
    : null;
}

export interface PlatformAuditEntry {
  /** The operator; null only for a sign-in nobody could be matched to. */
  adminId: string | null;
  action: PlatformAuditAction;
  targetType: PlatformAuditTarget;
  targetId?: string | null;
  /** The workspace the action concerns — writes its own trail too. */
  licenseId?: bigint | null;
  /** Required on every action outside {@link PLATFORM_SELF_ACTIONS}. */
  reason?: string | null;
  /** Identifiers, counts, changed field names — never values or secrets. */
  payload?: Record<string, unknown>;
  ip?: string | null;
  /** Lands in the workspace entry's metadata, like the tenant writer's. */
  requestId?: string | null;
}

export interface PlatformAuditRecorded {
  seq: bigint;
  hash: string;
}

type PlatformTx = Prisma.TransactionClient;

interface PlatformAuditRow {
  chainSeq: bigint;
  adminId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  licenseId: bigint | null;
  reason: string | null;
  payload: unknown;
  ip: string | null;
  createdAt: Date;
  prevHash: string | null;
  hash: string;
}

export interface PlatformAuditItem {
  chain_seq: string;
  admin_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  license_id: string | null;
  reason: string | null;
  payload: unknown;
  ip: string | null;
  created_at: string;
}

export interface PlatformAuditListFilter {
  adminId?: string;
  action?: PlatformAuditAction;
  licenseId?: bigint;
  from?: Date;
  to?: Date;
  /** The `next_cursor` of a previous page. */
  cursor?: string;
  limit?: number;
}

export interface PlatformAuditExportPage {
  body: string;
  count: number;
  firstSeq: bigint | null;
  lastSeq: bigint | null;
  hasMore: boolean;
  /** Integrity of the page as delivered, linked onto the entry before it. */
  chainOk: boolean;
  signature: string;
}

/** A finding about the head row, which only the platform chain has. */
export interface HeadFinding {
  kind: 'head_mismatch';
  id: null;
  seq: string | null;
  detail: string;
}

export interface PlatformAuditVerification {
  ok: boolean;
  checked: number;
  first_seq: string | null;
  last_seq: string | null;
  head_seq: string | null;
  /** The first {@link MAX_REPORTED_FINDINGS}; `findings_total` counts them all. */
  findings: Array<Pick<ChainFinding | HeadFinding, 'kind' | 'seq' | 'detail'>>;
  findings_total: number;
}

const LIST_DEFAULT = 50;
const LIST_MAX = 100;
const EXPORT_DEFAULT = 1000;
const EXPORT_MAX = 5000;
const VERIFY_BATCH = 1000;
const MAX_REPORTED_FINDINGS = 100;

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(1, Math.floor(value)), max);
}

function encodeCursor(seq: bigint): string {
  return Buffer.from(seq.toString(), 'utf8').toString('base64url');
}

/** A cursor this module wrote, or null — a stale bookmark starts from the top. */
export function decodePlatformAuditCursor(cursor: string | undefined): bigint | null {
  if (!cursor) return null;
  const text = Buffer.from(cursor, 'base64url').toString('utf8');
  return /^[1-9]\d{0,18}$/.test(text) ? BigInt(text) : null;
}

function itemOf(row: PlatformAuditRow): PlatformAuditItem {
  return {
    chain_seq: row.chainSeq.toString(),
    admin_id: row.adminId,
    action: row.action,
    target_type: row.targetType,
    target_id: row.targetId,
    license_id: row.licenseId === null ? null : row.licenseId.toString(),
    reason: row.reason,
    payload: row.payload,
    ip: row.ip,
    created_at: row.createdAt.toISOString(),
  };
}

/** One NDJSON line of the export: the entry and its two hashes, keys sorted. */
function exportLine(row: PlatformAuditRow): string {
  return canonicalJson({ ...itemOf(row), prev_hash: row.prevHash, hash: row.hash });
}

function hashOf(key: Buffer, row: PlatformAuditRow): string {
  return platformChainRowHash(key, row);
}

export interface PlatformAuditLogOptions {
  /** `PLATFORM_SETTINGS_KEY`; the chain key is derived from it. */
  settingsKey: string;
  /** `AUDIT_CHAIN_SECRET` — for the workspace half of a double entry. */
  tenantChainSecret: string;
  now?: () => number;
}

export class PlatformAuditLog {
  readonly #db: PrismaClient;
  readonly #key: Buffer;
  readonly #tenantChainSecret: string;
  readonly #now: () => number;

  constructor(db: PrismaClient, options: PlatformAuditLogOptions) {
    this.#db = db;
    this.#key = Buffer.from(derivePlatformKey(options.settingsKey, 'auditChain'), 'hex');
    this.#tenantChainSecret = options.tenantChainSecret;
    this.#now = options.now ?? Date.now;
  }

  /** The chain key — for a test, or the runbook's offline check. Never logged. */
  get key(): Buffer {
    return this.#key;
  }

  /**
   * Do `fn` and record `entry` in one transaction: the action, the platform
   * entry and — when it names a workspace — the workspace's entry commit
   * together or not at all. `entry` may be computed from `fn`'s result (an id
   * the action created).
   */
  async run<T>(
    entry: PlatformAuditEntry | ((result: T) => PlatformAuditEntry),
    fn: (tx: PlatformTx) => Promise<T>,
  ): Promise<T> {
    return this.#db.$transaction(async (tx) => {
      const result = await fn(tx);
      await this.record(typeof entry === 'function' ? entry(result) : entry, tx);
      return result;
    });
  }

  /** Record one entry — inside `tx` when given, else in its own transaction. */
  async record(entry: PlatformAuditEntry, tx?: PlatformTx): Promise<PlatformAuditRecorded> {
    const checked = this.#checked(entry);
    if (tx) return this.#write(tx, checked);
    return this.#db.$transaction((own) => this.#write(own, checked));
  }

  #checked(entry: PlatformAuditEntry): PlatformAuditEntry & { reason: string | null } {
    if (!(PLATFORM_AUDIT_ACTIONS as readonly string[]).includes(entry.action)) {
      throw new TypeError(`unknown platform audit action: ${String(entry.action)}`);
    }
    if (!(PLATFORM_AUDIT_TARGETS as readonly string[]).includes(entry.targetType)) {
      throw new TypeError(`unknown platform audit target: ${String(entry.targetType)}`);
    }
    let reason: string | null = null;
    if (entry.reason !== undefined && entry.reason !== null) {
      reason = normalizeReason(entry.reason);
      if (reason === null) {
        throw new TypeError(
          `platform audit reason must be ${PLATFORM_REASON_MIN}-${PLATFORM_REASON_MAX} characters`,
        );
      }
    }
    if (reason === null && !PLATFORM_SELF_ACTIONS.has(entry.action)) {
      throw new TypeError(`${entry.action} needs a reason`);
    }
    const licenseId = entry.licenseId ?? null;
    if (licenseId !== null && tenantActionOf(entry.action) === null) {
      throw new TypeError(`${entry.action} has no workspace wording and cannot name a workspace`);
    }
    if (licenseId === null && requiresWorkspace(entry.action)) {
      throw new TypeError(`${entry.action} needs the workspace it acts on`);
    }
    return { ...entry, reason };
  }

  async #write(
    tx: PlatformTx,
    entry: PlatformAuditEntry & { reason: string | null },
  ): Promise<PlatformAuditRecorded> {
    // The id and timestamp are assigned here, not by the database, for the
    // tenant writer's reason: the hash commits to them and there is no UPDATE.
    const createdAt = new Date(this.#now());
    const slot = await this.#reserve(tx);
    const licenseId = entry.licenseId ?? null;
    const payload = sanitizeAuditMetadata(entry.payload);

    if (licenseId !== null) {
      // BYPASSRLS skips the policy, but the column-level context is still
      // what `siyahtus_current_license()` reads anywhere a trigger asks.
      await tx.$executeRaw`SELECT set_config('app.current_license', ${licenseId.toString()}, true)`;
      await writeAuditEntry(
        tx as unknown as TenantClient,
        {
          licenseId,
          chainSecret: this.#tenantChainSecret,
          actorId: entry.adminId,
          actorType: 'platform',
          requestId: entry.requestId ?? null,
          ip: entry.ip ?? null,
        },
        {
          action: tenantActionOf(entry.action)!,
          target:
            entry.targetType === 'workspace'
              ? `license:${licenseId}`
              : `${entry.targetType}:${entry.targetId ?? ''}`,
          metadata: { platform_seq: slot.seq.toString() },
        },
        { now: createdAt },
      );
    }

    const row = {
      chainSeq: slot.seq,
      adminId: entry.adminId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      licenseId,
      reason: entry.reason,
      payload,
      ip: entry.ip ?? null,
      createdAt,
      prevHash: slot.prevHash,
    };
    const hash = platformChainRowHash(this.#key, row);
    await tx.platformAuditLog.create({
      data: { ...row, payload: payload as Prisma.InputJsonObject, hash },
    });
    await tx.$executeRaw`
      UPDATE platform_audit_chain_head SET hash = ${hash}, updated_at = now() WHERE id = 1`;
    return { seq: slot.seq, hash };
  }

  /**
   * The next position, under the head's row lock until the caller commits. The
   * first writer ever seeds the head; `ON CONFLICT DO NOTHING` lets a racing
   * second first-writer fall through to the update instead of failing.
   */
  async #reserve(tx: PlatformTx): Promise<{ seq: bigint; prevHash: string | null }> {
    const advance = () =>
      tx.$queryRaw<Array<{ seq: bigint; hash: string | null }>>`
        UPDATE platform_audit_chain_head SET seq = seq + 1, updated_at = now()
         WHERE id = 1
        RETURNING seq, hash`;
    let rows = await advance();
    if (!rows[0]) {
      await tx.$executeRaw`
        INSERT INTO platform_audit_chain_head (id, seq, hash, updated_at)
        VALUES (1, 0, NULL, now()) ON CONFLICT (id) DO NOTHING`;
      rows = await advance();
    }
    const head = rows[0];
    if (!head) throw new Error('platform audit chain head is unreachable');
    return { seq: head.seq, prevHash: head.hash };
  }

  // --- Reading ---------------------------------------------------------------

  /** Newest first, keyset on the position. */
  async list(
    filter: PlatformAuditListFilter = {},
  ): Promise<{ data: PlatformAuditItem[]; next_cursor: string | null }> {
    const limit = clamp(filter.limit, LIST_DEFAULT, LIST_MAX);
    const before = decodePlatformAuditCursor(filter.cursor);
    const createdAt: Prisma.DateTimeFilter = {};
    if (filter.from) createdAt.gte = filter.from;
    if (filter.to) createdAt.lte = filter.to;
    const rows = await this.#db.platformAuditLog.findMany({
      where: {
        ...(filter.adminId ? { adminId: filter.adminId } : {}),
        ...(filter.action ? { action: filter.action } : {}),
        ...(filter.licenseId !== undefined ? { licenseId: filter.licenseId } : {}),
        ...(filter.from || filter.to ? { createdAt } : {}),
        ...(before !== null ? { chainSeq: { lt: before } } : {}),
      },
      orderBy: { chainSeq: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map(itemOf),
      next_cursor: rows.length > limit && last ? encodeCursor(last.chainSeq) : null,
    };
  }

  /**
   * One page of the whole chain, oldest first, as NDJSON — unfiltered, like
   * the tenant export: a selective copy of a trail is not evidence of it. The
   * signature (`signExportPage`, scope `platform`) binds the exact bytes to
   * the range they claim; `docs/runbooks/platform-audit.md` checks it offline.
   */
  async exportPage(
    options: { after?: bigint | null; limit?: number } = {},
  ): Promise<PlatformAuditExportPage> {
    const limit = clamp(options.limit, EXPORT_DEFAULT, EXPORT_MAX);
    const after = options.after ?? null;
    const rows = (await this.#db.platformAuditLog.findMany({
      where: after !== null ? { chainSeq: { gt: after } } : {},
      orderBy: { chainSeq: 'asc' },
      take: limit + 1,
    })) as PlatformAuditRow[];
    const page = rows.slice(0, limit);
    const previous =
      after !== null
        ? await this.#db.platformAuditLog.findUnique({
            where: { chainSeq: after },
            select: { chainSeq: true, hash: true },
          })
        : null;

    const body = page.map((row) => `${exportLine(row)}\n`).join('');
    const firstSeq = page[0]?.chainSeq ?? null;
    const lastSeq = page.at(-1)?.chainSeq ?? null;
    const chain = verifyChain(page, {
      recompute: (row) => hashOf(this.#key, row),
      ...(previous
        ? { after: { seq: previous.chainSeq, hash: previous.hash } }
        : after === null
          ? { prunedThroughSeq: 0n }
          : {}),
    });
    return {
      body,
      count: page.length,
      firstSeq,
      lastSeq,
      hasMore: rows.length > limit,
      chainOk: chain.ok,
      signature: signExportPage(this.#key, {
        scope: PLATFORM_CHAIN_SCOPE,
        count: page.length,
        firstSeq,
        lastSeq,
        body,
      }),
    };
  }

  /**
   * Walk the whole chain from position 1 in batches and report every break:
   * a removed entry (gap), an altered one (hash), a relinked one, a trail that
   * does not start at 1, and a head that does not point at the last entry —
   * which is how a deleted *tail* shows, since nothing after it is left to
   * break.
   */
  async verify(): Promise<PlatformAuditVerification> {
    const findings: Array<ChainFinding | HeadFinding> = [];
    let checked = 0;
    let first: bigint | null = null;
    let previous: { seq: bigint; hash: string } | null = null;

    for (;;) {
      const batch = (await this.#db.platformAuditLog.findMany({
        where: previous ? { chainSeq: { gt: previous.seq } } : {},
        orderBy: { chainSeq: 'asc' },
        take: VERIFY_BATCH,
      })) as PlatformAuditRow[];
      if (batch.length === 0) break;
      const result: ChainVerification = verifyChain(batch, {
        recompute: (row) => hashOf(this.#key, row),
        ...(previous ? { after: previous } : { prunedThroughSeq: 0n }),
      });
      findings.push(...result.findings);
      checked += result.checked;
      first ??= batch[0]!.chainSeq;
      const last = batch.at(-1)!;
      previous = { seq: last.chainSeq, hash: last.hash };
      if (batch.length < VERIFY_BATCH) break;
    }

    const head = await this.#db.platformAuditChainHead.findUnique({ where: { id: 1 } });
    const headSeq = head?.seq ?? 0n;
    const lastSeq = previous?.seq ?? 0n;
    if (headSeq !== lastSeq || (previous !== null && head?.hash !== previous.hash)) {
      findings.push({
        kind: 'head_mismatch',
        id: null,
        seq: headSeq.toString(),
        detail:
          headSeq > lastSeq
            ? `the head has handed out position ${headSeq}, but the last surviving entry is ${lastSeq} — entries ${lastSeq + 1n}…${headSeq} are missing`
            : `the head (position ${headSeq}) does not point at the last entry (position ${lastSeq})`,
      });
    }

    return {
      ok: findings.length === 0,
      checked,
      first_seq: first === null ? null : first.toString(),
      last_seq: previous ? previous.seq.toString() : null,
      head_seq: head ? head.seq.toString() : null,
      findings: findings
        .slice(0, MAX_REPORTED_FINDINGS)
        .map(({ kind, seq, detail }) => ({ kind, seq, detail })),
      findings_total: findings.length,
    };
  }

  /**
   * A workspace's own trail, read-only, exactly as its members see it
   * (`audit-log-reader.ts`). This connection bypasses row level security, so
   * the licence filter here is the boundary, not a redundancy.
   */
  async workspaceTrail(
    licenseId: bigint,
    options: Omit<AuditLogListOptions, 'licenseId'> = {},
  ): Promise<{ items: AuditLogItem[]; nextPageId?: string } | null> {
    const license = await this.#db.license.findUnique({
      where: { id: licenseId },
      select: { id: true },
    });
    if (!license) return null;
    return listAuditLog(this.#db as unknown as TenantClient, { ...options, licenseId });
  }
}
