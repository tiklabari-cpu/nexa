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
 * Since the member's day (ID-02 · K1 = A) a chat is one customer's day and a
 * thread one visit inside it, so the conversation count comes as a pair:
 * `chats_count` (days — "Thread ID" in the panel) and `connections_count`
 * (visits — "Chat ID"). Reports, SLA, AI resolutions and ratings all count
 * per connection; the pair is what keeps the profile agreeing with them.
 *
 * Customers belong to an *organization*, while almost everything else in the
 * product is scoped to a *license*. A customer who wrote to two workspaces of
 * the same company is one person, and the chat/ticket counts here are therefore
 * narrowed to the caller's license — otherwise an agent would see totals that
 * include conversations they can never open.
 */
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_CUSTOMER_SORT_KEY,
  sanitizeReferrer,
  type CustomerSortKey,
  type CustomFieldType,
  type CustomFieldValue,
  type FormPlacement,
  type SortOrder,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { readCustomFieldValues } from '../custom-fields/custom-field-service.js';
import { visitedPagesOf, visitorPageUrls } from '../campaigns/campaign-matching.js';
import type { GeoLocation } from '../geo/geo-locator.js';
import { maskPlayerContact } from './player-contact.js';

export type CustomerSegment = 'all' | 'leads' | 'recent' | 'banned';

export interface ListOptions {
  query?: string;
  segment: CustomerSegment;
  limit: number;
  pageId?: string;
  /** Exact match, already upper-cased by the caller (route validates the shape). */
  countryCode?: string;
  /** `YYYY-MM-DD`, inclusive of the whole day in UTC. */
  lastActivityFrom?: string;
  lastActivityTo?: string;
  /** Restricts to customers with (`true`) or without (`false`) a ticket in the caller's license. */
  hasTickets?: boolean;
  /** Column the whole collection is ordered by; defaults to most recent activity. */
  sort?: CustomerSortKey;
  order?: SortOrder;
  /**
   * Whether the caller may see a player's email and username
   * (`seesPlayerContact`, tm 325.6). False masks both on every row and keeps
   * `query` off them — a match on an address the row does not show would
   * still confirm it. Defaults to true.
   */
  contactVisible?: boolean;
}

export interface CustomerSummary {
  id: string;
  name: string | null;
  email: string | null;
  /** Typed into the widget's pre-chat form; unverified. */
  username: string | null;
  phone: string | null;
  country_code: string | null;
  country: string | null;
  is_lead: boolean;
  banned: boolean;
  /** Conversation days in this licence — chats ("Thread ID"). */
  chats_count: number;
  /** The connections those days held — threads ("Chat ID"), one per visit. */
  connections_count: number;
  tickets_count: number;
  last_activity_at: string | null;
  created_at: string;
  /**
   * The contact custom fields flagged `show_in_table` (FR-MOD-03.2.3), with
   * this customer's values — a subset of the full set `custom_fields` (below)
   * carries on the detail response. Empty when the workspace has flagged none.
   */
  table_custom_fields: CustomFieldValue[];
}

export interface CustomerDetail extends CustomerSummary {
  banned_at: string | null;
  /** True total — `visits` below is capped at `MAX_VISITS`. */
  visits_count: number;
  /** Teams this visitor's conversations have been routed to, deduplicated. */
  groups: Array<{ id: number; name: string }>;
  visits: Array<{
    id: string;
    came_from: string | null;
    /** Pages seen during the visit, in order (FR-MOD-13.2) — sanitised by `visitedPagesOf`. */
    pages: Array<{ url: string; at?: string }>;
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
    /** The day's connections, oldest first (ID-05: the profile reads day → connection). */
    connections: Array<{ id: string; active: boolean; created_at: string }>;
  }>;
  /** Custom fields defined for contacts, with this contact's values (08.7.6). */
  custom_fields: CustomFieldValue[];
}

const RECENT_WINDOW_DAYS = 30;
const MAX_VISITS = 10;
const MAX_CHATS = 10;
/** Connections listed under one day on the profile. */
const MAX_DAY_CONNECTIONS = 20;

