/**
 * The ready-made templates' endpoints against Postgres (tm 311.3 · SiyahTuş
 * analysis AI-15 · ADR `docs/adr/ai-template-catalog.md`): the catalogue
 * reads write nothing; an install is a switched-off copy with its forbidden
 * phrases, idempotent per agent and template (one copy from two installs at
 * once); `route_mapping` writes the hand-over routes; a copy goes on only with
 * its placeholders replaced (`template_unfilled`) and every topic served
 * (`template_unmapped`); a locked copy is never switched off or deleted
 * (`409 template_locked`); the `igaming_core` pack installs the twenty, its
 * rules (off), its example rows (`source: sample`, which the AI does not read
 * until a person reviews one) and — asked to — the six teams.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  IGAMING_CORE_PACK,
  IGAMING_TEMPLATE_KEYS,
  IGAMING_TEMPLATES_TR,
  igamingTemplate,
  templateTopics,
} from '@siyahtus/ai-templates';
import { QUEUE_TOPIC_ROLES, foldGuardrailText } from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { readFactTables } from '../../src/services/ai/conversation/facts.js';
import {
  RESPONSIBLE_GAMBLING_EXPERTISE,
  TEMPLATE_TEAM_NAMES,
} from '../../src/services/ai-templates/install.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Json = Record<string, unknown>;

interface SkillBody {
  id: string;
  name: string;
  mode: string;
  active: boolean;
  locked: boolean;
  template_key: string | null;
  template_version: number | null;
  slots: Array<{ name: string }>;
  procedure: {
    steps: Array<{ id: string }>;
    templates: Array<{ key: string; text: string }>;
  } & Json;
}

interface InstallBody {
  created: boolean;
  skill: SkillBody;
  tenant_must_fill: Json[];
  unfilled_placeholders: string[];
  unmapped_topics: string[];
}

interface ErrorBody {
  error: { type: string; message: string; details?: Json };
}

const APP_URL = process.env['DATABASE_APP_URL'];
const DEPOSIT = igamingTemplate('deposit_not_credited')!;
const COMPLAINT = igamingTemplate('complaint_formal')!;
const SELF_EXCLUSION = igamingTemplate('self_exclusion')!;

describe('ready-made template installs (tm 311.3 · AI-15)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let token: string;
  let aiAgentId: string;
  let financeId: number;

  const auth = (t = token) => ({ authorization: `Bearer ${t}` });
  const tenant = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });
  const install = (key: string, body: Json = {}, t = token) =>
    server.post(`/ai-templates/${key}/install`, { ai_agent_id: aiAgentId, ...body }, auth(t));
  const scopedToken = (scopes: string[]) =>
    grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes,
    });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    await app.$connect();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    token = await scopedToken(['agents-bot--all:rw', 'access_rules:rw', 'groups--all:rw']);
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent' },
        select: { id: true },
      })
    ).id;
    financeId = Number(
      (
        await owner.group.create({
          data: { licenseId: fx.a.licenseId, name: 'Ödemeler' },
          select: { id: true },
        })
      ).id,
    );
  });

  describe('the catalogue', () => {
    it('lists the twenty in catalogue order with their packs, and reading writes nothing', async () => {
      const response = await server.get('/ai-templates?industry=igaming&lang=tr', auth());
      expect(response.statusCode).toBe(200);
      const body = response.json() as { items: Json[]; packs: Json[] };
      expect(body.items.map((item) => item['key'])).toEqual([...IGAMING_TEMPLATE_KEYS]);
      expect(body.items.filter((item) => item['locked']).map((item) => item['key'])).toEqual([
        'self_exclusion',
        'responsible_gambling_signal',
      ]);
      expect(body.items[0]).toMatchObject({
        key: 'deposit_not_credited',
        name: DEPOSIT.name,
        version: DEPOSIT.version,
        topics: ['finance'],
        tenant_must_fill_count: DEPOSIT.tenant_must_fill.length,
        installed_version: null,
      });
      expect(body.packs).toEqual([
        {
          key: 'igaming_core',
          version: IGAMING_CORE_PACK.version,
          industry: 'igaming',
          lang: 'tr',
          template_keys: [...IGAMING_TEMPLATE_KEYS],
          default_rules_count: 5,
          sample_rows_count: 14,
        },
      ]);

      const detail = await server.get('/ai-templates/deposit_not_credited', auth());
      expect(detail.statusCode).toBe(200);
      expect(detail.json()).toMatchObject({
        key: 'deposit_not_credited',
        when_to_use: DEPOSIT.procedure.when_to_use,
        procedure: { steps: DEPOSIT.procedure.steps, templates: DEPOSIT.procedure.templates },
        forbidden_phrases: DEPOSIT.forbidden_phrases,
        tenant_must_fill: DEPOSIT.tenant_must_fill,
        installed_version: null,
      });
      expect((detail.json() as { scenarios: unknown[] }).scenarios).toHaveLength(
        DEPOSIT.scenarios.length,
      );

      expect((await server.get('/ai-templates/nope', auth())).statusCode).toBe(404);
      expect((await server.get('/ai-templates?lang=en', auth())).statusCode).toBe(400);
      expect(await owner.skill.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
      expect(await owner.handoffRoute.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });
  });

  describe('one template', () => {
    it('installs deposit_not_credited as a draft with its slots, steps, texts, phrases and mapped team — once', async () => {
      const first = await install('deposit_not_credited', {
        route_mapping: { finance: financeId },
      });
      expect(first.statusCode).toBe(201);
      const body = first.json() as InstallBody;
      expect(body).toMatchObject({
        created: true,
        unfilled_placeholders: [],
        unmapped_topics: [],
        tenant_must_fill: DEPOSIT.tenant_must_fill,
      });
      expect(body.skill).toMatchObject({
        name: DEPOSIT.name,
        mode: 'procedure',
        active: false,
        locked: false,
        template_key: 'deposit_not_credited',
        template_version: DEPOSIT.version,
      });
      expect(body.skill.slots.map((slot) => slot.name)).toEqual(
        DEPOSIT.procedure.slots.map((slot) => slot.name),
      );
      expect(body.skill.procedure.steps.map((step) => step.id)).toEqual(
        DEPOSIT.procedure.steps.map((step) => step.id),
      );
      expect(body.skill.procedure.templates).toEqual(DEPOSIT.procedure.templates);

      const routes = await owner.handoffRoute.findMany({ where: { licenseId: fx.a.licenseId } });
      expect(routes).toMatchObject([
        { brandId: null, matchType: 'topic', matchKey: 'finance', groupId: BigInt(financeId) },
      ]);
      const phrases = await owner.aiForbiddenPhrase.findMany({ where: { aiAgentId } });
      expect(phrases.map((p) => p.phrase).sort()).toEqual(
        DEPOSIT.forbidden_phrases.map((p) => p.phrase).sort(),
      );
      for (const phrase of phrases) expect(phrase.scope).toEqual({ skill_ids: [body.skill.id] });

      const again = await install('deposit_not_credited');
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({ created: false, skill: { id: body.skill.id } });
      expect(await owner.skill.count({ where: { aiAgentId } })).toBe(1);
      expect(await owner.aiForbiddenPhrase.count({ where: { aiAgentId } })).toBe(phrases.length);

      const list = await server.get('/ai-templates', auth());
      expect((list.json() as { items: Json[] }).items[0]).toMatchObject({
        installed_version: DEPOSIT.version,
      });

      const forced = await install('deposit_not_credited', { force_copy: true });
      expect(forced.statusCode).toBe(201);
      expect((forced.json() as InstallBody).skill.id).not.toBe(body.skill.id);
      expect(await owner.skill.count({ where: { aiAgentId } })).toBe(2);
      // The second copy joins the same phrases rather than doubling them.
      expect(await owner.aiForbiddenPhrase.count({ where: { aiAgentId } })).toBe(phrases.length);
    });

    it('two installs at once leave one copy', async () => {
      const [a, b] = await Promise.all([
        install('deposit_not_credited'),
        install('deposit_not_credited'),
      ]);
      expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
      expect((a.json() as InstallBody).skill.id).toBe((b.json() as InstallBody).skill.id);
      expect(await owner.skill.count({ where: { aiAgentId } })).toBe(1);
    });

    it('a topic nothing serves does not stop the install — it stops publishing, until a team takes it', async () => {
      const installed = await install('deposit_not_credited');
      expect(installed.statusCode).toBe(201);
      const body = installed.json() as InstallBody;
      expect(body.unmapped_topics).toEqual(['finance']);

      const on = await server.patch(`/skills/${body.skill.id}`, { active: true }, auth());
      expect(on.statusCode).toBe(400);
      expect((on.json() as ErrorBody).error.details).toEqual({
        reason: 'template_unmapped',
        topics: ['finance'],
      });

      // A team holding the queue role serves the topic as a route does.
      await owner.group.update({
        where: { licenseId_id: { licenseId: fx.a.licenseId, id: BigInt(financeId) } },
        data: { topicRole: 'finance' },
      });
      const retried = await server.patch(`/skills/${body.skill.id}`, { active: true }, auth());
      expect(retried.statusCode).toBe(200);
      expect((retried.json() as SkillBody).active).toBe(true);
    });

    it('a placeholder left blocks publishing (template_unfilled); its key is allowed in edits until replaced', async () => {
      const complaintTeam = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Şikâyet', topicRole: 'complaint' },
        select: { id: true },
      });
      expect(complaintTeam.id).toBeDefined();
      const installed = await install('complaint_formal');
      const body = installed.json() as InstallBody;
      expect(body.unfilled_placeholders).toEqual(['sikayet_suresi', 'adr_kurumu']);
      expect(body.unmapped_topics).toEqual([]);

      const on = await server.patch(`/skills/${body.skill.id}`, { active: true }, auth());
      expect(on.statusCode).toBe(400);
      expect((on.json() as ErrorBody).error.details).toEqual({
        reason: 'template_unfilled',
        placeholders: ['sikayet_suresi', 'adr_kurumu'],
      });

      // Rewording another text keeps the placeholders and is not refused for them.
      const reworded = JSON.parse(JSON.stringify(body.skill.procedure)) as SkillBody['procedure'];
      reworded.templates[0]!.text = `${reworded.templates[0]!.text} `;
      const kept = await server.patch(`/skills/${body.skill.id}`, { procedure: reworded }, auth());
      expect(kept.statusCode).toBe(200);

      const filled = JSON.parse(
        JSON.stringify(body.skill.procedure)
          .split('{sikayet_suresi}')
          .join('15 gün')
          .split('{adr_kurumu}')
          .join('Örnek Uyuşmazlık Kurulu'),
      ) as Json;
      const saved = await server.patch(`/skills/${body.skill.id}`, { procedure: filled }, auth());
      expect(saved.statusCode).toBe(200);
      const published = await server.patch(`/skills/${body.skill.id}`, { active: true }, auth());
      expect(published.statusCode).toBe(200);

      // An edit to a copy that is on is held to the same.
      const back = await server.patch(
        `/skills/${body.skill.id}`,
        { procedure: body.skill.procedure },
        auth(),
      );
      expect(back.statusCode).toBe(400);
      expect((back.json() as ErrorBody).error.details?.['reason']).toBe('template_unfilled');
    });

    it('a locked copy is never switched off or deleted (409 template_locked); its texts change, its steps do not', async () => {
      const installed = await install('self_exclusion');
      expect(installed.statusCode).toBe(201);
      const body = installed.json() as InstallBody;
      expect(body.skill).toMatchObject({ locked: true, template_key: 'self_exclusion' });
      expect(SELF_EXCLUSION.locked).toBe(true);

      const off = await server.patch(`/skills/${body.skill.id}`, { active: false }, auth());
      expect(off.statusCode).toBe(409);
      expect((off.json() as ErrorBody).error.type).toBe('template_locked');
      const deleted = await server.del(`/skills/${body.skill.id}`, auth());
      expect(deleted.statusCode).toBe(409);
      expect((deleted.json() as ErrorBody).error.type).toBe('template_locked');
      expect(await owner.skill.count({ where: { id: body.skill.id } })).toBe(1);

      // The texts change — the placeholder still allowed — and so the lock holds the steps.
      const reworded = JSON.parse(JSON.stringify(body.skill.procedure)) as SkillBody['procedure'];
      reworded.templates[0]!.text = `${reworded.templates[0]!.text} `;
      const texts = await server.patch(`/skills/${body.skill.id}`, { procedure: reworded }, auth());
      expect(texts.statusCode).toBe(200);
      const restructured = { ...reworded, steps: reworded.steps.slice(1) };
      const steps = await server.patch(
        `/skills/${body.skill.id}`,
        { procedure: restructured },
        auth(),
      );
      expect(steps.statusCode).toBe(400);
      expect((steps.json() as ErrorBody).error.details?.['reason']).toBe('procedure_locked_change');

      // The lock is the template's: a copy whose flag was cleared is still locked.
      await owner.skill.update({ where: { id: body.skill.id }, data: { locked: false } });
      expect((await server.del(`/skills/${body.skill.id}`, auth())).statusCode).toBe(409);

      // An unlocked copy is deleted as any skill is.
      const deposit = (await install('deposit_not_credited')).json() as InstallBody;
      expect((await server.del(`/skills/${deposit.skill.id}`, auth())).statusCode).toBe(204);
    });

    it('refuses what is not the workspace’s, a topic the template does not hand over to, and a route without its scope', async () => {
      const narrow = await scopedToken(['agents-bot--all:rw']);
      const noScope = await install(
        'deposit_not_credited',
        { route_mapping: { finance: financeId } },
        narrow,
      );
      expect(noScope.statusCode).toBe(403);
      expect((await install('deposit_not_credited', {}, narrow)).statusCode).toBe(201);
      await owner.skill.deleteMany({ where: { aiAgentId } });

      const readOnly = await scopedToken(['agents-bot--all:ro']);
      expect((await install('deposit_not_credited', {}, readOnly)).statusCode).toBe(403);

      const bonus = await install('deposit_not_credited', { route_mapping: { bonus: financeId } });
      expect(bonus.statusCode).toBe(400);
      expect((bonus.json() as ErrorBody).error.details).toMatchObject({
        reason: 'template_route_unknown_topic',
        topic: 'bonus',
      });

      const foreignTeam = await owner.group.create({
        data: { licenseId: fx.b.licenseId, name: 'Başka' },
        select: { id: true },
      });
      const stranger = await install('deposit_not_credited', {
        route_mapping: { finance: Number(foreignTeam.id) },
      });
      expect(stranger.statusCode).toBe(400);
      expect((stranger.json() as ErrorBody).error.details?.['reason']).toBe(
        'handoff_route_unknown_team',
      );

      const foreignAgent = await owner.aiAgent.create({
        data: { licenseId: fx.b.licenseId, name: 'Başka', kind: 'ai_agent' },
        select: { id: true },
      });
      const elsewhere = await install('deposit_not_credited', { ai_agent_id: foreignAgent.id });
      expect(elsewhere.statusCode).toBe(400);
      expect((await install('nope')).statusCode).toBe(404);
      expect(await owner.skill.count()).toBe(0);
      expect(await owner.handoffRoute.count()).toBe(0);
    });

    it('maps a topic for each brand given, and points an existing route at the new team', async () => {
      const brand = await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'A', slug: 'a', isDefault: true },
        select: { id: true },
      });
      const other = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Eski finans' },
        select: { id: true },
      });
      await owner.handoffRoute.create({
        data: {
          licenseId: fx.a.licenseId,
          brandId: brand.id,
          matchType: 'topic',
          matchKey: 'finance',
          groupId: other.id,
        },
      });
      const installed = await install('deposit_not_credited', {
        brand_ids: [brand.id],
        route_mapping: { finance: financeId },
      });
      expect(installed.statusCode).toBe(201);
      const routes = await owner.handoffRoute.findMany({ where: { licenseId: fx.a.licenseId } });
      expect(routes).toHaveLength(1);
      expect(routes[0]).toMatchObject({ brandId: brand.id, groupId: BigInt(financeId) });
    });
  });

  describe('the igaming_core pack', () => {
    it('installs the twenty, the rules (off), the example rows (sample) and the six teams — and again, nothing', async () => {
      const response = await server.post(
        '/ai-templates/packs/igaming_core/install',
        { ai_agent_id: aiAgentId, create_groups: true },
        auth(),
      );
      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        templates: Array<Json & { template_key: string; skill_id: string }>;
        rules: { created: Array<Json & { title: string; scope: Json }>; existing: number };
        sample_rows: { created: number; skipped: number };
        groups_created: Array<{ id: number; name: string; topic_role: string }>;
        persona_style: Json;
        unmapped_topics: string[];
      };
      expect(body.templates.map((t) => t.template_key)).toEqual([...IGAMING_TEMPLATE_KEYS]);
      expect(body.templates.every((t) => t['created'] === true)).toBe(true);
      expect(body.templates.every((t) => (t['unmapped_topics'] as string[]).length === 0)).toBe(
        true,
      );
      expect(body.unmapped_topics).toEqual([]);
      expect(body.persona_style).toEqual(IGAMING_CORE_PACK.persona_style);

      // The six teams, each holding its role; Responsible Gambling with its training.
      expect(body.groups_created.map((g) => g.topic_role).sort()).toEqual(
        [...QUEUE_TOPIC_ROLES].sort(),
      );
      for (const group of body.groups_created) {
        expect(group.name).toBe(
          TEMPLATE_TEAM_NAMES[group.topic_role as keyof typeof TEMPLATE_TEAM_NAMES],
        );
      }
      const rg = await owner.group.findFirst({
        where: { licenseId: fx.a.licenseId, topicRole: 'responsible_gambling' },
        select: { requiredExpertise: { select: { expertise: { select: { slug: true } } } } },
      });
      expect(rg?.requiredExpertise.map((r) => r.expertise.slug)).toEqual([
        RESPONSIBLE_GAMBLING_EXPERTISE.slug,
      ]);

      // Every copy a switched-off draft; the two locked ones locked.
      const copies = await owner.skill.findMany({ where: { aiAgentId } });
      expect(copies).toHaveLength(20);
      expect(copies.every((copy) => !copy.active)).toBe(true);
      expect(
        copies
          .filter((copy) => copy.locked)
          .map((copy) => copy.templateKey)
          .sort(),
      ).toEqual(['responsible_gambling_signal', 'self_exclusion']);

      // The rules: off, the payment one scoped to the four payment copies.
      expect(body.rules.created.map((rule) => rule.title)).toEqual(
        IGAMING_CORE_PACK.default_rules.map((rule) => rule.title),
      );
      expect(body.rules.created.every((rule) => rule['active'] === false)).toBe(true);
      const payment = body.rules.created.find((rule) => rule.title.startsWith('Ödeme'))!;
      const paymentKeys = IGAMING_CORE_PACK.default_rules.find(
        (r) => r.key === 'odeme_once_bilgi',
      )!.template_keys!;
      const byKey = new Map(body.templates.map((t) => [t.template_key, t.skill_id]));
      expect((payment.scope['skill_ids'] as string[]).sort()).toEqual(
        paymentKeys.map((key) => byKey.get(key)!).sort(),
      );

      // The phrases: one row per distinct phrase, each scoped to the copies that carry it.
      const distinct = new Set(
        IGAMING_TEMPLATES_TR.flatMap((template) =>
          template.forbidden_phrases.map(
            (p) =>
              `${p.match}:${p.match === 'regex' ? p.phrase.trim() : foldGuardrailText(p.phrase)}`,
          ),
        ),
      );
      expect(await owner.aiForbiddenPhrase.count({ where: { aiAgentId } })).toBe(distinct.size);

      // The example rows: all written as samples.
      const total = Object.values(IGAMING_CORE_PACK.sample_rows).reduce((n, r) => n + r.length, 0);
      expect(body.sample_rows).toEqual({ created: total, skipped: 0 });
      const methods = await owner.kbPaymentMethod.findMany({
        where: { licenseId: fx.a.licenseId },
      });
      expect(methods).toHaveLength(IGAMING_CORE_PACK.sample_rows.payment_methods.length);
      expect(methods.every((row) => row.source === 'sample')).toBe(true);
      expect(
        await owner.kbRule.count({ where: { licenseId: fx.a.licenseId, source: 'sample' } }),
      ).toBe(IGAMING_CORE_PACK.sample_rows.rules.length);

      const again = await server.post(
        '/ai-templates/packs/igaming_core/install',
        { ai_agent_id: aiAgentId, create_groups: true },
        auth(),
      );
      expect(again.statusCode).toBe(200);
      const second = again.json() as typeof body;
      expect(second.templates.every((t) => t['created'] === false)).toBe(true);
      expect(second.rules).toEqual({ created: [], existing: 5 });
      expect(second.sample_rows).toEqual({ created: 0, skipped: total });
      expect(second.groups_created).toEqual([]);
      expect(await owner.skill.count({ where: { aiAgentId } })).toBe(20);
      expect(await owner.group.count({ where: { licenseId: fx.a.licenseId } })).toBe(7);
    });

    it('makes no team unless asked, and asks the team scope when it is', async () => {
      const response = await server.post(
        '/ai-templates/packs/igaming_core/install',
        { ai_agent_id: aiAgentId },
        auth(),
      );
      expect(response.statusCode).toBe(201);
      const body = response.json() as { groups_created: unknown[]; unmapped_topics: string[] };
      expect(body.groups_created).toEqual([]);
      expect(body.unmapped_topics.sort()).toEqual(
        [...new Set(IGAMING_TEMPLATES_TR.flatMap(templateTopics))].sort(),
      );
      expect(await owner.group.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);

      const narrow = await scopedToken(['agents-bot--all:rw']);
      const refused = await server.post(
        '/ai-templates/packs/igaming_core/install',
        { ai_agent_id: aiAgentId, create_groups: true },
        auth(narrow),
      );
      expect(refused.statusCode).toBe(403);
      expect(
        (await server.post('/ai-templates/packs/nope/install', { ai_agent_id: aiAgentId }, auth()))
          .statusCode,
      ).toBe(404);
    });

    it('the AI reads no example row until a person reviews it, which makes it the workspace’s', async () => {
      await server.post(
        '/ai-templates/packs/igaming_core/install',
        { ai_agent_id: aiAgentId },
        auth(),
      );
      const now = new Date();
      const before = await withTenant(app, tenant(), (tx) =>
        readFactTables(tx, { brandId: null, now }),
      );
      const papara = await owner.kbPaymentMethod.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, name: 'Papara' },
      });
      expect(JSON.stringify(before)).not.toContain(papara.id);
      expect(await owner.knowledgeSource.count({ where: { sourceRowId: papara.id } })).toBe(0);

      const reviewed = await server.post(
        `/knowledge-tables/payment-methods/${papara.id}/review`,
        {},
        auth(),
      );
      expect(reviewed.statusCode).toBe(200);
      expect((reviewed.json() as Json)['source']).toBe('manual');
      const after = await withTenant(app, tenant(), (tx) =>
        readFactTables(tx, { brandId: null, now }),
      );
      expect(JSON.stringify(after)).toContain(papara.id);

      // Editing an example row confirms it too.
      const bonus = await owner.kbBonus.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      const edited = await server.patch(
        `/knowledge-tables/bonuses/${bonus.id}`,
        { validity_days: 14 },
        auth(),
      );
      expect(edited.statusCode).toBe(200);
      expect((edited.json() as Json)['source']).toBe('manual');
    });
  });
});
