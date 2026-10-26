/**
 * What the root panel reads about workspaces (tm 389.9 · FR-ADMIN-08 · design.md §C).
 *
 * Counts, states and identities. A message, a player, a knowledge article or a
 * ticket body never enters a response from here (requirements §2 — content is
 * reached by impersonation, 389.15, and nowhere else); the member list is the
 * one place a person is named, because a support desk cannot work without the
 * address it is answering.
 *
 * Reads as `siyahtus_platform` (BYPASSRLS) through `app.platformDb`. Nothing
 * here runs inside `withTenant`, so **every query names the licence it reads**
 * — the filter is the boundary, not a redundancy, and the cross-visibility
 * suite (`platform-workspaces.test.ts`) is what holds each one to it. The
 * billing views are the tenant API's own builders (`billing-views.ts`,
 * `invoice-service.ts`, `metering.ts`), which name their licence for the same
 * reason.
 */
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AGENT_ROLES, type SandboxSummary } from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { buildSubscriptionView, usageConfig } from '../billing/billing-views.js';
import { listInvoices, type Invoice } from '../billing/invoice-service.js';
import { currentPeriod, usageSummary, type UsageSummary } from '../billing/metering.js';
import { readSandbox } from '../billing/sandbox-service.js';
import { TRIAL_PLAN } from '../../lib/entitlements.js';

export const WORKSPACE_SORTS = [
  'created_desc',
  'created_asc',
  'name_asc',
  'trial_ends_asc',
] as const;
export type WorkspaceSort = (typeof WORKSPACE_SORTS)[number];

export const WORKSPACE_LIST_DEFAULT = 25;
export const WORKSPACE_LIST_MAX = 50;
export const USAGE_DAYS_DEFAULT = 30;
export const USAGE_DAYS_MAX = 90;
const USAGE_PERIODS = 12;
const STATUS_HISTORY_MAX = 20;
const IMPERSONATIONS_MAX = 100;
const DAY_MS = 86_400_000;

/**
 * The platform audit actions that change what a workspace may do — its
 * status history. A plan change or an override is not a status.
 */
export const WORKSPACE_STATUS_ACTIONS = [
  'workspace.trial_extended',
  'workspace.activated',
  'workspace.suspended',
  'workspace.unsuspended',
  'workspace.read_only_set',
  'workspace.active_set',
  'workspace.cancelled',
  'workspace.resumed',
  'workspace.deletion_scheduled',
  'workspace.deletion_cancelled',
] as const;

export interface WorkspaceListFilter {
  status?: string;
  plan?: string;
  region?: string;
  trialEndsBefore?: Date;
  q?: string;
  sort: WorkspaceSort;
  cursor?: string;
  limit?: number;
}

export interface WorkspaceSummary {
  license_id: string;
  organization_name: string;
  region: string;
  status: string;
  plan: string;
  trial_ends_at: string | null;
  created_at: string;
  owner_email: string | null;
  member_count: number;
}

export interface WorkspaceDetail {
  license_id: string;
  organization: {
    id: string;
    name: string;
    region: string;
    timezone: string;
    sector: string | null;
    company_size: string | null;
    created_at: string;
  };
  license: {
    status: string;
    plan: string;
    billing_cycle: string;
    trial_ends_at: string | null;
    suspended_at: string | null;
    suspended_reason: string | null;
    purge_scheduled_at: string | null;
    onboarding_completed_at: string | null;
    terms_accepted_at: string | null;
    sandbox_of_license_id: string | null;
    created_at: string;
  };
  owner: {
    account_id: string;
    name: string;
    email: string;
    email_verified_at: string | null;
  } | null;
  counts: {
    members: number;
    brands: number;
    customers: number;
    chats: number;
    tickets: number;
    ai_agents: number;
  };
  status_history: Array<{
    action: string;
    at: string;
    admin_id: string | null;
    reason: string | null;
  }>;
}

export interface WorkspaceMember {
  account_id: string;
  name: string;
  email: string;
  role: string;
  suspended: boolean;
  two_factor_enabled: boolean;
  joined_at: string;
  last_seen_at: string | null;
}

export interface WorkspaceNote {
  id: string;
  license_id: string;
  admin_id: string;
  admin_email: string | null;
  body: string;
  created_at: string;
}

/** The cursor did not come from this list with these filters. */
export class WorkspaceCursorError extends Error {}

const iso = (at: Date | null): string | null => (at === null ? null : at.toISOString());
const pad = (value: number) => String(value).padStart(2, '0');

