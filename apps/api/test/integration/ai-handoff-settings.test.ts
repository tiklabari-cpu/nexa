/**
 * The AI's hand-over triggers and messages (tm 303.1 · SiyahTuş analysis
 * AI-09; owner decision K9; assumptions AI-09-S1, AI-09-S2), through the real
 * server and the real database.
 *
 * `GET|PUT /ai-agents/{id}/handoff-settings` gains three fields beside the
 * assignment mode, the stall timeout and the no-answer policy:
 *
 *   - `triggers` — the switchable triggers and their counts, defaults 2/2/12;
 *     a write changes the fields it names and keeps the rest; the locked
 *     triggers cannot be turned off (400 `handoff_trigger_locked`);
 *   - `messages` — the workspace's sentence per reason, null for the default;
 *   - `after_hours` — the text for a hand-over nobody can take now.
 *
 * And under the route: the columns' CHECKs, row level security on the table
 * (the app role sees and writes only its own workspace's row), the narrowed
 * column grants, and the contract naming the same reasons as the types.
 */
import { PrismaClient } from '@prisma/client';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  DEFAULT_HANDOFF_TRIGGERS,
  HANDOFF_MESSAGE_MAX,
  HANDOFF_MESSAGE_REASONS,
  HANDOFF_TRIGGER_LOCKED_REASON,
  LOCKED_HANDOFF_REASONS,
  SWITCHABLE_HANDOFF_TRIGGERS,
  readHandoffMessages,
} from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

