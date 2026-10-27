/**
 * Billing across every workspace (tm 389.12 · FR-ADMIN-12 · design.md §C
 * billing): the plan catalogue, every subscription, every issued statement,
 * the packages on sale, revenue by month — and the two things an operator
 * does to one workspace's bill, a credit and a subscription by hand.
 *
 * Reads as `siyahtus_platform` (BYPASSRLS) through `app.platformDb`, so, like
 * `workspaces.ts`, **every query names what it reads** — a licence, a period,
 * a list of ids; nothing relies on row level security. Responses carry
 * amounts, states and identities (licence number, organization name); never a
 * workspace's content.
 *
 * **Money is integer minor units.** Statements are in US dollars
 * (`INVOICE_CURRENCY`); a credit is stored with an upper-case code
 * (`platform_credits_currency_check`) and must match the statements' or it is
 * refused — it could never be applied (`billing_apply_platform_credits` only
 * takes a credit in the statement's own currency).
 *
 * **A credit is applied at the period close**, not here: the sweep
 * (`invoice-close-sweep.ts`) takes each open credit off the next statement it
 * freezes, in the transaction that writes it, and never below zero.
 *
 * **Revenue is the closed statements, exactly** (decision 3 of the task): the
 * open period is not a statement, so it is reported apart — only what was
 * already bought in it — rather than estimated.
 */
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  AI_PACKAGE_MAX_PACKS,
  AI_RESOLUTION_PACK_SIZE,
  aiPackagePriceCents,
  API_PACKAGE_CATALOG,
} from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import { TRIAL_PLAN } from '../../lib/entitlements.js';
import { AI_CAPS_SETTING_KEY, parsePlanAiCaps, planAiDailyTokens } from '../ai/ai-plan-caps.js';
import { parseDeploymentCaps } from '../ai/ai-settings.js';
import {
  INVOICE_CURRENCY,
  invoiceCsvRows,
  invoiceFilename,
  serialiseStored,
} from '../billing/invoice-service.js';
import { currentPeriod } from '../billing/metering.js';
import {
  aiDailyTokensForPlan,
  BILLING_CYCLES,
  PLAN_IDS,
  PLANS,
  type BillingCycle,
  type PlanId,
} from '../billing/subscription-service.js';
import { lockLicense, refuseClosed, type ActionOutcome } from './workspace-actions.js';

type Tx = Prisma.TransactionClient;

export const BILLING_LIST_DEFAULT = 50;
export const BILLING_LIST_MAX = 100;
export const REVENUE_MONTHS_DEFAULT = 12;
export const REVENUE_MONTHS_MAX = 36;
/** One credit's ceiling: $1,000,000 in cents — a typo guard, not a policy. */
export const CREDIT_MAX_MINOR = 100_000_000;
/** How far ahead a subscription by hand may run: three years. */
export const MANUAL_SUBSCRIPTION_MAX_DAYS = 3 * 366;

const DAY_MS = 86_400_000;

/** The one currency a credit can be in — the statements'. */
export const CREDIT_CURRENCY = INVOICE_CURRENCY.toUpperCase();

/** A cursor this list did not write, or wrote for other filters. */
export class BillingCursorError extends Error {}

const clamp = (value: number | undefined, fallback: number, max: number): number =>
  value === undefined ? fallback : Math.min(Math.max(1, Math.trunc(value)), max);

// --- Keyset cursors ---------------------------------------------------------

interface Cursor {
  /** Which list and filters wrote it, hashed. */
  f: string;
  /** The last row's sort key, as text. */
  k: string;
  id: string;
}

function fingerprint(list: string, filter: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([list, filter]))
    .digest('base64url')
    .slice(0, 16);
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(raw: string, expected: string, key: RegExp): Cursor {
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>;
    if (
      value.f === expected &&
      typeof value.k === 'string' &&
      key.test(value.k) &&
      typeof value.id === 'string' &&
      /^[0-9a-f-]{36}$/i.test(value.id)
    ) {
      return { f: value.f, k: value.k, id: value.id };
    }
  } catch {
    // fall through
  }
  throw new BillingCursorError();
}

/** Epoch milliseconds in SQL — a JavaScript `Date` keeps no microseconds, so the key cannot either. */
const epochMs = (column: string) =>
  Prisma.raw(`floor(extract(epoch from ${column}) * 1000)::bigint`);

