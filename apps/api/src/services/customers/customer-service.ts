/**
 * Customer directory.
 *
 * Two deliberate choices about counts and identity:
 *
 * `customers.chats_count` and `tickets_count` exist in the schema (PRD §8.4)
 * but no write path has ever maintained them. Reading them back would report 0
 * for every customer, forever, and look authoritative doing it. These queries
 * count the related rows instead. It costs a join; it is not wrong.
 *
 * Customers belong to an *organization*, while almost everything else in the
 * product is scoped to a *license*. A customer who wrote to two workspaces of
 * the same company is one person, and the chat/ticket counts here are therefore
 * narrowed to the caller's license — otherwise an agent would see totals that
 * include conversations they can never open.
 */
import type { Prisma } from '@prisma/client';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

export type CustomerSegment = 'all' | 'leads' | 'recent' | 'banned';

export interface ListOptions {
  query?: string;
  segment: CustomerSegment;
  limit: number;
  pageId?: string;
}

export interface CustomerSummary {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  country_code: string | null;
  country: string | null;
  is_lead: boolean;
  banned: boolean;
  chats_count: number;
  tickets_count: number;
  last_activity_at: string | null;
  created_at: string;
}

export interface CustomerDetail extends CustomerSummary {
  banned_at: string | null;
  visits: Array<{
    id: string;
    came_from: string | null;
    pages: unknown;
    os: string | null;
    browser: string | null;
    started_at: string;
    ended_at: string | null;
  }>;
  chats: Array<{
    id: string;
    active: boolean;
    created_at: string;
    last_event_at: string | null;
  }>;
}

/** Ordering is (last_activity_at DESC, id DESC), so the cursor carries both. */
interface Cursor {
  lastActivityAt: string | null;
  id: string;
}

const RECENT_WINDOW_DAYS = 30;
const MAX_VISITS = 10;
const MAX_CHATS = 10;

export class CustomerService {
  async list(
    tx: TenantClient,
    tenant: TenantContext,
    options: ListOptions,
  ): Promise<{ items: CustomerSummary[]; total: number; nextPageId?: string }> {
    const where = this.#where(tenant, options);
    const cursor = decodeCursor(options.pageId);

    // Fetch one extra to learn whether another page exists, without a second
    // count query that could disagree with the page under concurrent writes.
    const [rows, total] = await Promise.all([
      tx.customer.findMany({
        where: cursor ? { AND: [where, cursorPredicate(cursor)] } : where,
        // `nulls: 'last'` is stated rather than left to the database. Postgres
        // defaults DESC to NULLS FIRST, which would put every never-active
        // visitor above the people who wrote in this morning — and, worse,
        // silently disagree with the keyset predicate below, ending pagination
        // early and hiding customers with no error anywhere.
        orderBy: [{ lastActivityAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        take: options.limit + 1,
        include: this.#counts(tenant),
      }),
      tx.customer.count({ where }),
    ]);

    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const last = page.at(-1);

    return {
      items: page.map(toSummary),
      total,
      ...(hasMore && last
        ? {
            nextPageId: encodeCursor({
              lastActivityAt: last.lastActivityAt?.toISOString() ?? null,
              id: last.id,
            }),
          }
        : {}),
    };
  }

  async get(
    tx: TenantClient,
    tenant: TenantContext,
    customerId: string,
  ): Promise<CustomerDetail | null> {
    const customer = await tx.customer.findFirst({
      where: { id: customerId },
      include: {
        ...this.#counts(tenant),
        visits: {
          where: { licenseId: tenant.licenseId },
          orderBy: { startedAt: 'desc' },
          take: MAX_VISITS,
        },
        chats: {
          where: { licenseId: tenant.licenseId },
          orderBy: { createdAt: 'desc' },
          take: MAX_CHATS,
          include: {
            threads: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { createdAt: true, closedAt: true },
            },
          },
        },
      },
    });
    if (!customer) return null;

    return {
      ...toSummary(customer),
      banned_at: customer.bannedAt?.toISOString() ?? null,
      visits: customer.visits.map((visit) => ({
        id: visit.id,
        came_from: visit.cameFrom,
        pages: visit.pages,
        os: visit.os,
        browser: visit.browser,
        started_at: visit.startedAt.toISOString(),
        ended_at: visit.endedAt?.toISOString() ?? null,
      })),
      chats: customer.chats.map((chat) => ({
        id: chat.id,
        active: chat.active,
        created_at: chat.createdAt.toISOString(),
        last_event_at: chat.threads[0]?.createdAt.toISOString() ?? null,
      })),
    };
  }

  /**
   * Record a page view against the customer's current visit.
   *
   * A visit is continued rather than created when the last one is still recent:
   * a visitor clicking through five pages is one visit, and one row per page
   * would make the history unreadable and the table enormous.
   */
  async recordPageView(
    tx: TenantClient,
    tenant: TenantContext,
    input: {
      customerId: string;
      url: string;
      referrer?: string | undefined;
      userAgent?: string | undefined;
      ip?: string | undefined;
    },
  ): Promise<void> {
    const since = new Date(Date.now() - 30 * 60_000);
    const current = await tx.visit.findFirst({
      where: {
        customerId: input.customerId,
        licenseId: tenant.licenseId,
        startedAt: { gte: since },
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true, pages: true },
    });

    const entry = { url: input.url.slice(0, 2048), at: new Date().toISOString() };

    if (current) {
      const pages = Array.isArray(current.pages) ? (current.pages as unknown[]) : [];
      // Consecutive duplicates are noise — a reload is not a new page.
      const lastUrl = (pages.at(-1) as { url?: string } | undefined)?.url;
      if (lastUrl === entry.url) return;

      await tx.visit.update({
        where: { id: current.id },
        // Bounded: a visitor who leaves a tab open for hours must not grow one
        // JSON column without limit.
        data: { pages: [...pages, entry].slice(-50) as Prisma.InputJsonValue },
      });
      return;
    }

    await tx.visit.create({
      data: {
        customerId: input.customerId,
        licenseId: tenant.licenseId,
        cameFrom: input.referrer?.slice(0, 2048) ?? null,
        pages: [entry] as Prisma.InputJsonValue,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        os: detectOs(input.userAgent),
        browser: detectBrowser(input.userAgent),
        ip: input.ip ?? null,
      },
    });
  }

  #where(tenant: TenantContext, options: ListOptions): Prisma.CustomerWhereInput {
    const filters: Prisma.CustomerWhereInput[] = [{ organizationId: tenant.organizationId }];

    if (options.query) {
      const contains = options.query.trim();
      filters.push({
        OR: [
          { name: { contains, mode: 'insensitive' } },
          { email: { contains, mode: 'insensitive' } },
          { phone: { contains } },
        ],
      });
    }

    switch (options.segment) {
      case 'leads':
        filters.push({ isLead: true });
        break;
      case 'recent':
        filters.push({
          lastActivityAt: { gte: new Date(Date.now() - RECENT_WINDOW_DAYS * 86_400_000) },
        });
        break;
      case 'banned':
        filters.push({ bannedAt: { not: null } });
        break;
      case 'all':
        break;
    }

    return filters.length === 1 ? filters[0]! : { AND: filters };
  }

