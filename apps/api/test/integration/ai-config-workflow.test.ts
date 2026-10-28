/**
 * The AI configuration's review line (tm 316.2 · SiyahTuş analysis AI-20 ·
 * ADR-14b §2.5, §2.10, §2.11): a draft revision that moves with every save and
 * refuses a save made against an older one (`If-Match`); "Onaya gönder" only
 * once the compliance pack has passed for that very revision; approval by
 * someone other than the submitter — the Founder for a compliance change —
 * that publishes in one transaction (statuses, pointer, chunk ranges, AI-21);
 * rejection, a scheduled approval, a rollback that copies an earlier package
 * and brings its dropped knowledge back as a new chunk generation, a base
 * published over, and the live pause switch.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_COMPLIANCE_PACK_SIZE, AI_COMPLIANCE_PACK_VERSION } from '@siyahtus/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

interface Version {
  id: string;
  label: string;
  number: number;
  seq: number | null;
  status: string;
  draft_revision: number;
  base_version_id: string | null;
  rollback_of: string | null;
  test_run_id: string | null;
  touches_compliance: boolean;
  snapshot_hash: string;
  review_note: string | null;
  scheduled_at: string | null;
  published_by: string | null;
  diff_summary: { changes: number; compliance: string[]; sections: Array<{ section: string }> };
}

interface ErrorBody {
  error: { type: string; details?: Record<string, unknown> };
}

describe('AI configuration review line (AI-20 · tm 316.2)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let founder: Headers;
  let admin: { accountId: string; auth: Headers };
  let admin2: { accountId: string; auth: Headers };
  let seq = 0;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  async function member(role: 'admin' | 'team_lead' | 'agent') {
    seq += 1;
    const account = await owner.account.create({
      data: { email: `${role}-${seq}-${Date.now()}@example.test`, name: `Üye ${role} ${seq}` },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: account.id, role },
    });
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: account.id,
      scopes: ['agents-bot--all:rw'],
    });
    return { accountId: account.id, auth: { authorization: `Bearer ${token}` } };
  }

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    server.app.permissionMatrix.cache.invalidate();
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', tone: 'friendly' },
        select: { id: true },
      })
    ).id;
    founder = {
      authorization: `Bearer ${await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['agents-bot--all:rw'],
      })}`,
    };
    admin = await member('admin');
    admin2 = await member('admin');
  });

  const agentRow = () =>
    owner.aiAgent.findUniqueOrThrow({
      where: { id: aiAgentId },
      select: { draftRevision: true, publishedVersionId: true, active: true, tone: true },
    });

  /** A completed pre-publish run of the draft revision (now, by default). */
  async function packRun(
    options: { revision?: number; failed?: number } = {},
  ): Promise<{ id: string }> {
    const revision = options.revision ?? Number((await agentRow()).draftRevision);
    const failed = options.failed ?? 0;
    return owner.aiTestRun.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        configTarget: 'draft',
        draftRevision: revision,
        trigger: 'pre_publish',
        status: 'completed',
        scenarioCount: AI_COMPLIANCE_PACK_SIZE,
        passed: AI_COMPLIANCE_PACK_SIZE - failed,
        failed,
        compliancePackVersion: AI_COMPLIANCE_PACK_VERSION,
        compliancePassed: AI_COMPLIANCE_PACK_SIZE - failed,
        complianceFailed: failed,
        startedAt: new Date(),
        finishedAt: new Date(),
      },
      select: { id: true },
    });
  }

  const tone = (value: string, who: Headers, ifMatch?: string) =>
    server.patch(
      `/ai-agents/${aiAgentId}`,
      { tone: value },
      { ...who, ...(ifMatch === undefined ? {} : { 'if-match': ifMatch }) },
    );

  const submit = (who: Headers, extra: Headers = {}) =>
    server.post('/ai/config/versions', { ai_agent_id: aiAgentId }, { ...who, ...extra });

  const approve = (id: string, who: Headers, body: Record<string, unknown> = {}) =>
    server.post(`/ai/config/versions/${id}/approve`, body, who);

  async function submitted(who: Headers = admin.auth): Promise<Version> {
    const response = await submit(who);
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { version: Version }).version;
  }

  /** Change the tone, pass the pack, submit as `admin`, approve as `admin2`. */
  async function publish(value: string): Promise<Version> {
    expect((await tone(value, admin.auth)).statusCode).toBe(200);
    await packRun();
    const version = await submitted();
    const response = await approve(version.id, admin2.auth);
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as Version;
  }

  const errorOf = (response: { json: () => unknown }) => (response.json() as ErrorBody).error;

  const changesOf = (entityId: string) =>
    owner.aiConfigChange.findMany({
      where: { licenseId: fx.a.licenseId, entityId },
      orderBy: { at: 'asc' },
      select: { action: true, note: true, versionId: true },
    });

  const auditActions = async () =>
    (
      await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: { startsWith: 'ai.' } },
        orderBy: { createdAt: 'asc' },
        select: { action: true },
      })
    ).map((row) => row.action);

  it('the submitter never approves their own; someone else does, and it is published in one step', async () => {
    expect((await tone('formal', admin.auth)).statusCode).toBe(200);
    expect((await agentRow()).draftRevision).toBe(1n);
    const run = await packRun();

    const version = await submitted();
    expect(version).toMatchObject({
      label: 'v1',
      status: 'in_review',
      draft_revision: 1,
      base_version_id: null,
      test_run_id: run.id,
      touches_compliance: false,
    });
    expect(version.diff_summary.changes).toBeGreaterThan(0);

    const own = await approve(version.id, admin.auth);
    expect(own.statusCode).toBe(403);
    expect(errorOf(own)).toMatchObject({
      type: 'not_allowed',
      details: { reason: 'own_submission' },
    });

    const response = await approve(version.id, admin2.auth, { note: 'Kontrol ettim.' });
    expect(response.statusCode, response.body).toBe(200);
    const published = response.json() as Version;
    expect(published).toMatchObject({ status: 'published', published_by: admin2.accountId });
    expect(published.seq).toBeGreaterThanOrEqual(1);
    expect((await agentRow()).publishedVersionId).toBe(version.id);

    expect((await changesOf(version.id)).map((row) => row.action)).toEqual([
      'submitted',
      'approved',
      'published',
    ]);
    expect(await auditActions()).toEqual(
      expect.arrayContaining(['ai.config_submitted', 'ai.config_approved', 'ai.config_published']),
    );

    // The draft is the published package now: nothing to submit.
    const draft = await server.get(`/ai/config/draft/diff?ai_agent_id=${aiAgentId}`, admin.auth);
    expect(draft.statusCode, draft.body).toBe(200);
    expect(draft.headers['etag']).toBe('"1"');
    expect(draft.json()).toMatchObject({
      draft_revision: 1,
      published: { id: version.id, status: 'published' },
      open: null,
      ok: true,
      diff: { changes: 0 },
      compliance_gate: { state: 'passed' },
      submittable: false,
    });
    const again = await submit(admin.auth);
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toMatchObject({
      type: 'ai_config_version_state',
      details: { reason: 'no_changes' },
    });
  });

  it('a compliance change is published by the Founder alone', async () => {
    await owner.aiForbiddenPhrase.create({
      data: { licenseId: fx.a.licenseId, aiAgentId, phrase: 'kesin kazanç' },
    });
    await packRun();
    const version = await submitted();
    expect(version.touches_compliance).toBe(true);
    expect(version.diff_summary.compliance).toContain('guardrails');

    const byAdmin = await approve(version.id, admin2.auth);
    expect(byAdmin.statusCode).toBe(403);
    expect(errorOf(byAdmin)).toMatchObject({
      type: 'not_allowed',
      details: { reason: 'owner_required', compliance: ['guardrails'] },
    });
    expect((await agentRow()).publishedVersionId).toBeNull();

    const byFounder = await approve(version.id, founder);
    expect(byFounder.statusCode, byFounder.body).toBe(200);
    expect(byFounder.json()).toMatchObject({ status: 'published' });
  });

  it('a Team Lead prepares and submits but never publishes; the matrix can take publishing from an Administrator', async () => {
    await owner.roleCapabilityOverride.create({
      data: { licenseId: fx.a.licenseId, role: 'team_lead', capability: 'ai.manage', value: 'on' },
    });
    await owner.roleCapabilityOverride.create({
      data: {
        licenseId: fx.a.licenseId,
        role: 'admin',
        capability: 'ai.config.publish',
        value: 'off',
      },
    });
    server.app.permissionMatrix.cache.invalidate();
    const lead = await member('team_lead');
    const teamMember = await member('agent');

    await packRun();
    const version = await submitted(lead.auth);
    for (const [path, body] of [
      [`/ai/config/versions/${version.id}/approve`, {}],
      [`/ai/config/versions/${version.id}/reject`, {}],
      [`/ai/config/versions/${version.id}/rollback`, {}],
      ['/ai/pause', { ai_agent_id: aiAgentId }],
    ] as const) {
      const refused = await server.post(path, body, lead.auth);
      expect(refused.statusCode, path).toBe(403);
    }
    // A Team Member holds no AI configuration scope at all.
    expect((await submit(teamMember.auth)).statusCode).toBe(403);

    const offForAdmins = await approve(version.id, admin2.auth);
    expect(offForAdmins.statusCode).toBe(403);
    expect(errorOf(offForAdmins)).toMatchObject({
      type: 'authorization',
      details: { reason: 'capability_off' },
    });
    const byFounder = await approve(version.id, founder);
    expect(byFounder.statusCode, byFounder.body).toBe(200);
  });

  it('"Onaya gönder" stays shut until the compliance pack passed for this very revision', async () => {
    const none = await submit(admin.auth);
    expect(none.statusCode).toBe(409);
    expect(errorOf(none)).toMatchObject({
      type: 'ai_config_version_state',
      details: { reason: 'compliance_pack', gate_state: 'missing' },
    });

    // A pass of an earlier revision tested another draft.
    await packRun({ revision: 0 });
    expect((await tone('formal', admin.auth)).statusCode).toBe(200);
    const earlier = await submit(admin.auth);
    expect(errorOf(earlier)).toMatchObject({
      details: { reason: 'compliance_pack', gate_state: 'missing' },
    });

    const failing = await packRun({ failed: 1 });
    const failed = await submit(admin.auth);
    expect(errorOf(failed)).toMatchObject({
      details: { reason: 'compliance_pack', gate_state: 'failed', run_id: failing.id },
    });
    const shut = await server.get(`/ai/config/draft/diff?ai_agent_id=${aiAgentId}`, admin.auth);
    expect(shut.json()).toMatchObject({
      draft_revision: 1,
      compliance_gate: { state: 'failed', open: false },
      submittable: false,
    });
    const pack = await server.get(`/ai/compliance-pack?ai_agent_id=${aiAgentId}`, admin.auth);
    expect(pack.json()).toMatchObject({ gate: { state: 'failed', run_id: failing.id } });

    const passing = await packRun();
    const open = await server.get(`/ai/config/draft/diff?ai_agent_id=${aiAgentId}`, admin.auth);
    expect(open.json()).toMatchObject({ compliance_gate: { state: 'passed' }, submittable: true });
    const version = await submitted();
    expect(version.test_run_id).toBe(passing.id);
  });

  it('If-Match: the second of two saves against one draft revision is 409, and so is a stale submission', async () => {
    const draft = await server.get(`/ai/config/draft/diff?ai_agent_id=${aiAgentId}`, admin.auth);
    expect(draft.headers['etag']).toBe('"0"');

    expect((await tone('formal', admin.auth, '"0"')).statusCode).toBe(200);
    const second = await tone('casual', admin2.auth, '"0"');
    expect(second.statusCode).toBe(409);
    expect(errorOf(second)).toMatchObject({
      type: 'ai_config_revision_conflict',
      details: { ai_agent_id: aiAgentId, current_revision: 1, expected_revision: 0 },
    });
    expect(await agentRow()).toMatchObject({ draftRevision: 1n, tone: 'formal' });

    expect((await tone('casual', admin2.auth, '"1"')).statusCode).toBe(200);
    // No header: last write wins, as before versioning — and the revision still moves.
    expect((await tone('neutral', admin.auth)).statusCode).toBe(200);
    expect((await agentRow()).draftRevision).toBe(3n);
    expect((await tone('formal', admin.auth, 'yesterday')).statusCode).toBe(400);

    // Two saves at once against the same revision: one wins, one is told.
    const raced = await Promise.all([
      tone('formal', admin.auth, '"3"'),
      tone('professional', admin2.auth, '"3"'),
    ]);
    expect(raced.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect((await agentRow()).draftRevision).toBe(4n);

    await packRun();
    const stale = await submit(admin.auth, { 'if-match': '"3"' });
    expect(stale.statusCode).toBe(409);
    expect(errorOf(stale)).toMatchObject({ type: 'ai_config_revision_conflict' });
    const current = await submit(admin.auth, { 'if-match': '"4"' });
    expect(current.statusCode, current.body).toBe(201);
  });

  it('saves at once without If-Match queue on the draft, never on each other: each moves it once', async () => {
    // Each insert holds a KEY SHARE lock on the agent (the foreign key) and
    // writes an audit entry; the revision's lock must fit between the two.
    const created = await Promise.all(
      ['Para yatırma', 'Para çekme', 'Bonus', 'KYC', 'Limitler', 'Hesap'].map((name) =>
        server.post(
          '/skills',
          { name, ai_agent_id: aiAgentId, instruction: `${name} sorularını yanıtla.` },
          admin.auth,
        ),
      ),
    );
    expect(created.map((response) => response.statusCode)).toEqual([201, 201, 201, 201, 201, 201]);
    expect((await agentRow()).draftRevision).toBe(6n);
  });

  it('a new submission rejects the open one; a scheduled approval waits and can be rejected', async () => {
    expect((await tone('formal', admin.auth)).statusCode).toBe(200);
    await packRun();
    const first = await submitted();
    expect((await tone('casual', admin.auth)).statusCode).toBe(200);
    await packRun();
    const response = await submit(admin.auth);
    expect(response.statusCode).toBe(201);
    const body = response.json() as { version: Version; replaced_version_ids: string[] };
    expect(body.version.label).toBe('v2');
    expect(body.replaced_version_ids).toEqual([first.id]);
    const replaced = (await server.get(`/ai/config/versions/${first.id}`, admin.auth)).json();
    expect(replaced).toMatchObject({ status: 'rejected', review_note: 'superseded_by_submit' });
    const late = await approve(first.id, admin2.auth);
    expect(errorOf(late)).toMatchObject({ details: { reason: 'not_open', status: 'rejected' } });

    const past = await approve(body.version.id, admin2.auth, {
      publish_at: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(past.statusCode).toBe(400);
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const scheduled = await approve(body.version.id, admin2.auth, { publish_at: at });
    expect(scheduled.statusCode, scheduled.body).toBe(200);
    expect(scheduled.json()).toMatchObject({ status: 'approved', seq: null });
    expect(new Date((scheduled.json() as Version).scheduled_at!).toISOString()).toBe(at);
    expect((await agentRow()).publishedVersionId).toBeNull();

    const rejected = await server.post(
      `/ai/config/versions/${body.version.id}/reject`,
      { note: 'Yarın değil.' },
      admin2.auth,
    );
    expect(rejected.statusCode, rejected.body).toBe(200);
    expect(rejected.json()).toMatchObject({ status: 'rejected', review_note: 'Yarın değil.' });
    const twice = await server.post(
      `/ai/config/versions/${body.version.id}/reject`,
      {},
      admin2.auth,
    );
    expect(errorOf(twice)).toMatchObject({ details: { reason: 'not_open' } });

    const page = await server.get(
      `/ai/config/versions?ai_agent_id=${aiAgentId}&limit=1`,
      admin.auth,
    );
    const listed = page.json() as { versions: Version[]; next_cursor: string | null };
    expect(listed.versions.map((version) => version.label)).toEqual(['v2']);
    expect(listed.next_cursor).toBe('2.0');
    const next = await server.get(
      `/ai/config/versions?ai_agent_id=${aiAgentId}&limit=1&cursor=${listed.next_cursor}`,
      admin.auth,
    );
    expect((next.json() as { versions: Version[] }).versions.map((v) => v.label)).toEqual(['v1']);
  });

  it('rolling back to v1 publishes a copy of its package and makes the knowledge v2 dropped visible again', async () => {
    const source = await owner.knowledgeSource.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        type: 'article',
        name: 'Para çekme süreleri',
        content: 'Çekimler 24 saatte işlenir.',
      },
      select: { id: true },
    });
    for (const [position, text] of ['Çekimler 24 saatte', 'işlenir.'].entries()) {
      await owner.$executeRaw`
        INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, position)
        VALUES (gen_random_uuid(), ${source.id}::uuid, ${fx.a.licenseId}, ${text}, ${position})`;
    }
    const chunks = () =>
      owner.knowledgeChunk.findMany({
        where: { sourceId: source.id },
        orderBy: [{ generation: 'asc' }, { position: 'asc' }],
        select: { generation: true, visibleFromVersion: true, hiddenFromVersion: true },
      });

    const v1 = await publish('formal');
    expect(await chunks()).toEqual([
      { generation: 1, visibleFromVersion: BigInt(v1.seq!), hiddenFromVersion: null },
      { generation: 1, visibleFromVersion: BigInt(v1.seq!), hiddenFromVersion: null },
    ]);

    // v2 drops the source from the AI's knowledge (Copilot keeps it).
    await owner.knowledgeSource.update({
      where: { id: source.id },
      data: { audiences: ['copilot'] },
    });
    const v2 = await publish('casual');
    expect((await chunks()).map((chunk) => chunk.hiddenFromVersion)).toEqual([
      BigInt(v2.seq!),
      BigInt(v2.seq!),
    ]);
    const between = await server.get(`/ai/config/versions/${v1.id}/diff/${v2.id}`, admin.auth);
    expect(between.statusCode).toBe(200);
    expect(
      (between.json() as Version['diff_summary']).sections.map((section) => section.section),
    ).toEqual(['agent', 'knowledge']);

    const revisionBefore = (await agentRow()).draftRevision;
    const response = await server.post(
      `/ai/config/versions/${v1.id}/rollback`,
      { note: 'v2 yanlış süre söylüyor.' },
      admin.auth,
    );
    expect(response.statusCode, response.body).toBe(201);
    const v3 = response.json() as Version;
    expect(v3).toMatchObject({
      label: 'v3',
      status: 'published',
      rollback_of: v1.id,
      base_version_id: v2.id,
      snapshot_hash: v1.snapshot_hash,
      review_note: 'v2 yanlış süre söylüyor.',
    });
    expect(v3.seq!).toBeGreaterThan(v2.seq!);
    expect((await agentRow()).publishedVersionId).toBe(v3.id);
    expect((await server.get(`/ai/config/versions/${v2.id}`, admin.auth)).json()).toMatchObject({
      status: 'superseded',
    });

    // The closed range is not reopened: the chunks come back as generation 2.
    expect(await chunks()).toEqual([
      { generation: 1, visibleFromVersion: BigInt(v1.seq!), hiddenFromVersion: BigInt(v2.seq!) },
      { generation: 1, visibleFromVersion: BigInt(v1.seq!), hiddenFromVersion: BigInt(v2.seq!) },
      { generation: 2, visibleFromVersion: BigInt(v3.seq!), hiddenFromVersion: null },
      { generation: 2, visibleFromVersion: BigInt(v3.seq!), hiddenFromVersion: null },
    ]);
    const stored = await owner.aiConfigVersion.findUniqueOrThrow({ where: { id: v3.id } });
    expect(stored.knowledgeManifest).toEqual([
      expect.objectContaining({ source_id: source.id, generation: 2, chunk_count: 2 }),
    ]);

    // The draft is not touched: the source stays Copilot's, the revision where it was.
    const draftSource = await owner.knowledgeSource.findUniqueOrThrow({
      where: { id: source.id },
      select: { audiences: true, chunkGeneration: true },
    });
    expect(draftSource).toEqual({ audiences: ['copilot'], chunkGeneration: 1 });
    expect((await agentRow()).draftRevision).toBe(revisionBefore);
    expect((await changesOf(v3.id)).map((row) => [row.action, row.note])).toEqual([
      ['rolled_back', 'v2 yanlış süre söylüyor.'],
    ]);
    expect(await auditActions()).toContain('ai.config_rolled_back');

    const current = await server.post(`/ai/config/versions/${v3.id}/rollback`, {}, admin.auth);
    expect(errorOf(current)).toMatchObject({ details: { reason: 'rollback_current' } });

    // v1's chunks cleaned up: it cannot be restored again.
    await owner.knowledgeChunk.deleteMany({ where: { sourceId: source.id, generation: 1 } });
    const purged = await server.post(`/ai/config/versions/${v1.id}/rollback`, {}, admin.auth);
    expect(purged.statusCode).toBe(409);
    expect(errorOf(purged)).toMatchObject({
      type: 'ai_config_version_state',
      details: { reason: 'knowledge_purged', source_ids: [source.id] },
    });
  });

  it('a version whose base was published over by a rollback is rejected on approval', async () => {
    const v1 = await publish('formal');
    await publish('casual');
    expect((await tone('neutral', admin.auth)).statusCode).toBe(200);
    await packRun();
    const v3 = await submitted();
    const unpublished = await server.post(`/ai/config/versions/${v3.id}/rollback`, {}, admin.auth);
    expect(errorOf(unpublished)).toMatchObject({ details: { reason: 'rollback_unpublished' } });

    const rollback = await server.post(`/ai/config/versions/${v1.id}/rollback`, {}, admin.auth);
    expect(rollback.statusCode, rollback.body).toBe(201);
    const v4 = rollback.json() as Version;

    const stale = await approve(v3.id, admin2.auth);
    expect(stale.statusCode).toBe(409);
    expect(errorOf(stale)).toMatchObject({
      type: 'ai_config_version_state',
      details: { reason: 'stale_base', version_id: v3.id },
    });
    // The rejection is kept; production is still the rollback.
    expect((await server.get(`/ai/config/versions/${v3.id}`, admin.auth)).json()).toMatchObject({
      status: 'rejected',
      review_note: 'stale_base',
    });
    expect((await agentRow()).publishedVersionId).toBe(v4.id);
  });

  it('pause and resume: an administrator, at once, recorded, and the draft does not move', async () => {
    // A new agent starts switched off; this one is answering.
    await owner.aiAgent.update({ where: { id: aiAgentId }, data: { active: true } });
    const paused = await server.post(
      '/ai/pause',
      { ai_agent_id: aiAgentId, note: 'Yanlış bonus bilgisi.' },
      admin.auth,
    );
    expect(paused.statusCode, paused.body).toBe(200);
    expect(paused.json()).toEqual({ ai_agent_id: aiAgentId, active: false });
    expect(await agentRow()).toMatchObject({ active: false, draftRevision: 0n });
    expect(
      (await server.post('/ai/pause', { ai_agent_id: aiAgentId }, admin.auth)).statusCode,
    ).toBe(200);
    expect((await changesOf(aiAgentId)).map((row) => [row.action, row.note])).toEqual([
      ['paused', 'Yanlış bonus bilgisi.'],
    ]);

    const blocked = await server.post('/ai/resume', { ai_agent_id: aiAgentId }, admin.auth);
    expect(blocked.statusCode).toBe(409);
    expect(errorOf(blocked)).toMatchObject({ type: 'ai_guardrail_setup_incomplete' });
    await owner.aiGuardrailSettings.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        crisisText: 'Destek hattı: 112.',
        approvedAt: new Date(),
        approvedBy: fx.a.ownerAccountId,
      },
    });
    const resumed = await server.post('/ai/resume', { ai_agent_id: aiAgentId }, admin.auth);
    expect(resumed.statusCode, resumed.body).toBe(200);
    expect(await agentRow()).toMatchObject({ active: true, draftRevision: 0n });
    expect((await changesOf(aiAgentId)).map((row) => row.action)).toEqual(['paused', 'resumed']);
    expect(await auditActions()).toEqual(expect.arrayContaining(['ai.paused', 'ai.resumed']));
  });

  it("another workspace reaches none of an agent's versions or its switch (RLS)", async () => {
    const v1 = await publish('formal');
    const before = await agentRow();
    const foreign = {
      authorization: `Bearer ${await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['agents-bot--all:rw'],
      })}`,
    };
    for (const response of [
      await server.get(`/ai/config/draft/diff?ai_agent_id=${aiAgentId}`, foreign),
      await server.get(`/ai/config/versions?ai_agent_id=${aiAgentId}`, foreign),
      await server.get(`/ai/config/versions/${v1.id}`, foreign),
      await server.post('/ai/config/versions', { ai_agent_id: aiAgentId }, foreign),
      await server.post(`/ai/config/versions/${v1.id}/rollback`, {}, foreign),
      await server.post('/ai/pause', { ai_agent_id: aiAgentId }, foreign),
    ]) {
      expect(response.statusCode, response.body).toBe(404);
    }
    expect(await agentRow()).toEqual(before);
    expect(before.publishedVersionId).toBe(v1.id);
  });
});
