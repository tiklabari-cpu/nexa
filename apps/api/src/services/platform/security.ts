/**
 * The Security page's data (tm 389.16 · FR-ADMIN-22 · docs/platform-admin/design.md
 * §C security): the sign-up blocklist, failed sign-ins, sign-ups by address and
 * the abuse counters of the tenant API's guards.
 *
 * **The blocklist is written here and read in the database.** The tenant API
 * never touches `platform_blocklist`: it asks `platform_signup_blocked(email,
 * ip)` (a SECURITY DEFINER function, migration `20261101090000`), so
 * `siyahtus_app` has no grant on the table and an entry takes effect for the
 * very next sign-up — nothing between this write and that read is cached. What
 * is stored is therefore what that function compares plainly: an address and a
 * domain in lower case, an IP in the canonical form `inet` reads (a CIDR with
 * its host bits zeroed). {@link normalizeBlocklistValue} is that single
 * spelling; the table's CHECK is the net under it.
 *
 * **Counts, addresses and licence numbers only.** A failed sign-in's trail
 * (`auth.login_failed`) records the address it came from and the workspace it
 * was tried against, nothing about who it claimed to be — there is no e-mail
 * to mask. Everything here is read with the platform role, which sees every
 * workspace (BYPASSRLS) and answers with no tenant content.
 *
 * **Cross-workspace reads go through the licence.** `audit_log` and
 * `ai_customer_daily_usage` are indexed by `license_id` first, so each count
 * is a `LATERAL` lookup per licence rather than a scan of the table: the cost
 * follows the number of workspaces, not the number of rows.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { AI_TURNS_PER_CUSTOMER_DAY_DEFAULT, type PlatformBlocklistKind } from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { formatAllowlistEntry, parseAllowlistEntry } from '../../lib/ip-allowlist.js';
import { readComponentStatuses, type ComponentStatus } from '../ops/component-status.js';
import { INVITES_PER_DAY } from '../auth/lifecycle-service.js';

export const BLOCKLIST_LIST_DEFAULT = 50;
export const BLOCKLIST_LIST_MAX = 200;
export const BLOCKLIST_VALUE_MAX = 320;
export const FAILED_LOGINS_HOURS_MAX = 168;
export const SIGNUPS_BY_IP_DAYS_MAX = 90;

/** The window `authFailureBucket` counts in (`plugins/rate-limit.ts`). */
export const AUTH_FAILURE_WINDOW_SECONDS = 60;
const AUTH_FAILURE_KEY_PATTERN = 'rl:authfail:*';
/** Keys one `SCAN` batch asks for, and how many batches one answer may take. */
const SCAN_COUNT = 200;
const SCAN_MAX_ROUNDS = 25;
/** Addresses listed in `tenant.live`; the totals count them all. */
const LIVE_ADDRESSES_SHOWN = 50;
const TOP_SHOWN = 20;

const EMAIL_RE = /^[^@\s]+@[^@\s]+$/;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * The stored spelling of a blocklist value, or null when it is not one.
 *
 * - `email`: trimmed, lower case, one `@`.
 * - `domain`: trimmed, lower case; a leading `@` or `*.` and a trailing dot are
 *   forgiven. A domain entry also covers its subdomains (the database function
 *   does that), so `example.com` is what to type for both.
 * - `ip`: a single address or a CIDR, v4 or v6, in the canonical form
 *   {@link formatAllowlistEntry} writes — host bits of a CIDR zeroed, a full-length
 *   prefix dropped.
 */
export function normalizeBlocklistValue(kind: PlatformBlocklistKind, raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '' || trimmed.length > BLOCKLIST_VALUE_MAX) return null;
  if (kind === 'email') {
    const email = trimmed.toLowerCase();
    return EMAIL_RE.test(email) ? email : null;
  }
  if (kind === 'domain') {
    const domain = trimmed
      .toLowerCase()
      .replace(/^(@|\*\.)/, '')
      .replace(/\.$/, '');
    return DOMAIN_RE.test(domain) ? domain : null;
  }
  const entry = parseAllowlistEntry(trimmed);
  return entry ? formatAllowlistEntry(entry) : null;
}