function isoDate(at: Date): string {
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(1, Math.floor(value)), max);
}

/** `%`, `_` and the escape itself, literal inside an `ILIKE` pattern. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * One sort key per order, plus the licence number. Timestamps are compared
 * as epoch milliseconds — the precision a cursor written by JavaScript keeps
 * (a microsecond the client cannot echo would skip or repeat a row).
 */
const SORT_SQL: Record<WorkspaceSort, { key: string; direction: 'ASC' | 'DESC' }> = {
  created_desc: {
    key: 'floor(extract(epoch FROM l.created_at) * 1000)::bigint',
    direction: 'DESC',
  },
  created_asc: { key: 'floor(extract(epoch FROM l.created_at) * 1000)::bigint', direction: 'ASC' },
  name_asc: { key: 'lower(o.name)', direction: 'ASC' },
  // A trial with no end sorts last.
  trial_ends_asc: {
    key: 'COALESCE(floor(extract(epoch FROM l.trial_ends_at) * 1000)::bigint, 9223372036854775807)',
    direction: 'ASC',
  },
};

interface ListCursor {
  /** Which list wrote it: sort and filters, hashed. */
  f: string;
  /** The last row's sort key, as text. */
  k: string;
  id: string;
}

function filterFingerprint(filter: WorkspaceListFilter): string {
  const shape = JSON.stringify([
    filter.sort,
    filter.status ?? null,
    filter.plan ?? null,
    filter.region ?? null,
    filter.trialEndsBefore?.toISOString() ?? null,
    filter.q ?? null,
  ]);
  return createHash('sha256').update(shape).digest('base64url').slice(0, 16);
}

function encodeListCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeListCursor(raw: string, fingerprint: string): ListCursor {
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<ListCursor>;
    if (
      value.f === fingerprint &&
      typeof value.k === 'string' &&
      typeof value.id === 'string' &&
      /^[1-9]\d{0,18}$/.test(value.id)
    ) {
      return { f: value.f, k: value.k, id: value.id };
    }
  } catch {
    // fall through
  }
  throw new WorkspaceCursorError();
}

interface ListRow {
  id: bigint;
  name: string;
  region: string;
  status: string;
  trial_ends_at: Date | null;
  created_at: Date;
  plan: string;
  owner_email: string | null;
  member_count: number;
  sort_key: string;
}

interface NoteCursor {
  at: string;
  id: string;
}

function encodeNoteCursor(cursor: NoteCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeNoteCursor(raw: string): NoteCursor {
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<NoteCursor>;
    if (
      typeof value.at === 'string' &&
      !Number.isNaN(Date.parse(value.at)) &&
      typeof value.id === 'string' &&
      /^[0-9a-f-]{36}$/i.test(value.id)
    ) {
      return { at: value.at, id: value.id };
    }
  } catch {
    // fall through
  }
  throw new WorkspaceCursorError();
}

export interface PlatformWorkspacesOptions {
  env: Env;
  now?: () => number;
}

export class PlatformWorkspaces {
  readonly #db: PrismaClient;
  readonly #env: Env;
  readonly #now: () => number;

  constructor(db: PrismaClient, options: PlatformWorkspacesOptions) {
    this.#db = db;
    this.#env = options.env;
    this.#now = options.now ?? Date.now;
  }