  /** Counts restricted to the caller's license — see the note at the top. */
  #counts(tenant: TenantContext) {
    return {
      _count: {
        select: {
          chats: { where: { licenseId: tenant.licenseId } },
          tickets: { where: { licenseId: tenant.licenseId } },
        },
      },
    } satisfies Prisma.CustomerInclude;
  }
}

type CustomerRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  countryCode: string | null;
  country: string | null;
  isLead: boolean;
  bannedAt: Date | null;
  lastActivityAt: Date | null;
  createdAt: Date;
  _count: { chats: number; tickets: number };
};

function toSummary(row: CustomerRow): CustomerSummary {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    country_code: row.countryCode,
    country: row.country,
    is_lead: row.isLead,
    banned: row.bannedAt !== null,
    chats_count: row._count.chats,
    tickets_count: row._count.tickets,
    last_activity_at: row.lastActivityAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * Keyset predicate for (last_activity_at DESC, id DESC).
 *
 * Customers who have never been active have a null `last_activity_at`, and
 * Postgres sorts nulls last on DESC. Once the cursor reaches them, ordering
 * continues on id alone — without this branch the comparison against null would
 * match nothing and the page would end early, silently hiding every inactive
 * customer.
 */
function cursorPredicate(cursor: Cursor): Prisma.CustomerWhereInput {
  if (cursor.lastActivityAt === null) {
    return { lastActivityAt: null, id: { lt: cursor.id } };
  }
  const at = new Date(cursor.lastActivityAt);
  return {
    OR: [
      { lastActivityAt: { lt: at } },
      { lastActivityAt: at, id: { lt: cursor.id } },
      { lastActivityAt: null },
    ],
  };
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(pageId: string | undefined): Cursor | null {
  if (!pageId) return null;
  try {
    const parsed = JSON.parse(Buffer.from(pageId, 'base64url').toString('utf8')) as Cursor;
    // A malformed cursor is treated as no cursor rather than an error: it is
    // almost always a stale bookmark, and failing the whole request for that is
    // worse than starting from the top.
    return typeof parsed?.id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function detectOs(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  if (/Windows/i.test(userAgent)) return 'Windows';
  if (/iPhone|iPad|iOS/i.test(userAgent)) return 'iOS';
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'macOS';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return null;
}

function detectBrowser(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  // Order matters: Edge and Chrome both claim Safari, Chrome claims Safari too.
  if (/Edg\//i.test(userAgent)) return 'Edge';
  if (/OPR\/|Opera/i.test(userAgent)) return 'Opera';
  if (/Firefox\//i.test(userAgent)) return 'Firefox';
  if (/Chrome\//i.test(userAgent)) return 'Chrome';
  if (/Safari\//i.test(userAgent)) return 'Safari';
  return null;
}