// --- Views -------------------------------------------------------------------

export interface BillingPlan {
  id: PlanId;
  pricing: 'listed' | 'quoted';
  unit_price_cents: number | null;
  ai_resolutions_included: number | null;
  entitlements: string[];
  ai_daily_tokens: { llm: number | null; embedding: number | null };
  workspaces: number;
}

export interface SubscriptionRow {
  license_id: string;
  organization_name: string;
  license_status: string;
  plan: string;
  status: string;
  billing_cycle: string;
  seats: number;
  unit_price_cents: number;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
}

export interface InvoiceRow {
  id: string;
  license_id: string;
  organization_name: string;
  number: string;
  period: string;
  origin: string;
  status: string;
  currency: string;
  subtotal_cents: number;
  credit_cents: number;
  total_cents: number;
  issued_at: string;
}

export interface CreditView {
  id: string;
  license_id: string;
  organization_name: string;
  amount_minor: number;
  currency: string;
  reason: string;
  admin_email: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_period: string | null;
  remainder_of: string | null;
  created_at: string;
}

export interface RevenueMonth {
  period: string;
  currency: string;
  invoices: number;
  subtotal_cents: number;
  credit_cents: number;
  total_cents: number;
}

/** The `yyyymm` `count` months before `period`. */
function periodBefore(period: string, count: number): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));
  const d = new Date(Date.UTC(year, month - 1 - count, 1));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * The plans' AI figures as the panel set them (`platform_settings` `ai.caps`), and the
 * deployment's own when 389.17 stored them in the same row (null: the environment's).
 */
export async function readPlanCapSetting(db: PrismaClient | Tx) {
  const row = await db.platformSetting.findUnique({ where: { key: AI_CAPS_SETTING_KEY } });
  return {
    row,
    defaults: parsePlanAiCaps(row?.value ?? null),
    deployment: parseDeploymentCaps(row?.value ?? null),
  };
}

interface CreditRowRaw {
  id: string;
  license_id: bigint;
  organization_name: string;
  amount_minor: bigint;
  currency: string;
  reason: string;
  admin_email: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  invoice_period: string | null;
  remainder_of: string | null;
  created_at: Date;
  sort_key: bigint;
}

function creditOf(row: CreditRowRaw): CreditView {
  return {
    id: row.id,
    license_id: row.license_id.toString(),
    organization_name: row.organization_name,
    amount_minor: Number(row.amount_minor),
    currency: row.currency,
    reason: row.reason,
    admin_email: row.admin_email,
    invoice_id: row.invoice_id,
    invoice_number: row.invoice_number,
    invoice_period: row.invoice_period,
    remainder_of: row.remainder_of,
    created_at: row.created_at.toISOString(),
  };
}

const CREDIT_SELECT = Prisma.sql`
  SELECT c.id::text AS id, c.license_id, o.name AS organization_name, c.amount_minor, c.currency,
         c.reason, a.email::text AS admin_email, c.invoice_id::text AS invoice_id,
         i.number AS invoice_number, i.period::text AS invoice_period,
         c.remainder_of::text AS remainder_of, c.created_at, ${epochMs('c.created_at')} AS sort_key
    FROM platform_credits c
    JOIN licenses l ON l.id = c.license_id
    JOIN organizations o ON o.id = l.organization_id
    LEFT JOIN platform_admins a ON a.id = c.admin_id
    LEFT JOIN invoices i ON i.id = c.invoice_id`;

export interface PlatformBillingOptions {
  env: Env;
  now?: () => number;
}

export class PlatformBilling {
  readonly #db: PrismaClient;
  readonly #env: Env;
  readonly #now: () => number;

  constructor(db: PrismaClient, options: PlatformBillingOptions) {
    this.#db = db;
    this.#env = options.env;
    this.#now = options.now ?? Date.now;
  }

