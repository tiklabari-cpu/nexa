/**
 * Multi-condition campaign targeting (EN-03 · tm 352.1), through the real
 * routes: rules joined by all/any, the server deciding where the visitor is
 * and who they are, the widget left to decide time on the page and exit
 * intent (`show_when`), page changes and session variables arriving on
 * `POST /customer/visit`, and a waiting card counted as displayed only when
 * `POST /customer/campaigns/{id}/shown` says it was shown.
 *
 * The last block is the regression the task's acceptance names: a campaign
 * saved in the first shape (`{ url_contains }`), converted by the migration's
 * own statement, reaches the same visitor the same way.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { mintForExistingCustomer } from '../helpers/member-token.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const SITE = 'https://casino.example';
const DEPOSIT = `${SITE}/deposit`;
const CASINO = `${SITE}/casino`;
const HOME = `${SITE}/`;

const TURKEY = { field: 'country', op: 'equals', value: 'TR' };
const ON_DEPOSIT = { field: 'current_url', op: 'contains', value: '/deposit' };
const THIRTY_SECONDS = { field: 'time_on_page', op: 'gte', value: 30 };
const LEAVING = { field: 'exit_intent', op: 'equals', value: true };

interface PolledCampaign {
  id: string;
  message: string;
  show_when?: { match: string; rules: unknown[] };
}

describe('multi-condition campaign targeting (EN-03)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let writeToken: string;
  let writeTokenB: string;

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
    writeToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers:rw'],
    });
    writeTokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['customers:rw'],
    });
  });

  // --- Arrangement ---------------------------------------------------------

  /** A visitor never seen before, optionally with the contact's country set. */
  async function visitor(
    t: TenantFixture,
    country: string | null = null,
  ): Promise<{ id: string; token: string }> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: 'Player', countryCode: country },
      select: { id: true },
    });
    const response = await mintForExistingCustomer(server, t, customer.id);
    expect(response.statusCode).toBe(200);
    return { id: customer.id, token: (response.json() as { token: string }).token };
  }

  async function createCampaign(
    conditions: Record<string, unknown>,
    token = writeToken,
  ): Promise<{ id: string; conditions: Record<string, unknown>; matched: number }> {
    const response = await server.post(
      '/campaigns',
      { name: 'Deposit help', conditions, content: { message: 'Need a hand?' } },
      auth(token),
    );
    expect(response.statusCode).toBe(201);
    return response.json() as { id: string; conditions: Record<string, unknown>; matched: number };
  }

  async function visit(token: string, body: Record<string, unknown>): Promise<number> {
    const response = await server.post('/customer/visit', body, auth(token));
    return response.statusCode;
  }

  async function poll(token: string): Promise<PolledCampaign | null> {
    const response = await server.get('/customer/chat', auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { campaign: PolledCampaign | null }).campaign;
  }

  const sendOf = (campaignId: string, customerId: string) =>
    owner.campaignSend.findFirst({
      where: { campaignId, customerId },
      select: { deliveredAt: true },
    });

  // --- All / any -----------------------------------------------------------

  it('"TR and /deposit and 30 s": only when all three hold; the card waits for the 30 s (FR-MOD-03.3.2)', async () => {
    const campaign = await createCampaign({
      match: 'all',
      rules: [TURKEY, ON_DEPOSIT, THIRTY_SECONDS],
    });
    expect(campaign.conditions).toEqual({
      match: 'all',
      rules: [TURKEY, ON_DEPOSIT, THIRTY_SECONDS],
    });

    const german = await visitor(fx.a, 'DE');
    expect(await visit(german.token, { url: DEPOSIT })).toBe(204);
    const elsewhere = await visitor(fx.a, 'TR');
    expect(await visit(elsewhere.token, { url: HOME })).toBe(204);
    expect(await sendOf(campaign.id, german.id)).toBeNull();
    expect(await sendOf(campaign.id, elsewhere.id)).toBeNull();
    expect(await poll(german.token)).toBeNull();

    const player = await visitor(fx.a, 'TR');
    expect(await visit(player.token, { url: DEPOSIT })).toBe(204);
    expect(await sendOf(campaign.id, player.id)).toEqual({ deliveredAt: null });

    // Offered with the rule it waits for, and not counted yet — on every poll.
    const offered = {
      id: campaign.id,
      message: 'Need a hand?',
      show_when: { match: 'all', rules: [THIRTY_SECONDS] },
    };
    expect(await poll(player.token)).toEqual(offered);
    expect(await poll(player.token)).toEqual(offered);
    expect(await sendOf(campaign.id, player.id)).toEqual({ deliveredAt: null });

    // A single-page move away: not offered while elsewhere, offered again on return.
    expect(await visit(player.token, { url: CASINO })).toBe(204);
    expect(await poll(player.token)).toBeNull();
    expect(await visit(player.token, { url: DEPOSIT })).toBe(204);
    expect(await poll(player.token)).toEqual(offered);

    // Shown: counted now, once, and never offered again.
    const shown = await server.post(
      `/customer/campaigns/${campaign.id}/shown`,
      undefined,
      auth(player.token),
    );
    expect(shown.statusCode).toBe(204);
    const stamped = await sendOf(campaign.id, player.id);
    expect(stamped?.deliveredAt).toBeInstanceOf(Date);
    const again = await server.post(
      `/customer/campaigns/${campaign.id}/shown`,
      undefined,
      auth(player.token),
    );
    expect(again.statusCode).toBe(204);
    expect(await sendOf(campaign.id, player.id)).toEqual(stamped);
    expect(await poll(player.token)).toBeNull();

    const list = await server.get('/campaigns', auth(writeToken));
    const card = (
      list.json() as { items: Array<{ id: string; performance: { displayed: number } }> }
    ).items.find((item) => item.id === campaign.id);
    expect(card?.performance.displayed).toBe(1);
  });

  it('"any": one server rule shows the card now; none holding waits for a browser rule (FR-MOD-03.3.2)', async () => {
    const campaign = await createCampaign({
      match: 'any',
      rules: [TURKEY, ON_DEPOSIT, THIRTY_SECONDS],
    });

    // Not in Turkey, but on /deposit: one is enough, shown and counted now.
    const onDeposit = await visitor(fx.a, 'DE');
    await visit(onDeposit.token, { url: DEPOSIT });
    expect(await poll(onDeposit.token)).toEqual({ id: campaign.id, message: 'Need a hand?' });
    expect((await sendOf(campaign.id, onDeposit.id))?.deliveredAt).toBeInstanceOf(Date);

    // Neither: the card waits for the 30 s, the one rule left.
    const browsing = await visitor(fx.a, 'DE');
    await visit(browsing.token, { url: HOME });
    expect(await poll(browsing.token)).toEqual({
      id: campaign.id,
      message: 'Need a hand?',
      show_when: { match: 'any', rules: [THIRTY_SECONDS] },
    });
    expect(await sendOf(campaign.id, browsing.id)).toEqual({ deliveredAt: null });
  });

  it('exit intent: the card waits for it, and counts only once the widget says it was shown (FR-MOD-03.3.2)', async () => {
    const campaign = await createCampaign({ rules: [ON_DEPOSIT, LEAVING] });
    const player = await visitor(fx.a);
    await visit(player.token, { url: DEPOSIT });

    expect((await poll(player.token))?.show_when).toEqual({ match: 'all', rules: [LEAVING] });
    expect(await sendOf(campaign.id, player.id)).toEqual({ deliveredAt: null });

    const shown = await server.post(
      `/customer/campaigns/${campaign.id}/shown`,
      undefined,
      auth(player.token),
    );
    expect(shown.statusCode).toBe(204);
    expect((await sendOf(campaign.id, player.id))?.deliveredAt).toBeInstanceOf(Date);
  });

  it('a card that waits never holds back one to show now', async () => {
    const waiting = await createCampaign({ rules: [ON_DEPOSIT, LEAVING] });
    const now = await createCampaign({ rules: [ON_DEPOSIT] });
    const player = await visitor(fx.a);
    await visit(player.token, { url: DEPOSIT });

    expect((await poll(player.token))?.id).toBe(now.id);
    const next = await poll(player.token);
    expect(next?.id).toBe(waiting.id);
    expect(next?.show_when).toBeDefined();
  });

  it('fires at the visitors already on the site when the campaign is saved, rule by rule', async () => {
    const player = await visitor(fx.a, 'TR');
    await visit(player.token, { url: DEPOSIT });
    const german = await visitor(fx.a, 'DE');
    await visit(german.token, { url: DEPOSIT });

    const campaign = await createCampaign({ rules: [TURKEY, ON_DEPOSIT] });
    expect(campaign.matched).toBe(1);
    expect(await sendOf(campaign.id, player.id)).toEqual({ deliveredAt: null });
    expect(await sendOf(campaign.id, german.id)).toBeNull();
  });

  // --- The other server-side fields ------------------------------------------

  it('referrer, new or returning, and any page of the session', async () => {
    const fromGoogle = await createCampaign({
      rules: [{ field: 'referrer', op: 'contains', value: 'google' }],
    });
    const returning = await createCampaign({
      rules: [{ field: 'visitor_type', op: 'equals', value: 'returning' }],
    });
    const passedPromo = await createCampaign({
      rules: [
        { field: 'session_url', op: 'contains', value: '/promo' },
        { field: 'current_url', op: 'not_contains', value: '/promo' },
      ],
    });

    const searcher = await visitor(fx.a);
    await visit(searcher.token, { url: HOME, referrer: 'https://www.google.com/search?q=x' });
    expect(await sendOf(fromGoogle.id, searcher.id)).not.toBeNull();
    expect(await sendOf(returning.id, searcher.id)).toBeNull();

    const regular = await visitor(fx.a);
    await owner.visit.create({
      data: {
        customerId: regular.id,
        licenseId: fx.a.licenseId,
        pages: [{ url: HOME }],
        startedAt: new Date(Date.now() - 3 * 86_400_000),
      },
    });
    await visit(regular.token, { url: HOME });
    expect(await sendOf(returning.id, regular.id)).not.toBeNull();
    expect(await sendOf(fromGoogle.id, regular.id)).toBeNull();

    await visit(regular.token, { url: `${SITE}/promo` });
    expect(await sendOf(passedPromo.id, regular.id)).toBeNull();
    await visit(regular.token, { url: CASINO });
    expect(await sendOf(passedPromo.id, regular.id)).not.toBeNull();
  });

  // --- POST /customer/visit --------------------------------------------------

  it('records single-page moves as page views, a repeat once, and fires on the move (FR-MOD-03.3.2)', async () => {
    const campaign = await createCampaign({ rules: [ON_DEPOSIT] });
    const player = await visitor(fx.a);
    await visit(player.token, { url: HOME });
    await visit(player.token, { url: HOME });
    expect(await sendOf(campaign.id, player.id)).toBeNull();
    await visit(player.token, { url: DEPOSIT });

    const visits = await owner.visit.findMany({
      where: { customerId: player.id },
      select: { pages: true },
    });
    expect(visits).toHaveLength(1);
    expect((visits[0]!.pages as Array<{ url: string }>).map((page) => page.url)).toEqual([
      HOME,
      DEPOSIT,
    ]);
    expect(await sendOf(campaign.id, player.id)).toEqual({ deliveredAt: null });
  });

  it('keeps session variables masked and bounded, and targets on them alone (FR-MOD-03.3.2)', async () => {
    const vip = await createCampaign({
      rules: [{ field: 'custom_var', op: 'gte', value: 3, key: 'vip_level' }],
    });
    const player = await visitor(fx.a);
    expect(
      await visit(player.token, {
        url: HOME,
        variables: { vip_level: 2, note: 'card 4111 1111 1111 1111', logged_in: true },
      }),
    ).toBe(204);
    expect(await sendOf(vip.id, player.id)).toBeNull();

    // Replaced, not merged; the repeat page still writes them and re-evaluates.
    expect(await visit(player.token, { url: HOME, variables: { vip_level: '4' } })).toBe(204);
    expect(await sendOf(vip.id, player.id)).not.toBeNull();

    const before = await owner.visit.findFirstOrThrow({
      where: { customerId: player.id },
      select: { variables: true },
    });
    expect(before.variables).toEqual({ vip_level: '4' });

    await visit(player.token, {
      url: HOME,
      variables: { note: 'card 4111 1111 1111 1111', logged_in: true },
    });
    const stored = await owner.visit.findFirstOrThrow({
      where: { customerId: player.id },
      select: { variables: true },
    });
    expect(stored.variables).toEqual({ note: 'card **** **** **** 1111', logged_in: 'true' });

    // Never handed back: the contact's profile does not carry them.
    const profile = await server.get(`/customers/${player.id}`, auth(writeToken));
    expect(profile.statusCode).toBe(200);
    expect(profile.body).not.toContain('logged_in');

    const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]));
    expect(await visit(player.token, { url: HOME, variables: tooMany })).toBe(400);
    expect(await visit(player.token, { url: HOME, variables: { k: 'x'.repeat(101) } })).toBe(400);
    expect(await visit(player.token, { url: HOME, variables: { ['x'.repeat(101)]: 1 } })).toBe(400);
    expect(await visit(player.token, { url: 'javascript:alert(1)' })).toBe(400);
    expect(await visit(player.token, { url: HOME, extra: 1 })).toBe(400);
    expect(await visit(writeToken, { url: HOME })).toBe(404);
  });

  it('the shown report: 404 for a campaign this visitor was never sent, 400 for a bad id', async () => {
    const player = await visitor(fx.a);
    const other = await createCampaign({ rules: [ON_DEPOSIT] });
    const theirs = await createCampaign({ rules: [ON_DEPOSIT] }, writeTokenB);

    for (const id of [other.id, theirs.id]) {
      const response = await server.post(
        `/customer/campaigns/${id}/shown`,
        undefined,
        auth(player.token),
      );
      expect(response.statusCode).toBe(404);
    }
    const bad = await server.post('/customer/campaigns/nope/shown', undefined, auth(player.token));
    expect(bad.statusCode).toBe(400);
    const agent = await server.post(
      `/customer/campaigns/${other.id}/shown`,
      undefined,
      auth(writeToken),
    );
    expect(agent.statusCode).toBe(404);
  });

  // --- Saving --------------------------------------------------------------

  it('refuses a trigger the engine could not read, naming the rule', async () => {
    const refuse = async (conditions: unknown): Promise<string> => {
      const response = await server.post(
        '/campaigns',
        { name: 'x', conditions, content: { message: 'm' } },
        auth(writeToken),
      );
      expect(response.statusCode).toBe(400);
      return (response.json() as { error: { message: string } }).error.message;
    };
    expect(await refuse({ rules: Array.from({ length: 11 }, () => ON_DEPOSIT) })).toMatch(/rules/);
    expect(
      await refuse({ rules: [ON_DEPOSIT, { field: 'country', op: 'contains', value: 'TR' }] }),
    ).toMatch(/conditions\.rules\.1/);
    expect(await refuse({ rules: [{ field: 'custom_var', op: 'equals', value: 'x' }] })).toMatch(
      /key/,
    );
    await refuse({ rules: [{ field: 'weather', op: 'equals', value: 'sunny' }] });
    await refuse({ match: 'some', rules: [ON_DEPOSIT] });
    await refuse({ rules: [] });
  });

  it('answers the first shape beside the rules only while they say exactly that', async () => {
    const legacy = await createCampaign({ url_contains: ' /deposit ' });
    expect(legacy.conditions).toEqual({
      match: 'all',
      rules: [ON_DEPOSIT],
      url_contains: '/deposit',
    });
    const both = await createCampaign({ rules: [TURKEY], url_contains: '/ignored' });
    expect(both.conditions).toEqual({ match: 'all', rules: [TURKEY] });
  });

  it('tells the widget at mint whether to report page changes', async () => {
    const tracking = async (): Promise<boolean> => {
      const customer = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Player' },
        select: { id: true },
      });
      const response = await mintForExistingCustomer(server, fx.a, customer.id);
      return (response.json() as { campaign_tracking: boolean }).campaign_tracking;
    };
    expect(await tracking()).toBe(false);

    // Switched off, or not started yet: still nothing to track.
    const off = await server.post(
      '/campaigns',
      {
        name: 'Off',
        active: false,
        conditions: { rules: [ON_DEPOSIT] },
        content: { message: 'm' },
      },
      auth(writeToken),
    );
    expect(off.statusCode).toBe(201);
    expect(await tracking()).toBe(false);

    await createCampaign({ rules: [ON_DEPOSIT] });
    expect(await tracking()).toBe(true);
  });

  // --- The regression the task names -------------------------------------

  it('an old campaign, converted by the migration, reaches the same visitor the same way (FR-MOD-03.3.2)', async () => {
    const old = await owner.campaign.create({
      data: {
        licenseId: fx.a.licenseId,
        name: 'From before EN-03',
        status: 'ongoing',
        conditions: { url_contains: ' /deposit ' },
        content: { message: 'Old but gold' },
      },
      select: { id: true },
    });
    const untouched = await owner.campaign.create({
      data: {
        licenseId: fx.a.licenseId,
        name: 'Empty trigger',
        status: 'inactive',
        conditions: { url_contains: '' },
        content: { message: 'x' },
      },
      select: { id: true },
    });

    // The migration's own statement, read from its file — twice, to show a
    // second run changes nothing.
    const sql = readFileSync(
      fileURLToPath(
        new URL(
          '../../prisma/migrations/20261202090000_campaign_conditions_v2/migration.sql',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    const update = sql.slice(sql.indexOf('UPDATE "campaigns"'));
    await owner.$executeRawUnsafe(update);
    await owner.$executeRawUnsafe(update);

    const converted = await owner.campaign.findUniqueOrThrow({
      where: { id: old.id },
      select: { conditions: true },
    });
    expect(converted.conditions).toEqual({
      url_contains: ' /deposit ',
      match: 'all',
      rules: [{ field: 'current_url', op: 'contains', value: '/deposit' }],
    });
    const empty = await owner.campaign.findUniqueOrThrow({
      where: { id: untouched.id },
      select: { conditions: true },
    });
    expect(empty.conditions).toEqual({ url_contains: '' });

    const player = await visitor(fx.a);
    await visit(player.token, { url: `${SITE}/Deposit?amount=50` });
    expect(await poll(player.token)).toEqual({ id: old.id, message: 'Old but gold' });
    expect((await sendOf(old.id, player.id))?.deliveredAt).toBeInstanceOf(Date);

    const elsewhere = await visitor(fx.a);
    await visit(elsewhere.token, { url: CASINO });
    expect(await poll(elsewhere.token)).toBeNull();
  });
});