export interface BlocklistEntryView {
  id: string;
  kind: PlatformBlocklistKind;
  value: string;
  reason: string | null;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
}

export class BlocklistCursorError extends Error {}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id]), 'utf8').toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [at, id] = parsed as [unknown, unknown];
      const createdAt = typeof at === 'string' ? new Date(at) : null;
      if (createdAt && !Number.isNaN(createdAt.getTime()) && typeof id === 'string') {
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
          return { createdAt, id };
        }
      }
    }
  } catch {
    // Falls through to the refusal below.
  }
  throw new BlocklistCursorError('not a cursor of this list');
}

export interface BlocklistFilter {
  kind?: PlatformBlocklistKind;
  q?: string;
  cursor?: string;
  limit?: number;
}

/** Whether a Prisma error is the unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
  );
}

export interface Counted {
  key: string;
  count: number;
}

type SecurityRedis = Pick<Redis, 'scan' | 'pipeline' | 'hgetall'>;

export interface PlatformSecurityOptions {
  /** `RATE_LIMIT_AUTH_FAILURES_PER_MIN`: failures per window before an address is refused. */
  authFailureLimit: number;
  now?: () => number;
}

export type AbuseCounterStatus = 'available' | 'not_installed' | 'not_available';

export class PlatformSecurity {
  readonly #db: PrismaClient;
  readonly #redis: SecurityRedis;
  readonly #authFailureLimit: number;
  readonly #now: () => number;

  constructor(db: PrismaClient, redis: SecurityRedis, options: PlatformSecurityOptions) {
    this.#db = db;
    this.#redis = redis;
    this.#authFailureLimit = options.authFailureLimit;
    this.#now = options.now ?? Date.now;
  }

  // --- Blocklist ---------------------------------------------------------------

  async listBlocklist(
    filter: BlocklistFilter,
  ): Promise<{ data: BlocklistEntryView[]; next_cursor: string | null }> {
    const limit = Math.min(
      Math.max(1, Math.floor(filter.limit ?? BLOCKLIST_LIST_DEFAULT)),
      BLOCKLIST_LIST_MAX,
    );
    const after = filter.cursor ? decodeCursor(filter.cursor) : null;
    const q = filter.q?.trim().toLowerCase();
    const where: Prisma.PlatformBlocklistWhereInput = {
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(q ? { value: { contains: q } } : {}),
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    };
    const rows = await this.#db.platformBlocklist.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const emails = await this.#adminEmails(page.map((row) => row.createdBy));
    return {
      data: page.map((row) => viewOf(row, emails)),
      next_cursor: rows.length > limit && last ? encodeCursor(last) : null,
    };
  }

