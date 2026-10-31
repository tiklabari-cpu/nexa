/**
 * Report filters (RP-01 · tm 368): agent, team, tag and topic narrow every
 * conversation report — the JSON, its export, a share link and a scheduled
 * export — and an Ekip Lideri reads only the teams they lead, whatever team
 * they ask for.
 *
 * The fixture: four connections in the window, one before it.
 *
 *   c1  team A      agent X  tag bonus  topic withdrawal  rated good  SLA miss
 *   c2  teams A, B  agent Y  tag kyc                      rated bad
 *   c3  team B      agent X  tag bonus  topic deposit
 *   c4  team B      agent Y
 *   p1  team A      agent X  (the baseline window)
 *
 * plus a ticket in team A held by X and one in team B (with an SLA miss).
 * The lead leads team A and is a plain member of team B.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultScopesForRole,
  generateShortId,
  REPORT_FILTERABLE_GROUPS,
  type ReportFilterableGroup,
} from '@siyahtus/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { REPORT_GROUPS } from '../../src/routes/reports-export.js';

type Headers = Record<string, string>;
type Json = Record<string, unknown>;

const DAY = 86_400_000;

/** `metric,value` CSV rows as a map (the overview export). */
function metricRows(csv: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of csv.trim().split(/\r?\n/).slice(1)) {
    const [key, value] = line.split(',');
    if (key !== undefined) out.set(key, value ?? '');
  }
  return out;
}

/** Data lines of a CSV, header dropped. */
function dataLines(csv: string): string[][] {
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.length > 0)
    .map((line) => line.split(','));
}

const sum = (rows: Array<Record<string, unknown>>, key: string): number =>
  rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);