export class CustomerService {
  async list(
    tx: TenantClient,
    tenant: TenantContext,
    options: ListOptions,
  ): Promise<{ items: CustomerSummary[]; total: number; nextPageId?: string }> {
    const where = this.#where(tenant, options);

    // The sort is the server's, over every row the filter matches — not the
    // browser's, over the page it happens to hold. Re-ordering a loaded window
    // answers a different question than the header claims to (D3 pattern the
    // audit named): past the first page, the row that should be first was
    // never fetched.
    const sort = options.sort ?? DEFAULT_CUSTOMER_SORT_KEY;
    const order = options.order ?? 'desc';
    const column = SORT_COLUMNS[sort];
    const cursor = decodeCursor(options.pageId, sort, order);

    // Fetch one extra to learn whether another page exists, without a second
    // count query that could disagree with the page under concurrent writes.
    const [rows, total] = await Promise.all([
      tx.customer.findMany({
        where: cursor ? { AND: [where, cursorFilter(column, order, cursor)] } : where,
        // `nulls: 'last'` is stated rather than left to the database. Postgres
        // defaults DESC to NULLS FIRST, which would put every never-active
        // visitor above the people who wrote in this morning — and, worse,
        // silently disagree with the keyset predicate below, ending pagination
        // early and hiding customers with no error anywhere. The id tie-break
        // stays `desc` under every sort, matching the cursor's own tie-break
        // (`id < …`): a secondary order that flipped with `order` would
        // disagree with it on rows that compare equal.
        orderBy: [column.orderBy(order), { id: 'desc' }],
        take: options.limit + 1,
        include: this.#counts(tenant),
      }),
      tx.customer.count({ where }),
    ]);

    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const last = page.at(-1);

    const pageIds = page.map((row) => row.id);
    const tableFields = await this.#tableCustomFields(tx, tenant, pageIds);
    const connections = await connectionCounts(tx, tenant, pageIds);

    const contactVisible = options.contactVisible ?? true;
    return {
      items: page.map((row) => ({
        ...maskPlayerContact(toSummary(row, connections.get(row.id) ?? 0), contactVisible),
        table_custom_fields: tableFields.get(row.id) ?? [],
      })),
      total,
      ...(hasMore && last ? { nextPageId: encodeCursor(sort, order, column, last) } : {}),
    };
  }

