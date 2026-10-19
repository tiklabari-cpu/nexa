/**
 * The AI usage screen's API and the 80%/100% alerts (tm 283.3 · SiyahTuş
 * analysis AI-16, AI-16-S2/S3 · PLAN §D232).
 *
 * Real Postgres and Redis; the model is a scripted provider with id `openai`
 * (counted, like any real model), answering every call for 100 tokens in and
 * 10 out. What is held:
 *
 *   1. `GET /ai/usage`: owner and admin read it, an agent is refused; the
 *      series and the breakdown add up to the counters and the ledger; a
 *      licence override is the cap shown; today's alerts and recipients are
 *      listed; money appears only with configured prices.
 *   2. RLS: a workspace reads only its own usage, alerts and recipients, and
 *      cannot claim an alert for another.
 *   3. The alerts: 80% is announced exactly once per day and meter — to the
 *      owner and the chosen recipients, by mail and by a realtime push — even
 *      when ten observations cross it at once; the cap's first refusal is the
 *      100% notice; a test meter announces nothing.
 *   4. `PUT /ai/usage/alert-recipients`: owner only, admins only, audited.
 */
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { licenseChannel } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { utcDayKey } from '../../src/services/ai/ai-daily-budget.js';
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
} from '../../src/services/ai/provider/llm-provider.js';
import { customerAsks, seedAiWorkspace, type AiWorkspace } from '../helpers/ai-workspace.js';
import { grantToken, ownerClient, seedFixtures } from '../helpers/fixtures.js';
import { asKnowledgeAnswer } from '../helpers/knowledge-answer.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const PRICES = {
  AI_PRICE_LLM_INPUT_USD_PER_MTOK: '2.5',
  AI_PRICE_LLM_OUTPUT_USD_PER_MTOK: '10',
  AI_PRICE_EMBEDDING_USD_PER_MTOK: '0.02',
};

/** A counted model that answers every call for 100 tokens in and 10 out. */
class ScriptedLlm implements LlmProvider {
  readonly id = 'openai' as const;
  calls = 0;

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    this.calls += 1;
    return {
      text: asKnowledgeAnswer('Written by the scripted model.', request),
      usage: { inputTokens: 100, outputTokens: 10 },
    };
  }
}

const today = () => utcDayKey(new Date());
const isoToday = () => new Date().toISOString().slice(0, 10);
/** `yyyymmdd` `back` UTC days before today. */
function dayBefore(back: number): string {
  const now = new Date();
  return utcDayKey(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back)),
  );
}

interface UsageBody {
  day: string;
  time_zone: string;
  resets_at: string;
  window_days: number;
  meters: Array<{
    meter: string;
    used: number;
    reserved: number;
    cap: number;
    percent: number;
    cost_usd?: number;
  }>;
  daily: Array<Record<string, number | string>>;
  surfaces: Array<{
    surface: string;
    meter: string;
    input_tokens: number;
    output_tokens: number;
    cost_usd?: number;
  }>;
  pricing?: Record<string, unknown>;
  alerts: Array<{ meter: string; threshold: number; used: number; cap: number }>;
  alert_recipients: string[];
}