  /** The tenant API's builders take a tenant client; this connection is one without RLS. */
  get #tx(): TenantClient {
    return this.#db as unknown as TenantClient;
  }

  /** The workspace's tenant context, or null — an unknown licence is a 404, not a 500. */
  async tenant(licenseId: bigint): Promise<(TenantContext & { region: string }) | null> {
    const license = await this.#db.license.findUnique({
      where: { id: licenseId },
      select: { id: true, organizationId: true, organization: { select: { region: true } } },
    });
    if (!license) return null;
    return {
      licenseId: license.id,
      organizationId: license.organizationId,
      region: license.organization.region,
    };
  }

  async list(
    filter: WorkspaceListFilter,
  ): Promise<{ data: WorkspaceSummary[]; next_cursor: string | null }> {
    const limit = clamp(filter.limit, WORKSPACE_LIST_DEFAULT, WORKSPACE_LIST_MAX);
    const fingerprint = filterFingerprint(filter);
    const cursor = filter.cursor ? decodeListCursor(filter.cursor, fingerprint) : null;
    const sort = SORT_SQL[filter.sort];
    const key = Prisma.raw(sort.key);
    const direction = Prisma.raw(sort.direction);
    const plan = Prisma.sql`COALESCE(s.plan, ${TRIAL_PLAN})`;

    const conditions: Prisma.Sql[] = [Prisma.sql`l.sandbox_of_license_id IS NULL`];
    if (filter.status) conditions.push(Prisma.sql`l.status = ${filter.status}`);
    if (filter.region) conditions.push(Prisma.sql`o.region = ${filter.region}`);
    if (filter.plan) conditions.push(Prisma.sql`${plan} = ${filter.plan}`);
    if (filter.trialEndsBefore) {
      conditions.push(
        Prisma.sql`l.trial_ends_at IS NOT NULL AND l.trial_ends_at < ${filter.trialEndsBefore}`,
      );
    }
    if (filter.q) {
      const pattern = likePattern(filter.q);
      const byNumber = /^[1-9]\d{0,18}$/.test(filter.q)
        ? Prisma.sql` OR l.id = ${BigInt(filter.q)}`
        : Prisma.empty;
      conditions.push(
        Prisma.sql`(o.name ILIKE ${pattern} OR ow.email ILIKE ${pattern}${byNumber})`,
      );
    }
    if (cursor) {
      const keyValue =
        filter.sort === 'name_asc' ? Prisma.sql`${cursor.k}` : Prisma.sql`${cursor.k}::bigint`;
      const op = Prisma.raw(sort.direction === 'DESC' ? '<' : '>');
      conditions.push(Prisma.sql`(${key}, l.id) ${op} (${keyValue}, ${BigInt(cursor.id)})`);
    }

    const rows = await this.#db.$queryRaw<ListRow[]>`
      SELECT l.id, o.name, o.region, l.status, l.trial_ends_at, l.created_at,
             ${plan} AS plan, ow.email AS owner_email,
             (SELECT count(*)::int FROM agent_memberships m WHERE m.license_id = l.id) AS member_count,
             (${key})::text AS sort_key
      FROM licenses l
      JOIN organizations o ON o.id = l.organization_id
      LEFT JOIN LATERAL (
        SELECT plan FROM subscriptions WHERE license_id = l.id ORDER BY created_at DESC LIMIT 1
      ) s ON true
      LEFT JOIN LATERAL (
        SELECT a.email::text AS email FROM agent_memberships m
        JOIN accounts a ON a.id = m.agent_id
        WHERE m.license_id = l.id AND m.role = 'owner'
        ORDER BY m.created_at LIMIT 1
      ) ow ON true
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY ${key} ${direction}, l.id ${direction}
      LIMIT ${limit + 1}`;

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => ({
        license_id: row.id.toString(),
        organization_name: row.name,
        region: row.region,
        status: row.status,
        plan: row.plan,
        trial_ends_at: iso(row.trial_ends_at),
        created_at: row.created_at.toISOString(),
        owner_email: row.owner_email,
        member_count: row.member_count,
      })),
      next_cursor:
        rows.length > limit && last
          ? encodeListCursor({ f: fingerprint, k: last.sort_key, id: last.id.toString() })
          : null,
    };
  }

  async detail(licenseId: bigint): Promise<WorkspaceDetail | null> {
    const license = await this.#db.license.findUnique({
      where: { id: licenseId },
      include: { organization: true },
    });
    if (!license) return null;

    const [owner, subscription, members, brands, customers, chats, tickets, aiAgents, history] =
      await Promise.all([
        this.#db.agentMembership.findFirst({
          where: { licenseId, role: 'owner' },
          orderBy: { createdAt: 'asc' },
          select: {
            agent: { select: { id: true, name: true, email: true, emailVerifiedAt: true } },
          },
        }),
        this.#db.subscription.findFirst({
          where: { licenseId },
          orderBy: { createdAt: 'desc' },
          select: { plan: true, billingCycle: true },
        }),
        this.#db.agentMembership.count({ where: { licenseId } }),
        this.#db.brand.count({ where: { licenseId } }),
        this.#db.customer.count({ where: { organizationId: license.organizationId } }),
        this.#db.chat.count({ where: { licenseId } }),
        this.#db.ticket.count({ where: { licenseId } }),
        this.#db.aiAgent.count({ where: { licenseId } }),
        this.#db.platformAuditLog.findMany({
          where: { licenseId, action: { in: [...WORKSPACE_STATUS_ACTIONS] } },
          orderBy: { chainSeq: 'desc' },
          take: STATUS_HISTORY_MAX,
          select: { action: true, createdAt: true, adminId: true, reason: true },
        }),
      ]);

    return {
      license_id: license.id.toString(),
      organization: {
        id: license.organization.id,
        name: license.organization.name,
        region: license.organization.region,
        timezone: license.organization.timezone,
        sector: license.organization.sector,
        company_size: license.organization.companySize,
        created_at: license.organization.createdAt.toISOString(),
      },
      license: {
        status: license.status,
        plan: subscription?.plan ?? TRIAL_PLAN,
        billing_cycle: subscription?.billingCycle ?? license.billingCycle,
        trial_ends_at: iso(license.trialEndsAt),
        suspended_at: iso(license.suspendedAt),
        suspended_reason: license.suspendedReason,
        purge_scheduled_at: iso(license.purgeScheduledAt),
        onboarding_completed_at: iso(license.onboardingCompletedAt),
        terms_accepted_at: iso(license.termsAcceptedAt),
        sandbox_of_license_id: license.sandboxOfLicenseId?.toString() ?? null,
        created_at: license.createdAt.toISOString(),
      },
      owner: owner
        ? {
            account_id: owner.agent.id,
            name: owner.agent.name,
            email: owner.agent.email,
            email_verified_at: iso(owner.agent.emailVerifiedAt),
          }
        : null,
      counts: { members, brands, customers, chats, tickets, ai_agents: aiAgents },
      status_history: [
        ...history.map((entry) => ({
          action: entry.action,
          at: entry.createdAt.toISOString(),
          admin_id: entry.adminId,
          reason: entry.reason,
        })),
        { action: 'created', at: license.createdAt.toISOString(), admin_id: null, reason: null },
      ],
    };
  }

  /** Kurucu first, then by role as `AGENT_ROLES` ranks them, then by who joined first. */
  async members(licenseId: bigint): Promise<WorkspaceMember[]> {
    const rows = await this.#db.agentMembership.findMany({
      where: { licenseId },
      orderBy: { createdAt: 'asc' },
      select: {
        role: true,
        suspended: true,
        twoFactorEnabled: true,
        createdAt: true,
        agent: { select: { id: true, name: true, email: true, lastSeenAt: true } },
      },
    });
    const rank = (role: string) => {
      const index = (AGENT_ROLES as readonly string[]).indexOf(role);
      return index === -1 ? AGENT_ROLES.length : index;
    };
    return rows
      .map((row, position) => ({ row, position }))
      .sort((a, b) => rank(a.row.role) - rank(b.row.role) || a.position - b.position)
      .map(({ row }) => ({
        account_id: row.agent.id,
        name: row.agent.name,
        email: row.agent.email,
        role: row.role,
        suspended: row.suspended,
        two_factor_enabled: row.twoFactorEnabled,
        joined_at: row.createdAt.toISOString(),
        last_seen_at: iso(row.agent.lastSeenAt),
      }));
  }

  async brands(
    licenseId: bigint,
  ): Promise<
    Array<{ id: string; name: string; slug: string; is_default: boolean; created_at: string }>
  > {
    const rows = await this.#db.brand.findMany({
      where: { licenseId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, slug: true, isDefault: true, createdAt: true },
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      is_default: row.isDefault,
      created_at: row.createdAt.toISOString(),
    }));
  }

  async usage(
    tenant: TenantContext,
    days: number,
  ): Promise<{
    current: UsageSummary;
    periods: Array<{ period: string; metric: string; quantity: number; included: number }>;
    days: number;
    ai_daily: Array<{ date: string; llm: number; embedding: number }>;
  }> {
    const today = new Date(this.#now());
    const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const startMs = todayMs - (days - 1) * DAY_MS;
    const dayKeys = Array.from({ length: days }, (_, index) =>
      isoDate(new Date(startMs + index * DAY_MS)),
    );
    const firstPeriodDate = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (USAGE_PERIODS - 1), 1),
    );
    const firstPeriod = currentPeriod(firstPeriodDate);

    const [current, records, daily] = await Promise.all([
      usageSummary(this.#tx, tenant, usageConfig(this.#env)),
      this.#db.usageRecord.findMany({
        where: { licenseId: tenant.licenseId, period: { gte: firstPeriod } },
        orderBy: [{ period: 'desc' }, { metric: 'asc' }],
        select: { period: true, metric: true, quantity: true, included: true },
      }),
      this.#db.aiDailyUsage.findMany({
        where: {
          licenseId: tenant.licenseId,
          day: { in: dayKeys.map((day) => day.replaceAll('-', '')) },
          meter: { in: ['llm', 'embedding'] },
        },
        select: { day: true, meter: true, used: true },
      }),
    ]);

    const used = new Map(daily.map((row) => [`${row.day}:${row.meter}`, Number(row.used)]));
    return {
      current,
      periods: records.map((row) => ({
        period: row.period,
        metric: row.metric,
        quantity: Number(row.quantity),
        included: Number(row.included),
      })),
      days,
      ai_daily: dayKeys.map((date) => {
        const day = date.replaceAll('-', '');
        return {
          date,
          llm: used.get(`${day}:llm`) ?? 0,
          embedding: used.get(`${day}:embedding`) ?? 0,
        };
      }),
    };
  }

  subscription(tenant: TenantContext): Promise<Record<string, unknown>> {
    return buildSubscriptionView(this.#tx, tenant, this.#env);
  }

  invoices(tenant: TenantContext): Promise<Invoice[]> {
    return listInvoices(this.#tx, tenant, this.#env);
  }

  async sandbox(tenant: TenantContext & { region: string }): Promise<{
    is_sandbox: boolean;
    sandbox_of_license_id: string | null;
    sandbox: SandboxSummary | null;
  }> {
    const [rows, self] = await Promise.all([
      readSandbox(this.#tx, tenant, tenant.region as SandboxSummary['region']),
      this.#db.license.findUnique({
        where: { id: tenant.licenseId },
        select: { sandboxOfLicenseId: true },
      }),
    ]);
    return {
      is_sandbox: rows.isSandbox,
      sandbox_of_license_id: self?.sandboxOfLicenseId?.toString() ?? null,
      sandbox: rows.sandbox,
    };
  }

  async notes(
    licenseId: bigint,
    options: { cursor?: string; limit?: number },
  ): Promise<{ data: WorkspaceNote[]; next_cursor: string | null }> {
    const limit = clamp(options.limit, WORKSPACE_LIST_DEFAULT, WORKSPACE_LIST_MAX);
    const cursor = options.cursor ? decodeNoteCursor(options.cursor) : null;
    const rows = await this.#db.platformNote.findMany({
      where: {
        licenseId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: new Date(cursor.at) } },
                { createdAt: new Date(cursor.at), id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { admin: { select: { email: true } } },
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map(noteOf),
      next_cursor:
        rows.length > limit && last
          ? encodeNoteCursor({ at: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async impersonations(licenseId: bigint): Promise<
    Array<{
      id: string;
      admin_id: string;
      admin_email: string | null;
      account_id: string;
      mode: string;
      started_at: string;
      ends_at: string;
      ended_at: string | null;
      end_reason: string | null;
    }>
  > {
    const rows = await this.#db.platformImpersonationSession.findMany({
      where: { licenseId },
      orderBy: { startedAt: 'desc' },
      take: IMPERSONATIONS_MAX,
      include: { admin: { select: { email: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      admin_id: row.adminId,
      admin_email: row.admin.email,
      account_id: row.accountId,
      mode: row.mode,
      started_at: row.startedAt.toISOString(),
      ends_at: row.endsAt.toISOString(),
      ended_at: iso(row.endedAt),
      end_reason: row.endReason,
    }));
  }

  async aiSummary(licenseId: bigint): Promise<{ ai_agents: { total: number; active: number } }> {
    const [total, active] = await Promise.all([
      this.#db.aiAgent.count({ where: { licenseId } }),
      this.#db.aiAgent.count({ where: { licenseId, active: true } }),
    ]);
    return { ai_agents: { total, active } };
  }
}

/**
 * Within `tx`, so the note and its audit entries commit together
 * (`app.platformAuditLog.run`).
 */
export async function addWorkspaceNote(
  tx: Prisma.TransactionClient,
  input: { licenseId: bigint; adminId: string; body: string },
): Promise<WorkspaceNote> {
  const row = await tx.platformNote.create({
    // Stamped here rather than by `now()`: the list's cursor is written by JavaScript, which
    // keeps milliseconds, and an equal-time tie must compare equal to it.
    data: {
      licenseId: input.licenseId,
      adminId: input.adminId,
      body: input.body,
      createdAt: new Date(),
    },
    include: { admin: { select: { email: true } } },
  });
  return noteOf(row);
}

function noteOf(row: {
  id: string;
  licenseId: bigint;
  adminId: string;
  body: string;
  createdAt: Date;
  admin: { email: string } | null;
}): WorkspaceNote {
  return {
    id: row.id,
    license_id: row.licenseId.toString(),
    admin_id: row.adminId,
    admin_email: row.admin?.email ?? null,
    body: row.body,
    created_at: row.createdAt.toISOString(),
  };
}
