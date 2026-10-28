/**
 * The root panel's AI catalogues and a workspace's AI summary (tm 389.19 · FR-ADMIN-23 ·
 * docs/platform-admin/design.md §C ai-catalogs), driven through the platform API and — for the
 * crisis-text drafts — read back through a running tenant API on the same database.
 *
 * What the platform ships (the 19 rules, the template pack, the compliance pack, the rubric)
 * comes back with its version and keys and none of its text; the tools catalogue says it is not
 * installed. The platform connection bypasses row level security, so the summary and the install
 * list are the proof that every query names its licence: A's numbers carry none of B's rows.
 * The crisis-text drafts are the one write: a reason, the superadmin, plain text, an audit entry
 * naming countries (never a text), and a tenant that is offered the draft for its own country
 * and nothing it did not ask for.
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no test title carries one (CONVENTIONS §7.3).
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_TEMPLATES_PACKAGE_VERSION, IGAMING_TEMPLATES_TR } from '@siyahtus/ai-templates';
import {
  AI_COMPLIANCE_PACK_SIZE,
  AI_COMPLIANCE_PACK_VERSION,
  AI_COMPLIANCE_SCENARIOS,
  AI_QA_RUBRIC_VERSION,
  GUARDRAIL_IDS,
  PLATFORM_GUARDRAILS,
  PLATFORM_GUARDRAILS_VERSION,
  PLATFORM_QA_RUBRIC,
  type PlatformRole,
} from '@siyahtus/types';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import { countSince, OPTIONAL_SOURCES } from '../../src/services/platform/ai-catalogs.js';
import {
  grantToken,
  ownerClient,
  platformClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { bearer, createOperator, openActiveSession, TestClock } from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type ErrorBody = { error: { type: string; message: string } };

const REASON = 'Wording agreed with compliance';
const DAY = 86_400_000;
const SECRET_TEXT = 'SECRET-PROCEDURE-TEXT-DO-NOT-LEAK';

const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

describe('platform AI catalogues (tm 389.19)', () => {
  let platform: PlatformTestServer;
  let tenant: TestServer;
  let db: PrismaClient;
  let clock: TestClock;
  let fx: Fixtures;
  const tokens = new Map<PlatformRole, string>();

  const call = (
    method: 'GET' | 'PUT',
    path: string,
    body?: Record<string, unknown>,
    role: PlatformRole = 'superadmin',
    server: FastifyInstance = platform.app,
  ): Promise<LightMyRequestResponse> =>
    server.inject({
      method,
      url: `${PLATFORM_PREFIX}${path}`,
      headers: bearer(tokens.get(role)!),
      ...(body === undefined ? {} : { payload: body }),
    });
  const ok = async (response: Promise<LightMyRequestResponse>) => {
    const settled = await response;
    expect(settled.statusCode, settled.body).toBe(200);
    return settled.json() as Record<string, any>;
  };
  const errorOf = (response: LightMyRequestResponse) => (response.json() as ErrorBody).error;
  const putDrafts = (drafts: unknown, role: PlatformRole = 'superadmin') =>
    call(
      'PUT',
      '/ai-catalogs/crisis-text-drafts',
      { reason: REASON, drafts: drafts as never },
      role,
    );

  beforeAll(async () => {
    db = platformClient();
    clock = new TestClock(Date.now());
    platform = await buildPlatformTestServer(
      { RATE_LIMIT_PLATFORM_PER_MIN: '100000' },
      { now: clock.read },
    );
    tenant = await startTestServer();
  });

  afterAll(async () => {
    await platform?.close();
    await tenant?.close();
    await db?.$disconnect();
  });

  beforeEach(async () => {
    clock.now = Date.now();
    fx = await seedFixtures(owner);
    await clearRateLimits(tenant.app);
    tokens.clear();
    for (const role of ['superadmin', 'support', 'billing', 'readonly'] as const) {
      const operator = await createOperator(db, { role, clock });
      tokens.set(role, await openActiveSession(db, operator, clock));
    }
  });

  // --- Seeding ------------------------------------------------------------------------------

  /** A workspace holds one customer-facing agent; a second is the Copilot. */
  async function agentOf(
    t: TenantFixture,
    active = true,
    kind: 'ai_agent' | 'copilot' = 'ai_agent',
  ): Promise<string> {
    return (
      await owner.aiAgent.create({
        data: { licenseId: t.licenseId, name: 'Ada', kind, active },
        select: { id: true },
      })
    ).id;
  }

  /** `count` installed template copies for `t`, the first `live` of them switched on. */
  async function install(t: TenantFixture, agentId: string, count: number, live: number) {
    for (const [index, template] of IGAMING_TEMPLATES_TR.slice(0, count).entries()) {
      await owner.skill.create({
        data: {
          licenseId: t.licenseId,
          aiAgentId: agentId,
          kind: 'ai_agent',
          name: template.name,
          instruction: SECRET_TEXT,
          templateKey: template.key,
          templateVersion: template.version,
          locked: template.locked,
          active: index < live,
        },
      });
    }
  }

  let seq = 0;
  async function conversation(t: TenantFixture): Promise<{ chatId: string; threadId: string }> {
    seq += 1;
    const chatId = `cat${String(seq).padStart(9, '0')}`;
    const threadId = `thr${String(seq).padStart(9, '0')}`;
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: t.customerId, active: false },
    });
    await owner.thread.create({
      data: { id: threadId, chatId, licenseId: t.licenseId, active: false, closedAt: new Date() },
    });
    return { chatId, threadId };
  }

  async function hit(t: TenantFixture, ruleKey: string, createdAt: Date = new Date()) {
    const { chatId, threadId } = await conversation(t);
    await owner.aiGuardrailHit.create({
      data: {
        licenseId: t.licenseId,
        chatId,
        threadId,
        turnId: crypto.randomUUID(),
        ruleKey,
        stage: 'input',
        actionTaken: 'crisis_text',
        evidence: 'SECRET-PLAYER-WORDS',
        catalogVersion: PLATFORM_GUARDRAILS_VERSION,
        createdAt,
      },
    });
  }

  // --- The catalogues -------------------------------------------------------------------------

  describe('what the platform ships', () => {
    it('lists the 19 rules with the catalogue version and none of the lexicon', async () => {
      const response = await call('GET', '/ai-catalogs/guardrails');
      const body = await ok(Promise.resolve(response));
      expect(body['version']).toBe(PLATFORM_GUARDRAILS_VERSION);
      expect(body['count']).toBe(19);
      expect(body['items'].map((item: { id: string }) => item.id)).toEqual([...GUARDRAIL_IDS]);
      const g1 = body['items'].find((item: { id: string }) => item.id === 'G1');
      const rule = PLATFORM_GUARDRAILS.find((candidate) => candidate.id === 'G1')!;
      expect(g1).toMatchObject({
        title: { tr: rule.title.tr, en: rule.title.en },
        category: rule.category,
        action: rule.action,
        input_patterns: { tr: rule.input?.tr.length ?? 0, en: rule.input?.en.length ?? 0 },
      });
      // Counts, not patterns: no regular expression source leaves the catalogue.
      for (const item of body['items']) {
        expect(Object.keys(item).sort()).toEqual(Object.keys(g1).sort());
      }
      const firstPattern = rule.input?.tr[0];
      expect(firstPattern).toBeDefined();
      expect(response.body).not.toContain(firstPattern!.re.source);
    });

    it('shows the template pack by key, version and counts — never a procedure', async () => {
      const response = await call('GET', '/ai-catalogs/templates');
      const body = await ok(Promise.resolve(response));
      expect(body['pack']).toMatchObject({
        key: 'igaming_core',
        version: AI_TEMPLATES_PACKAGE_VERSION,
        template_count: IGAMING_TEMPLATES_TR.length,
      });
      expect(body['items']).toHaveLength(20);
      expect(Object.keys(body['items'][0]).sort()).toEqual([
        'key',
        'locked',
        'name',
        'scenario_count',
        'tenant_must_fill_count',
        'version',
      ]);
      const first = IGAMING_TEMPLATES_TR[0]!;
      expect(response.body).not.toContain(first.procedure.steps?.[0]?.toString() ?? '\u0000');
    });

    it('shows the compliance pack by key and the rubric with its version', async () => {
      const pack = await ok(call('GET', '/ai-catalogs/compliance-pack'));
      expect(pack['version']).toBe(AI_COMPLIANCE_PACK_VERSION);
      expect(pack['size']).toBe(AI_COMPLIANCE_PACK_SIZE);
      expect(pack['items']).toHaveLength(AI_COMPLIANCE_SCENARIOS.length);
      expect(pack['items'][0]).toEqual({
        key: AI_COMPLIANCE_SCENARIOS[0]!.key,
        guardrail: AI_COMPLIANCE_SCENARIOS[0]!.guardrail,
        language: AI_COMPLIANCE_SCENARIOS[0]!.language,
      });

      const rubric = await ok(call('GET', '/ai-catalogs/qa-rubric'));
      expect(rubric).toMatchObject({
        status: 'available',
        version: AI_QA_RUBRIC_VERSION,
        scale: { min: 1, max: 5 },
      });
      expect(rubric['items']).toHaveLength(7);
      expect(
        rubric['items'].filter((item: { handoff_only: boolean }) => item.handoff_only),
      ).toHaveLength(2);
    });

    it('says the tool catalogue is not installed rather than listing nothing', async () => {
      expect(await ok(call('GET', '/ai-catalogs/tools'))).toEqual({
        status: 'not_installed',
        version: null,
        items: [],
      });
    });
  });

  // --- Template installs ----------------------------------------------------------------------

  describe('template installs', () => {
    it('counts copies, live ones and ones behind the pack per workspace, B being absent', async () => {
      const agentA = await agentOf(fx.a);
      await install(fx.a, agentA, 20, 3);
      // One copy of A's is behind the pack's version of its template.
      await owner.skill.updateMany({
        where: { licenseId: fx.a.licenseId, templateKey: IGAMING_TEMPLATES_TR[5]!.key },
        data: { templateVersion: 0 },
      });
      // B has an agent and an ordinary skill but no template copy.
      const agentB = await agentOf(fx.b);
      await owner.skill.create({
        data: {
          licenseId: fx.b.licenseId,
          aiAgentId: agentB,
          kind: 'ai_agent',
          name: 'Own',
          active: true,
        },
      });

      const response = await call('GET', '/ai-catalogs/templates/installs');
      const body = await ok(Promise.resolve(response));
      expect(body['data']).toEqual([
        {
          license_id: fx.a.licenseId.toString(),
          workspace_name: expect.any(String),
          installed: 20,
          active: 3,
          outdated: 1,
        },
      ]);
      expect(body['next_cursor']).toBeNull();
      // Counts only: not a copy's name or its text.
      expect(response.body).not.toContain(SECRET_TEXT);
      expect(response.body).not.toContain(IGAMING_TEMPLATES_TR[0]!.name);
    });

    it('orders by copies then licence and pages with a cursor', async () => {
      await install(fx.a, await agentOf(fx.a), 2, 1);
      await install(fx.b, await agentOf(fx.b), 5, 0);
      const first = await ok(call('GET', '/ai-catalogs/templates/installs?limit=1'));
      expect(first['data'].map((row: { license_id: string }) => row.license_id)).toEqual([
        fx.b.licenseId.toString(),
      ]);
      expect(first['next_cursor']).toEqual(expect.any(String));
      const second = await ok(
        call('GET', `/ai-catalogs/templates/installs?limit=1&cursor=${first['next_cursor']}`),
      );
      expect(second['data'].map((row: { license_id: string }) => row.license_id)).toEqual([
        fx.a.licenseId.toString(),
      ]);
      expect(second['next_cursor']).toBeNull();

      const bad = await call('GET', '/ai-catalogs/templates/installs?cursor=not-a-cursor');
      expect(bad.statusCode).toBe(400);
      expect((await call('GET', '/ai-catalogs/templates/installs?limit=0')).statusCode).toBe(400);
    });
  });

  // --- Crisis-text drafts ---------------------------------------------------------------------

  describe('crisis-text drafts', () => {
    const DRAFTS = {
      TR: { en: 'Please call 183 free of charge.', tr: '183 numaralı hattı arayın.' },
      GB: { en: 'Call 0808 8020 133.' },
    };

    async function offeredTo(
      t: TenantFixture,
      agentId: string,
      language?: string,
    ): Promise<Record<string, any>> {
      const token = await grantToken(owner, {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        ownerId: t.ownerAccountId,
        scopes: ['agents-bot--all:rw'],
      });
      const response = await tenant.get(`/ai-guardrails/settings?ai_agent_id=${agentId}`, {
        authorization: `Bearer ${token}`,
        ...(language ? { 'accept-language': language } : {}),
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json() as Record<string, any>;
    }

    it('starts empty, saves the whole map and reads it back', async () => {
      expect(await ok(call('GET', '/ai-catalogs/crisis-text-drafts'))).toEqual({
        drafts: {},
        version: 0,
        updated_at: null,
        max_length: 1000,
      });
      const saved = await ok(putDrafts(DRAFTS));
      expect(saved['drafts']).toEqual(DRAFTS);
      expect(saved['version']).toBe(1);
      expect(await ok(call('GET', '/ai-catalogs/crisis-text-drafts'))).toEqual(saved);

      // The whole map is replaced: a country left out is removed.
      const replaced = await ok(putDrafts({ GB: DRAFTS.GB }));
      expect(replaced['drafts']).toEqual({ GB: DRAFTS.GB });
      expect(replaced['version']).toBe(2);
    });

    it('offers a workspace the draft for its own country, in its language, and never applies it', async () => {
      await ok(putDrafts(DRAFTS));
      const agentA = await agentOf(fx.a);
      const agentB = await agentOf(fx.b);
      // No country known from UTC: nothing to offer.
      expect((await offeredTo(fx.a, agentA))['crisis_text_draft']).toBeNull();

      await owner.organization.update({
        where: { id: fx.a.organizationId },
        data: { timezone: 'Europe/Istanbul' },
      });
      await owner.organization.update({
        where: { id: fx.b.organizationId },
        data: { timezone: 'Europe/London' },
      });
      const tr = await offeredTo(fx.a, agentA, 'tr-TR,tr;q=0.9');
      expect(tr['crisis_text_draft']).toBe(DRAFTS.TR.tr);
      expect((await offeredTo(fx.a, agentA))['crisis_text_draft']).toBe(DRAFTS.TR.en);
      // B is in GB, which has only an English text — offered whatever the language.
      expect((await offeredTo(fx.b, agentB, 'tr'))['crisis_text_draft']).toBe(DRAFTS.GB.en);

      // A suggestion, not a text: the workspace's own is still empty and unapproved.
      expect(tr).toMatchObject({
        crisis_text: null,
        crisis_text_approved: false,
        setup_problem: 'crisis_text_missing',
      });
      expect(await owner.aiGuardrailSettings.count({ where: { aiAgentId: agentA } })).toBe(0);

      // A country without a draft gets none.
      await owner.organization.update({
        where: { id: fx.a.organizationId },
        data: { timezone: 'Europe/Berlin' },
      });
      expect((await offeredTo(fx.a, agentA))['crisis_text_draft']).toBeNull();
    });

    it('records the countries touched, never a text, and nothing for an unchanged map', async () => {
      await ok(putDrafts(DRAFTS));
      await ok(
        putDrafts({ TR: { en: 'Changed English.', tr: DRAFTS.TR.tr }, DE: { en: 'Hilfe: 0800.' } }),
      );
      await ok(
        putDrafts({ TR: { en: 'Changed English.', tr: DRAFTS.TR.tr }, DE: { en: 'Hilfe: 0800.' } }),
      );

      const entries = await owner.platformAuditLog.findMany({
        where: { action: 'ai_settings.crisis_drafts_updated' },
        orderBy: { chainSeq: 'asc' },
      });
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({ targetType: 'settings', reason: REASON });
      expect(entries[0]!.payload).toEqual({
        added: ['GB', 'TR'],
        changed: [],
        removed: [],
        version: 1,
      });
      expect(entries[1]!.payload).toEqual({
        added: ['DE'],
        changed: ['TR'],
        removed: ['GB'],
        version: 2,
      });
      const trail = JSON.stringify(entries, (_k, v: unknown) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
      for (const text of [DRAFTS.TR.en, DRAFTS.TR.tr, DRAFTS.GB.en, 'Hilfe: 0800.']) {
        expect(trail).not.toContain(text);
      }
    });

    it('refuses markup, control characters, a long text, a bad country and an empty entry', async () => {
      const refused = async (drafts: unknown) => {
        const response = await putDrafts(drafts);
        expect(response.statusCode, response.body).toBe(400);
        expect(errorOf(response).type).toBe('validation');
      };
      await refused({ TR: { en: 'Call <b>183</b>' } });
      await refused({ TR: { en: '<script>alert(1)</script>' } });
      await refused({ TR: { en: 'bell\u0007' } });
      await refused({ TR: { en: 'x'.repeat(1001) } });
      await refused({ TR: { en: '   ' } });
      await refused({ TR: {} });
      await refused({ tr: { en: 'lower-case country' } });
      await refused({ TUR: { en: 'three letters' } });
      await refused({ TR: { de: 'unknown language' } });
      await refused({ TR: { en: 'x', extra: 'y' } });
      await refused(
        Object.fromEntries(
          Array.from({ length: 61 }, (_, i) => [
            `${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`,
            { en: 'x' },
          ]),
        ),
      );
      // The longest allowed text, trimmed, is fine; CRLF is stored as LF.
      const longest = await ok(putDrafts({ TR: { en: `  ${'x'.repeat(1000)}  ` } }));
      expect(longest['drafts'].TR.en).toHaveLength(1000);
      const lines = await ok(putDrafts({ TR: { en: 'one\r\ntwo' } }));
      expect(lines['drafts'].TR.en).toBe('one\ntwo');
      expect(
        await owner.platformAuditLog.count({
          where: { action: 'ai_settings.crisis_drafts_updated' },
        }),
      ).toBe(2);
    });

    it('needs a reason and the superadmin; the others read or are refused', async () => {
      const noReason = await call('PUT', '/ai-catalogs/crisis-text-drafts', { drafts: DRAFTS });
      expect(noReason.statusCode).toBe(400);
      expect(errorOf(noReason).type).toBe('platform_reason_required');
      for (const role of ['support', 'billing', 'readonly'] as const) {
        expect((await putDrafts(DRAFTS, role)).statusCode).toBe(403);
      }
      for (const role of ['support', 'readonly'] as const) {
        expect(
          (await call('GET', '/ai-catalogs/crisis-text-drafts', undefined, role)).statusCode,
        ).toBe(200);
      }
      expect(
        (await call('GET', '/ai-catalogs/crisis-text-drafts', undefined, 'billing')).statusCode,
      ).toBe(403);
      expect(await owner.platformSetting.count({ where: { key: 'ai.crisis_text_drafts' } })).toBe(
        0,
      );
    });

    it('keeps the catalogue reads to the roles that may read the AI page', async () => {
      for (const path of [
        '/ai-catalogs/guardrails',
        '/ai-catalogs/templates',
        '/ai-catalogs/templates/installs',
        '/ai-catalogs/compliance-pack',
        '/ai-catalogs/qa-rubric',
        '/ai-catalogs/tools',
      ]) {
        for (const role of ['support', 'readonly'] as const) {
          expect((await call('GET', path, undefined, role)).statusCode, path).toBe(200);
        }
        expect((await call('GET', path, undefined, 'billing')).statusCode, path).toBe(403);
      }
    });

    it('is not mounted on the tenant API', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--all:rw'],
      });
      const response = await tenant.get('/platform/v1/ai-catalogs/guardrails', {
        authorization: `Bearer ${token}`,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  // --- The workspace summary ------------------------------------------------------------------

  describe('the workspace AI summary', () => {
    it('counts the workspace’s own rows only, and none of their content', async () => {
      const agentA = await agentOf(fx.a);
      await agentOf(fx.a, false, 'copilot');
      const agentB = await agentOf(fx.b);
      for (const [t, agent, active] of [
        [fx.a, agentA, true],
        [fx.a, agentA, false],
        [fx.b, agentB, true],
        [fx.b, agentB, true],
        [fx.b, agentB, true],
      ] as const) {
        await owner.aiGuidanceRule.create({
          data: {
            licenseId: t.licenseId,
            aiAgentId: agent,
            title: SECRET_TEXT,
            body: SECRET_TEXT,
            category: 'communication',
            active,
          },
        });
      }
      const ruleId = crypto.randomUUID();
      const phraseId = crypto.randomUUID();
      await hit(fx.a, 'G3');
      await hit(fx.a, 'G3');
      await hit(fx.a, 'G7');
      await hit(fx.a, `rule:${ruleId}`);
      await hit(fx.a, `phrase:${phraseId}`);
      await hit(fx.a, 'G3', new Date(Date.now() - 31 * DAY));
      for (let i = 0; i < 5; i += 1) await hit(fx.b, 'G3');

      for (const [t, agent, passed, failed, status] of [
        [fx.a, agentA, 13, 1, 'failed'],
        [fx.b, agentB, 14, 0, 'completed'],
      ] as const) {
        await owner.aiTestRun.create({
          data: {
            licenseId: t.licenseId,
            aiAgentId: agent,
            configTarget: 'draft',
            trigger: 'pre_publish',
            status,
            scenarioCount: 14,
            passed,
            failed,
            compliancePackVersion: AI_COMPLIANCE_PACK_VERSION,
            compliancePassed: passed,
            complianceFailed: failed,
            finishedAt: new Date(),
          },
        });
      }
      // An older run of A's, and one that did not play the pack, are not "the latest".
      await owner.aiTestRun.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId: agentA,
          configTarget: 'draft',
          trigger: 'manual',
          status: 'queued',
          createdAt: new Date(Date.now() + 1000),
        },
      });

      const response = await call('GET', `/workspaces/${fx.a.licenseId}/ai-summary`);
      const summary = await ok(Promise.resolve(response));
      expect(summary['ai_agents']).toEqual({ total: 2, active: 1 });
      expect(summary['guidance_rules']).toEqual({ status: 'available', total: 2, active: 1 });
      expect(summary['guardrail_hits']).toEqual({
        status: 'available',
        last_30_days: 5,
        by_rule: { G3: 2, G7: 1, workspace_rule: 1, forbidden_phrase: 1 },
      });
      expect(summary['compliance_pack']).toEqual({
        status: 'available',
        last_run: {
          version: AI_COMPLIANCE_PACK_VERSION,
          run_status: 'failed',
          passed: 13,
          failed: 1,
          finished_at: expect.any(String),
        },
      });
      // No content, no identifiers of other tenants' rows.
      for (const secret of [SECRET_TEXT, 'SECRET-PLAYER-WORDS', ruleId, phraseId]) {
        expect(response.body).not.toContain(secret);
      }

      const other = await ok(call('GET', `/workspaces/${fx.b.licenseId}/ai-summary`));
      expect(other['ai_agents']).toEqual({ total: 1, active: 1 });
      expect(other['guidance_rules']).toMatchObject({ total: 3, active: 3 });
      expect(other['guardrail_hits']).toMatchObject({ last_30_days: 5, by_rule: { G3: 5 } });
      expect(other['compliance_pack'].last_run).toMatchObject({
        passed: 14,
        run_status: 'completed',
      });

      const support = await call(
        'GET',
        `/workspaces/${fx.a.licenseId}/ai-summary`,
        undefined,
        'support',
      );
      expect(support.statusCode).toBe(200);
      expect((await call('GET', '/workspaces/999999999/ai-summary')).statusCode).toBe(404);
    });

    it('reports a workspace with nothing as zeros and no last run', async () => {
      const empty = await ok(call('GET', `/workspaces/${fx.b.licenseId}/ai-summary`));
      expect(empty).toMatchObject({
        ai_agents: { total: 0, active: 0 },
        guidance_rules: { status: 'available', total: 0, active: 0 },
        guardrail_hits: { status: 'available', last_30_days: 0, by_rule: {} },
        compliance_pack: { status: 'available', last_run: null },
      });
    });

    it('counts the QA queue’s open reviews and the ones completed in 30 days, per workspace (tm 319.1)', async () => {
      const rubricOf = async (t: TenantFixture) =>
        (
          await owner.qaRubric.create({
            data: {
              id: crypto.randomUUID(),
              licenseId: t.licenseId,
              version: 1,
              criteria: PLATFORM_QA_RUBRIC as never,
              active: true,
            },
            select: { id: true },
          })
        ).id;
      const review = async (
        t: TenantFixture,
        agentId: string,
        rubricId: string,
        status: 'pending_prescore' | 'ready' | 'in_review' | 'completed',
        reviewedAt: Date | null = null,
      ) => {
        const { chatId, threadId } = await conversation(t);
        await owner.qaReview.create({
          data: {
            id: crypto.randomUUID(),
            licenseId: t.licenseId,
            chatId,
            threadId,
            aiAgentId: agentId,
            reasons: ['random'],
            status,
            dueAt: new Date(),
            rubricId,
            ...(status === 'completed' ? { final: 'pass', reviewedAt } : {}),
          },
        });
      };
      const [agentA, agentB] = [await agentOf(fx.a), await agentOf(fx.b)];
      const [rubricA, rubricB] = [await rubricOf(fx.a), await rubricOf(fx.b)];
      for (const status of ['pending_prescore', 'ready', 'in_review'] as const) {
        await review(fx.a, agentA, rubricA, status);
      }
      await review(fx.a, agentA, rubricA, 'completed', new Date());
      await review(fx.a, agentA, rubricA, 'completed', new Date(Date.now() - 31 * DAY));
      for (let i = 0; i < 4; i += 1) await review(fx.b, agentB, rubricB, 'ready');

      const summary = await ok(call('GET', `/workspaces/${fx.a.licenseId}/ai-summary`));
      expect(summary['qa']).toEqual({
        status: 'available',
        reviewed_30_days: 1,
        awaiting_review: 3,
      });
    });

    it('marks the sources that have not shipped as not installed, not as zero', async () => {
      const present = await owner.$queryRaw<Array<{ configs: boolean; qa: boolean }>>`
        SELECT to_regclass('public.ai_config_changes') IS NOT NULL AS configs,
               to_regclass('public.qa_reviews') IS NOT NULL AS qa`;
      const summary = await ok(call('GET', `/workspaces/${fx.a.licenseId}/ai-summary`));
      expect(summary['config_changes'].status).toBe(
        present[0]!.configs ? 'available' : 'not_installed',
      );
      expect(summary['qa'].status).toBe(present[0]!.qa ? 'available' : 'not_installed');
    });
  });

  // --- The optional-source lookup, with a table of the promised shape --------------------------

  describe('a source that ships later', () => {
    const PROBE = {
      table: 'zz_ai_catalog_probe',
      licenseColumn: 'license_id',
      timeColumn: 'created_at',
    };

    it('turns on by itself when its table appears and counts only the licence and the window', async () => {
      const since = new Date(Date.now() - 30 * DAY);
      expect(await countSince(db, PROBE, fx.a.licenseId, since)).toEqual({
        status: 'not_installed',
        count: 0,
      });
      await owner.$executeRawUnsafe(
        `CREATE TABLE zz_ai_catalog_probe (license_id bigint NOT NULL, created_at timestamptz NOT NULL)`,
      );
      try {
        await owner.$executeRawUnsafe(`GRANT SELECT ON zz_ai_catalog_probe TO siyahtus_platform`);
        const rows = [
          [fx.a.licenseId, new Date()],
          [fx.a.licenseId, new Date(Date.now() - 2 * DAY)],
          [fx.a.licenseId, new Date(Date.now() - 40 * DAY)],
          [fx.b.licenseId, new Date()],
        ] as const;
        for (const [licenseId, at] of rows) {
          await owner.$executeRaw`INSERT INTO zz_ai_catalog_probe VALUES (${licenseId}, ${at})`;
        }
        expect(await countSince(db, PROBE, fx.a.licenseId, since)).toEqual({
          status: 'available',
          count: 2,
        });
        expect((await countSince(db, PROBE, fx.b.licenseId, since)).count).toBe(1);
      } finally {
        await owner.$executeRawUnsafe(`DROP TABLE IF EXISTS zz_ai_catalog_probe`);
      }
    });

    it('names the promised tables and columns once', () => {
      expect(OPTIONAL_SOURCES.configChanges).toEqual({
        table: 'ai_config_changes',
        licenseColumn: 'license_id',
        timeColumn: 'at',
      });
      expect(OPTIONAL_SOURCES.qaReviews.table).toBe('qa_reviews');
    });
  });
});
