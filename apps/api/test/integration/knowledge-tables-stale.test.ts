/**
 * The stale-row sweep of the structured knowledge tables (tm 310.5 · SiyahTuş
 * analysis AI-13-S2), against Postgres.
 *
 * A row is due for review `review_interval_days` after `reviewed_at` (a bonus
 * also at `active_to`). The sweep claims each stale row once per due moment and
 * mails the workspace's owner and admins one digest of the rows it claimed:
 * a second pass tells nobody twice, a reviewed row that lapses again is
 * announced again, another workspace's rows never reach this one's people.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KnowledgeTableStaleSweeper } from '../../src/services/knowledge-tables/stale-sweep.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const DAY = 24 * 60 * 60 * 1000;

describe('the stale-row sweep — owner and admins hear once per lapse (AI-13-S2 · tm 310.5)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;
  const mailer = new MemoryMailer();
  const now = new Date('2026-10-21T09:00:00Z');
  const ago = (days: number): Date => new Date(now.getTime() - days * DAY);

  const sweep = (at: Date = now) =>
    new KnowledgeTableStaleSweeper(app, mailer, 'https://panel.example.test').run({ now: at });
  const mailsTo = (email: string) =>
    mailer.sent.filter((m) => m.kind === 'notification' && m.to === email);

  async function payment(licenseId: bigint, name: string, reviewedAt: Date, interval = 14) {
    return owner.kbPaymentMethod.create({
      data: {
        licenseId,
        name,
        direction: 'deposit',
        reviewedAt,
        reviewIntervalDays: interval,
      },
      select: { id: true },
    });
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    mailer.clear();
  });

  it('mails the owner one digest naming the rows past their review date, and not the fresh ones', async () => {
    await payment(fx.a.licenseId, 'Papara', ago(20));
    await payment(fx.a.licenseId, 'Havale', ago(3));
    await owner.kbKycDocument.create({
      data: { licenseId: fx.a.licenseId, docType: 'Kimlik kartı', reviewedAt: ago(100) },
    });

    const report = await sweep();

    const tenant = report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());
    expect(tenant).toMatchObject({ stale: 2, announced: 2, mailed: 1, mailFailed: 0 });
    const mails = mailsTo(fx.a.ownerEmail);
    expect(mails).toHaveLength(1);
    expect(mails[0]?.body).toContain('Papara');
    expect(mails[0]?.body).toContain('Kimlik kartı');
    expect(mails[0]?.body).not.toContain('Havale');
    expect(mails[0]?.body).toContain('https://panel.example.test/app/playbook');
  });

  it('is idempotent: a second pass over the same rows announces and mails nothing', async () => {
    await payment(fx.a.licenseId, 'Papara', ago(20));

    await sweep();
    mailer.clear();
    const again = await sweep(new Date(now.getTime() + DAY));

    expect(again.totals.announced).toBe(0);
    expect(again.tenants.find((t) => t.licenseId === fx.a.licenseId.toString())?.stale).toBe(1);
    expect(mailer.sent).toEqual([]);
  });

  it('announces a row again when it is reviewed and lapses a second time', async () => {
    const row = await payment(fx.a.licenseId, 'Papara', ago(20));
    await sweep();
    mailer.clear();

    // "Gözden geçirdim" — due again in 14 days, so it is no longer stale and its claim goes.
    await owner.kbPaymentMethod.update({ where: { id: row.id }, data: { reviewedAt: now } });
    const reviewed = await sweep();
    expect(reviewed.totals.stale).toBe(0);
    expect(await owner.knowledgeTableStaleNotice.count({ where: { rowId: row.id } })).toBe(0);
    expect(mailer.sent).toEqual([]);

    const lapse = await sweep(new Date(now.getTime() + 15 * DAY));
    expect(lapse.totals.announced).toBe(1);
    expect(mailsTo(fx.a.ownerEmail)).toHaveLength(1);
  });

  it('treats a bonus past its campaign end as due even inside its review interval', async () => {
    await owner.kbBonus.create({
      data: {
        licenseId: fx.a.licenseId,
        name: 'Hoş geldin',
        reviewedAt: ago(1),
        activeTo: ago(2),
      },
    });

    const report = await sweep();

    expect(report.totals.announced).toBe(1);
    expect(mailsTo(fx.a.ownerEmail)[0]?.body).toContain('Hoş geldin');
  });

  it('keeps one workspace’s rows from reaching another workspace’s people', async () => {
    await payment(fx.b.licenseId, 'Başka kiracı', ago(40));

    await sweep();

    expect(mailsTo(fx.a.ownerEmail)).toEqual([]);
    expect(mailsTo(fx.b.ownerEmail)).toHaveLength(1);
    expect(mailsTo(fx.b.ownerEmail)[0]?.body).toContain('Başka kiracı');
  });

  it('honours the member’s e-mail switch, yet still records the claim', async () => {
    await payment(fx.a.licenseId, 'Papara', ago(20));
    await owner.agentMembership.updateMany({
      where: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId },
      data: { notifyEmail: false },
    });

    const report = await sweep();

    expect(report.totals.announced).toBe(1);
    expect(mailsTo(fx.a.ownerEmail)).toEqual([]);
    expect(
      await owner.knowledgeTableStaleNotice.count({ where: { licenseId: fx.a.licenseId } }),
    ).toBe(1);
  });

  it('does not mail a plain agent, only owner, vice-owner and admin', async () => {
    await payment(fx.a.licenseId, 'Papara', ago(20));

    await sweep();

    expect(mailsTo(fx.a.agentEmail)).toEqual([]);
  });

  it('names at most ten rows and says how many there are', async () => {
    for (let i = 0; i < 12; i += 1) await payment(fx.a.licenseId, `Yöntem ${i}`, ago(20));

    await sweep();

    const body = mailsTo(fx.a.ownerEmail)[0]?.body ?? '';
    expect(body).toContain('12');
    expect(body).toContain('Yöntem 9');
    expect(body).not.toContain('Yöntem 11');
  });
});