  /** Adds one entry; the same range twice is a 400, not a second row. */
  async addBlocklist(input: {
    kind: PlatformBlocklistKind;
    value: string;
    reason: string;
    adminId: string;
  }): Promise<BlocklistEntryView> {
    const value = normalizeBlocklistValue(input.kind, input.value);
    if (value === null) {
      throw ApiError.validation(invalidValueMessage(input.kind), {
        reason: 'invalid_value',
        kind: input.kind,
      });
    }
    // Millisecond precision: the list's keyset key, which a JavaScript Date
    // cannot carry beyond.
    const createdAt = new Date(this.#now());
    try {
      const row = await this.#db.platformBlocklist.create({
        data: {
          kind: input.kind,
          value,
          reason: input.reason,
          createdBy: input.adminId,
          createdAt,
        },
      });
      const emails = await this.#adminEmails([row.createdBy]);
      return viewOf(row, emails);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw ApiError.validation('That entry is already on the blocklist.', {
          reason: 'already_listed',
          kind: input.kind,
        });
      }
      throw error;
    }
  }

  /** Removes one entry and returns what it was, or null when there is none by that id. */
  async removeBlocklist(
    id: string,
  ): Promise<{ id: string; kind: PlatformBlocklistKind; value: string } | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    const rows = await this.#db.$queryRaw<
      Array<{ id: string; kind: PlatformBlocklistKind; value: string }>
    >`DELETE FROM platform_blocklist WHERE id = ${id}::uuid RETURNING id::text AS id, kind, value`;
    return rows[0] ?? null;
  }

  async #adminEmails(ids: ReadonlyArray<string | null>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return new Map();
    const admins = await this.#db.platformAdmin.findMany({
      where: { id: { in: wanted } },
      select: { id: true, email: true },
    });
    return new Map(admins.map((admin) => [admin.id, admin.email]));
  }

  // --- Failed sign-ins ---------------------------------------------------------

  async failedLogins(hours: number) {
    const now = this.#now();
    const since = new Date(now - hours * 3_600_000);
    const [live, history, operator] = await Promise.all([
      this.#liveFailures(now),
      this.#tenantFailureHistory(since),
      this.#operatorFailures(since),
    ]);
    return {
      generated_at: new Date(now).toISOString(),
      hours,
      since: since.toISOString(),
      tenant: { live, history },
      operator,
    };
  }

  /**
   * The pre-authentication failure budget, read without spending it: every
   * `rl:authfail:<ip>` key still holding entries inside its 60-second window.
   * `SCAN`, never `KEYS`, and bounded — a Redis too busy to finish is reported
   * `truncated`, a Redis that cannot be read `unavailable`.
   */
  async #liveFailures(now: number) {
    const empty = {
      status: 'unavailable' as 'available' | 'unavailable',
      window_seconds: AUTH_FAILURE_WINDOW_SECONDS,
      limit: this.#authFailureLimit,
      addresses_total: 0,
      locked_total: 0,
      addresses: [] as Array<{ ip: string; failures: number; locked: boolean }>,
      truncated: false,
    };
    try {
      const keys: string[] = [];
      let cursor = '0';
      let rounds = 0;
      do {
        const [next, batch] = await this.#redis.scan(
          cursor,
          'MATCH',
          AUTH_FAILURE_KEY_PATTERN,
          'COUNT',
          SCAN_COUNT,
        );
        cursor = next;
        keys.push(...batch);
        rounds += 1;
      } while (cursor !== '0' && rounds < SCAN_MAX_ROUNDS);
      const truncated = cursor !== '0';

      const unique = [...new Set(keys)];
      const pipeline = this.#redis.pipeline();
      const windowStart = now - AUTH_FAILURE_WINDOW_SECONDS * 1000;
      for (const key of unique) pipeline.zcount(key, `(${windowStart}`, '+inf');
      const results = (await pipeline.exec()) ?? [];

      const addresses: Array<{ ip: string; failures: number; locked: boolean }> = [];
      unique.forEach((key, index) => {
        const [error, count] = results[index] ?? [null, 0];
        const failures = error ? 0 : Number(count);
        if (failures > 0) {
          addresses.push({
            ip: key.slice('rl:authfail:'.length),
            failures,
            locked: failures >= this.#authFailureLimit,
          });
        }
      });
      addresses.sort((a, b) => b.failures - a.failures || a.ip.localeCompare(b.ip));
      return {
        ...empty,
        status: 'available' as const,
        addresses_total: addresses.length,
        locked_total: addresses.filter((address) => address.locked).length,
        addresses: addresses.slice(0, LIVE_ADDRESSES_SHOWN),
        truncated,
      };
    } catch {
      return empty;
    }
  }

  /** The workspaces' `auth.login_failed` trail since `since`: by address and by workspace. */
  async #tenantFailureHistory(since: Date) {
    const byWorkspaceRows = await this.#db.$queryRaw<Array<{ key: string; n: number }>>`
      SELECT l.id::text AS key, c.n
      FROM licenses l
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS n FROM audit_log a
        WHERE a.license_id = l.id AND a.action = 'auth.login_failed' AND a.created_at >= ${since}
      ) c
      WHERE c.n > 0
      ORDER BY c.n DESC, l.id
      LIMIT 5000`;
    const byIpRows = await this.#db.$queryRaw<Array<{ key: string; n: number }>>`
      SELECT coalesce(a.ip, 'unknown') AS key, count(*)::int AS n
      FROM licenses l
      CROSS JOIN LATERAL (
        SELECT ip FROM audit_log
        WHERE license_id = l.id AND action = 'auth.login_failed' AND created_at >= ${since}
      ) a
      GROUP BY 1
      ORDER BY n DESC, key
      LIMIT ${TOP_SHOWN}`;
    return {
      total: byWorkspaceRows.reduce((sum, row) => sum + row.n, 0),
      by_ip: byIpRows.map(countedOf),
      by_workspace: byWorkspaceRows.slice(0, TOP_SHOWN).map(countedOf),
    };
  }

  /** This panel's own refused sign-ins and codes, from the platform chain. */
  async #operatorFailures(since: Date) {
    const rows = await this.#db.$queryRaw<Array<{ action: string; ip: string; n: number }>>`
      SELECT action, coalesce(ip, 'unknown') AS ip, count(*)::int AS n
      FROM platform_audit_log
      WHERE action IN ('admin.sign_in_failed', 'admin.totp_failed') AND created_at >= ${since}
      GROUP BY action, 2`;
    const byIp = new Map<string, number>();
    let signIn = 0;
    let totp = 0;
    for (const row of rows) {
      if (row.action === 'admin.sign_in_failed') signIn += row.n;
      else totp += row.n;
      byIp.set(row.ip, (byIp.get(row.ip) ?? 0) + row.n);
    }
    return {
      sign_in_failed: signIn,
      totp_failed: totp,
      by_ip: [...byIp.entries()]
        .map(([key, count]) => ({ key, count }))
        .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
        .slice(0, TOP_SHOWN),
    };
  }

  // --- Sign-ups by address -----------------------------------------------------

  /**
   * Sign-ups do not keep the address they came from (design.md §C security:
   * personal-data reduction), so there is nothing to count and no column was
   * added for it. Said plainly — an empty list would read as "no sign-ups".
   */
  signupsByIp(days: number) {
    return {
      status: 'not_available' as const,
      days,
      reason:
        'Sign-ups do not record the address they came from; no column was added for it (personal-data reduction).',
      data: [] as Counted[],
    };
  }

  // --- Abuse counters ----------------------------------------------------------

  async abuseCounters() {
    const now = this.#now();
    const day = new Date(now).toISOString().slice(0, 10);
    const [invites, widgetQuota, widgetChallenge] = await Promise.all([
      this.#inviteCounter(day),
      this.#quotaCounter(day),
      this.#challengeCounter(),
    ]);
    return {
      generated_at: new Date(now).toISOString(),
      invites,
      widget_quota: widgetQuota,
      widget_challenge: widgetChallenge,
    };
  }

  async #tableExists(name: string): Promise<boolean> {
    const rows = await this.#db.$queryRaw<Array<{ present: boolean }>>`
      SELECT to_regclass(${`public.${name}`}) IS NOT NULL AS present`;
    return rows[0]?.present === true;
  }

  /** Workspaces that sent their whole daily invitation allowance today (UTC day). */
  async #inviteCounter(day: string) {
    const base = {
      limit_per_day: INVITES_PER_DAY,
      workspaces_at_limit: 0,
      workspaces: [] as Counted[],
    };
    if (!(await this.#tableExists('audit_log'))) {
      return { status: 'not_installed' as AbuseCounterStatus, ...base };
    }
    const rows = await this.#db.$queryRaw<Array<{ key: string; n: number }>>`
      SELECT l.id::text AS key, c.n
      FROM licenses l
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS n FROM audit_log a
        WHERE a.license_id = l.id AND a.action = 'member.invited'
          AND a.created_at >= ${day}::date::timestamptz
      ) c
      WHERE c.n >= ${INVITES_PER_DAY}
      ORDER BY c.n DESC, l.id
      LIMIT 5000`;
    return {
      status: 'available' as AbuseCounterStatus,
      limit_per_day: INVITES_PER_DAY,
      workspaces_at_limit: rows.length,
      workspaces: rows.slice(0, TOP_SHOWN).map(countedOf),
    };
  }

  /**
   * Members who used their whole per-member AI allowance on `day` — each
   * workspace's default-brand `ai_turns_per_customer_day` (0 is "no allowance",
   * so nobody reaches it). `day` is the UTC date; a workspace whose
   * conversation day starts elsewhere has its rows filed under its own date.
   */
  async #quotaCounter(day: string) {
    const base = { day, members_at_cap: 0, workspaces_affected: 0, workspaces: [] as Counted[] };
    if (!(await this.#tableExists('ai_customer_daily_usage'))) {
      return { status: 'not_installed' as AbuseCounterStatus, ...base };
    }
    const rows = await this.#db.$queryRaw<Array<{ key: string; n: number }>>`
      SELECT l.id::text AS key, c.n
      FROM licenses l
      CROSS JOIN LATERAL (
        SELECT coalesce(
          (SELECT s.ai_turns_per_customer_day
             FROM security_settings s
             JOIN brands b ON b.id = s.brand_id
            WHERE s.license_id = l.id AND b.is_default
            LIMIT 1),
          ${AI_TURNS_PER_CUSTOMER_DAY_DEFAULT}
        ) AS cap
      ) k
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS n FROM ai_customer_daily_usage u
        WHERE u.license_id = l.id AND u.day = ${day}::date AND k.cap > 0 AND u.ai_turns >= k.cap
      ) c
      WHERE c.n > 0
      ORDER BY c.n DESC, l.id
      LIMIT 5000`;
    return {
      status: 'available' as AbuseCounterStatus,
      day,
      members_at_cap: rows.reduce((sum, row) => sum + row.n, 0),
      workspaces_affected: rows.length,
      workspaces: rows.slice(0, TOP_SHOWN).map(countedOf),
    };
  }

  /** The human check is logged, not counted: only the component's own state is there to show. */
  async #challengeCounter(): Promise<{
    status: AbuseCounterStatus;
    component: ComponentStatus | null;
  }> {
    const statuses = await readComponentStatuses(this.#redis).catch(() => []);
    const component = statuses.find((status) => status.key === 'captcha') ?? null;
    return { status: 'not_available', component };
  }
}

function countedOf(row: { key: string; n: number }): Counted {
  return { key: row.key, count: row.n };
}

function invalidValueMessage(kind: PlatformBlocklistKind): string {
  switch (kind) {
    case 'email':
      return 'Enter a full e-mail address, such as person@example.com.';
    case 'domain':
      return 'Enter a domain such as example.com (its subdomains are covered too).';
    case 'ip':
      return 'Enter an IP address or a CIDR range, such as 203.0.113.7 or 203.0.113.0/24.';
  }
}

function viewOf(
  row: {
    id: string;
    kind: string;
    value: string;
    reason: string | null;
    createdBy: string | null;
    createdAt: Date;
  },
  emails: Map<string, string>,
): BlocklistEntryView {
  return {
    id: row.id,
    kind: row.kind as PlatformBlocklistKind,
    value: row.value,
    reason: row.reason,
    created_by: row.createdBy,
    created_by_email: row.createdBy ? (emails.get(row.createdBy) ?? null) : null,
    created_at: row.createdAt.toISOString(),
  };
}
