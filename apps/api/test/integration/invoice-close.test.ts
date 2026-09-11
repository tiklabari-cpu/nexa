/**
 * Persistent invoice history and the period-close sweep (FR-MOD-10.3).
 *
 * The bug this closes was silent and retroactive. Invoice history was *derived
 * on read*: every past period was priced from whatever `subscriptions` said at
 * the moment of the request, and the subscription is a single row that
 * `updateSubscription` rewrites in place. So changing plan, seats or cycle
 * rewrote statements the workspace had already been shown and already
 * downloaded — with nothing anywhere recording what the month had actually
 * cost.
 *
 * **The central assertion of this file is therefore retroactivity, and nothing
 * else here matters as much:** freeze a period, change the subscription
 * underneath it, and read it back unchanged — total, currency, status and every
 * line. Everything below is the property that makes that assertion mean
 * something in a real deployment rather than only in one test:
 *
 *   1. **Idempotence.** The sweep is driven by a scheduler *and* a CLI, so two
 *      passes overlap sooner or later. A second pass must write nothing — and
 *      the guarantee is `UNIQUE (license_id, period)`, not a check the service
 *      makes first, which is why the test runs the passes rather than inspecting
 *      the code.
 *   2. **Only closed periods.** The current month is still accruing; freezing it
 *      would be a statement about a month that has not happened.
 *   3. **The `ApiPackagePurchase` line item (tm 71.5 · 09.3-e) survives the move
 *      to the table.** It was the one line the derived path had that nothing
 *      else in the schema records, so it is the one most easily lost.
 *   4. **RLS, not a WHERE clause.** The sweep runs as `nexa_app`
 *      (`DATABASE_APP_URL`), the role a request runs as, so a query that forgot
 *      to scope by tenant is caught by the database refusing the row. The
 *      negative half is asserted against the raw role too: a workspace must not
 *      be able to read, edit or delete another's statement — nor its own,
 *      since an editable invoice is exactly as retroactive as a derived one.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InvoiceCloseSweeper } from '../../src/services/billing/invoice-close-sweep.js';
import { currentPeriod } from '../../src/services/billing/metering.js';
import {
  invoiceNumber,
  issuedAt,
  periodWindow,
  previousPeriod,
} from '../../src/services/billing/invoice-service.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

interface InvoiceView {
  number: string;
  period: string;
  period_label: string;
  period_start: string;
  period_end: string;
  issued_at: string;
  origin: 'issued' | 'reconstructed' | 'estimate';
  status: 'paid' | 'open' | 'trial';
  currency: string;
  line_items: { description: string; amount_cents: number }[];
  subtotal_cents: number;
  total_cents: number;
}

describe('persistent invoice history (FR-MOD-10.3)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  const open = currentPeriod();
  const justClosed = previousPeriod(open);
  /** Two months back — old enough that the sweep calls closing it a reconstruction. */
  const older = previousPeriod(justClosed);

  const auth = async (tenant: 'a' | 'b') => ({
    authorization: `Bearer ${await grantToken(owner, {
      licenseId: fx[tenant].licenseId,
      organizationId: fx[tenant].organizationId,
      ownerId: fx[tenant].ownerAccountId,
      scopes: ['reports_read'],
    })}`,
  });

  /** Take the trial off and put an active subscription on file. */
  async function activate(tenant: 'a' | 'b', seats = 2, unitPriceCents = 9_900): Promise<void> {
    await owner.license.update({
      where: { id: fx[tenant].licenseId },
      data: { status: 'active', trialEndsAt: null },
    });
    await owner.subscription.create({
      data: {
        licenseId: fx[tenant].licenseId,
        status: 'active',
        seats,
        unitPriceCents,
        aiResolutionsIncluded: 200,
      },
    });
  }

  /** Evidence that something billable happened in a period. */
  async function meter(
    tenant: 'a' | 'b',
    period: string,
    quantity: bigint,
    included = 200n,
  ): Promise<void> {
    await owner.usageRecord.create({
      data: {
        licenseId: fx[tenant].licenseId,
        metric: 'ai_resolutions',
        period,
        quantity,
        included,
        overageUnit: 50,
        overageUnitPriceCents: 50,
      },
    });
  }

  async function sweep(now?: Date) {
    return new InvoiceCloseSweeper(appRole, testEnv()).run(now ? { now } : {});
  }

  async function listInvoices(tenant: 'a' | 'b'): Promise<InvoiceView[]> {
    const response = await server.get('/billing/invoices', await auth(tenant));
    expect(response.statusCode).toBe(200);
    return (response.json() as { invoices: InvoiceView[] }).invoices;
  }

  async function invoiceFor(tenant: 'a' | 'b', period: string): Promise<InvoiceView | undefined> {
    return (await listInvoices(tenant)).find((invoice) => invoice.period === period);
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
  });

  // =========================================================================
  // The reason this table exists.
  describe('a frozen statement does not move when the subscription does', () => {
    it('keeps the total, the lines, the status and the currency across a plan change', async () => {
      await activate('a', 2, 9_900);
      // 260 resolutions against 200 included → 60 over at $0.50 = $30.
      await meter('a', justClosed, 260n);

      expect((await sweep()).totals.issued).toBe(1);

      const frozen = await invoiceFor('a', justClosed);
      expect(frozen).toBeDefined();
      // Seats ($198) + the AI overage ($30).
      expect(frozen?.total_cents).toBe(2 * 9_900 + 60 * 50);

      // Now everything the derived path used to re-read: seats, unit price,
      // cycle and plan all change, and the trial ends.
      await owner.subscription.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { seats: 25, unitPriceCents: 49_900, billingCycle: 'annual', plan: 'enterprise' },
      });

      const after = await invoiceFor('a', justClosed);
      // Byte-for-byte the same statement. Before this table, `total_cents`
      // alone would have gone from $228 to $124,780.
      expect(after).toEqual(frozen);
    });

    it('serves the same frozen bytes on the download, across the same change', async () => {
      await activate('a', 2, 9_900);
      await meter('a', justClosed, 260n);
      await sweep();

      const before = await server.get(`/billing/invoices/${justClosed}/download`, await auth('a'));
      expect(before.statusCode).toBe(200);

      await owner.subscription.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { seats: 25, unitPriceCents: 49_900 },
      });

      const after = await server.get(`/billing/invoices/${justClosed}/download`, await auth('a'));
      expect(after.body).toBe(before.body);
      expect(after.body).toContain('Total,22800');
    });

    it('leaves a trial month a trial month after the workspace starts paying', async () => {
      // The fixture license is trialing, so the closed month owed nothing.
      await meter('a', justClosed, 260n);
      await sweep();
      expect(await invoiceFor('a', justClosed)).toMatchObject({ status: 'trial', total_cents: 0 });

      await activate('a', 2, 9_900);

      // The derived path recomputed `status` from *today's* trial state, so
      // leaving the trial turned every trial month into a paid one.
      expect(await invoiceFor('a', justClosed)).toMatchObject({ status: 'trial', total_cents: 0 });
    });

    it('refuses to let the app role edit or delete a statement at all', async () => {
      await activate('a');
      await meter('a', justClosed, 260n);
      await sweep();

      // Freezing is only as strong as the privilege that withholds a rewrite:
      // an UPDATE reachable by the runtime role would make the frozen row a
      // suggestion. Asserted through the raw role rather than a service, since
      // no service offers this and the guarantee is the GRANT.
      await expect(
        appRole.$executeRawUnsafe(`UPDATE invoices SET total_cents = 1`),
      ).rejects.toThrow(/permission denied/i);
      await expect(appRole.$executeRawUnsafe(`DELETE FROM invoices`)).rejects.toThrow(
        /permission denied/i,
      );
      await expect(
        appRole.$executeRawUnsafe(`UPDATE invoice_line_items SET amount_cents = 1`),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // =========================================================================
  describe('the sweep closes each period exactly once', () => {
    it('writes nothing on a second pass', async () => {
      await activate('a');
      await meter('a', justClosed, 260n);

      const first = await sweep();
      expect(first.totals).toMatchObject({ issued: 1, reconstructed: 0, skipped: 0 });

      const second = await sweep();
      // Not "skipped": the anti-join finds no candidate at all, so there is
      // nothing to race for. `skipped` is reserved for losing the INSERT.
      expect(second.totals).toMatchObject({ issued: 0, reconstructed: 0, skipped: 0 });
      expect(await owner.invoice.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
      // Seats and the overage — and still only those two after the second pass.
      expect(await owner.invoiceLineItem.count({ where: { licenseId: fx.a.licenseId } })).toBe(2);
    });

    it('loses the race rather than issuing a second statement for the month', async () => {
      await activate('a');
      await meter('a', justClosed, 260n);

      // The race, made deterministic instead of hoped for. An uncommitted
      // statement for this period is held open in another transaction: the
      // sweep's anti-join cannot see it (so the period is still a candidate)
      // and its INSERT blocks on the unique index until that transaction
      // commits — which is precisely the interleaving a scheduler tick and an
      // operator running the CLI produce, and the only one where the
      // constraint, rather than the anti-join, is what stops the duplicate.
      let release = (): void => {};
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });

      const blocker = owner.$transaction(async (tx) => {
        await tx.invoice.create({
          data: {
            licenseId: fx.a.licenseId,
            number: `NEXA-${justClosed}`,
            period: justClosed,
            periodStart: new Date('2020-01-01T00:00:00Z'),
            periodEnd: new Date('2020-02-01T00:00:00Z'),
            issuedAt: new Date('2020-01-31T00:00:00Z'),
            origin: 'issued',
            status: 'paid',
            currency: 'usd',
            subtotalCents: 1,
            totalCents: 1,
          },
        });
        await held;
      });

      const sweeping = sweep();
      await new Promise((resolve) => setTimeout(resolve, 250));
      release();
      await blocker;

      const report = await sweeping;
      expect(report.totals).toMatchObject({ issued: 0, reconstructed: 0, skipped: 1 });
      // One statement for the month — the one that got there first.
      expect(await owner.invoice.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
      expect(await owner.invoice.findFirstOrThrow({ where: { period: justClosed } })).toMatchObject(
        { totalCents: 1 },
      );
    });

    it('never closes the period that is still running', async () => {
      await activate('a');
      await meter('a', open, 260n);

      expect((await sweep()).totals).toMatchObject({ issued: 0, reconstructed: 0 });
      expect(await owner.invoice.count()).toBe(0);

      // It is still on the list — as the estimate, which is what an unfinished
      // month is.
      expect(await invoiceFor('a', open)).toMatchObject({ origin: 'estimate', status: 'open' });
    });

    /**
     * The other half of "the open period is never frozen", and the half the
     * database cannot hold on its own.
     *
     * The CHECKs refuse the two values that would *mark* a row as an open
     * period, but `issued`/`paid` carrying the current month is perfectly
     * storable — a restored dump, a clock that moved, or a later caller could
     * put one there. A month that has not ended has no settled total, so the
     * live estimate is the truthful answer for it: the stored row must neither
     * displace the estimate nor appear beside it as a second entry for the same
     * month.
     */
    it('serves the estimate, not a stored row, for the month still running', async () => {
      await activate('a');
      await meter('a', open, 260n);

      const window = periodWindow(open);
      await owner.invoice.create({
        data: {
          licenseId: fx.a.licenseId,
          number: invoiceNumber(open),
          period: open,
          periodStart: window.start,
          periodEnd: window.end,
          issuedAt: issuedAt(open),
          origin: 'issued',
          status: 'paid',
          currency: 'usd',
          subtotalCents: 1,
          totalCents: 1,
        },
      });

      const invoices = await listInvoices('a');
      expect(invoices.filter((invoice) => invoice.period === open)).toHaveLength(1);
      expect(invoices[0]).toMatchObject({ period: open, origin: 'estimate', status: 'open' });
      expect(invoices[0]?.total_cents).not.toBe(1);
    });

    it('leaves a month with no usage and no purchase unbilled', async () => {
      await activate('a');
      expect((await sweep()).totals).toMatchObject({ issued: 0, reconstructed: 0 });
      // Only the estimate, exactly as the derived path listed only periods it
      // had evidence for.
      expect((await listInvoices('a')).map((i) => i.period)).toEqual([open]);
    });
  });

  // =========================================================================
  describe('backfill: an old period is reconstructed, and says so', () => {
    it('marks the month just gone `issued` and an older one `reconstructed`', async () => {
      await activate('a');
      await meter('a', justClosed, 260n);
      await meter('a', older, 210n);

      const report = await sweep();
      expect(report.totals).toMatchObject({ issued: 1, reconstructed: 1, skipped: 0 });

      expect(await invoiceFor('a', justClosed)).toMatchObject({ origin: 'issued' });
      expect(await invoiceFor('a', older)).toMatchObject({ origin: 'reconstructed' });
    });

    it('prices a reconstruction from the records that survived, not from the catalogue', async () => {
      await activate('a', 2, 9_900);
      // A price the catalogue does not carry — proof the line came off the
      // receipt rather than being re-looked-up at reconstruction time.
      await owner.apiPackagePurchase.create({
        data: {
          licenseId: fx.a.licenseId,
          packageId: 'essential',
          apiCalls: 250_000n,
          priceCents: 1_234,
          period: older,
        },
      });

      await sweep();

      const invoice = await invoiceFor('a', older);
      expect(invoice?.origin).toBe('reconstructed');
      expect(invoice?.line_items).toContainEqual({
        description: 'API package — Essential (250000 calls)',
        amount_cents: 1_234,
      });
      expect(invoice?.total_cents).toBe(2 * 9_900 + 1_234);
    });

    it('composes each period from its own usage, not from whatever row comes first', async () => {
      await activate('a', 2, 9_900);
      // Two closed months, two different overages. A composition that read
      // `usage_records` without filtering by period would pick one of these for
      // both statements — and every assertion about a *single* period would
      // still pass.
      await meter('a', justClosed, 260n);
      await meter('a', older, 400n);

      await sweep();

      expect((await invoiceFor('a', justClosed))?.line_items).toContainEqual({
        description: 'AI resolutions overage — 60 beyond 200',
        amount_cents: 60 * 50,
      });
      expect((await invoiceFor('a', older))?.line_items).toContainEqual({
        description: 'AI resolutions overage — 200 beyond 200',
        amount_cents: 200 * 50,
      });
    });

    it('puts each purchase on the statement for the month it was bought in', async () => {
      await activate('a', 2, 9_900);
      // Same trap one table over: a purchase read without its period would be
      // billed on every statement the sweep writes, so the workspace pays for
      // one package twice.
      for (const [period, priceCents] of [
        [justClosed, 1_111],
        [older, 2_222],
      ] as const) {
        await owner.apiPackagePurchase.create({
          data: {
            licenseId: fx.a.licenseId,
            packageId: 'essential',
            apiCalls: 100_000n,
            priceCents,
            period,
          },
        });
      }

      await sweep();

      expect((await invoiceFor('a', justClosed))?.total_cents).toBe(2 * 9_900 + 1_111);
      expect((await invoiceFor('a', older))?.total_cents).toBe(2 * 9_900 + 2_222);
    });

    it('freezes a reconstruction as firmly as an issued statement', async () => {
      await activate('a', 2, 9_900);
      await meter('a', older, 260n);
      await sweep();
      const before = await invoiceFor('a', older);

      await owner.subscription.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { seats: 9, unitPriceCents: 1_000 },
      });

      // The label says the seat line was a best effort; it does not say the row
      // keeps moving. A reconstruction that still drifted would be the original
      // bug with a disclaimer on it.
      expect(await invoiceFor('a', older)).toEqual(before);
    });
  });

  // =========================================================================
  describe('the statement keeps every line the derived path had', () => {
    it('carries a bought API package as its own line item (tm 71.5 · 09.3-e)', async () => {
      await activate('a');
      await owner.apiPackagePurchase.create({
        data: {
          licenseId: fx.a.licenseId,
          packageId: 'essential',
          apiCalls: 250_000n,
          priceCents: 4_900,
          period: justClosed,
        },
      });

      await sweep();

      const invoice = await invoiceFor('a', justClosed);
      expect(invoice?.line_items).toContainEqual({
        description: 'API package — Essential (250000 calls)',
        amount_cents: 4_900,
      });
    });

    it('carries bought AI resolution packs as their own line (FR-MOD-10.1.4)', async () => {
      await activate('a');
      await owner.aiPackagePurchase.create({
        data: {
          licenseId: fx.a.licenseId,
          idempotencyKey: 'seeded-pack',
          packs: 2,
          resolutions: 100,
          priceCents: 5_000,
          period: justClosed,
        },
      });

      await sweep();

      expect((await invoiceFor('a', justClosed))?.line_items).toContainEqual({
        description: 'AI resolution packs — 2 packs (100 resolutions)',
        amount_cents: 5_000,
      });
    });

    it('stores the lines in composed order, and the period window with them', async () => {
      await activate('a');
      await meter('a', justClosed, 260n);
      await owner.apiPackagePurchase.create({
        data: {
          licenseId: fx.a.licenseId,
          packageId: 'essential',
          apiCalls: 250_000n,
          priceCents: 4_900,
          period: justClosed,
        },
      });

      await sweep();

      const invoice = await invoiceFor('a', justClosed);
      // Seats, then the overage, then the purchase — a reordered statement
      // reads as a different one, so the order is stored rather than left to
      // whatever a SELECT returns.
      expect(invoice?.line_items.map((item) => item.description)).toEqual([
        'Subscription — 2 seats (monthly)',
        'AI resolutions overage — 60 beyond 200',
        'API package — Essential (250000 calls)',
      ]);
      expect(invoice?.subtotal_cents).toBe(invoice?.total_cents);

      const window = { start: invoice?.period_start ?? '', end: invoice?.period_end ?? '' };
      expect(new Date(window.end).getTime()).toBeGreaterThan(new Date(window.start).getTime());
      expect(window.start.slice(0, 7).replace('-', '')).toBe(justClosed);
      // Half-open: the upper bound is the next month's first instant.
      expect(window.end.slice(8, 10)).toBe('01');
    });

    it('sorts the list newest first, estimate at the top', async () => {
      await activate('a');
      await meter('a', justClosed, 260n);
      await meter('a', older, 260n);
      await sweep();

      expect((await listInvoices('a')).map((i) => i.period)).toEqual([open, justClosed, older]);
    });
  });

  // =========================================================================
  describe('tenant isolation (NFR-S4)', () => {
    it('closes each workspace against its own figures only', async () => {
      await activate('a', 2, 9_900);
      await activate('b', 7, 9_900);
      await meter('a', justClosed, 260n);
      await meter('b', justClosed, 200n);

      const report = await sweep();
      expect(report.totals.issued).toBe(2);

      expect((await invoiceFor('a', justClosed))?.total_cents).toBe(2 * 9_900 + 60 * 50);
      // B ran seven seats and no overage — A's usage never reached it.
      expect((await invoiceFor('b', justClosed))?.total_cents).toBe(7 * 9_900);
    });

    it('scopes its own evidence query, so the RLS-exempt owner role cannot cross tenants', async () => {
      // The seed runs this sweep as the *owner* (`DATABASE_URL`), and
      // `runtimeDatabaseUrl` falls back to the owner on any machine with no
      // `DATABASE_APP_URL` — a role Postgres exempts from row level security.
      // The evidence query is raw SQL with no Prisma `where` behind it, so
      // without its own `license_id` predicate it would union every workspace's
      // periods and close them all against one tenant's subscription. Asserted
      // through `owner` precisely because RLS is not there to catch it.
      await activate('a', 2, 9_900);
      await activate('b', 7, 9_900);
      await meter('a', justClosed, 260n);
      await meter('b', older, 260n);

      await new InvoiceCloseSweeper(owner, testEnv()).run();

      const periodsOf = async (licenseId: bigint): Promise<string[]> =>
        (await owner.invoice.findMany({ where: { licenseId }, select: { period: true } })).map(
          (row) => row.period,
        );

      expect(await periodsOf(fx.a.licenseId)).toEqual([justClosed]);
      expect(await periodsOf(fx.b.licenseId)).toEqual([older]);
    });

    it("never shows one workspace another's statement", async () => {
      await activate('a');
      await meter('a', justClosed, 260n);
      await sweep();

      expect((await listInvoices('b')).map((i) => i.period)).toEqual([open]);
      const download = await server.get(
        `/billing/invoices/${justClosed}/download`,
        await auth('b'),
      );
      expect(download.statusCode).toBe(404);
    });

    it('hides the rows from the app role itself when another tenant is set', async () => {
      await activate('a');
      await meter('a', justClosed, 260n);
      await sweep();

      // RLS, asserted at the row rather than at the endpoint: with B's license
      // in the session, A's invoice and its lines are simply not there.
      const [rows, lines] = await appRole.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_license', ${fx.b.licenseId.toString()}, true)`;
        await tx.$executeRaw`SELECT set_config('app.current_organization', ${fx.b.organizationId}, true)`;
        return Promise.all([
          tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM invoices`,
          tx.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM invoice_line_items`,
        ]);
      });
      expect(Number(rows[0]?.n)).toBe(0);
      expect(Number(lines[0]?.n)).toBe(0);

      // And the owner, which bypasses RLS, confirms the rows do exist.
      expect(await owner.invoice.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
    });

    it('refuses a statement written under the wrong license', async () => {
      // The WITH CHECK half of the policy: even holding a valid session for B,
      // a row claiming A's license cannot be inserted. Without this, a sweep
      // with a mis-set context would write into another workspace's history.
      await expect(
        appRole.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_license', ${fx.b.licenseId.toString()}, true)`;
          await tx.$executeRaw`SELECT set_config('app.current_organization', ${fx.b.organizationId}, true)`;
          await tx.$executeRawUnsafe(
            `INSERT INTO invoices (id, license_id, number, period, period_start, period_end, issued_at, origin, status, currency, subtotal_cents, total_cents)
             VALUES (gen_random_uuid(), ${fx.a.licenseId.toString()}, 'NEXA-209901', '209901',
                     '2099-01-01T00:00:00Z', '2099-02-01T00:00:00Z', '2099-01-31T00:00:00Z',
                     'issued', 'paid', 'usd', 0, 0)`,
          );
        }),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  // =========================================================================
  describe('the schema refuses a statement that could not be true', () => {
    /** Insert as the table's owner, so only the CHECK can stop it. */
    async function insertInvoice(overrides: Record<string, string>): Promise<void> {
      const columns: Record<string, string> = {
        license_id: fx.a.licenseId.toString(),
        number: `'NEXA-209901'`,
        period: `'209901'`,
        period_start: `'2099-01-01T00:00:00Z'`,
        period_end: `'2099-02-01T00:00:00Z'`,
        issued_at: `'2099-01-31T00:00:00Z'`,
        origin: `'issued'`,
        status: `'paid'`,
        currency: `'usd'`,
        subtotal_cents: '0',
        total_cents: '0',
        ...overrides,
      };
      const names = ['id', ...Object.keys(columns)].join(', ');
      const values = ['gen_random_uuid()', ...Object.values(columns)].join(', ');
      await owner.$executeRawUnsafe(`INSERT INTO invoices (${names}) VALUES (${values})`);
    }

    it('accepts a well-formed statement', async () => {
      await insertInvoice({});
      expect(await owner.invoice.count({ where: { period: '209901' } })).toBe(1);
    });

    it('refuses `estimate` as a stored origin', async () => {
      // The database's half of "the open period is never frozen": an estimate
      // is a period with no row, so a row claiming to be one is a contradiction.
      await expect(insertInvoice({ origin: `'estimate'` })).rejects.toThrow(
        /invoices_origin_check/,
      );
    });

    it('refuses `open` as a stored status', async () => {
      await expect(insertInvoice({ status: `'open'` })).rejects.toThrow(/invoices_status_check/);
    });

    it('refuses an inverted or empty period window', async () => {
      await expect(insertInvoice({ period_end: `'2098-12-01T00:00:00Z'` })).rejects.toThrow(
        /invoices_period_window_check/,
      );
      await expect(insertInvoice({ period_end: `'2099-01-01T00:00:00Z'` })).rejects.toThrow(
        /invoices_period_window_check/,
      );
    });

    it('refuses a malformed period and an upper-case currency', async () => {
      await expect(insertInvoice({ period: `'2099-1'` })).rejects.toThrow(/invoices_period_check/);
      await expect(insertInvoice({ currency: `'USD'` })).rejects.toThrow(/invoices_currency_check/);
    });

    it('refuses a negative statement', async () => {
      await expect(insertInvoice({ total_cents: '-1' })).rejects.toThrow(/invoices_amounts_check/);
    });

    it('refuses a second statement for the same period', async () => {
      await insertInvoice({});
      // Prisma reports a unique violation by the conflicting key rather than by
      // the index name, so this matches what Postgres actually says.
      await expect(insertInvoice({})).rejects.toThrow(/\(license_id, period\)=/);
    });

    it('refuses an unlabelled or negative line', async () => {
      await insertInvoice({});
      const invoiceId = (
        await owner.invoice.findFirstOrThrow({ where: { period: '209901' }, select: { id: true } })
      ).id;

      const line = (overrides: string): string =>
        `INSERT INTO invoice_line_items (id, invoice_id, license_id, position, description, amount_cents)
         VALUES (gen_random_uuid(), '${invoiceId}', ${fx.a.licenseId.toString()}, ${overrides})`;

      await expect(owner.$executeRawUnsafe(line(`0, '   ', 100`))).rejects.toThrow(
        /invoice_line_items_description_check/,
      );
      await expect(owner.$executeRawUnsafe(line(`1, 'Credit', -100`))).rejects.toThrow(
        /invoice_line_items_amount_check/,
      );
      await expect(owner.$executeRawUnsafe(line(`-1, 'Seats', 100`))).rejects.toThrow(
        /invoice_line_items_position_check/,
      );
      // And two lines cannot claim the same place on the statement.
      await owner.$executeRawUnsafe(line(`0, 'Seats', 100`));
      await expect(owner.$executeRawUnsafe(line(`0, 'Seats again', 100`))).rejects.toThrow(
        /\(invoice_id, .?position.?\)=/,
      );
    });
  });
});
