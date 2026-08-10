/**
 * `buildGroupCsv`'s public contract — one header row and one row shape per
 * report group, moved with the generator to this module (07.9-sched-d2).
 *
 * Figures are `reports-billing.test.ts`'s job (it proves a CSV export never
 * disagrees with the JSON report it was reused from, ADR-09) and stays
 * unchanged and green as the regression proof for this move. This suite pins
 * what every *consumer* of a CSV — a spreadsheet, the scheduler's mailer
 * (07.9-sched-e) — can rely on without reading a row's numbers: the header,
 * the row width, and which groups are a day series versus a fixed
 * `metric,value` table. Plus the one failure mode `group` has on its own: a
 * name the catalogue does not carry.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../lib/tenant.js';
import { ownerClient, seedFixtures, type Fixtures } from '../../../test/helpers/fixtures.js';
import { buildGroupCsv } from './report-csv.js';

describe('buildGroupCsv — header + row shape (07.9-sched-d2)', () => {
  let owner: PrismaClient;
  let fx: Fixtures;
  /** The one goal the fixture defines — its id is a cell in the goals table. */
  let goalId: string;

  const from = new Date('2026-01-01T00:00:00.000Z');
  const to = new Date('2026-01-01T23:59:59.999Z');
  const day = '2026-01-01';

  beforeAll(async () => {
    owner = ownerClient();
    fx = await seedFixtures(owner);

    // One closed, automated, agent-assigned thread with a good rating and one
    // open ticket — enough for every day-series group (breakdown, reviews,
    // cases, team-performance) to carry a real row without standing up the
    // full chat-service flow reports-billing.test.ts already exercises.
    const chatId = 'csvshapechat';
    const threadId = 'csvshapethrd';
    await owner.chat.create({
      data: { id: chatId, licenseId: fx.a.licenseId, customerId: fx.a.customerId, createdAt: from },
    });
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: fx.a.licenseId,
        active: false,
        assigneeId: fx.a.agentAccountId,
        createdAt: from,
        closedAt: from,
      },
    });
    await owner.rating.create({
      data: { chatId, licenseId: fx.a.licenseId, threadId, value: 'good', createdAt: from },
    });
    await owner.ticket.create({
      data: {
        id: 'csvshapetckt',
        licenseId: fx.a.licenseId,
        customerId: fx.a.customerId,
        subject: 'Shape fixture',
        status: 'open',
        createdAt: from,
      },
    });

    // A lead touch (FR-MOD-07.7 Leads, §V3): an `is_lead` customer whose only
    // license contact is this chat.
    const lead = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: 'Lead fixture', isLead: true },
      select: { id: true },
    });
    await owner.chat.create({
      data: { id: 'csvshapelead', licenseId: fx.a.licenseId, customerId: lead.id, createdAt: from },
    });

    // The Goals funnel (FR-MOD-13.3): the chat's customer also visited and
    // converted in the window, so all three nested stages carry a real 1 —
    // enough to pin the row shape without re-proving the figures, which
    // `reports-billing.test.ts` owns.
    await owner.visit.create({
      data: { licenseId: fx.a.licenseId, customerId: fx.a.customerId, startedAt: from },
    });
    const goal = await owner.goal.create({
      data: { licenseId: fx.a.licenseId, name: 'Signed up' },
      select: { id: true },
    });
    goalId = goal.id;
    await owner.goalAchievement.create({
      data: {
        licenseId: fx.a.licenseId,
        goalId: goal.id,
        customerId: fx.a.customerId,
        achievedAt: from,
      },
    });
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  function csv(group: string) {
    return withTenant(
      owner,
      { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
      (tx) => buildGroupCsv(tx, fx.a.licenseId, group, from, to),
    );
  }

  it("overview — a fixed metric,value table, independent of the window's data", async () => {
    const { headers, rows } = await csv('overview');
    expect(headers).toEqual(['metric', 'value']);
    expect(rows).toHaveLength(12);
    for (const row of rows) expect(row).toHaveLength(2);
    expect(rows).toContainEqual(['chats', 1]);
    expect(rows).toContainEqual(['tickets', 1]);
  });

  it('ai-agent — a fixed metric,value table', async () => {
    const { headers, rows } = await csv('ai-agent');
    expect(headers).toEqual(['metric', 'value']);
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row).toHaveLength(2);
    expect(rows).toContainEqual(['resolutions', 1]);
  });

  it('sales — the "not configured" skeleton, always this shape (FR-MOD-13.5)', async () => {
    const { headers, rows } = await csv('sales');
    expect(headers).toEqual(['metric', 'value']);
    // Fixed regardless of data — there is no sales source to have measured.
    expect(rows).toEqual([
      ['configured', 'false'],
      ['tracked_sales', null],
      ['attributed_revenue_cents', null],
      ['currency', null],
      ['conversions', null],
    ]);
  });

  it('reviews — one row per UTC day with a response, date,good,bad,responses,score', async () => {
    const { headers, rows } = await csv('reviews');
    expect(headers).toEqual(['date', 'good', 'bad', 'responses', 'score']);
    expect(rows).toEqual([[day, 1, 0, 1, 1]]);
  });

  it('cases — one row per UTC day with a ticket, date,open,closed,total', async () => {
    const { headers, rows } = await csv('cases');
    expect(headers).toEqual(['date', 'open', 'closed', 'total']);
    expect(rows).toEqual([[day, 1, 0, 1]]);
  });

  it('leads — one row per UTC day with a touch, date,count', async () => {
    const { headers, rows } = await csv('leads');
    expect(headers).toEqual(['date', 'count']);
    expect(rows).toEqual([[day, 1]]);
  });

  it('team-performance — one row per assigned agent, 14 columns', async () => {
    const { headers, rows } = await csv('team-performance');
    expect(headers).toEqual([
      'agent_id',
      'name',
      'chats',
      'closed',
      'manual',
      'assisted',
      'automated',
      'avg_first_response_seconds',
      'avg_duration_seconds',
      'csat_good',
      'csat_bad',
      'csat_responses',
      'csat_score',
      'transfers',
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(14);
    expect(rows[0]?.[0]).toBe(fx.a.agentAccountId);
  });

  it('breakdown — a long-format table across four dimensions, dense on the hour axis', async () => {
    const { headers, rows } = await csv('breakdown');
    expect(headers).toEqual([
      'dimension',
      'key',
      'chats',
      'closed',
      'manual',
      'assisted',
      'automated',
    ]);
    for (const row of rows) expect(row).toHaveLength(7);
    // Hours 0-23 are always present (breakdownByHour is dense) — the floor on
    // row count regardless of how sparse the day/team/channel dimensions are.
    const hourRows = rows.filter((row) => row[0] === 'hour');
    expect(hourRows).toHaveLength(24);
    expect(rows).toContainEqual(['day', day, 1, 1, 0, 0, 1]);
  });

  it('topics — headers survive an empty cluster set (below the sufficiency floor)', async () => {
    const { headers, rows } = await csv('topics');
    expect(headers).toEqual(['label', 'volume', 'share', 'previous_volume', 'trend']);
    // A single thread's worth of text never clears TOPIC_MIN_CONVERSATIONS —
    // the empty-but-headered shape 07.6-a's "no fabricated zero-row" rule asks
    // for, proven here as a row-shape property rather than a topics figure.
    expect(rows).toEqual([]);
  });

  it('goals — the funnel then one row per defined goal, section,key,name,value', async () => {
    const { headers, rows } = await csv('goals');
    expect(headers).toEqual(['section', 'key', 'name', 'value']);
    for (const row of rows) expect(row).toHaveLength(4);
    // The funnel block is fixed: four rows, always in stage order, so a reader
    // that takes them positionally is not at the mercy of the window's data.
    expect(rows.slice(0, 4)).toEqual([
      ['funnel', 'visitors', 'Visitors', 1],
      ['funnel', 'chats', 'Chats', 1],
      ['funnel', 'conversions', 'Conversions', 1],
      ['funnel', 'conversion_rate', 'Conversion rate', 1],
    ]);
    // Then one row per goal — the id in `key` so a consumer can join, the name
    // in `name` so a spreadsheet is readable.
    expect(rows.slice(4)).toEqual([['goal', goalId, 'Signed up', 1]]);
  });

  it('an unknown group is a validation error, not an empty file', async () => {
    await expect(csv('not-a-real-group')).rejects.toMatchObject({
      name: 'ApiError',
      type: 'validation',
    });
  });
});