  async plans(): Promise<BillingPlan[]> {
    const [{ defaults }, counts] = await Promise.all([
      readPlanCapSetting(this.#db),
      this.#db.$queryRaw<Array<{ plan: string; workspaces: number }>>`
        SELECT COALESCE(s.plan, ${TRIAL_PLAN}) AS plan, count(*)::int AS workspaces
          FROM licenses l
          LEFT JOIN LATERAL (
            SELECT plan FROM subscriptions WHERE license_id = l.id ORDER BY created_at DESC LIMIT 1
          ) s ON true
         WHERE l.sandbox_of_license_id IS NULL
         GROUP BY 1`,
    ]);
    const onPlan = new Map(counts.map((row) => [row.plan, row.workspaces]));
    return PLAN_IDS.map((id) => {
      const spec = PLANS[id];
      return {
        id,
        pricing: spec.pricing,
        unit_price_cents: spec.unitPriceCents,
        ai_resolutions_included: spec.aiResolutionsIncluded,
        entitlements: [...spec.entitlements],
        ai_daily_tokens: planAiDailyTokens(defaults, id, aiDailyTokensForPlan(id)),
        workspaces: onPlan.get(id) ?? 0,
      };
    });
  }

  async subscriptions(filter: {
    plan?: string;
    status?: string;
    pastDue?: boolean;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: SubscriptionRow[]; next_cursor: string | null }> {
    const limit = clamp(filter.limit, BILLING_LIST_DEFAULT, BILLING_LIST_MAX);
    const f = fingerprint('subscriptions', [
      filter.plan ?? null,
      filter.status ?? null,
      filter.pastDue ?? null,
    ]);
    const cursor = filter.cursor ? decodeCursor(filter.cursor, f, /^\d{1,16}$/) : null;

    const conditions: Prisma.Sql[] = [Prisma.sql`l.sandbox_of_license_id IS NULL`];
    if (filter.plan) conditions.push(Prisma.sql`s.plan = ${filter.plan}`);
    if (filter.status) conditions.push(Prisma.sql`s.status = ${filter.status}`);
    if (filter.pastDue === true) {
      conditions.push(Prisma.sql`(s.status = 'past_due' OR l.status = 'past_due')`);
    } else if (filter.pastDue === false) {
      conditions.push(Prisma.sql`s.status <> 'past_due' AND l.status <> 'past_due'`);
    }
    if (cursor) {
      conditions.push(
        Prisma.sql`(${epochMs('s.created_at')}, s.id) < (${BigInt(cursor.k)}, ${cursor.id}::uuid)`,
      );
    }

    const rows = await this.#db.$queryRaw<
      Array<{
        id: string;
        license_id: bigint;
        organization_name: string;
        license_status: string;
        plan: string;
        status: string;
        billing_cycle: string;
        seats: number;
        unit_price_cents: number;
        current_period_end: Date | null;
        cancel_at_period_end: boolean;
        created_at: Date;
        sort_key: bigint;
      }>
    >`
      SELECT s.id::text AS id, s.license_id, o.name AS organization_name, l.status AS license_status,
             s.plan, s.status, s.billing_cycle, s.seats, s.unit_price_cents, s.current_period_end,
             s.cancel_at_period_end, s.created_at, ${epochMs('s.created_at')} AS sort_key
        FROM (
          SELECT DISTINCT ON (license_id) *
            FROM subscriptions ORDER BY license_id, created_at DESC, id DESC
        ) s
        JOIN licenses l ON l.id = s.license_id
        JOIN organizations o ON o.id = l.organization_id
       WHERE ${Prisma.join(conditions, ' AND ')}
       ORDER BY ${epochMs('s.created_at')} DESC, s.id DESC
       LIMIT ${limit + 1}`;

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => ({
        license_id: row.license_id.toString(),
        organization_name: row.organization_name,
        license_status: row.license_status,
        plan: row.plan,
        status: row.status,
        billing_cycle: row.billing_cycle,
        seats: row.seats,
        unit_price_cents: row.unit_price_cents,
        current_period_end: row.current_period_end?.toISOString() ?? null,
        cancel_at_period_end: row.cancel_at_period_end,
        created_at: row.created_at.toISOString(),
      })),
      next_cursor:
        rows.length > limit && last
          ? encodeCursor({ f, k: last.sort_key.toString(), id: last.id })
          : null,
    };
  }

  async invoices(filter: {
    licenseId?: bigint;
    period?: string;
    status?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: InvoiceRow[]; next_cursor: string | null }> {
    const limit = clamp(filter.limit, BILLING_LIST_DEFAULT, BILLING_LIST_MAX);
    const f = fingerprint('invoices', [
      filter.licenseId?.toString() ?? null,
      filter.period ?? null,
      filter.status ?? null,
    ]);
    const cursor = filter.cursor ? decodeCursor(filter.cursor, f, /^\d{6}$/) : null;

    const conditions: Prisma.Sql[] = [Prisma.sql`true`];
    if (filter.licenseId !== undefined)
      conditions.push(Prisma.sql`i.license_id = ${filter.licenseId}`);
    if (filter.period) conditions.push(Prisma.sql`i.period = ${filter.period}`);
    if (filter.status) conditions.push(Prisma.sql`i.status = ${filter.status}`);
    if (cursor) {
      conditions.push(Prisma.sql`(i.period, i.id) < (${cursor.k}, ${cursor.id}::uuid)`);
    }

    const rows = await this.#db.$queryRaw<
      Array<{
        id: string;
        license_id: bigint;
        organization_name: string;
        number: string;
        period: string;
        origin: string;
        status: string;
        currency: string;
        subtotal_cents: number;
        credit_cents: number;
        total_cents: number;
        issued_at: Date;
      }>
    >`
      SELECT i.id::text AS id, i.license_id, o.name AS organization_name, i.number,
             i.period::text AS period, i.origin, i.status, i.currency::text AS currency,
             i.subtotal_cents, i.total_cents, i.issued_at,
             COALESCE((SELECT -sum(li.amount_cents) FROM invoice_line_items li
                        WHERE li.invoice_id = i.id AND li.platform_credit_id IS NOT NULL), 0)::int
               AS credit_cents
        FROM invoices i
        JOIN licenses l ON l.id = i.license_id
        JOIN organizations o ON o.id = l.organization_id
       WHERE ${Prisma.join(conditions, ' AND ')}
       ORDER BY i.period DESC, i.id DESC
       LIMIT ${limit + 1}`;

    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map((row) => ({
        id: row.id,
        license_id: row.license_id.toString(),
        organization_name: row.organization_name,
        number: row.number,
        period: row.period,
        origin: row.origin,
        status: row.status,
        currency: row.currency,
        subtotal_cents: row.subtotal_cents,
        credit_cents: row.credit_cents,
        total_cents: row.total_cents,
        issued_at: row.issued_at.toISOString(),
      })),
      next_cursor:
        rows.length > limit && last ? encodeCursor({ f, k: last.period, id: last.id }) : null,
    };
  }

  /** One statement as the workspace's own CSV, or null — an unknown id and a malformed one alike. */
  async invoiceCsv(
    invoiceId: string,
  ): Promise<{ filename: string; headers: string[]; rows: (string | number)[][] } | null> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)) {
      return null;
    }
    const row = await this.#db.invoice.findUnique({
      where: { id: invoiceId },
      include: { lineItems: { orderBy: { position: 'asc' } } },
    });
    if (!row) return null;
    const invoice = serialiseStored(row);
    return { filename: invoiceFilename(invoice.period), ...invoiceCsvRows(invoice) };
  }

  async packages() {
    const period = currentPeriod(new Date(this.#now()));
    const [api, ai] = await Promise.all([
      this.#db.apiPackagePurchase.groupBy({
        by: ['packageId'],
        where: { period },
        _count: { _all: true },
        _sum: { priceCents: true },
      }),
      this.#db.aiPackagePurchase.aggregate({
        where: { period },
        _sum: { packs: true, priceCents: true },
      }),
    ]);
    const sold = new Map(
      api.map((row) => [row.packageId, { count: row._count._all, revenue: row._sum.priceCents }]),
    );
    return {
      period,
      api_packages: API_PACKAGE_CATALOG.map((entry) => ({
        id: entry.id,
        name: entry.name,
        api_calls: entry.api_calls,
        price_cents: entry.price_cents,
        sold: {
          count: sold.get(entry.id)?.count ?? 0,
          revenue_cents: sold.get(entry.id)?.revenue ?? 0,
        },
      })),
      ai_resolution_pack: {
        resolutions_per_pack: AI_RESOLUTION_PACK_SIZE,
        pack_price_cents: aiPackagePriceCents(1, this.#env.AI_OVERAGE_CENTS),
        max_packs: AI_PACKAGE_MAX_PACKS,
        sold: { count: ai._sum.packs ?? 0, revenue_cents: ai._sum.priceCents ?? 0 },
      },
    };
  }

  async revenue(months: number) {
    const open = currentPeriod(new Date(this.#now()));
    const first = periodBefore(open, months);
    const [closed, apiOpen, aiOpen, credits] = await Promise.all([
      this.#db.$queryRaw<
        Array<{
          period: string;
          currency: string;
          invoices: number;
          subtotal_cents: bigint;
          credit_cents: bigint;
          total_cents: bigint;
        }>
      >`
        SELECT i.period::text AS period, i.currency::text AS currency, count(*)::int AS invoices,
               sum(i.subtotal_cents)::bigint AS subtotal_cents,
               sum(i.total_cents)::bigint AS total_cents,
               COALESCE(sum(c.credit), 0)::bigint AS credit_cents
          FROM invoices i
          LEFT JOIN LATERAL (
            SELECT -sum(li.amount_cents) AS credit FROM invoice_line_items li
             WHERE li.invoice_id = i.id AND li.platform_credit_id IS NOT NULL
          ) c ON true
         WHERE i.status = 'paid' AND i.period >= ${first} AND i.period < ${open}
         GROUP BY 1, 2`,
      this.#db.apiPackagePurchase.aggregate({
        where: { period: open },
        _sum: { priceCents: true },
      }),
      this.#db.aiPackagePurchase.aggregate({ where: { period: open }, _sum: { priceCents: true } }),
      this.#db.platformCredit.groupBy({
        by: ['currency'],
        where: { invoiceId: null },
        _count: { _all: true },
        _sum: { amountMinor: true },
        orderBy: { currency: 'asc' },
      }),
    ]);

    // Every period in the window, oldest first; the statements' currency always,
    // any other only where a statement carries it.
    const periods = Array.from({ length: months }, (_, index) =>
      periodBefore(open, months - index),
    );
    const currencies = [...new Set([INVOICE_CURRENCY, ...closed.map((row) => row.currency)])];
    const found = new Map(closed.map((row) => [`${row.period}:${row.currency}`, row]));
    const monthsOut: RevenueMonth[] = [];
    for (const period of periods) {
      for (const currency of currencies) {
        const row = found.get(`${period}:${currency}`);
        if (!row && currency !== INVOICE_CURRENCY) continue;
        monthsOut.push({
          period,
          currency,
          invoices: row?.invoices ?? 0,
          subtotal_cents: Number(row?.subtotal_cents ?? 0n),
          credit_cents: Number(row?.credit_cents ?? 0n),
          total_cents: Number(row?.total_cents ?? 0n),
        });
      }
    }
    return {
      months: monthsOut,
      open_period: {
        period: open,
        package_purchases_cents: (apiOpen._sum.priceCents ?? 0) + (aiOpen._sum.priceCents ?? 0),
      },
      open_credits: credits.map((row) => ({
        currency: row.currency,
        amount_minor: Number(row._sum.amountMinor ?? 0n),
        credits: row._count._all,
      })),
    };
  }

  async credits(filter: {
    licenseId?: bigint;
    open?: boolean;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: CreditView[]; next_cursor: string | null }> {
    const limit = clamp(filter.limit, BILLING_LIST_DEFAULT, BILLING_LIST_MAX);
    const f = fingerprint('credits', [filter.licenseId?.toString() ?? null, filter.open ?? null]);
    const cursor = filter.cursor ? decodeCursor(filter.cursor, f, /^\d{1,16}$/) : null;
    const conditions: Prisma.Sql[] = [Prisma.sql`true`];
    if (filter.licenseId !== undefined) {
      conditions.push(Prisma.sql`c.license_id = ${filter.licenseId}`);
    }
    if (filter.open === true) conditions.push(Prisma.sql`c.invoice_id IS NULL`);
    if (filter.open === false) conditions.push(Prisma.sql`c.invoice_id IS NOT NULL`);
    if (cursor) {
      conditions.push(
        Prisma.sql`(${epochMs('c.created_at')}, c.id) < (${BigInt(cursor.k)}, ${cursor.id}::uuid)`,
      );
    }
    const rows = await this.#db.$queryRaw<CreditRowRaw[]>`
      ${CREDIT_SELECT}
       WHERE ${Prisma.join(conditions, ' AND ')}
       ORDER BY ${epochMs('c.created_at')} DESC, c.id DESC
       LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map(creditOf),
      next_cursor:
        rows.length > limit && last
          ? encodeCursor({ f, k: last.sort_key.toString(), id: last.id })
          : null,
    };
  }

  async credit(tx: Tx | PrismaClient, id: string): Promise<CreditView> {
    const [row] = await tx.$queryRaw<CreditRowRaw[]>`${CREDIT_SELECT} WHERE c.id = ${id}::uuid`;
    if (!row) throw ApiError.notFound('Credit not found.');
    return creditOf(row);
  }
}

// --- Mutations (inside the route's transaction) -------------------------------

export interface GrantCreditInput {
  licenseId: bigint;
  amountMinor: number;
  currency: string;
  reason: string;
  adminId: string;
}

/**
 * Record a credit for the workspace's next statement. The licence is locked
 * like any workspace action's, so a credit cannot land on a workspace being
 * purged in the same instant; a currency the statements are not in is
 * refused, since no statement could ever take it.
 */
export async function grantCredit(tx: Tx, input: GrantCreditInput): Promise<{ id: string }> {
  if (input.currency !== CREDIT_CURRENCY) {
    throw ApiError.validation(`A credit must be in ${CREDIT_CURRENCY}, the statements' currency.`, {
      reason: 'currency_mismatch',
      currency: CREDIT_CURRENCY,
    });
  }
  await lockLicense(tx, input.licenseId);
  return tx.platformCredit.create({
    data: {
      licenseId: input.licenseId,
      amountMinor: BigInt(input.amountMinor),
      currency: input.currency,
      reason: input.reason,
      adminId: input.adminId,
    },
    select: { id: true },
  });
}

export interface ManualSubscriptionInput {
  plan: PlanId;
  periodEnd: Date;
  seats?: number;
  billingCycle?: BillingCycle;
}

/**
 * Subscribe the workspace by hand — what a confirmed transfer earns (389.18
 * calls this once a payment is matched): its latest subscription on `plan`,
 * `active` until `periodEnd`, any scheduled cancellation cleared; the licence
 * `active` with the trial over. A workspace without a subscription gets one,
 * sized to its headcount unless `seats` says otherwise; the amounts follow
 * `setPlan`'s rule (a quoted tier keeps the figures already on the row).
 */
export async function createManualSubscription(
  tx: Tx,
  licenseId: bigint,
  input: ManualSubscriptionInput,
  now: Date,
): Promise<ActionOutcome> {
  if (input.periodEnd.getTime() <= now.getTime()) {
    throw ApiError.validation('period_end must be in the future.', { reason: 'period_end_past' });
  }
  if (input.periodEnd.getTime() > now.getTime() + MANUAL_SUBSCRIPTION_MAX_DAYS * DAY_MS) {
    throw ApiError.validation('period_end is more than three years away.', {
      reason: 'period_end_too_far',
    });
  }
  const license = await lockLicense(tx, licenseId);
  refuseClosed(license);

  const existing = await tx.subscription.findFirst({
    where: { licenseId },
    orderBy: { createdAt: 'desc' },
  });
  const spec = PLANS[input.plan];
  const fallback = PLANS.growth;
  const headcount = existing
    ? existing.seats
    : await tx.agentMembership.count({ where: { licenseId, suspended: false } });
  const seats = input.seats ?? Math.max(1, headcount);
  const billingCycle = input.billingCycle ?? (existing?.billingCycle as BillingCycle | undefined);
  const data = {
    plan: input.plan,
    status: 'active',
    seats,
    billingCycle:
      billingCycle && (BILLING_CYCLES as readonly string[]).includes(billingCycle)
        ? billingCycle
        : 'monthly',
    unitPriceCents: spec.unitPriceCents ?? existing?.unitPriceCents ?? fallback.unitPriceCents,
    aiResolutionsIncluded:
      spec.aiResolutionsIncluded ??
      existing?.aiResolutionsIncluded ??
      fallback.aiResolutionsIncluded,
    currentPeriodEnd: input.periodEnd,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
  };
  const subscription = existing
    ? await tx.subscription.update({ where: { id: existing.id }, data, select: { id: true } })
    : await tx.subscription.create({ data: { ...data, licenseId }, select: { id: true } });
  await tx.license.update({
    where: { id: licenseId },
    data: { status: 'active', trialEndsAt: null, plan: input.plan },
  });
  return {
    unchanged: false,
    payload: {
      subscription_id: subscription.id,
      plan: input.plan,
      from_plan: existing?.plan ?? null,
      from_status: license.status,
      seats,
      billing_cycle: data.billingCycle,
      period_end: input.periodEnd.toISOString(),
    },
  };
}