describe('report filters (RP-01 · tm 368)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let teamA: bigint;
  let teamB: bigint;
  let agentX: string;
  let agentY: string;
  let bonus: string;
  let kyc: string;
  let ownerAuth: Headers;
  let leadAuth: Headers;
  let leadId: string;
  const now = Date.now();
  const inWindow = new Date(now - DAY);
  const inBaseline = new Date(now - 40 * DAY);

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  afterEach(async () => {
    await server.app.backgroundMail.settled();
  });

  async function session(accountId: string, role: string): Promise<Headers> {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: accountId,
      kind: 'oauth',
      scopes: defaultScopesForRole(role),
    });
    return { authorization: `Bearer ${token}` };
  }

  async function connection(input: {
    teams: bigint[];
    agent: string;
    tags?: string[];
    topic?: string;
    rating?: 'good' | 'bad';
    at?: Date;
  }): Promise<string> {
    const at = input.at ?? inWindow;
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Oyuncu' },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId: customer.id, active: false },
    });
    const threadId = generateShortId();
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: fx.a.licenseId,
        active: false,
        assigneeId: input.agent,
        createdAt: at,
        closedAt: new Date(at.getTime() + 600_000),
        firstResponseAt: new Date(at.getTime() + 60_000),
      },
    });
    for (const groupId of input.teams) {
      await owner.chatAccess.create({ data: { chatId, groupId } });
    }
    for (const tagId of input.tags ?? []) {
      await owner.threadTag.create({ data: { threadId, tagId } });
    }
    if (input.topic !== undefined) {
      await owner.aiConversationOutcome.create({
        data: {
          licenseId: fx.a.licenseId,
          chatId,
          threadId,
          intent: input.topic,
          startedAt: at,
          endedAt: new Date(at.getTime() + 600_000),
          aiTurns: 1,
        },
      });
    }
    if (input.rating !== undefined) {
      await owner.rating.create({
        data: {
          chatId,
          licenseId: fx.a.licenseId,
          threadId,
          value: input.rating,
          createdAt: new Date(at.getTime() + 700_000),
        },
      });
    }
    return threadId;
  }

  async function slaMiss(subjectType: 'thread' | 'ticket', subjectId: string): Promise<void> {
    await owner.slaBreach.create({
      data: {
        licenseId: fx.a.licenseId,
        subjectType,
        subjectId,
        target: 'first_response',
        targetMinutes: 5,
        elapsedMinutes: 9,
        businessHoursOnly: false,
        detectedAt: inWindow,
      },
    });
  }

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    server.app.permissionMatrix.cache.invalidate();
    await clearRateLimits(server.app);

    const group = async (name: string) =>
      (
        await owner.group.create({
          data: { licenseId: fx.a.licenseId, name },
          select: { id: true },
        })
      ).id;
    teamA = await group('Finans');
    teamB = await group('Teknik');
    const tag = async (name: string) =>
      (await owner.tag.create({ data: { licenseId: fx.a.licenseId, name }, select: { id: true } }))
        .id;
    bonus = await tag('bonus');
    kyc = await tag('kyc');

    agentX = fx.a.agentAccountId;
    agentY = fx.a.ownerAccountId;

    const lead = await owner.account.create({
      data: { email: `lead-${fx.a.licenseId}@example.test`, name: 'Ekip Lideri' },
      select: { id: true },
    });
    leadId = lead.id;
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: lead.id,
        role: 'team_lead',
        routingStatus: 'accepting_chats',
      },
    });
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: teamA, agentId: lead.id, isLead: true },
    });
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: teamB, agentId: lead.id },
    });

    const c1 = await connection({
      teams: [teamA],
      agent: agentX,
      tags: [bonus],
      topic: 'withdrawal',
      rating: 'good',
    });
    await connection({ teams: [teamA, teamB], agent: agentY, tags: [kyc], rating: 'bad' });
    await connection({ teams: [teamB], agent: agentX, tags: [bonus], topic: 'deposit' });
    await connection({ teams: [teamB], agent: agentY });
    await connection({ teams: [teamA], agent: agentX, at: inBaseline });

    await owner.ticket.create({
      data: {
        id: generateShortId(),
        licenseId: fx.a.licenseId,
        subject: 'Çekim',
        assigneeId: agentX,
        groupId: teamA,
        createdAt: inWindow,
      },
    });
    const ticketB = generateShortId();
    await owner.ticket.create({
      data: {
        id: ticketB,
        licenseId: fx.a.licenseId,
        subject: 'Giriş',
        groupId: teamB,
        createdAt: inWindow,
      },
    });
    await slaMiss('thread', c1);
    await slaMiss('ticket', ticketB);

    ownerAuth = await session(fx.a.ownerAccountId, 'owner');
    leadAuth = await session(leadId, 'team_lead');
  });

  async function json(path: string, auth: Headers = ownerAuth): Promise<Json> {
    const response = await server.get(path, auth);
    expect(response.statusCode, `${path}: ${response.body}`).toBe(200);
    return response.json() as Json;
  }

  async function csv(query: string, auth: Headers = ownerAuth): Promise<string> {
    const response = await server.get(`/reports/export?${query}`, auth);
    expect(response.statusCode, `${query}: ${response.body}`).toBe(200);
    return response.body;
  }

  const totals = (body: Json) => body.totals as Record<string, number | null>;

  it('narrows the Overview by each filter, any-of within a key, all-of across keys (FR-MOD-07.5)', async () => {
    const all = await json('/reports/overview');
    expect(totals(all).chats).toBe(4);
    expect(totals(all).tickets).toBe(2);
    expect(all.filters).toBeUndefined();
    expect(typeof totals(all).achieved_goals).toBe('number');

    const byAgent = await json(`/reports/overview?agent_id=${agentX}`);
    expect(totals(byAgent).chats).toBe(2);
    expect(totals(byAgent).tickets).toBe(1);
    expect(byAgent.filters).toEqual({ agent_id: [agentX] });
    // A goal is reached by a visitor: no filter can be credited with it.
    expect(totals(byAgent).achieved_goals).toBeNull();
    expect((byAgent.previous_period as Json).achieved_goals).toBeNull();

    expect(totals(await json(`/reports/overview?group_id=${teamA}`)).chats).toBe(2);
    expect(totals(await json(`/reports/overview?group_id=${teamB}`)).chats).toBe(3);
    expect(totals(await json(`/reports/overview?tag=${bonus}`)).chats).toBe(2);
    expect(totals(await json(`/reports/overview?tag=${bonus}&tag=${kyc}`)).chats).toBe(3);
    expect(totals(await json('/reports/overview?topic=withdrawal')).chats).toBe(1);
    expect(totals(await json(`/reports/overview?agent_id=${agentX}&group_id=${teamA}`)).chats).toBe(
      1,
    );
    expect(
      totals(await json(`/reports/overview?agent_id=${agentX}&agent_id=${agentY}`)).chats,
    ).toBe(4);

    const teamAOverview = await json(`/reports/overview?group_id=${teamA}`);
    expect((teamAOverview.satisfaction as Json).responses).toBe(2);
    expect((teamAOverview.sla as Json).breaches).toBe(1);
    expect((teamAOverview.previous_period as Json).chats).toBe(1);
    expect((teamAOverview.top_tags as Array<{ name: string }>).map((t) => t.name).sort()).toEqual([
      'bonus',
      'kyc',
    ]);
    expect(totals(await json(`/reports/overview?group_id=${teamB}`)).tickets).toBe(1);
    expect((await json(`/reports/overview?group_id=${teamB}`)).sla).toMatchObject({ breaches: 1 });
  });

  /**
   * The "every endpoint applies the filter" guard (05 RP-01 "Riskler"): a filter
   * that matches nothing must zero every conversation figure of every
   * conversation report, JSON and export alike. A query that forgot the filter
   * shows up here as a non-zero number.
   */
  it('applies the filter to every conversation report, JSON and export, with no query left out (FR-MOD-07.7)', async () => {
    const nobody = '00000000-0000-4000-8000-000000000001';
    const q = `agent_id=${nobody}`;

    const checks: Record<ReportFilterableGroup, () => Promise<void>> = {
      overview: async () => {
        const body = await json(`/reports/overview?${q}`);
        for (const key of ['chats', 'tickets', 'total_cases', 'closed', 'manual', 'assisted']) {
          expect(totals(body)[key], key).toBe(0);
        }
        expect(totals(body).automated).toBe(0);
        expect(totals(body).queued_now).toBe(0);
        expect(body.by_agent).toEqual([]);
        expect(body.top_tags).toEqual([]);
        expect((body.satisfaction as Json).responses).toBe(0);
        expect((body.sla as Json).breaches).toBe(0);
        const prev = body.previous_period as Json;
        expect(prev.chats).toBe(0);
        expect(prev.tickets).toBe(0);
        expect(prev.sla_breaches).toBe(0);
        const rows = metricRows(await csv(`group=overview&${q}&baseline=previous_period`));
        for (const key of ['chats', 'tickets', 'total_cases', 'closed', 'satisfaction_responses']) {
          expect(rows.get(key), key).toBe('0');
        }
        expect(rows.get('benchmark_chats')).toBe('0');
      },
      breakdown: async () => {
        const body = await json(`/reports/breakdown?${q}`);
        expect(body.by_day).toEqual([]);
        expect(sum(body.by_hour as Json[], 'chats')).toBe(0);
        expect(body.by_agent).toEqual([]);
        expect(body.by_channel).toEqual([]);
        expect(body.by_team).toEqual([]);
        expect((body.previous_period as Json).chats).toBe(0);
        const lines = dataLines(await csv(`group=breakdown&${q}`));
        expect(lines.reduce((total, line) => total + Number(line[2] ?? 0), 0)).toBe(0);
      },
      'team-performance': async () => {
        const body = await json(`/reports/team-performance?${q}`);
        expect(body.agents).toEqual([]);
        expect((body.totals as Json).chats).toBe(0);
        expect((body.previous_period as Json).chats).toBe(0);
        expect(dataLines(await csv(`group=team-performance&${q}`))).toEqual([]);
      },
      reviews: async () => {
        const body = await json(`/reports/reviews?${q}`);
        expect((body.csat as Json).responses).toBe(0);
        expect(body.by_day).toEqual([]);
        expect((body.previous_period as Json).responses).toBe(0);
        const days = dataLines(await csv(`group=reviews&${q}`)).filter(
          (line) => !String(line[0]).startsWith('insight_'),
        );
        expect(days).toEqual([]);
      },
    };
    // A conversation group added to the list without a check here fails.
    expect(Object.keys(checks).sort()).toEqual([...REPORT_FILTERABLE_GROUPS].sort());
    for (const group of REPORT_FILTERABLE_GROUPS) await checks[group]();

    // And the same reports without the filter are not empty — the zeros above
    // are the filter's, not an empty fixture's.
    expect(totals(await json('/reports/overview')).chats).toBe(4);
    expect(((await json('/reports/team-performance')).agents as Json[]).length).toBe(2);
    expect(((await json('/reports/reviews')).csat as Json).responses).toBe(2);
  });

  it('refuses a filter on every report that is not counted from conversations, rather than ignoring it', async () => {
    const q = `agent_id=${agentX}`;
    const others = REPORT_GROUPS.map((group) => group.id).filter(
      (id) => !(REPORT_FILTERABLE_GROUPS as readonly string[]).includes(id),
    );
    expect(others.length).toBeGreaterThan(0);
    for (const id of others) {
      const json = await server.get(`/reports/${id}?${q}`, ownerAuth);
      expect(json.statusCode, id).toBe(400);
      const exported = await server.get(`/reports/export?group=${id}&${q}`, ownerAuth);
      expect(exported.statusCode, `export ${id}`).toBe(400);
    }
    expect((await server.get(`/reports/staffing-forecast?${q}`, ownerAuth)).statusCode).toBe(400);
    // Unfiltered, they still answer.
    expect((await server.get('/reports/cases', ownerAuth)).statusCode).toBe(200);
  });

  it('exports exactly the figures the filtered screen shows (FR-MOD-07.7)', async () => {
    const q = `group_id=${teamB}&tag=${bonus}&tag=${kyc}`;
    const overview = await json(`/reports/overview?${q}`);
    const rows = metricRows(await csv(`group=overview&${q}`));
    expect(Number(rows.get('chats'))).toBe(totals(overview).chats);
    expect(totals(overview).chats).toBe(2);
    expect(Number(rows.get('tickets'))).toBe(totals(overview).tickets);
    expect(Number(rows.get('closed'))).toBe(totals(overview).closed);
    expect(Number(rows.get('satisfaction_responses'))).toBe(
      (overview.satisfaction as Json).responses,
    );

    const performance = await json(`/reports/team-performance?${q}`);
    const agents = performance.agents as Array<{ agent_id: string; chats: number }>;
    const lines = dataLines(await csv(`group=team-performance&${q}`));
    expect(lines.map((line) => [line[0], Number(line[2])]).sort()).toEqual(
      agents.map((row) => [row.agent_id, row.chats]).sort(),
    );

    const breakdown = await json(`/reports/breakdown?group_id=${teamA}`);
    // Under a team filter the per-team rows are the filtered teams' — c2 is
    // also shared with team B, which does not open a row for B.
    expect((breakdown.by_team as Array<{ team_id: number }>).map((row) => row.team_id)).toEqual([
      Number(teamA),
    ]);
  });

  it('accepts ids only — an e-mail address is not a filter value (GV-05)', async () => {
    const response = await server.get('/reports/overview?agent_id=agent%40example.test', ownerAuth);
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('agent_id');
    expect((await server.get('/reports/overview?group_id=finans', ownerAuth)).statusCode).toBe(400);
  });

  describe('the Ekip Lideri reach (RL-02 · K7)', () => {
    it('reads only the teams they lead, and asking for another team is an empty report (FR-MOD-04.RBAC)', async () => {
      const own = await json('/reports/overview', leadAuth);
      expect(totals(own).chats).toBe(2);
      expect(own.filters).toEqual({ group_id: [String(teamA)] });

      // Team B: they are a member, not its lead — the intersection is empty.
      const other = await json(`/reports/overview?group_id=${teamB}`, leadAuth);
      expect(totals(other).chats).toBe(0);
      expect(totals(other).tickets).toBe(0);
      expect(other.filters).toEqual({ group_id: [] });

      const both = await json(`/reports/overview?group_id=${teamA}&group_id=${teamB}`, leadAuth);
      expect(totals(both).chats).toBe(2);
      expect(both.filters).toEqual({ group_id: [String(teamA)] });

      const narrowed = await json(`/reports/overview?agent_id=${agentY}`, leadAuth);
      expect(totals(narrowed).chats).toBe(1);

      // The export is bounded the same way.
      const rows = metricRows(await csv(`group=overview&group_id=${teamB}`, leadAuth));
      expect(rows.get('chats')).toBe('0');
      const breakdown = await json('/reports/breakdown', leadAuth);
      expect((breakdown.by_team as Array<{ team_id: number }>).map((row) => row.team_id)).toEqual([
        Number(teamA),
      ]);
    });

    it('stops reading a team the moment they stop leading it', async () => {
      await owner.groupAgent.updateMany({
        where: { groupId: teamA, agentId: leadId },
        data: { isLead: false },
      });
      const body = await json('/reports/overview', leadAuth);
      expect(totals(body).chats).toBe(0);
      expect(body.filters).toEqual({ group_id: [] });
    });

    it('keeps the lead off every other report, billing and the workspace-wide scope (FR-MOD-04.RBAC)', async () => {
      for (const id of ['cases', 'leads', 'goals', 'ai-agent', 'topics', 'sales', 'campaigns']) {
        expect((await server.get(`/reports/${id}`, leadAuth)).statusCode, id).toBe(403);
        expect(
          (await server.get(`/reports/export?group=${id}`, leadAuth)).statusCode,
          `export ${id}`,
        ).toBe(403);
      }
      expect((await server.get('/billing/subscription', leadAuth)).statusCode).toBe(403);
      const groups = (await json('/reports/groups', leadAuth)).groups as Array<{ id: string }>;
      expect(groups.map((group) => group.id).sort()).toEqual([...REPORT_FILTERABLE_GROUPS].sort());

      // An Ekip Üyesi has no report reach at all.
      const memberAuth = await session(fx.a.agentAccountId, 'agent');
      expect((await server.get('/reports/overview', memberAuth)).statusCode).toBe(403);
    });
  });

  describe('frozen filters', () => {
    it('freezes a share link to its filter, and refuses one on a group that takes none (FR-MOD-07.3.1)', async () => {
      const minted = await server.post(
        '/reports/share-links',
        { group: 'overview', filters: { group_id: [String(teamA)], agent_id: [agentX] } },
        ownerAuth,
      );
      expect(minted.statusCode, minted.body).toBe(201);
      const link = minted.json() as { token: string; filters: Json };
      expect(link.filters).toEqual({ agent_id: [agentX], group_id: [String(teamA)] });

      const shared = await server.get(`/reports/shared?token=${link.token}`, {});
      expect(shared.statusCode).toBe(200);
      const body = shared.json() as { filters: Json; rows: Array<[string, number]> };
      expect(body.filters).toEqual(link.filters);
      expect(new Map(body.rows).get('chats')).toBe(1);
      // The same table the filtered export gives.
      const exported = metricRows(await csv(`group=overview&group_id=${teamA}&agent_id=${agentX}`));
      expect(String(new Map(body.rows).get('chats'))).toBe(exported.get('chats'));

      const list = (await json('/reports/share-links')).items as Array<{ filters: Json }>;
      expect(list[0]?.filters).toEqual(link.filters);

      const refused = await server.post(
        '/reports/share-links',
        { group: 'cases', filters: { agent_id: [agentX] } },
        ownerAuth,
      );
      expect(refused.statusCode).toBe(400);
      const unknownKey = await server.post(
        '/reports/share-links',
        { group: 'overview', filters: { email: ['x@example.test'] } },
        ownerAuth,
      );
      expect(unknownKey.statusCode).toBe(400);
    });

    it('stores a scheduled export’s filter and keeps it on a conversation group (FR-MOD-07.7)', async () => {
      const created = await server.post(
        '/reports/scheduled-exports',
        {
          group: 'team-performance',
          frequency: 'weekly',
          recipients: [fx.a.ownerEmail],
          filters: { group_id: [Number(teamA)], tag: [bonus] },
        },
        ownerAuth,
      );
      expect(created.statusCode, created.body).toBe(201);
      const schedule = created.json() as { id: string; filters: Json };
      expect(schedule.filters).toEqual({ group_id: [String(teamA)], tag: [bonus] });

      const moved = await server.patch(
        `/reports/scheduled-exports/${schedule.id}`,
        { group: 'leads' },
        ownerAuth,
      );
      expect(moved.statusCode).toBe(400);

      const cleared = await server.patch(
        `/reports/scheduled-exports/${schedule.id}`,
        { filters: {} },
        ownerAuth,
      );
      expect(cleared.statusCode).toBe(200);
      expect((cleared.json() as { filters: Json }).filters).toEqual({});
      expect(
        (
          await server.patch(
            `/reports/scheduled-exports/${schedule.id}`,
            { group: 'leads' },
            ownerAuth,
          )
        ).statusCode,
      ).toBe(200);

      const refused = await server.post(
        '/reports/scheduled-exports',
        {
          group: 'goals',
          frequency: 'daily',
          recipients: [fx.a.ownerEmail],
          filters: { topic: ['withdrawal'] },
        },
        ownerAuth,
      );
      expect(refused.statusCode).toBe(400);
    });
  });
});