describe('hand-over triggers and messages (AI-09 · K9)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let otherAgentId: string;
  let adminToken: string;
  let otherAdminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const tenant = (t: TenantFixture) => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  const read = (id = aiAgentId, token = adminToken) =>
    server.get(`/ai-agents/${id}/handoff-settings`, auth(token));
  const put = (payload: object, id = aiAgentId, token = adminToken) =>
    server.app.inject({
      method: 'PUT',
      url: server.url(`/ai-agents/${id}/handoff-settings`),
      payload,
      headers: auth(token),
    });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL is not set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await appRole.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    otherAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.b.licenseId, name: 'Bea', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });
    otherAdminToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });
  });

  // --- Triggers ---------------------------------------------------------------

  describe('triggers', () => {
    it('reads the AI-09-S2 defaults for an agent nobody configured: 2 turns, 2 warnings, 12 turns', async () => {
      const response = await read();
      expect(response.statusCode).toBe(200);
      const body = response.json() as Record<string, unknown>;
      expect(body['triggers']).toEqual({
        not_understood: { enabled: true, turns: 2, ask_first: true },
        negative_sentiment: { enabled: true, consecutive: 2, ask_first: false },
        abuse: { warnings: 2 },
        loop_detected: { enabled: true },
        max_turns: { enabled: true, turns: 12 },
        repeat_same_day: { enabled: true },
      });
      expect(body['after_hours']).toEqual({ text: null });
      expect(body['messages']).toEqual(readHandoffMessages(null));
    });

    it('changes the fields a write names and keeps the rest, across writes', async () => {
      const first = await put({ triggers: { not_understood: { turns: 3, ask_first: false } } });
      expect(first.statusCode).toBe(200);
      const second = await put({
        triggers: { max_turns: { enabled: false }, abuse: { warnings: 4 } },
      });
      expect(second.statusCode).toBe(200);
      const triggers = (second.json() as { triggers: typeof DEFAULT_HANDOFF_TRIGGERS }).triggers;
      expect(triggers.not_understood).toEqual({ enabled: true, turns: 3, ask_first: false });
      expect(triggers.max_turns).toEqual({ enabled: false, turns: 12 });
      expect(triggers.abuse).toEqual({ warnings: 4 });
      expect(triggers.negative_sentiment).toEqual(DEFAULT_HANDOFF_TRIGGERS.negative_sentiment);
      // A write of another field leaves the triggers alone.
      expect((await put({ ai_stall_timeout_seconds: 90 })).statusCode).toBe(200);
      expect((await read()).json()).toMatchObject({ triggers, ai_stall_timeout_seconds: 90 });
    });

    it('lets the workspace switch off every switchable trigger', async () => {
      const off = Object.fromEntries(
        SWITCHABLE_HANDOFF_TRIGGERS.map((trigger) => [trigger, { enabled: false }]),
      );
      const response = await put({ triggers: off });
      expect(response.statusCode).toBe(200);
      const triggers = (response.json() as { triggers: Record<string, { enabled: boolean }> })
        .triggers;
      for (const trigger of SWITCHABLE_HANDOFF_TRIGGERS) {
        expect(triggers[trigger]!.enabled).toBe(false);
      }
    });

    it('refuses to turn a locked trigger off, and stores nothing of that request', async () => {
      for (const trigger of LOCKED_HANDOFF_REASONS) {
        const response = await put({
          triggers: { [trigger]: { enabled: false }, max_turns: { turns: 20 } },
        });
        expect(response.statusCode, trigger).toBe(400);
        expect(response.json()).toMatchObject({
          error: {
            type: 'validation',
            details: { reason: HANDOFF_TRIGGER_LOCKED_REASON, trigger },
          },
        });
      }
      expect((await read()).json()).toMatchObject({
        triggers: { max_turns: { turns: 12 } },
      });
      // Named with `enabled: true`, a locked trigger is a no-op, not an error.
      const kept = await put({ triggers: { player_request: { enabled: true } } });
      expect(kept.statusCode).toBe(200);
      expect((kept.json() as { triggers: object }).triggers).not.toHaveProperty('player_request');
    });

    it('refuses counts out of bounds, fractions, unknown triggers and empty objects', async () => {
      for (const triggers of [
        { not_understood: { turns: 0 } },
        { not_understood: { turns: 11 } },
        { max_turns: { turns: 1 } },
        { max_turns: { turns: 51 } },
        { abuse: { warnings: 6 } },
        { negative_sentiment: { consecutive: 1.5 } },
        { no_knowledge: { enabled: false } },
        { tenant_rule: { enabled: false } },
        { loop_detected: {} },
        {},
      ]) {
        const response = await put({ triggers });
        expect(response.statusCode, JSON.stringify(triggers)).toBe(400);
        expect(response.json()).toMatchObject({ error: { type: 'validation' } });
      }
    });
  });

  // --- Messages and after hours --------------------------------------------

  describe('messages and after-hours text', () => {
    it('writes a message per reason, keeps the others, and null goes back to the default', async () => {
      const first = await put({
        messages: { player_request: '  Sizi Finans ekibine bağlıyorum.  ', abuse: 'Aktarıyorum.' },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        messages: {
          player_request: 'Sizi Finans ekibine bağlıyorum.',
          abuse: 'Aktarıyorum.',
          ai_failure: null,
        },
      });
      const second = await put({ messages: { abuse: null } });
      expect(second.json()).toMatchObject({
        messages: { player_request: 'Sizi Finans ekibine bağlıyorum.', abuse: null },
      });
      // Only what was written is stored, so a default can still change.
      const row = await owner.aiHandoffSettings.findUniqueOrThrow({
        where: { aiAgentId },
        select: { messages: true },
      });
      expect(row.messages).toEqual({ player_request: 'Sizi Finans ekibine bağlıyorum.' });
    });

    it('has a message for every reason but no_knowledge, whose sentence is no_answer.text', async () => {
      const messages = (await read()).json() as { messages: Record<string, unknown> };
      expect(Object.keys(messages.messages).sort()).toEqual([...HANDOFF_MESSAGE_REASONS].sort());
      const response = await put({ messages: { no_knowledge: 'Bilmiyorum.' } });
      expect(response.statusCode).toBe(400);
    });

    it('refuses a message too long, blank, or for an unknown reason', async () => {
      for (const messages of [
        { abuse: 'x'.repeat(HANDOFF_MESSAGE_MAX + 1) },
        { abuse: '   ' },
        { kyc_docs_missing: 'x' },
        {},
      ]) {
        expect((await put({ messages })).statusCode, JSON.stringify(messages)).toBe(400);
      }
      expect((await put({ messages: { abuse: 'x'.repeat(HANDOFF_MESSAGE_MAX) } })).statusCode).toBe(
        200,
      );
    });

    it('writes and clears the after-hours text', async () => {
      const text = 'Ekibimiz Pazartesi 09:00 itibarıyla dönecek.';
      expect((await put({ after_hours: { text } })).json()).toMatchObject({
        after_hours: { text },
      });
      expect((await put({ after_hours: { text: null } })).json()).toMatchObject({
        after_hours: { text: null },
      });
      expect((await put({ after_hours: {} })).statusCode).toBe(400);
      expect(
        (await put({ after_hours: { text: 'x'.repeat(HANDOFF_MESSAGE_MAX + 1) } })).statusCode,
      ).toBe(400);
    });
  });

  // --- Under the route ---------------------------------------------------------

  describe('the table', () => {
    it("holds another workspace's agent out: 404 to read or write, its row untouched (NFR-S4)", async () => {
      expect((await read(otherAgentId)).statusCode).toBe(404);
      expect((await put({ triggers: { max_turns: { turns: 20 } } }, otherAgentId)).statusCode).toBe(
        404,
      );
      expect(await owner.aiHandoffSettings.count({ where: { aiAgentId: otherAgentId } })).toBe(0);
      // Its own admin may.
      expect(
        (await put({ triggers: { max_turns: { turns: 20 } } }, otherAgentId, otherAdminToken))
          .statusCode,
      ).toBe(200);
    });

    it('row level security: the app role sees only its own row and cannot write one for another workspace (NFR-S4)', async () => {
      expect((await put({ messages: { abuse: 'A.' } })).statusCode).toBe(200);
      const seen = await withTenant(appRole, tenant(fx.b), (tx) =>
        tx.aiHandoffSettings.findMany({ select: { aiAgentId: true } }),
      );
      expect(seen).toEqual([]);
      const changed = await withTenant(
        appRole,
        tenant(fx.b),
        (tx) =>
          tx.$executeRaw`UPDATE ai_handoff_settings SET messages = '{"abuse":"B."}'::jsonb
                        WHERE ai_agent_id = ${aiAgentId}::uuid`,
      );
      expect(changed).toBe(0);
      // Under its own licence, for the other workspace's agent: the write trigger refuses it.
      await expect(
        withTenant(appRole, tenant(fx.b), (tx) =>
          tx.aiHandoffSettings.create({
            data: { aiAgentId, licenseId: fx.b.licenseId, triggers: {} },
          }),
        ),
      ).rejects.toThrow();
      const row = await owner.aiHandoffSettings.findUniqueOrThrow({
        where: { aiAgentId },
        select: { messages: true, licenseId: true },
      });
      expect(row).toEqual({ messages: { abuse: 'A.' }, licenseId: fx.a.licenseId });
    });

    it('the app role may update the three settings but not the time the trigger keeps', async () => {
      expect((await put({ messages: { abuse: 'A.' } })).statusCode).toBe(200);
      const updated = await withTenant(
        appRole,
        tenant(fx.a),
        (tx) =>
          tx.$executeRaw`UPDATE ai_handoff_settings
                          SET triggers = '{}'::jsonb, messages = '{}'::jsonb, after_hours = '{}'::jsonb
                        WHERE ai_agent_id = ${aiAgentId}::uuid`,
      );
      expect(updated).toBe(1);
      await expect(
        withTenant(
          appRole,
          tenant(fx.a),
          (tx) =>
            tx.$executeRaw`UPDATE ai_handoff_settings SET updated_at = now()
                          WHERE ai_agent_id = ${aiAgentId}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('the CHECKs refuse what the route would: a non-object, a long or non-text message, a long after-hours text', async () => {
      await owner.aiHandoffSettings.create({
        data: { aiAgentId, licenseId: fx.a.licenseId },
      });
      const set = (sql: string) =>
        owner.$executeRawUnsafe(
          `UPDATE ai_handoff_settings SET ${sql} WHERE ai_agent_id = '${aiAgentId}'`,
        );
      await expect(set(`triggers = '[]'::jsonb`)).rejects.toThrow(
        /ai_handoff_settings_triggers_check/,
      );
      await expect(set(`messages = '"x"'::jsonb`)).rejects.toThrow(
        /ai_handoff_settings_messages_check/,
      );
      await expect(set(`messages = '{"abuse": 3}'::jsonb`)).rejects.toThrow(
        /ai_handoff_settings_messages_check/,
      );
      // The bound is in bytes: what 500 characters can take in UTF-8, no more.
      const bytes = HANDOFF_MESSAGE_MAX * 4;
      await expect(
        set(`messages = jsonb_build_object('abuse', repeat('x', ${bytes + 1}))`),
      ).rejects.toThrow(/ai_handoff_settings_messages_check/);
      await expect(
        set(`after_hours = jsonb_build_object('text', repeat('x', ${bytes + 1}))`),
      ).rejects.toThrow(/ai_handoff_settings_after_hours_check/);
      await expect(
        set(`messages = jsonb_build_object('abuse', repeat('x', ${bytes}))`),
      ).resolves.toBe(1);
    });

    it('takes a 500-letter Turkish message and after-hours text the route lets through', async () => {
      const text = 'ş'.repeat(HANDOFF_MESSAGE_MAX);
      const response = await put({ messages: { abuse: text }, after_hours: { text } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ messages: { abuse: text }, after_hours: { text } });
    });

    it('the contract names the same message reasons and locked triggers as the types', () => {
      const doc = loadOpenApiDocument() as unknown as {
        components: { schemas: Record<string, { properties?: Record<string, unknown> }> };
        paths: Record<string, Record<string, unknown>>;
      };
      expect(Object.keys(doc.components.schemas['AiHandoffMessages']!.properties!).sort()).toEqual(
        [...HANDOFF_MESSAGE_REASONS].sort(),
      );
      expect(Object.keys(doc.components.schemas['AiHandoffTriggers']!.properties!).sort()).toEqual(
        [...SWITCHABLE_HANDOFF_TRIGGERS, 'abuse'].sort(),
      );
      const operation = doc.paths['/ai-agents/{aiAgentId}/handoff-settings']!['put'] as {
        requestBody: {
          content: {
            'application/json': {
              schema: { properties: { triggers: { properties: Record<string, unknown> } } };
            };
          };
        };
      };
      const named = Object.keys(
        operation.requestBody.content['application/json'].schema.properties.triggers.properties,
      ).sort();
      expect(named).toEqual(
        [...new Set([...SWITCHABLE_HANDOFF_TRIGGERS, ...LOCKED_HANDOFF_REASONS])].sort(),
      );
    });
  });
});