describe('the AI usage screen’s API and the 80%/100% alerts (tm 283.3)', () => {
  let owner: PrismaClient;
  const llm = new ScriptedLlm();
  const mailer = new MemoryMailer();
  let server: TestServer;

  async function seedCounter(licenseId: bigint, day: string, meter: string, used: number) {
    await owner.aiDailyUsage.upsert({
      where: { licenseId_day_meter: { licenseId, day, meter } },
      create: { licenseId, day, meter, used: BigInt(used) },
      update: { used: BigInt(used) },
    });
  }

  async function seedLedger(
    licenseId: bigint,
    day: string,
    surface: string,
    meter: string,
    input: number,
    output: number,
  ) {
    await owner.aiUsageEvent.create({
      data: {
        licenseId,
        day,
        at: new Date(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T12:00:00Z`),
        surface,
        meter,
        modelTier: meter === 'llm' || meter === 'llm_test' ? 'default' : null,
        inputTokens: BigInt(input),
        outputTokens: BigInt(output),
      },
    });
  }

  async function setOverride(licenseId: bigint, llmCap: number) {
    await owner.license.update({
      where: { id: licenseId },
      data: { aiDailyLlmTokensCap: BigInt(llmCap) },
    });
  }

  async function addMember(ws: AiWorkspace, role: string, notifyEmail = true) {
    const slug = `${role}-${Math.random().toString(36).slice(2, 8)}`;
    const account = await owner.account.create({
      data: { email: `${slug}@example.test`, name: slug },
      select: { id: true, email: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: ws.licenseId, agentId: account.id, role, notifyEmail },
    });
    return account;
  }

  const tokenFor = (ws: AiWorkspace, accountId: string, scopes = ['reports_read']) =>
    grantToken(owner, {
      licenseId: ws.licenseId,
      organizationId: ws.organizationId,
      ownerId: accountId,
      scopes,
      kind: 'oauth',
    });

  async function readUsage(target: TestServer, ws: AiWorkspace, accountId = ws.ownerId) {
    const response = await target.get('/ai/usage', {
      authorization: `Bearer ${await tokenFor(ws, accountId)}`,
    });
    return response;
  }

  const tenantOf = (ws: AiWorkspace): TenantContext => ({
    licenseId: ws.licenseId,
    organizationId: ws.organizationId,
  });

  const mailsTo = (email: string) =>
    mailer.sent.filter((m) => m.kind === 'notification' && m.to === email);

  beforeAll(async () => {
    owner = ownerClient();
    // Once, before the server caches anyone's caps: the reset restarts licence
    // ids, and a workspace reusing one would inherit what was cached for it.
    await seedFixtures(owner);
    server = await startTestServer({ LOG_LEVEL: 'warn', ...PRICES }, { llm, mailer });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await clearRateLimits(server.app);
    mailer.clear();
  });

  // ==========================================================================
  // 1. GET /ai/usage
  // ==========================================================================

  describe('GET /ai/usage', () => {
    it('shows the owner today against the cap, 30 UTC days and the breakdown — and both add up to the counters and the ledger (AI-16)', async () => {
      const ws = await seedAiWorkspace(owner);
      await seedCounter(ws.licenseId, dayBefore(3), 'llm', 5_000);
      await seedLedger(ws.licenseId, dayBefore(3), 'copilot', 'llm', 4_000, 1_000);
      await seedCounter(ws.licenseId, dayBefore(29), 'embedding', 700);
      await seedLedger(ws.licenseId, dayBefore(29), 'knowledge_index', 'embedding', 700, 0);
      await seedCounter(ws.licenseId, today(), 'llm_test', 300);
      await seedLedger(ws.licenseId, today(), 'simulation', 'llm_test', 250, 50);
      // Outside the window: neither counted nor broken down.
      await seedCounter(ws.licenseId, dayBefore(30), 'llm', 99_999);
      await seedLedger(ws.licenseId, dayBefore(30), 'ai_agent', 'llm', 99_000, 999);
      // One real answer, through the visitor's path: counter and ledger both.
      await customerAsks(owner, server, ws);
      expect(llm.calls).toBeGreaterThan(0);

      const response = await readUsage(server, ws);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.json() as UsageBody;

      expect(body.day).toBe(isoToday());
      expect(body.time_zone).toBe('UTC');
      expect(body.window_days).toBe(30);
      expect(body.resets_at).toBe(
        new Date(Date.parse(`${isoToday()}T00:00:00Z`) + 86_400_000).toISOString(),
      );
      expect(body.daily).toHaveLength(30);
      expect(body.daily[29]!['day']).toBe(isoToday());

      const llmToday = body.meters.find((m) => m.meter === 'llm')!;
      expect(llmToday).toMatchObject({ used: 110, reserved: 0, cap: 200_000, percent: 0.1 });
      // $2.50 per million in, $10 out: 100 × 2.5 + 10 × 10 = 350 per million.
      expect(llmToday.cost_usd).toBe(0.0004);
      expect(body.meters.find((m) => m.meter === 'llm_test')).toMatchObject({
        used: 300,
        cap: 40_000,
      });
      expect(body.meters.map((m) => m.meter)).toEqual([
        'llm',
        'embedding',
        'llm_test',
        'embedding_test',
      ]);

      // The series is the counter, to the token, inside the window.
      const windowStart = dayBefore(29);
      const counters = await owner.aiDailyUsage.findMany({
        where: { licenseId: ws.licenseId, day: { gte: windowStart } },
      });
      const series = body.daily.reduce(
        (sum, day) =>
          sum +
          Number(day['llm']) +
          Number(day['embedding']) +
          Number(day['llm_test']) +
          Number(day['embedding_test']),
        0,
      );
      expect(series).toBe(counters.reduce((sum, row) => sum + Number(row.used), 0));
      expect(series).toBe(5_000 + 700 + 300 + 110);

      // The breakdown is the ledger, and here the ledger matches the counter.
      const breakdown = body.surfaces.reduce((s, r) => s + r.input_tokens + r.output_tokens, 0);
      expect(breakdown).toBe(series);
      expect(body.surfaces.map((s) => [s.surface, s.meter])).toEqual([
        ['copilot', 'llm'],
        ['knowledge_index', 'embedding'],
        ['simulation', 'llm_test'],
        ['ai_agent', 'llm'],
      ]);
      expect(body.surfaces.find((s) => s.surface === 'knowledge_index')!.cost_usd).toBe(0);
      expect(body.pricing).toEqual({
        currency: 'USD',
        estimated: true,
        llm_input_usd_per_mtok: 2.5,
        llm_output_usd_per_mtok: 10,
        embedding_usd_per_mtok: 0.02,
      });
      expect(body.alerts).toEqual([]);
      expect(body.alert_recipients).toEqual([]);
    });

    it('shows a 500,000 override as the cap, and an admin may read it while an agent is refused (AI-16)', async () => {
      const ws = await seedAiWorkspace(owner);
      await setOverride(ws.licenseId, 500_000);
      const admin = await addMember(ws, 'admin');
      const agent = await addMember(ws, 'agent');

      const asAdmin = await readUsage(server, ws, admin.id);
      expect(asAdmin.statusCode).toBe(200);
      const body = asAdmin.json() as UsageBody;
      expect(body.meters.find((m) => m.meter === 'llm')!.cap).toBe(500_000);
      expect(body.meters.find((m) => m.meter === 'llm_test')!.cap).toBe(100_000);

      const asAgent = await readUsage(server, ws, agent.id);
      expect(asAgent.statusCode).toBe(403);
      expect(asAgent.body).not.toContain('500000');
    });

    it('carries no money at all when no price is configured (AI-16-S3)', async () => {
      const unpriced = await startTestServer({ LOG_LEVEL: 'warn' }, { llm, mailer });
      try {
        const ws = await seedAiWorkspace(owner);
        await seedCounter(ws.licenseId, today(), 'llm', 1_000);
        await seedLedger(ws.licenseId, today(), 'ai_agent', 'llm', 900, 100);
        const response = await readUsage(unpriced, ws);
        expect(response.statusCode).toBe(200);
        expect(response.body).not.toMatch(/cost_usd|pricing|usd_per_mtok/);
        const body = response.json() as UsageBody;
        expect(body.meters[0]).toMatchObject({ meter: 'llm', used: 1_000 });
      } finally {
        await unpriced.close();
      }
    });
  });

  // ==========================================================================
  // 2. RLS
  // ==========================================================================

  describe('tenant isolation', () => {
    it('reads its own usage, alerts and recipients only — another workspace’s numbers never show', async () => {
      const a = await seedAiWorkspace(owner);
      const b = await seedAiWorkspace(owner);
      const adminA = await addMember(a, 'admin');
      await seedCounter(a.licenseId, today(), 'llm', 150_000);
      await seedLedger(a.licenseId, today(), 'copilot', 'llm', 140_000, 10_000);
      await owner.aiUsageAlert.create({
        data: {
          licenseId: a.licenseId,
          day: today(),
          meter: 'llm',
          threshold: 80,
          used: 160_000n,
          cap: 200_000n,
        },
      });
      await owner.aiUsageAlertRecipient.create({
        data: { licenseId: a.licenseId, accountId: adminA.id },
      });

      const body = (await readUsage(server, b)).json() as UsageBody;
      expect(body.meters.find((m) => m.meter === 'llm')!.used).toBe(0);
      expect(body.surfaces).toEqual([]);
      expect(body.alerts).toEqual([]);
      expect(body.alert_recipients).toEqual([]);

      const own = (await readUsage(server, a)).json() as UsageBody;
      expect(own.meters.find((m) => m.meter === 'llm')!.used).toBe(150_000);
      expect(own.alerts).toMatchObject([{ meter: 'llm', threshold: 80 }]);
      expect(own.alert_recipients).toEqual([adminA.id]);
    });

    it.skipIf(!APP_URL)(
      'refuses the application role another workspace’s alert rows, and an alert claimed in its name',
      async () => {
        const a = await seedAiWorkspace(owner);
        const b = await seedAiWorkspace(owner);
        await owner.aiUsageAlert.create({
          data: {
            licenseId: a.licenseId,
            day: today(),
            meter: 'llm',
            threshold: 80,
            used: 1n,
            cap: 2n,
          },
        });
        const app = new PrismaClient({ datasources: { db: { url: APP_URL! } } });
        try {
          const seen = await withTenant(app, tenantOf(b), (tx) => tx.aiUsageAlert.findMany());
          expect(seen).toEqual([]);
          await expect(
            withTenant(app, tenantOf(b), (tx) =>
              tx.aiUsageAlert.create({
                data: {
                  licenseId: a.licenseId,
                  day: today(),
                  meter: 'llm',
                  threshold: 100,
                  used: 1n,
                  cap: 2n,
                },
              }),
            ),
          ).rejects.toThrow();
          await expect(
            withTenant(app, tenantOf(a), (tx) =>
              tx.aiUsageAlert.deleteMany({ where: { licenseId: a.licenseId } }),
            ),
          ).rejects.toThrow();
        } finally {
          await app.$disconnect();
        }
      },
    );
  });

  // ==========================================================================
  // 3. The alerts
  // ==========================================================================

  describe('the 80% and 100% alerts', () => {
    it('announces 80% exactly once per day and meter — to the owner and the chosen admin, by mail and push (AI-16)', async () => {
      const ws = await seedAiWorkspace(owner);
      // Room for a call's reservation (the prompt's characters + the reply's
      // ceiling, the platform's locked rules among them since tm 301.3) under the cap.
      await setOverride(ws.licenseId, 50_000);
      const admin = await addMember(ws, 'admin');
      const quiet = await addMember(ws, 'admin', false);
      const agent = await addMember(ws, 'agent');
      await owner.aiUsageAlertRecipient.createMany({
        data: [
          { licenseId: ws.licenseId, accountId: admin.id },
          { licenseId: ws.licenseId, accountId: quiet.id },
        ],
      });
      const ownerEmail = (await owner.account.findUniqueOrThrow({ where: { id: ws.ownerId } }))
        .email;
      await seedCounter(ws.licenseId, today(), 'llm', 39_900);

      const listener = server.app.redis.duplicate();
      const pushes: Array<{ action: string; audience: unknown; payload: unknown }> = [];
      listener.on('message', (_channel: string, message: string) => {
        const envelope = JSON.parse(message) as {
          action: string;
          audience: unknown;
          payload: unknown;
        };
        if (envelope.action === 'ai_usage_alert') pushes.push(envelope);
      });
      await listener.subscribe(licenseChannel(ws.licenseId));
      try {
        // 39,900 + 110 = 40,010 of 50,000: past 80%.
        await customerAsks(owner, server, ws);
        await server.app.aiUsageAlerts.idle();
        // 40,120: still past 80%, nothing new to say.
        await clearRateLimits(server.app);
        await customerAsks(owner, server, ws);
        await server.app.aiUsageAlerts.idle();
        await new Promise((resolve) => setTimeout(resolve, 100));

        const rows = await owner.aiUsageAlert.findMany({ where: { licenseId: ws.licenseId } });
        expect(rows.map((r) => [r.meter, r.threshold, Number(r.used), Number(r.cap)])).toEqual([
          ['llm', 80, 40_010, 50_000],
        ]);
        expect(mailsTo(ownerEmail)).toHaveLength(1);
        expect(mailsTo(admin.email)).toHaveLength(1);
        // Chosen, but their e-mail notifications are off; an agent is never told.
        expect(mailsTo(quiet.email)).toHaveLength(0);
        expect(mailsTo(agent.email)).toHaveLength(0);
        const mail = mailsTo(ownerEmail)[0]!;
        expect(mail.subject).toContain('80%');
        expect(mail.body).toContain('40,010 / 50,000');
        expect(mail.body).toContain('/app/settings/ai-usage');

        expect(pushes).toHaveLength(1);
        expect(pushes[0]!.payload).toEqual({
          meter: 'llm',
          threshold: 80,
          day: isoToday(),
          used: 40_010,
          cap: 50_000,
        });
        expect([...(pushes[0]!.audience as { agentIds: string[] }).agentIds].sort()).toEqual(
          [ws.ownerId, admin.id, quiet.id].sort(),
        );

        const listed = (await readUsage(server, ws)).json() as UsageBody;
        expect(listed.alerts).toMatchObject([{ meter: 'llm', threshold: 80, used: 40_010 }]);
      } finally {
        await listener.quit();
      }
    });

    it('sends one notice when ten observations cross 80% at once', async () => {
      const ws = await seedAiWorkspace(owner);
      await seedCounter(ws.licenseId, today(), 'llm', 9_000);
      const outcomes = await Promise.all(
        Array.from({ length: 10 }, () =>
          server.app.aiUsageAlerts.evaluate(
            { tenant: tenantOf(ws), meter: 'llm', day: today(), cap: 10_000 },
            false,
          ),
        ),
      );
      expect(outcomes.flatMap((o) => o.claimed)).toEqual([80]);
      expect(outcomes.filter((o) => o.announced !== null)).toHaveLength(1);
      expect(mailer.sent.filter((m) => m.kind === 'notification')).toHaveLength(1);
      expect(await owner.aiUsageAlert.count({ where: { licenseId: ws.licenseId } })).toBe(1);
    });

    it('announces 100% when the cap first refuses — once, however many messages it refuses after (AI-16)', async () => {
      const ws = await seedAiWorkspace(owner);
      await setOverride(ws.licenseId, 10_000);
      const ownerEmail = (await owner.account.findUniqueOrThrow({ where: { id: ws.ownerId } }))
        .email;
      // 9,990 of 10,000: not 100% on the counter, but no call fits.
      await seedCounter(ws.licenseId, today(), 'llm', 9_990);
      const calls = llm.calls;

      for (let i = 0; i < 3; i += 1) {
        await clearRateLimits(server.app);
        await customerAsks(owner, server, ws);
      }
      await server.app.aiUsageAlerts.idle();

      expect(llm.calls).toBe(calls);
      const rows = await owner.aiUsageAlert.findMany({
        where: { licenseId: ws.licenseId },
        orderBy: { threshold: 'asc' },
      });
      // Both thresholds are claimed — 80% was crossed too — but only "used up" is said.
      expect(rows.map((r) => r.threshold)).toEqual([80, 100]);
      const mails = mailsTo(ownerEmail);
      expect(mails).toHaveLength(1);
      expect(mails[0]!.subject).toContain('used up');
      expect(mails[0]!.body).toContain('00:00 UTC');
    });

    it('announces nothing for a test meter', async () => {
      const ws = await seedAiWorkspace(owner);
      await seedCounter(ws.licenseId, today(), 'llm_test', 40_000);
      const outcome = await server.app.aiUsageAlerts.evaluate(
        { tenant: tenantOf(ws), meter: 'llm_test', day: today(), cap: 40_000 },
        true,
      );
      expect(outcome).toEqual({ claimed: [], announced: null });
      expect(await owner.aiUsageAlert.count({ where: { licenseId: ws.licenseId } })).toBe(0);
      expect(mailer.sent).toEqual([]);
    });
  });

  // ==========================================================================
  // 4. PUT /ai/usage/alert-recipients
  // ==========================================================================

  describe('PUT /ai/usage/alert-recipients', () => {
    const put = async (ws: AiWorkspace, accountId: string, accountIds: string[]) =>
      server.put(
        '/ai/usage/alert-recipients',
        { account_ids: accountIds },
        {
          authorization: `Bearer ${await tokenFor(ws, accountId, ['reports_read', 'reports_manage'])}`,
        },
      );

    it('lets the owner choose admins, and records who was chosen', async () => {
      const ws = await seedAiWorkspace(owner);
      const one = await addMember(ws, 'admin');
      const two = await addMember(ws, 'viceowner');

      const saved = await put(ws, ws.ownerId, [one.id, two.id]);
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toEqual({ alert_recipients: [one.id, two.id] });

      const narrowed = await put(ws, ws.ownerId, [two.id]);
      expect(narrowed.json()).toEqual({ alert_recipients: [two.id] });
      const body = (await readUsage(server, ws)).json() as UsageBody;
      expect(body.alert_recipients).toEqual([two.id]);

      const trail = await owner.auditLogEntry.findMany({
        where: { licenseId: ws.licenseId, action: 'settings.ai_usage_alerts_updated' },
        orderBy: { createdAt: 'asc' },
        select: { metadata: true },
      });
      expect(trail.map((row) => row.metadata)).toMatchObject([
        { previous_account_ids: [], account_ids: [one.id, two.id] },
        { previous_account_ids: [one.id, two.id], account_ids: [two.id] },
      ]);
    });

    it('refuses an admin choosing, an agent being chosen, and a stranger being chosen', async () => {
      const ws = await seedAiWorkspace(owner);
      const other = await seedAiWorkspace(owner);
      const admin = await addMember(ws, 'admin');
      const agent = await addMember(ws, 'agent');
      const stranger = await addMember(other, 'admin');

      expect((await put(ws, admin.id, [admin.id])).statusCode).toBe(403);
      expect((await put(ws, ws.ownerId, [agent.id])).statusCode).toBe(400);
      expect((await put(ws, ws.ownerId, [stranger.id])).statusCode).toBe(400);
      expect((await put(ws, ws.ownerId, [admin.id, admin.id])).statusCode).toBe(400);
      expect(await owner.aiUsageAlertRecipient.count({ where: { licenseId: ws.licenseId } })).toBe(
        0,
      );
    });
  });
});
