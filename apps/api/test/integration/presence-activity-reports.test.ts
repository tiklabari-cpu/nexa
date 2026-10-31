/**
 * Availability and agent activity reports (RP-03 · tm 370):
 * `GET /reports/availability` and `GET /reports/agent-activity`.
 *
 * The fixture day is Monday 2026-10-26 in the workspace's default boundary
 * (Europe/Istanbul, midnight — UTC+3), so 09:00 local is 06:00Z.
 *
 * People: the owner (`reports_read`), the fixture agent X (a plain member,
 * no reports scope), a Team Lead who leads team A (members: the lead and X),
 * and Z, a member of team B only.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultScopesForRole } from '@siyahtus/types';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;
type Json = Record<string, unknown>;

const DAY = '2026-10-26';
const DAY_FROM = '2026-10-25T21:00:00.000Z';
const DAY_TO = '2026-10-26T21:00:00.000Z';
const local = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(DAY_FROM) + ((h ?? 0) * 60 + (m ?? 0)) * 60_000);
};

describe('availability and agent activity reports (RP-03 · tm 370)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let teamA: bigint;
  let teamB: bigint;
  let agentX: string;
  let agentZ: string;
  let leadId: string;
  let ownerAuth: Headers;
  let leadAuth: Headers;
  let agentAuth: Headers;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
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

  async function member(name: string, role: string): Promise<string> {
    const account = await owner.account.create({
      data: { email: `${name.toLowerCase()}-${fx.a.licenseId}@example.test`, name },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: account.id, role, routingStatus: 'offline' },
    });
    return account.id;
  }

  async function event(agentId: string, status: string, at: Date, source = 'manual') {
    await owner.agentPresenceEvent.create({
      data: { licenseId: fx.a.licenseId, agentId, status, source, changedAt: at },
    });
  }

  async function get(path: string, auth: Headers): Promise<{ status: number; body: Json }> {
    const response = await server.get(path, auth);
    return { status: response.statusCode, body: response.json() as Json };
  }

  const agentsOf = (body: Json) => body.agents as Json[];
  /** The agent's row: `agents[]` of the activity strip, `by_agent[]` of availability. */
  const rowOf = (body: Json, agentId: string) =>
    ((Array.isArray(body.agents) ? body.agents : body.by_agent) as Json[]).find(
      (a) => a.agent_id === agentId,
    );

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

    agentX = fx.a.agentAccountId;
    leadId = await member('Lead', 'team_lead');
    agentZ = await member('Zeynep', 'agent');
    await owner.groupAgent.createMany({
      data: [
        { licenseId: fx.a.licenseId, groupId: teamA, agentId: leadId, isLead: true },
        { licenseId: fx.a.licenseId, groupId: teamA, agentId: agentX },
        { licenseId: fx.a.licenseId, groupId: teamB, agentId: agentZ },
      ],
    });

    ownerAuth = await session(fx.a.ownerAccountId, 'owner');
    leadAuth = await session(leadId, 'team_lead');
    agentAuth = await session(agentX, 'agent');

    // X's day: 09 accepting, 12 not accepting, 13 accepting, 18 offline.
    await event(agentX, 'accepting_chats', local('09:00'));
    await event(agentX, 'not_accepting_chats', local('12:00'));
    await event(agentX, 'accepting_chats', local('13:00'));
    await event(agentX, 'offline', local('18:00'));
    // Z was accepting since the day before and closed the browser at 15:00.
    await event(agentZ, 'accepting_chats', new Date(Date.parse(DAY_FROM) - 3_600_000));
    await event(agentZ, 'offline', local('15:00'), 'disconnect');
  });

  describe('the figures', () => {
    it('09 accepting / 12 not accepting / 13 accepting / 18 offline reads 8 h accepting and 1 h not accepting', async () => {
      const activity = await get(
        `/reports/agent-activity?date=${DAY}&agent_id=${agentX}`,
        ownerAuth,
      );
      expect(activity.status).toBe(200);
      expect(activity.body).toMatchObject({
        date: DAY,
        timezone: 'Europe/Istanbul',
        range: { from: DAY_FROM, to: DAY_TO },
        as_of: DAY_TO,
        next_cursor: null,
      });
      const x = rowOf(activity.body, agentX);
      expect(x).toMatchObject({
        accepting_seconds: 8 * 3600,
        not_accepting_seconds: 3600,
        offline_seconds: 6 * 3600,
        unknown_seconds: 9 * 3600,
        disconnected_seconds: 0,
      });
      expect((x?.segments as Json[]).map((s) => [s.state, s.from])).toEqual([
        ['unknown', DAY_FROM],
        ['accepting', local('09:00').toISOString()],
        ['not_accepting', local('12:00').toISOString()],
        ['accepting', local('13:00').toISOString()],
        ['offline', local('18:00').toISOString()],
      ]);

      const availability = await get(
        `/reports/availability?from=${DAY_FROM}&to=${DAY_TO}&agent_id=${agentX}`,
        ownerAuth,
      );
      expect(availability.status).toBe(200);
      expect(availability.body.totals).toMatchObject({
        accepting_seconds: 8 * 3600,
        not_accepting_seconds: 3600,
      });
      const hours = availability.body.by_hour as Json[];
      expect(hours).toHaveLength(24);
      expect(hours[9]).toMatchObject({ accepting_minutes: 60, mean_accepting_agents: 1 });
      expect(hours[12]).toMatchObject({ accepting_minutes: 0, not_accepting_minutes: 60 });
    });

    it('a closed browser shows as "no connection" after the tolerance', async () => {
      const { body } = await get(
        `/reports/agent-activity?date=${DAY}&agent_id=${agentZ}`,
        ownerAuth,
      );
      const z = rowOf(body, agentZ);
      // The opening row carries Z's state from the day before.
      expect((z?.segments as Json[]).map((s) => [s.state, s.source])).toEqual([
        ['accepting', 'manual'],
        ['disconnected', 'disconnect'],
      ]);
      expect(z).toMatchObject({ accepting_seconds: 15 * 3600, disconnected_seconds: 9 * 3600 });

      const availability = await get(
        `/reports/availability?from=${DAY_FROM}&to=${DAY_TO}&agent_id=${agentZ}`,
        ownerAuth,
      );
      expect(rowOf(availability.body, agentZ)).toMatchObject({ disconnects: 1 });
    });

    it('lays the saved work schedule over the day and counts accepting time inside it', async () => {
      await owner.workSchedule.create({
        data: {
          licenseId: fx.a.licenseId,
          agentId: agentX,
          timezone: 'Europe/Istanbul',
          schedule: [{ day: 'monday', start: '08:00', end: '17:00', enabled: true }],
        },
      });
      const { body } = await get(
        `/reports/agent-activity?date=${DAY}&agent_id=${agentX}`,
        ownerAuth,
      );
      expect(rowOf(body, agentX)?.planned).toEqual([
        { from: local('08:00').toISOString(), to: local('17:00').toISOString() },
      ]);
      const availability = await get(
        `/reports/availability?from=${DAY_FROM}&to=${DAY_TO}`,
        ownerAuth,
      );
      expect(rowOf(availability.body, agentX)).toMatchObject({
        planned_seconds: 9 * 3600,
        // 09-12 and 13-17 inside an 08-17 plan.
        planned_accepting_seconds: 7 * 3600,
      });
      expect(rowOf(availability.body, agentZ)).toMatchObject({ planned_seconds: null });
    });

    it('starts the day at the workspace boundary, not at UTC midnight', async () => {
      await owner.inboxSettings.create({
        data: {
          licenseId: fx.a.licenseId,
          brandId: await seedDefaultBrand(owner, fx.a.licenseId),
          dayBoundaryTz: 'Asia/Tokyo',
        },
      });
      const { body } = await get(
        `/reports/agent-activity?date=${DAY}&agent_id=${agentX}`,
        ownerAuth,
      );
      expect(body).toMatchObject({
        timezone: 'Asia/Tokyo',
        range: { from: '2026-10-25T15:00:00.000Z', to: '2026-10-26T15:00:00.000Z' },
      });
      // 06:00Z is 15:00 in Tokyo.
      const availability = await get(
        `/reports/availability?from=${DAY_FROM}&to=${DAY_TO}&agent_id=${agentX}`,
        ownerAuth,
      );
      expect((availability.body.by_hour as Json[])[15]).toMatchObject({ accepting_minutes: 60 });
    });
  });

  describe('who may read whom (05 RP-03 decision 2)', () => {
    it('a Team Member reads only themselves — another agent is a 403', async () => {
      const other = await get(`/reports/agent-activity?date=${DAY}&agent_id=${agentZ}`, agentAuth);
      expect(other.status).toBe(403);
      expect(
        (
          await get(
            `/reports/availability?from=${DAY_FROM}&to=${DAY_TO}&agent_id=${agentZ}`,
            agentAuth,
          )
        ).status,
      ).toBe(403);
      expect(
        (await get(`/reports/agent-activity?date=${DAY}&group_id=${teamA}`, agentAuth)).status,
      ).toBe(403);

      const own = await get(`/reports/agent-activity?date=${DAY}`, agentAuth);
      expect(own.status).toBe(200);
      expect(agentsOf(own.body).map((a) => a.agent_id)).toEqual([agentX]);
      expect(
        (await get(`/reports/agent-activity?date=${DAY}&agent_id=${agentX}`, agentAuth)).status,
      ).toBe(200);
    });

    it('a Team Lead reads the members of the teams they lead, and nobody else', async () => {
      const team = await get(`/reports/agent-activity?date=${DAY}`, leadAuth);
      expect(team.status).toBe(200);
      expect(
        agentsOf(team.body)
          .map((a) => a.agent_id)
          .sort(),
      ).toEqual([agentX, leadId].sort());
      expect(
        (await get(`/reports/agent-activity?date=${DAY}&agent_id=${agentX}`, leadAuth)).status,
      ).toBe(200);
      expect(
        (await get(`/reports/agent-activity?date=${DAY}&agent_id=${agentZ}`, leadAuth)).status,
      ).toBe(403);
      expect(
        (
          await get(
            `/reports/availability?from=${DAY_FROM}&to=${DAY_TO}&group_id=${teamB}`,
            leadAuth,
          )
        ).status,
      ).toBe(403);
    });

    it('the owner reads every member, a team narrows to its members, another licence is never in it', async () => {
      const all = await get(`/reports/availability?from=${DAY_FROM}&to=${DAY_TO}`, ownerAuth);
      const ids = (all.body.by_agent as Json[]).map((a) => a.agent_id);
      expect(ids).toEqual(expect.arrayContaining([fx.a.ownerAccountId, agentX, leadId, agentZ]));
      expect(ids).not.toContain(fx.b.agentAccountId);
      expect(all.body.agents).toBe(ids.length);

      const teamOnly = await get(
        `/reports/availability?from=${DAY_FROM}&to=${DAY_TO}&group_id=${teamB}`,
        ownerAuth,
      );
      expect((teamOnly.body.by_agent as Json[]).map((a) => a.agent_id)).toEqual([agentZ]);

      const foreign = await get(
        `/reports/agent-activity?date=${DAY}&agent_id=${fx.b.agentAccountId}`,
        ownerAuth,
      );
      expect(agentsOf(foreign.body)).toEqual([]);
    });
  });

  describe('the request', () => {
    it('pages agents in name order', async () => {
      const first = await get(`/reports/agent-activity?date=${DAY}&limit=2`, ownerAuth);
      expect(agentsOf(first.body)).toHaveLength(2);
      const cursor = first.body.next_cursor as string;
      expect(cursor).toBe(agentsOf(first.body)[1]?.agent_id);
      const rest = await get(
        `/reports/agent-activity?date=${DAY}&limit=100&cursor=${cursor}`,
        ownerAuth,
      );
      expect(rest.body.next_cursor).toBeNull();
      const seen = [...agentsOf(first.body), ...agentsOf(rest.body)].map((a) => a.agent_id);
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toEqual(expect.arrayContaining([fx.a.ownerAccountId, agentX, leadId, agentZ]));

      const stray = await get(
        `/reports/agent-activity?date=${DAY}&cursor=00000000-0000-4000-8000-000000000000`,
        ownerAuth,
      );
      expect(stray.status).toBe(400);
    });

    it('refuses conversation keys, a window over 31 days and a day that has not begun', async () => {
      expect((await get(`/reports/agent-activity?date=${DAY}&tag=x`, ownerAuth)).status).toBe(400);
      expect(
        (
          await get(
            `/reports/availability?from=2026-09-01T00:00:00Z&to=2026-10-26T00:00:00Z`,
            ownerAuth,
          )
        ).status,
      ).toBe(400);
      expect(
        (await get(`/reports/availability?from=${DAY_TO}&to=${DAY_FROM}`, ownerAuth)).status,
      ).toBe(400);
      expect((await get('/reports/agent-activity?date=2999-01-01', ownerAuth)).status).toBe(400);
      expect((await get('/reports/agent-activity?date=2026-02-30', ownerAuth)).status).toBe(400);
    });

    it('defaults to today, drawn up to now', async () => {
      const { status, body } = await get(`/reports/agent-activity?agent_id=${agentX}`, ownerAuth);
      expect(status).toBe(200);
      expect(Date.parse(body.as_of as string)).toBeLessThanOrEqual(Date.now());
      expect(Date.parse(body.as_of as string)).toBeGreaterThan(
        Date.parse((body.range as Json).from as string),
      );
      // X went offline at 18:00 on the 26th and nothing since: offline all of today so far.
      const x = rowOf(body, agentX);
      expect((x?.segments as Json[]).map((s) => s.state)).toEqual(['offline']);
    });
  });
});
