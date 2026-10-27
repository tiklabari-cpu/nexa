/**
 * Operator alerts (tm 389.20 · FR-ADMIN-24 · docs/platform-admin/design.md §C, §B2).
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no test title carries one as a requirement tag
 * (CONVENTIONS §7.3); the letters (a)–(i) are the task's acceptance list.
 */
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PLATFORM_ALERT_KINDS, type PlatformRole } from '@siyahtus/types';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import {
  ALERT_CHAIN_KEY,
  ALERT_LOCK_KEY,
  ALERT_SENT_PREFIX,
} from '../../src/services/platform/alerts.js';
import { OPS_HEALTH_KEY } from '../../src/services/ops/health-keys.js';
import { ownerClient, platformClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import type { Message } from '../../src/services/mail/mailer.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import {
  bearer,
  createOperator,
  openActiveSession,
  TestClock,
  type TestOperator,
} from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

const dayKey = (at: number) => new Date(at).toISOString().slice(0, 10).replaceAll('-', '');

/** Fails every send while `failing` — the carrier being down. */
class FlakyMailer extends MemoryMailer {
  failing = false;

  override async send(message: Message): Promise<void> {
    if (this.failing) throw new Error('carrier down');
    await super.send(message);
  }
}

describe('operator alerts (tm 389.20)', () => {
  let platform: PlatformTestServer;
  let db: PrismaClient;
  let clock: TestClock;
  let mailer: FlakyMailer;
  let fx: Fixtures;
  let superadmin: TestOperator;
  const tokens = new Map<string, string>();

  const scan = () => platform.app.platformAlerts.runAlertScanOnce();
  const mailKinds = () => mailer.sent.map((m) => m.kind);

  const call = (
    method: 'GET' | 'PUT',
    path: string,
    body?: unknown,
    as: string | null = tokens.get('superadmin')!,
  ): Promise<LightMyRequestResponse> =>
    platform.app.inject({
      method,
      url: `${PLATFORM_PREFIX}${path}`,
      headers: as ? bearer(as) : {},
      ...(body === undefined ? {} : { payload: body as object }),
    });

  /** The tenant API leader's publication — fresh at the scanner's clock, `ok` unless said. */
  async function publishHealth(status: 'ok' | 'degraded' = 'ok', at = clock.now): Promise<void> {
    await platform.app.redis.set(
      OPS_HEALTH_KEY,
      JSON.stringify({
        generated_at: new Date(at).toISOString(),
        health: {
          status,
          service: 'api',
          version: 'test',
          region: 'eu',
          uptime_s: 100,
          dependencies: {
            database: { status: 'up' },
            redis: { status: status === 'ok' ? 'up' : 'down' },
          },
          scheduler: {},
          event_partitions: {},
          ai_jobs: null,
          providers: {},
        },
      }),
    );
  }

  async function clearAlertState(): Promise<void> {
    const keys = await platform.app.redis.keys('siyahtus:platform:alerts:*');
    if (keys.length > 0) await platform.app.redis.del(...keys);
  }

  async function addOperator(role: PlatformRole, options: { disabled?: boolean } = {}) {
    const operator = await createOperator(db, { role, clock, ...options });
    tokens.set(role, await openActiveSession(db, operator, clock));
    return operator;
  }

  beforeAll(async () => {
    db = platformClient();
    clock = new TestClock(Date.now());
    mailer = new FlakyMailer();
    platform = await buildPlatformTestServer({}, { now: clock.read, mailer });
    // The payment queue's table belongs to a later task (tm 389.18); the scan reads it when it
    // exists, so this suite stands one in with the columns the scan reads.
    await owner.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS crypto_payment_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      license_id bigint NOT NULL,
      status text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now())`);
  });

  afterAll(async () => {
    await owner.$executeRawUnsafe('DROP TABLE IF EXISTS crypto_payment_requests');
    await platform?.close();
    await db?.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await owner.$executeRawUnsafe('DELETE FROM crypto_payment_requests');
    clock.now = Date.now();
    mailer.clear();
    mailer.failing = false;
    tokens.clear();
    superadmin = await addOperator('superadmin');
    await clearAlertState();
    await publishHealth();
  });

  afterEach(async () => {
    await clearAlertState();
  });

  /** Trial ending in two days (a), a crypto request waiting 25 hours (b), a stale snapshot. */
  async function threeConditions(): Promise<void> {
    await owner.license.update({
      where: { id: fx.a.licenseId },
      data: { trialEndsAt: new Date(clock.now + 2 * DAY) },
    });
    await owner.$executeRaw`INSERT INTO crypto_payment_requests (license_id, status, created_at)
      VALUES (${fx.b.licenseId}, 'pending', ${new Date(clock.now - 25 * HOUR)})`;
    await publishHealth('ok', clock.now - 10 * 60_000);
  }

  describe('(a) the scan mails what it finds, once', () => {
    it('mails a trial, a waiting payment request and a stale snapshot — and nothing on the second pass', async () => {
      await threeConditions();

      const first = await scan();
      expect(first).toMatchObject({ found: 3, mailed: 3, mails: 3, duplicate: 0, failed: 0 });
      expect(mailKinds()).toEqual(['platform_alert', 'platform_alert', 'platform_alert']);
      const subjects = mailer.sent.map((m) => m.subject).sort();
      expect(subjects).toEqual([
        '[OPS] Payment request waiting: Org B',
        '[OPS] Platform health is red',
        '[OPS] Trial ending: Org A',
      ]);
      for (const mail of mailer.sent) {
        expect(mail.to).toBe(superadmin.email);
        expect(mail.licenseId).toBeNull();
      }

      mailer.clear();
      const second = await scan();
      expect(second).toMatchObject({ found: 3, mailed: 0, mails: 0, duplicate: 3 });
      expect(mailer.sent).toHaveLength(0);
    });

    it('names the workspace and its id and carries nothing of its content or people', async () => {
      await threeConditions();
      await scan();
      const trial = mailer.sent.find((m) => m.subject.includes('Trial ending'))!;
      expect(trial.body).toContain(`Org A (#${fx.a.licenseId})`);
      expect(trial.body).toContain('/workspaces/');
      for (const mail of mailer.sent) {
        expect(mail.body).not.toContain('example.test');
        expect(mail.html ?? '').not.toContain('example.test');
      }
    });

    it('does not report a trial outside three days, one already over, or a workspace that is no longer trialing', async () => {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { trialEndsAt: new Date(clock.now + 4 * DAY) },
      });
      await owner.license.update({
        where: { id: fx.b.licenseId },
        data: { trialEndsAt: new Date(clock.now - DAY) },
      });
      expect(await scan()).toMatchObject({ found: 0 });

      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { trialEndsAt: new Date(clock.now + DAY), status: 'active' },
      });
      expect(await scan()).toMatchObject({ found: 0 });
      expect(mailer.sent).toHaveLength(0);
    });

    it('does not report a payment request younger than 24 hours or one already handled', async () => {
      await owner.$executeRaw`INSERT INTO crypto_payment_requests (license_id, status, created_at)
        VALUES (${fx.a.licenseId}, 'pending', ${new Date(clock.now - 23 * HOUR)}),
               (${fx.b.licenseId}, 'confirmed', ${new Date(clock.now - 48 * HOUR)})`;
      expect(await scan()).toMatchObject({ found: 0 });
    });

    it('is quiet while the payment queue does not exist yet', async () => {
      await owner.$executeRawUnsafe(
        'ALTER TABLE crypto_payment_requests RENAME TO crypto_payment_requests_x',
      );
      try {
        expect(await scan()).toMatchObject({ found: 0, source_errors: 0 });
      } finally {
        await owner.$executeRawUnsafe(
          'ALTER TABLE crypto_payment_requests_x RENAME TO crypto_payment_requests',
        );
      }
    });
  });

  describe('(b) who is mailed, and in which language', () => {
    it('gives a superadmin every kind by default and the other roles none', async () => {
      await addOperator('support');
      await addOperator('billing');
      await addOperator('readonly');
      await threeConditions();
      await scan();
      expect(new Set(mailer.sent.map((m) => m.to))).toEqual(new Set([superadmin.email]));
    });

    it('mails the kinds an operator chose, in the language they chose', async () => {
      const support = await addOperator('support');
      await owner.platformAlertPrefs.create({
        data: { adminId: support.id, kinds: ['trial_ending'], locale: 'tr' },
      });
      await threeConditions();
      await scan();

      const toSupport = mailer.sent.filter((m) => m.to === support.email);
      expect(toSupport).toHaveLength(1);
      expect(toSupport[0]!.subject).toBe('[OPS] Deneme süresi bitiyor: Org A');
      expect(toSupport[0]!.locale).toBe('tr');
      expect(mailer.sent.filter((m) => m.to === superadmin.email)).toHaveLength(3);
    });

    it('mails a superadmin who turned a kind off nothing of it, and one who turned all off nothing at all', async () => {
      await owner.platformAlertPrefs.create({
        data: {
          adminId: superadmin.id,
          kinds: PLATFORM_ALERT_KINDS.filter((k) => k !== 'trial_ending'),
        },
      });
      await threeConditions();
      await scan();
      expect(mailer.sent.map((m) => m.subject).sort()).toEqual([
        '[OPS] Payment request waiting: Org B',
        '[OPS] Platform health is red',
      ]);

      mailer.clear();
      await clearAlertState();
      await owner.platformAlertPrefs.update({
        where: { adminId: superadmin.id },
        data: { kinds: [] },
      });
      expect(await scan()).toMatchObject({ found: 3, mailed: 0, unwanted: 3 });
      expect(mailer.sent).toHaveLength(0);
    });

    it('mails a disabled operator nothing, whatever they saved', async () => {
      const gone = await addOperator('support', { disabled: true });
      await owner.platformAlertPrefs.create({
        data: { adminId: gone.id, kinds: [...PLATFORM_ALERT_KINDS] },
      });
      await threeConditions();
      await scan();
      expect(mailer.sent.some((m) => m.to === gone.email)).toBe(false);
    });

    it('does not claim an alert nobody wants, so a later opt-in still hears it that day', async () => {
      await owner.platformAlertPrefs.create({ data: { adminId: superadmin.id, kinds: [] } });
      await threeConditions();
      expect(await scan()).toMatchObject({ unwanted: 3, mailed: 0 });
      await owner.platformAlertPrefs.update({
        where: { adminId: superadmin.id },
        data: { kinds: [...PLATFORM_ALERT_KINDS] },
      });
      expect(await scan()).toMatchObject({ mailed: 3 });
    });
  });

  describe('(c) one scan across replicas', () => {
    it('lets one of two simultaneous ticks scan, and sends the set once', async () => {
      await threeConditions();
      const results = await Promise.all([
        platform.app.platformAlerts.tick(),
        platform.app.platformAlerts.tick(),
      ]);
      expect(results.filter((r) => r === 'skipped')).toHaveLength(1);
      expect(results.filter((r) => typeof r === 'object')).toHaveLength(1);
      expect(mailer.sent).toHaveLength(3);
      expect(await platform.app.redis.exists(ALERT_LOCK_KEY)).toBe(1);
    });

    it('sends each alert once even when two passes run at the same moment', async () => {
      await threeConditions();
      await Promise.all([scan(), scan()]);
      expect(mailer.sent).toHaveLength(3);
    });
  });

  describe('(d) the platform audit chain', () => {
    async function writeEntries(count: number): Promise<void> {
      for (let i = 0; i < count; i++) {
        const response = await call('PUT', '/auth/me/alert-prefs', {
          kinds: [...PLATFORM_ALERT_KINDS],
          locale: 'en',
        });
        expect(response.statusCode, response.body).toBe(200);
      }
    }

    async function tamper(sql: string): Promise<void> {
      await owner.$transaction([
        owner.$executeRawUnsafe(
          'ALTER TABLE platform_audit_log DISABLE TRIGGER platform_audit_log_append_only',
        ),
        owner.$executeRawUnsafe(sql),
        owner.$executeRawUnsafe(
          'ALTER TABLE platform_audit_log ENABLE TRIGGER platform_audit_log_append_only',
        ),
      ]);
    }

    it('says nothing about an intact chain', async () => {
      await writeEntries(3);
      expect(await scan()).toMatchObject({ found: 0 });
      expect(JSON.parse((await platform.app.redis.get(ALERT_CHAIN_KEY))!)).toMatchObject({
        ok: true,
      });
    });

    it('mails a chain that no longer verifies, and repeats it hourly while it stays broken', async () => {
      await writeEntries(3);
      await tamper(`UPDATE platform_audit_log SET payload = '{"kinds":[]}' WHERE chain_seq = 2`);
      // The hourly bucket must not turn over between the passes below.
      const minute = new Date(clock.now).getUTCMinutes();
      if (minute >= 45) clock.advance((65 - minute) * 60_000);
      await publishHealth();

      const first = await scan();
      expect(first).toMatchObject({ found: 1, mailed: 1 });
      expect(mailer.sent[0]!.subject).toBe('[OPS] The audit chain no longer verifies');
      expect(mailer.sent[0]!.body).toContain('Findings');

      // The same hour: once.
      mailer.clear();
      clock.advance(10 * 60_000);
      await publishHealth();
      expect(await scan()).toMatchObject({ found: 1, mailed: 0, duplicate: 1 });

      // The next hour: again — a broken chain is not a once-a-day matter.
      clock.advance(HOUR);
      await publishHealth();
      expect(await scan()).toMatchObject({ found: 1, mailed: 1 });
      expect(mailer.sent).toHaveLength(1);
    });

    it('notices a deleted tail through the head', async () => {
      await writeEntries(3);
      const last = await owner.platformAuditLog.count();
      await tamper(`DELETE FROM platform_audit_log WHERE chain_seq = ${last}`);
      expect(await scan()).toMatchObject({ found: 1, mailed: 1 });
    });
  });

  describe('(e) the health snapshot', () => {
    it('reports a missing snapshot, a stale one and a degraded one — and a healthy one never', async () => {
      await platform.app.redis.del(OPS_HEALTH_KEY);
      expect(await scan()).toMatchObject({ found: 1, mailed: 1 });
      expect(mailer.sent[0]!.body).toContain('not publishing the health snapshot');

      await clearAlertState();
      mailer.clear();
      await publishHealth('ok', clock.now - 5 * 60_000);
      expect(await scan()).toMatchObject({ found: 1, mailed: 1 });

      await clearAlertState();
      mailer.clear();
      await publishHealth('degraded');
      expect(await scan()).toMatchObject({ found: 1, mailed: 1 });
      expect(mailer.sent[0]!.body).toContain('redis down');

      await clearAlertState();
      mailer.clear();
      await publishHealth('ok');
      expect(await scan()).toMatchObject({ found: 0 });
    });
  });

  describe('(f) a workspace at its AI allowance', () => {
    it('reports the workspace at its cap, not the one below it', async () => {
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { aiDailyLlmTokensCap: 1000n },
      });
      await owner.aiDailyUsage.createMany({
        data: [
          { licenseId: fx.a.licenseId, day: dayKey(clock.now), meter: 'llm', used: 995n },
          { licenseId: fx.b.licenseId, day: dayKey(clock.now), meter: 'llm', used: 10n },
          // Yesterday's full counter is not today's.
          {
            licenseId: fx.b.licenseId,
            day: dayKey(clock.now - DAY),
            meter: 'llm',
            used: 999999999n,
          },
        ],
      });
      expect(await scan()).toMatchObject({ found: 1, mailed: 1 });
      const mail = mailer.sent[0]!;
      expect(mail.subject).toBe('[OPS] AI allowance reached: Org A');
      expect(mail.body).toContain('995 / 1,000 tokens');
    });

    it('reads the deployment cap from the platform setting when the workspace has no override', async () => {
      await owner.platformSetting.create({
        data: {
          key: 'ai.caps',
          value: {
            deployment: {
              llm: { workspace: 2000, global: 1_000_000 },
              embedding: { workspace: 2000, global: 1_000_000 },
            },
          },
        },
      });
      await owner.aiDailyUsage.create({
        data: { licenseId: fx.a.licenseId, day: dayKey(clock.now), meter: 'llm', used: 2000n },
      });
      expect(await scan()).toMatchObject({ found: 1, mailed: 1 });
      await owner.platformSetting.delete({ where: { key: 'ai.caps' } });
    });
  });

  describe('(g) a deletion tomorrow', () => {
    it('reports a workspace whose data goes tomorrow and not one whose date is further off', async () => {
      const today = new Date(clock.now);
      const tomorrowNoon = Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + 1,
        12,
      );
      const inThree = tomorrowNoon + 2 * DAY;
      await owner.$executeRaw`UPDATE licenses SET purge_scheduled_at = ${new Date(tomorrowNoon)} WHERE id = ${fx.a.licenseId}`;
      await owner.$executeRaw`UPDATE licenses SET purge_scheduled_at = ${new Date(inThree)} WHERE id = ${fx.b.licenseId}`;
      expect(await scan()).toMatchObject({ found: 1, mailed: 1 });
      expect(mailer.sent[0]!.subject).toBe('[OPS] Deleted tomorrow: Org A');
    });
  });

  describe('(h) a carrier that is down', () => {
    it('hands the claim back, so the next scan mails what the failed one could not', async () => {
      await threeConditions();
      mailer.failing = true;
      expect(await scan()).toMatchObject({ found: 3, mailed: 0, failed: 3 });
      expect(await platform.app.redis.keys(`${ALERT_SENT_PREFIX}*`)).toHaveLength(0);

      mailer.failing = false;
      expect(await scan()).toMatchObject({ found: 3, mailed: 3 });
      expect(mailer.sent).toHaveLength(3);
    });
  });

  describe('(i) GET/PUT /auth/me/alert-prefs', () => {
    it('shows each role its default until it saves a choice, and the choice afterwards', async () => {
      await addOperator('support');
      const sa = await call('GET', '/auth/me/alert-prefs');
      expect(sa.json()).toEqual({
        kinds: [...PLATFORM_ALERT_KINDS],
        locale: 'en',
        customized: false,
        available: [...PLATFORM_ALERT_KINDS],
      });
      const support = await call('GET', '/auth/me/alert-prefs', undefined, tokens.get('support')!);
      expect(support.json()).toMatchObject({ kinds: [], customized: false });

      const saved = await call(
        'PUT',
        '/auth/me/alert-prefs',
        { kinds: ['health_red', 'trial_ending'], locale: 'tr' },
        tokens.get('support')!,
      );
      expect(saved.statusCode, saved.body).toBe(200);
      // Stored in the closed list's order, whatever order they were sent in.
      expect(saved.json()).toMatchObject({
        kinds: ['trial_ending', 'health_red'],
        locale: 'tr',
        customized: true,
      });
      const again = await call('GET', '/auth/me/alert-prefs', undefined, tokens.get('support')!);
      expect(again.json()).toMatchObject({ kinds: ['trial_ending', 'health_red'], locale: 'tr' });
      // Another operator's choice is untouched.
      expect((await call('GET', '/auth/me/alert-prefs')).json()).toMatchObject({
        customized: false,
      });
    });

    it('lets any role set its own, including none at all, and writes one reasonless entry', async () => {
      await addOperator('readonly');
      const saved = await call(
        'PUT',
        '/auth/me/alert-prefs',
        { kinds: [], locale: 'en' },
        tokens.get('readonly')!,
      );
      expect(saved.statusCode, saved.body).toBe(200);
      expect(saved.json()).toMatchObject({ kinds: [], customized: true });
      const entry = await owner.platformAuditLog.findFirst({
        where: { action: 'admin.alert_prefs_changed' },
      });
      expect(entry).toMatchObject({ reason: null, targetType: 'admin' });
      expect(entry!.payload).toEqual({ kinds: [], locale: 'en' });
    });

    it('refuses a kind or a language outside the lists, an extra field, and a caller with no session', async () => {
      const bad = [
        { kinds: ['everything'], locale: 'en' },
        { kinds: [], locale: 'de' },
        { kinds: [] },
        { kinds: [], locale: 'en', extra: true },
      ];
      for (const body of bad) {
        const response = await call('PUT', '/auth/me/alert-prefs', body);
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
      }
      expect(
        (await call('PUT', '/auth/me/alert-prefs', { kinds: [], locale: 'en' }, null)).statusCode,
      ).toBe(401);
      expect((await call('GET', '/auth/me/alert-prefs', undefined, null)).statusCode).toBe(401);
      expect(await owner.platformAlertPrefs.count()).toBe(0);
    });

    it('makes the saved choice the one the scan uses', async () => {
      const put = await call('PUT', '/auth/me/alert-prefs', {
        kinds: ['trial_ending'],
        locale: 'tr',
      });
      expect(put.statusCode).toBe(200);
      await threeConditions();
      await scan();
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]!.subject).toBe('[OPS] Deneme süresi bitiyor: Org A');
    });
  });
});
