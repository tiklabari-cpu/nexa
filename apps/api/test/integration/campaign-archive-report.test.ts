/**
 * Archiving, copying and reporting on campaigns (EN-05 · tm 354), through the
 * real routes: a deleted campaign leaves the list and never fires or delivers
 * again but keeps its history in the report; a copy is the same campaign
 * switched off; the report and its CSV say the same numbers; and a customer
 * erasure still reaches the sends of an archived campaign.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { mintForExistingCustomer } from '../helpers/member-token.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DEPOSIT = 'https://casino.example/deposit';
const ON_DEPOSIT = {
  match: 'all',
  rules: [{ field: 'current_url', op: 'contains', value: '/deposit' }],
};
const WINDOW = 'from=2026-10-01T00:00:00Z&to=2026-10-20T00:00:00Z';

const FIGURES = ['displayed', 'clicks', 'chats', 'conversion', 'suppressed'] as const;
type Figures = Record<(typeof FIGURES)[number], number>;
const figures = (
  displayed: number,
  clicks: number,
  chats: number,
  conversion: number,
  suppressed: number,
): Figures => ({
  displayed,
  clicks,
  chats,
  conversion,
  suppressed,
});

describe('campaign archive, copy and report (EN-05)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let writeToken: string;
  let writeTokenB: string;
  let reportToken: string;
  let reportTokenB: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await Promise.all([
      seedDefaultBrand(owner, fx.a.licenseId),
      seedDefaultBrand(owner, fx.b.licenseId),
    ]);
    await clearRateLimits(server.app);
    const grant = (t: Fixtures['a'], scopes: string[]) =>
      grantToken(owner, {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        ownerId: t.ownerAccountId,
        scopes,
      });
    writeToken = await grant(fx.a, ['customers:rw']);
    writeTokenB = await grant(fx.b, ['customers:rw']);
    reportToken = await grant(fx.a, ['reports_read', 'customers.erase:rw']);
    reportTokenB = await grant(fx.b, ['reports_read']);
  });

  async function createCampaign(
    name: string,
    over: Record<string, unknown> = {},
    token = writeToken,
  ): Promise<string> {
    const response = await server.post(
      '/campaigns',
      {
        name,
        conditions: ON_DEPOSIT,
        content: { message: 'Need help with your deposit?' },
        ...over,
      },
      auth(token),
    );
    expect(response.statusCode).toBe(201);
    return (response.json() as { id: string }).id;
  }

  async function listIds(token = writeToken): Promise<string[]> {
    const response = await server.get('/campaigns', auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: Array<{ id: string }> }).items.map((item) => item.id);
  }

  async function customer(licenseOrg = fx.a.organizationId): Promise<string> {
    return (
      await owner.customer.create({
        data: { organizationId: licenseOrg, name: 'Player' },
        select: { id: true },
      })
    ).id;
  }

  // --- Archiving ------------------------------------------------------------

  describe('DELETE /campaigns/{id}', () => {
    it('archives: the campaign leaves the list, a second delete and an edit are 404 (EN-05)', async () => {
      const id = await createCampaign('Old promo');
      const keep = await createCampaign('Still running');

      expect((await server.del(`/campaigns/${id}`, auth(writeToken))).statusCode).toBe(204);

      expect(await listIds()).toEqual([keep]);
      expect((await server.get('/campaigns?status=inactive', auth(writeToken))).json().total).toBe(
        0,
      );
      expect((await server.del(`/campaigns/${id}`, auth(writeToken))).statusCode).toBe(404);
      // It cannot be switched back on — only copied.
      const revive = await server.patch(`/campaigns/${id}`, { active: true }, auth(writeToken));
      expect(revive.statusCode).toBe(404);
      const row = await owner.campaign.findUniqueOrThrow({ where: { id } });
      expect(row.archivedAt).not.toBeNull();
      expect(row.status).toBe('inactive');
    });

    it('needs customers:rw and cannot reach another workspace (EN-05)', async () => {
      const id = await createCampaign('Mine');
      const readOnly = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['customers:ro'],
      });
      expect((await server.del(`/campaigns/${id}`, auth(readOnly))).statusCode).toBe(403);
      expect((await server.del(`/campaigns/${id}`, auth(writeTokenB))).statusCode).toBe(404);
      expect(await listIds()).toEqual([id]);
    });

    it('never fires at a visitor again (EN-05)', async () => {
      const id = await createCampaign('Deposit help');
      await server.del(`/campaigns/${id}`, auth(writeToken));

      const player = await customer();
      const minted = await mintForExistingCustomer(server, fx.a, player);
      const token = (minted.json() as { token: string }).token;
      expect((await server.post('/customer/visit', { url: DEPOSIT }, auth(token))).statusCode).toBe(
        204,
      );

      expect(await owner.campaignSend.count({ where: { campaignId: id } })).toBe(0);
      expect((await server.get('/customer/chat', auth(token))).json().campaign).toBeNull();
    });

    it('does not deliver a send it had queued before it was archived (EN-05)', async () => {
      const id = await createCampaign('Deposit help');
      const player = await customer();
      const minted = await mintForExistingCustomer(server, fx.a, player);
      const token = (minted.json() as { token: string }).token;
      await server.post('/customer/visit', { url: DEPOSIT }, auth(token));
      // Matched, owed, not yet shown.
      const queued = await owner.campaignSend.findFirstOrThrow({ where: { campaignId: id } });
      expect(queued.deliveredAt).toBeNull();

      await server.del(`/campaigns/${id}`, auth(writeToken));

      expect((await server.get('/customer/chat', auth(token))).json().campaign).toBeNull();
      expect(
        (await owner.campaignSend.findUniqueOrThrow({ where: { id: queued.id } })).deliveredAt,
      ).toBeNull();
    });
  });

  // --- Copying --------------------------------------------------------------

  describe('POST /campaigns/{id}/duplicate', () => {
    it('copies the settings into a new inactive campaign with no sends (EN-05)', async () => {
      const id = await createCampaign('Welcome', {
        starts_at: '2030-01-01T00:00:00Z',
        ends_at: '2030-02-01T00:00:00Z',
        recurring: true,
      });
      const player = await customer();
      await owner.campaignSend.create({
        data: { licenseId: fx.a.licenseId, campaignId: id, customerId: player },
      });

      const response = await server.post(`/campaigns/${id}/duplicate`, undefined, auth(writeToken));
      expect(response.statusCode).toBe(201);
      const copy = response.json() as Record<string, unknown> & { id: string };
      const source = (await server.get('/campaigns', auth(writeToken)))
        .json()
        .items.find((item: { id: string }) => item.id === id);

      expect(copy.id).not.toBe(id);
      expect(copy['name']).toBe('Welcome (copy)');
      expect(copy['status']).toBe('inactive');
      expect(copy['conditions']).toEqual(source.conditions);
      expect(copy['content']).toEqual(source.content);
      expect(copy['starts_at']).toBe(source.starts_at);
      expect(copy['ends_at']).toBe(source.ends_at);
      expect(copy['recurring']).toBe(true);
      expect(copy['matched']).toBe(0);
      expect(copy['performance']).toEqual({ displayed: 0, chats: 0, conversion: 0, suppressed: 0 });
      expect(await owner.campaignSend.count({ where: { campaignId: copy.id } })).toBe(0);
      expect((await listIds()).sort()).toEqual([id, copy.id].sort());
    });

    it('takes a name, and an archived campaign can still be copied (EN-05)', async () => {
      const id = await createCampaign('Gone');
      await server.del(`/campaigns/${id}`, auth(writeToken));

      const response = await server.post(
        `/campaigns/${id}/duplicate`,
        { name: 'Gone, again' },
        auth(writeToken),
      );
      expect(response.statusCode).toBe(201);
      expect(response.json().name).toBe('Gone, again');
      expect(await listIds()).toEqual([response.json().id]);
    });

    it('is a 404 for another workspace and a 400 for a bad name (EN-05)', async () => {
      const id = await createCampaign('Mine');
      expect(
        (await server.post(`/campaigns/${id}/duplicate`, undefined, auth(writeTokenB))).statusCode,
      ).toBe(404);
      expect(
        (await server.post(`/campaigns/${id}/duplicate`, { name: '' }, auth(writeToken)))
          .statusCode,
      ).toBe(400);
    });
  });

  // --- Report ---------------------------------------------------------------

  describe('GET /reports/campaigns', () => {
    interface Send {
      campaignId: string;
      at: string;
      delivered?: boolean;
      clicked?: boolean;
      engaged?: boolean;
      converted?: boolean;
      suppressed?: boolean;
      customerId?: string;
    }

    async function seedSend(send: Send): Promise<string> {
      const customerId = send.customerId ?? (await customer());
      const at = new Date(send.at);
      await owner.campaignSend.create({
        data: {
          licenseId: fx.a.licenseId,
          campaignId: send.campaignId,
          customerId,
          createdAt: at,
          deliveredAt: send.delivered ? at : null,
          clickedAt: send.clicked ? at : null,
          engaged: send.engaged ?? false,
          converted: send.converted ?? false,
          suppressedAt: send.suppressed ? at : null,
          suppressedReason: send.suppressed ? 'rg_signal' : null,
        },
      });
      return customerId;
    }

    /** X (to be archived) and Y, with sends on two days and one outside the window. */
    async function seedHistory() {
      const x = await createCampaign('Promo X', { active: false });
      const y = await createCampaign('Promo Y', { active: false });
      const erasable = await seedSend({
        campaignId: x,
        at: '2026-10-10T10:00:00Z',
        delivered: true,
        clicked: true,
        engaged: true,
        converted: true,
      });
      await seedSend({ campaignId: x, at: '2026-10-10T11:00:00Z', delivered: true });
      await seedSend({ campaignId: x, at: '2026-10-11T09:00:00Z', delivered: true, engaged: true });
      await seedSend({ campaignId: x, at: '2026-10-11T10:00:00Z', suppressed: true });
      await seedSend({ campaignId: x, at: '2026-10-11T12:00:00Z' }); // owed, never shown
      await seedSend({ campaignId: x, at: '2026-09-01T10:00:00Z', delivered: true }); // outside
      await seedSend({ campaignId: y, at: '2026-10-11T09:30:00Z', delivered: true, clicked: true });
      return { x, y, erasable };
    }

    const report = async (query = '', token = reportToken) => {
      const response = await server.get(`/reports/campaigns?${WINDOW}${query}`, auth(token));
      expect(response.statusCode).toBe(200);
      return response.json() as {
        totals: Figures;
        campaigns: Array<Figures & { campaign_id: string; name: string; archived: boolean }>;
        by_day: Array<Figures & { date: string; campaign_id: string; name: string }>;
        previous_period: Figures;
      };
    };

    it('counts the sends per campaign and per day, nested like the card (EN-05)', async () => {
      const { x, y } = await seedHistory();
      const body = await report();

      expect(body.totals).toEqual(figures(4, 2, 2, 1, 1));
      expect(body.campaigns.map((row) => [row.name, row.campaign_id])).toEqual([
        ['Promo X', x],
        ['Promo Y', y],
      ]);
      const byName = Object.fromEntries(body.campaigns.map((row) => [row.name, row]));
      expect(byName['Promo X']).toMatchObject({ ...figures(3, 1, 2, 1, 1), archived: false });
      expect(byName['Promo Y']).toMatchObject({ ...figures(1, 1, 0, 0, 0), archived: false });
      expect(body.by_day.map((row) => [row.date, row.name, row.displayed])).toEqual([
        ['2026-10-10', 'Promo X', 2],
        ['2026-10-11', 'Promo X', 1],
        ['2026-10-11', 'Promo Y', 1],
      ]);
      expect(body.by_day[0]).toMatchObject(figures(2, 1, 1, 1, 0));
      expect(body.by_day[1]).toMatchObject(figures(1, 0, 1, 0, 1));
      for (const day of body.by_day) {
        expect(day.clicks).toBeLessThanOrEqual(day.displayed);
        expect(day.chats).toBeLessThanOrEqual(day.displayed);
        expect(day.conversion).toBeLessThanOrEqual(day.displayed);
      }
      // The card shows the same all-time numbers for what it holds.
      const card = (await server.get('/campaigns', auth(writeToken)))
        .json()
        .items.find((item: { id: string }) => item.id === y);
      expect(card.performance).toEqual({ displayed: 1, chats: 0, conversion: 0, suppressed: 0 });
    });

    it('keeps the history of an archived campaign and lists it as archived (EN-05)', async () => {
      const { x } = await seedHistory();
      const before = await report();
      await server.del(`/campaigns/${x}`, auth(writeToken));
      const after = await report();

      expect(after.totals).toEqual(before.totals);
      expect(after.by_day).toEqual(before.by_day);
      expect(after.campaigns.find((row) => row.campaign_id === x)).toMatchObject({
        name: 'Promo X',
        archived: true,
        ...figures(3, 1, 2, 1, 1),
      });
    });

    it('lists an idle archived campaign only when it is asked for by id (EN-05)', async () => {
      const idle = await createCampaign('Never ran', { active: false });
      await server.del(`/campaigns/${idle}`, auth(writeToken));
      expect((await report()).campaigns).toEqual([]);

      const named = await report(`&campaign_id=${idle}`);
      expect(named.campaigns).toEqual([
        { campaign_id: idle, name: 'Never ran', archived: true, ...figures(0, 0, 0, 0, 0) },
      ]);
    });

    it('narrows to the campaigns named, repeated or alone (EN-05)', async () => {
      const { x, y } = await seedHistory();
      const onlyY = await report(`&campaign_id=${y}`);
      expect(onlyY.totals).toEqual(figures(1, 1, 0, 0, 0));
      expect(onlyY.campaigns.map((row) => row.campaign_id)).toEqual([y]);
      expect(onlyY.by_day.map((row) => row.campaign_id)).toEqual([y]);

      const both = await report(`&campaign_id=${x}&campaign_id=${y}`);
      expect(both.totals).toEqual(figures(4, 2, 2, 1, 1));

      const bad = await server.get(
        `/reports/campaigns?${WINDOW}&campaign_id=nope`,
        auth(reportToken),
      );
      expect(bad.statusCode).toBe(400);
    });

    it('measures the benchmark window with the same rules (EN-05)', async () => {
      await seedHistory();
      const body = await report('&baseline=previous_period');
      // The 30-day window ending 2026-10-01 holds only the 2026-09-01 send.
      const earlier = await server.get(
        '/reports/campaigns?from=2026-09-11T00:00:00Z&to=2026-10-01T00:00:00Z',
        auth(reportToken),
      );
      expect(earlier.json().totals).toEqual(figures(0, 0, 0, 0, 0));
      expect(body.previous_period).toMatchObject(figures(0, 0, 0, 0, 0));
    });

    it('needs reports_read and never shows another workspace (EN-05)', async () => {
      const { x } = await seedHistory();
      expect((await server.get(`/reports/campaigns?${WINDOW}`, auth(writeToken))).statusCode).toBe(
        403,
      );

      const other = await report('', reportTokenB);
      expect(other.totals).toEqual(figures(0, 0, 0, 0, 0));
      expect(other.campaigns).toEqual([]);
      const asked = await report(`&campaign_id=${x}`, reportTokenB);
      expect(asked.campaigns).toEqual([]);
      expect(asked.by_day).toEqual([]);
    });

    it('exports a CSV with the same numbers as the report (EN-05 · ADR-09)', async () => {
      const { x } = await seedHistory();
      await server.del(`/campaigns/${x}`, auth(writeToken));
      const body = await report();

      const response = await server.get(
        `/reports/export?group=campaigns&${WINDOW}`,
        auth(reportToken),
      );
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      const lines = response.body
        .trim()
        .split('\r\n')
        .map((line) => line.split(','));
      expect(lines[0]).toEqual(['section', 'date', 'campaign_id', 'name', ...FIGURES]);
      const rows = lines.slice(1);
      const nums = (cells: string[]) => cells.slice(4).map(Number);
      const expected = (row: Figures) => FIGURES.map((key) => row[key]);

      const total = rows.filter((cells) => cells[0] === 'total');
      expect(total).toHaveLength(1);
      expect(nums(total[0]!)).toEqual(expected(body.totals));

      const campaignRows = rows.filter((cells) => cells[0] === 'campaign');
      expect(campaignRows.map((cells) => [cells[2], cells[3], ...nums(cells)])).toEqual(
        body.campaigns.map((row) => [row.campaign_id, row.name, ...expected(row)]),
      );
      const dayRows = rows.filter((cells) => cells[0] === 'day');
      expect(dayRows.map((cells) => [cells[1], cells[2], ...nums(cells)])).toEqual(
        body.by_day.map((row) => [row.date, row.campaign_id, ...expected(row)]),
      );

      // The filter reaches the export too, and the PDF is the same table.
      const filtered = await server.get(
        `/reports/export?group=campaigns&${WINDOW}&campaign_id=${body.campaigns[1]!.campaign_id}`,
        auth(reportToken),
      );
      expect(filtered.body.trim().split('\r\n')).toHaveLength(
        1 +
          1 +
          1 +
          body.by_day.filter((row) => row.campaign_id === body.campaigns[1]!.campaign_id).length,
      );
      const pdf = await server.get(
        `/reports/export?group=campaigns&format=pdf&${WINDOW}`,
        auth(reportToken),
      );
      expect(pdf.statusCode).toBe(200);
      expect(pdf.headers['content-type']).toBe('application/pdf');
    });

    it('lists the campaigns group for a reports reader (EN-05)', async () => {
      const groups = await server.get('/reports/groups', auth(reportToken));
      expect(
        (groups.json() as { groups: Array<{ id: string }> }).groups.map((g) => g.id),
      ).toContain('campaigns');
    });
  });

  // --- Erasure --------------------------------------------------------------

  it('a customer erasure still removes the sends of an archived campaign (EN-05 · NFR-C8)', async () => {
    const id = await createCampaign('Promo X', { active: false });
    const player = await customer();
    await owner.campaignSend.create({
      data: {
        licenseId: fx.a.licenseId,
        campaignId: id,
        customerId: player,
        createdAt: new Date('2026-10-10T10:00:00Z'),
        deliveredAt: new Date('2026-10-10T10:00:00Z'),
      },
    });
    await server.del(`/campaigns/${id}`, auth(writeToken));

    const erased = await server.post(`/customers/${player}/erase`, undefined, auth(reportToken));
    expect(erased.statusCode).toBe(200);

    expect(await owner.campaignSend.count({ where: { campaignId: id } })).toBe(0);
    const body = (
      await server.get(`/reports/campaigns?${WINDOW}&campaign_id=${id}`, auth(reportToken))
    ).json();
    expect(body.totals).toEqual(figures(0, 0, 0, 0, 0));
    expect(await owner.campaign.count({ where: { id } })).toBe(1);
  });
});