  /** `contactVisible` false masks the email and username (`ListOptions`). */
  async get(
    tx: TenantClient,
    tenant: TenantContext,
    customerId: string,
    contactVisible = true,
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
              take: MAX_DAY_CONNECTIONS,
              select: { id: true, active: true, createdAt: true, closedAt: true },
            },
          },
        },
      },
    });
    if (!customer) return null;

    const [customFields, visitsCount, groups, connections] = await Promise.all([
      readCustomFieldValues(tx, tenant.licenseId, 'contact', customer.id),
      tx.visit.count({ where: { customerId, licenseId: tenant.licenseId } }),
      this.#groups(tx, tenant, customerId),
      connectionCounts(tx, tenant, [customer.id]),
    ]);

    return {
      ...maskPlayerContact(toSummary(customer, connections.get(customer.id) ?? 0), contactVisible),
      banned_at: customer.bannedAt?.toISOString() ?? null,
      custom_fields: customFields,
      // The same subset `list()` returns, derived here rather than a second
      // query — `custom_fields` above already carries every definition's
      // `show_in_table` flag (`readCustomFieldValues`).
      table_custom_fields: customFields.filter((field) => field.show_in_table),
      visits_count: visitsCount,
      groups,
      visits: customer.visits.map((visit) => ({
        id: visit.id,
        came_from: visit.cameFrom,
        // `pages` is free-form JSON (a manually edited row is possible) — read
        // through the same sanitiser the Inbox Details visitor uses, so a
        // malformed entry is an empty result here too, never a 500, and the two
        // panels can never show different pages for the same visit.
        pages: visitedPagesOf(visit.pages),
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
        connections: chat.threads
          .map((thread) => ({
            id: thread.id,
            active: thread.active,
            created_at: thread.createdAt.toISOString(),
          }))
          .reverse(),
      })),
    };
  }

  /**
   * Record a page view against the customer's current visit.
   *
   * A visit is continued rather than created when the last one is still recent:
   * a visitor clicking through five pages is one visit, and one row per page
   * would make the history unreadable and the table enormous.
   *
   * `referrer` is therefore only written when a visit is *created*: "came from"
   * is a property of the arrival, and letting a later page overwrite it would
   * replace the search engine that brought them with whichever page of the site
   * they clicked next.
   *
   * Returns the URLs this visitor is now known to have been on, in order — the
   * same list a campaign trigger or a goal would be evaluated against
   * (`visitorPageUrls` of the visit this call just wrote). Handed back rather
   * than left to be re-read, so the caller that has to evaluate against it does
   * not pay a second query for a row this method already had in hand (tm 176.5).
   *
   * Where the visitor is (GEOIP-COUNTRY · tm 330) is asked once, when a visit
   * is *created* — `locate` is not called for a page that continues one, so a
   * visitor clicking through a site costs one lookup, not one per page. The
   * answer is kept on the visit, and fills the contact's country only while it
   * is empty: a country an agent typed, or one an earlier visit found, is not
   * overwritten by where somebody happens to be today.
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
      /** Where the visitor is; called only when this page starts a visit. */
      locate?: (() => GeoLocation | null) | undefined;
    },
  ): Promise<string[]> {
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
      // Nothing to write, but the visitor is still on these pages: the caller
      // gets the unchanged list rather than an empty one, so a reload is a
      // cheap re-evaluation instead of a blind spot.
      if (lastUrl === entry.url) return visitorPageUrls(pages);

      const updated = [...pages, entry].slice(-50);
      await tx.visit.update({
        where: { id: current.id },
        // Bounded: a visitor who leaves a tab open for hours must not grow one
        // JSON column without limit.
        data: { pages: updated as Prisma.InputJsonValue },
      });
      return visitorPageUrls(updated);
    }

    const location = input.locate?.() ?? null;
    await tx.visit.create({
      data: {
        customerId: input.customerId,
        licenseId: tenant.licenseId,
        // Trimmed here, not at the caller: this is the single write to the
        // column, so "came_from never carries a query string" (NFR-S9) holds for
        // whatever route grows a referrer next. The widget already trims on the
        // host page; a hand-rolled request does not.
        cameFrom: sanitizeReferrer(input.referrer),
        pages: [entry] as Prisma.InputJsonValue,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
        os: detectOs(input.userAgent),
        browser: detectBrowser(input.userAgent),
        ip: input.ip ?? null,
        countryCode: location?.countryCode ?? null,
        city: location?.city ?? null,
      },
    });
    if (location?.countryCode) {
      await fillEmptyCountry(tx, input.customerId, location.countryCode);
    }
    return visitorPageUrls([entry]);
  }

  #where(tenant: TenantContext, options: ListOptions): Prisma.CustomerWhereInput {
    const filters: Prisma.CustomerWhereInput[] = [{ organizationId: tenant.organizationId }];

    if (options.query) {
      const contains = options.query.trim();
      const contact: Prisma.CustomerWhereInput[] =
        (options.contactVisible ?? true)
          ? [
              { email: { contains, mode: 'insensitive' } },
              // A handle is typed from its first character, so it is matched as
              // a prefix of the folded column rather than anywhere inside the
              // raw one (tm 278). `insensitive` keeps the folding on Postgres's
              // side: a JS `toLowerCase()` turns "İ" into "i̇", which
              // `lower()` does not.
              { usernameNormalized: { startsWith: contains, mode: 'insensitive' } },
            ]
          : [];
      filters.push({
        OR: [{ name: { contains, mode: 'insensitive' } }, ...contact, { phone: { contains } }],
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

    // The filter panel's conditions (FR-MOD-03.2.1) — each one additive, same
    // as the segment above. `countryCode` is a plain `=`, not `mode:
    // 'insensitive'`: the route already upper-cased it, matching the stored
    // convention, which is what lets `customers_organization_id_country_code_idx`
    // serve it instead of a sequential scan.
    if (options.countryCode !== undefined) {
      filters.push({ countryCode: options.countryCode });
    }
    if (options.lastActivityFrom !== undefined) {
      filters.push({
        lastActivityAt: { gte: new Date(`${options.lastActivityFrom}T00:00:00.000Z`) },
      });
    }
    if (options.lastActivityTo !== undefined) {
      filters.push({
        lastActivityAt: { lte: new Date(`${options.lastActivityTo}T23:59:59.999Z`) },
      });
    }
    if (options.hasTickets !== undefined) {
      // Scoped to the caller's license, matching `#counts` below: a ticket in
      // another license of the same organisation must not count here either.
      filters.push(
        options.hasTickets
          ? { tickets: { some: { licenseId: tenant.licenseId } } }
          : { tickets: { none: { licenseId: tenant.licenseId } } },
      );
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

  /**
   * The `show_in_table` contact custom fields (FR-MOD-03.2.3), with each of
   * `customerIds`' values — two queries regardless of page size, not one per
   * customer: the definitions flagged for the table (almost always a handful,
   * license-wide) and the stored values for this page's rows, joined in memory.
   * A customer absent from the values result still gets an entry per
   * definition (`value: null`), matching `readCustomFieldValues`'s own rule
   * that a defined-but-unset field is shown empty, never omitted.
   */
  async #tableCustomFields(
    tx: TenantClient,
    tenant: TenantContext,
    customerIds: string[],
  ): Promise<Map<string, CustomFieldValue[]>> {
    if (customerIds.length === 0) return new Map();

    const definitions = await tx.customFieldDefinition.findMany({
      where: { licenseId: tenant.licenseId, entity: 'contact', showInTable: true },
      orderBy: [{ createdAt: 'asc' }],
    });
    if (definitions.length === 0) return new Map(customerIds.map((id) => [id, []]));

    const values = await tx.customFieldValue.findMany({
      where: {
        licenseId: tenant.licenseId,
        customerId: { in: customerIds },
        definitionId: { in: definitions.map((definition) => definition.id) },
      },
      select: { customerId: true, definitionId: true, value: true },
    });

    const byCustomer = new Map<string, Map<string, string>>();
    for (const row of values) {
      if (!row.customerId) continue;
      const forCustomer = byCustomer.get(row.customerId) ?? new Map<string, string>();
      forCustomer.set(row.definitionId, row.value);
      byCustomer.set(row.customerId, forCustomer);
    }

    return new Map(
      customerIds.map((customerId) => {
        const stored = byCustomer.get(customerId);
        return [
          customerId,
          definitions.map((definition) => ({
            definition_id: definition.id,
            label: definition.label,
            type: definition.type as CustomFieldType,
            required: definition.required,
            value: stored?.get(definition.id) ?? null,
            form_placement: (definition.formPlacement as FormPlacement | null) ?? null,
            show_in_table: true,
          })),
        ];
      }),
    );
  }

  /**
   * Teams this visitor's conversations have been routed to (13.2), derived
   * from `chat_access` rather than a stored field — there is no
   * `customer_groups` table (§C). Scoped to the caller's license the same way
   * `visits`/`chats` are: a `chat_access` row only ever names a group in the
   * chat's own license, but the join is still filtered explicitly rather than
   * trusted, matching the rest of this service.
   */
  async #groups(
    tx: TenantClient,
    tenant: TenantContext,
    customerId: string,
  ): Promise<Array<{ id: number; name: string }>> {
    const access = await tx.chatAccess.findMany({
      where: { chat: { customerId, licenseId: tenant.licenseId } },
      select: { groupId: true },
    });
    const groupIds = [...new Set(access.map((a) => a.groupId))];
    if (groupIds.length === 0) return [];

    const groups = await tx.group.findMany({
      where: { licenseId: tenant.licenseId, id: { in: groupIds } },
      orderBy: { id: 'asc' },
      select: { id: true, name: true },
    });
    return groups.map((g) => ({ id: Number(g.id), name: g.name }));
  }
}

type CustomerRow = {
  id: string;
  name: string | null;
  email: string | null;
  username: string | null;
  phone: string | null;
  countryCode: string | null;
  country: string | null;
  isLead: boolean;
  bannedAt: Date | null;
  lastActivityAt: Date | null;
  createdAt: Date;
  _count: { chats: number; tickets: number };
};

/**
 * How many connections (threads — "Chat ID") each customer's conversations in
 * this licence hold, keyed by customer id: one grouped count for the whole
 * page, never one per row. Scoped to the licence like `#counts` (the note at
 * the top) — a customer of the same organisation writing to a sibling
 * workspace must not count here.
 */
async function connectionCounts(
  tx: TenantClient,
  tenant: TenantContext,
  customerIds: string[],
): Promise<Map<string, number>> {
  if (customerIds.length === 0) return new Map();
  const rows = await tx.$queryRaw<Array<{ customer_id: string; count: number }>>`
    SELECT c.customer_id::text AS customer_id, count(t.id)::int AS count
    FROM chats c
    JOIN threads t ON t.chat_id = c.id
    WHERE c.license_id = ${tenant.licenseId}
      AND c.customer_id = ANY(${customerIds}::uuid[])
    GROUP BY c.customer_id
  `;
  return new Map(rows.map((row) => [row.customer_id, row.count]));
}

/** Everything but `table_custom_fields` — every caller attaches that separately. */
function toSummary(
  row: CustomerRow,
  connections: number,
): Omit<CustomerSummary, 'table_custom_fields'> {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    username: row.username,
    phone: row.phone,
    country_code: row.countryCode,
    country: row.country,
    is_lead: row.isLead,
    banned: row.bannedAt !== null,
    chats_count: row._count.chats,
    connections_count: connections,
    tickets_count: row._count.tickets,
    last_activity_at: row.lastActivityAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

/** The cursor's comparable half — whatever the sorted column holds. */
type SortValue = string | null;

/**
 * One sortable column, expressed four ways: how to order by it, how to read the
 * cursor value off a row, and the two `where` fragments the keyset predicate
 * needs (past this value, exactly this value). Kept together so a column cannot
 * be half-added — an `orderBy` without a matching predicate pages silently
 * wrong rather than failing. Mirrors `ticket-service.ts`'s `SortColumn`.
 */
interface SortColumn {
  /**
   * Whether the column can be empty. Empty cells sort *last* in both directions
   * — a customer with no name or no country should never outrank a real one
   * just because the order flipped — so the keyset predicate has to treat them
   * as a trailing block rather than as a comparable value.
   */
  nullable: boolean;
  orderBy: (order: SortOrder) => Record<string, unknown>;
  valueOf: (row: CustomerRow) => SortValue;
  /** Rows past `value` in the reading direction. */
  beyond: (op: 'gt' | 'lt', value: string) => Record<string, unknown>;
  equals: (value: string) => Record<string, unknown>;
  /** Rows whose cell is empty; only meaningful when `nullable`. */
  empty: () => Record<string, unknown>;
}

const SORT_COLUMNS: Record<CustomerSortKey, SortColumn> = {
  last_activity: {
    nullable: true,
    orderBy: (order) => ({ lastActivityAt: { sort: order, nulls: 'last' } }),
    valueOf: (row) => row.lastActivityAt?.toISOString() ?? null,
    beyond: (op, value) => ({ lastActivityAt: { [op]: new Date(value) } }),
    equals: (value) => ({ lastActivityAt: new Date(value) }),
    empty: () => ({ lastActivityAt: null }),
  },
  name: {
    nullable: true,
    orderBy: (order) => ({ name: { sort: order, nulls: 'last' } }),
    valueOf: (row) => row.name,
    beyond: (op, value) => ({ name: { [op]: value } }),
    equals: (value) => ({ name: value }),
    empty: () => ({ name: null }),
  },
  country: {
    // Sorts on the code, not the free-text name: the code carries the
    // organisation-scoped index (`customers_organization_id_country_code_idx`)
    // and is written upper-case only, matching the filter panel's own
    // condition (`country_code`) — the same column, sorted instead of matched.
    nullable: true,
    orderBy: (order) => ({ countryCode: { sort: order, nulls: 'last' } }),
    valueOf: (row) => row.countryCode,
    beyond: (op, value) => ({ countryCode: { [op]: value } }),
    equals: (value) => ({ countryCode: value }),
    empty: () => ({ countryCode: null }),
  },
};

interface Cursor {
  value: SortValue;
  id: string;
}

/**
 * Keyset pagination over `(<sorted column> <order>, id DESC)`. Mirrors
 * `ticket-service.ts`'s `cursorFilter` — see there for why the id tie-break is
 * not optional (two customers with the same name, or the same absent one, would
 * otherwise make the cursor ambiguous).
 */
function cursorFilter(
  column: SortColumn,
  order: SortOrder,
  cursor: Cursor,
): Prisma.CustomerWhereInput {
  if (cursor.value === null) {
    return { AND: [column.empty(), { id: { lt: cursor.id } }] } as Prisma.CustomerWhereInput;
  }
  return {
    OR: [
      column.beyond(order === 'asc' ? 'gt' : 'lt', cursor.value),
      { AND: [column.equals(cursor.value), { id: { lt: cursor.id } }] },
      // Empty cells trail the whole collection, so they are still ahead of any
      // row that has a value — in *both* directions, which is why this arm is
      // not conditioned on `order`.
      ...(column.nullable ? [column.empty()] : []),
    ],
  } as Prisma.CustomerWhereInput;
}

/**
 * The cursor records the ordering it was issued under, not only the position —
 * see `ticket-service.ts`'s `encodeCursor` for why: a keyset cursor is a
 * position *in one ordering*, and carrying the sort is what makes a stale one
 * detectable instead of silently answering with a page one that looks like a
 * page two.
 */
function encodeCursor(
  sort: CustomerSortKey,
  order: SortOrder,
  column: SortColumn,
  row: CustomerRow,
): string {
  return Buffer.from(
    JSON.stringify({ k: sort, o: order, v: column.valueOf(row), i: row.id }),
  ).toString('base64url');
}

function decodeCursor(
  pageId: string | undefined,
  sort: CustomerSortKey,
  order: SortOrder,
): Cursor | null {
  if (!pageId) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(pageId, 'base64url').toString('utf8'));
  } catch {
    // A malformed cursor is a client bug, not a server error: start from the
    // beginning rather than 500.
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;

  const { k, o, v, i } = raw as { k?: unknown; o?: unknown; v?: unknown; i?: unknown };
  if (typeof i !== 'string' || typeof k !== 'string' || typeof o !== 'string') return null;
  if (v !== null && typeof v !== 'string') return null;

  // Refused rather than restarted. Restarting would hand back rows the caller
  // already has, labelled as the next page — the exact failure a cursor exists
  // to prevent, and one nothing downstream could notice.
  if (k !== sort || o !== order) {
    throw ApiError.validation('page_id was issued for a different sort; start the list again.');
  }

  if (v !== null && sort === 'last_activity' && Number.isNaN(Date.parse(v))) return null;
  return { value: v, id: i };
}

/**
 * Give a contact the country their address placed them in (GEOIP-COUNTRY ·
 * tm 330) — only while they have none. One guarded `UPDATE`: a contact whose
 * country is already known (typed by an agent, sent by an integration, found
 * on an earlier visit) matches no row, so there is no read-then-write for two
 * requests to race over.
 */
export async function fillEmptyCountry(
  tx: TenantClient,
  customerId: string,
  countryCode: string,
): Promise<void> {
  await tx.customer.updateMany({
    where: { id: customerId, countryCode: null },
    data: { countryCode },
  });
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
