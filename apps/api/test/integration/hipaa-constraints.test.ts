/**
 * What a signed HIPAA agreement actually constrains (NFR-C4 · C4-e).
 *
 * `C4-d` records an acceptance. On its own that is a row — a workspace could
 * hold it while keeping transcripts for a decade and having them summarised by
 * a model in another country, which is the account this requirement exists to
 * make impossible. So the three consequences are tested together, and each one
 * is tested as a **pair**: the covered workspace is constrained, and an
 * identical workspace with no agreement is not.
 *
 * That second half is not padding. A constraint that applies to everyone is a
 * product decision nobody made; a constraint that applies to nobody is a
 * compliance claim that is false. Only the pair distinguishes them, and only the
 * pair fails when the scope lookup is dropped and the rule starts firing
 * unconditionally.
 *
 * The retention half is asserted against the database rather than a report: the
 * question is whether the conversation is gone, not whether the runner said so.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RetentionPolicy } from '../../src/services/retention/policy.js';
import { RetentionRunner } from '../../src/services/retention/retention.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);

/**
 * A deployment configured to keep everything for a decade. This is how
 * "unlimited" is actually spelled where the environment admits only positive
 * integers, and it is the configuration the ceiling has to survive — a base
 * policy already tighter than the ceiling would prove nothing.
 */
const FOREVER: RetentionPolicy = {
  threadDays: 3650,
  visitDays: 3650,
  mailDays: 3650,
  auditDays: 30,
};

interface UsWorkspace {
  organizationId: string;
  licenseId: bigint;
  ownerAccountId: string;
  agentAccountId: string;
  customerId: string;
  trustedDomain: string;
  token: string;
  aiAgentId: string;
}

describe('HIPAA scope constraints (C4-e)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;
  let mailDir: string;
  let seq = 0;

  /** A US deployment whose model provider sits in Europe — the refusing shape. */
  let outOfRegion: TestServer;
  /** The same US deployment with an in-region provider — the allowing shape. */
  let inRegion: TestServer;

  beforeAll(async () => {
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    outOfRegion = await startTestServer({ NEXA_REGION: 'us', LLM_PROVIDER_REGION: 'eu' });
    inRegion = await startTestServer({ NEXA_REGION: 'us' });
  });

  afterAll(async () => {
    await Promise.all([outOfRegion.close(), inRegion.close()]);
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    mailDir = await mkdtemp(join(tmpdir(), 'nexa-hipaa-'));
    await clearRateLimits(outOfRegion.app);
    await clearRateLimits(inRegion.app);
  });

  afterEach(async () => {
    await rm(mailDir, { recursive: true, force: true });
  });

  const nextId = (prefix: string, width: number): string => {
    seq += 1;
    return prefix + String(seq).padStart(width - 1, '0');
  };

  /**
   * A workspace that genuinely lives in `us`, because the database will not let
   * a BAA timestamp exist anywhere else (`licenses_baa_requires_us_region`,
   * C4-d). Built here rather than through signup: the point of every test below
   * is a *pair* of otherwise-identical workspaces that differ only in whether
   * the agreement is signed, and that pair has to be constructed deliberately.
   */
  async function seedUsWorkspace(
    slug: string,
    options: { baaSigned: boolean },
  ): Promise<UsWorkspace> {
    const organization = await owner.organization.create({
      data: { name: `Org ${slug}`, region: 'us' },
      select: { id: true },
    });
    const license = await owner.license.create({
      data: {
        organizationId: organization.id,
        plan: 'growth',
        status: 'active',
        ...(options.baaSigned ? { hipaaBaaSignedAt: new Date() } : {}),
      },
      select: { id: true },
    });

    const ownerAccount = await owner.account.create({
      data: { email: `owner-${slug}@example.test`, name: `Owner ${slug}` },
      select: { id: true },
    });
    const agentAccount = await owner.account.create({
      data: { email: `agent-${slug}@example.test`, name: `Agent ${slug}` },
      select: { id: true },
    });
    await owner.agentMembership.createMany({
      data: [
        { licenseId: license.id, agentId: ownerAccount.id, role: 'owner' },
        {
          licenseId: license.id,
          agentId: agentAccount.id,
          role: 'agent',
          routingStatus: 'accepting_chats',
        },
      ],
    });

    const trustedDomain = `shop-${slug}.example.test`;
    await owner.trustedDomain.create({
      data: {
        organizationId: organization.id,
        licenseId: license.id,
        domain: trustedDomain,
        includeSubdomains: true,
      },
    });

    const customer = await owner.customer.create({
      data: { organizationId: organization.id, name: `Customer ${slug}` },
      select: { id: true },
    });

    const aiAgent = await owner.aiAgent.create({
      data: { licenseId: license.id, kind: 'ai_agent', name: 'Nexa AI', active: true },
      select: { id: true },
    });

    const token = await grantToken(owner, {
      licenseId: license.id,
      organizationId: organization.id,
      ownerId: ownerAccount.id,
      // Everything the AI surfaces below ask for, so a 403 in these tests can
      // only ever be the residency refusal and never a missing scope.
      scopes: [
        'agents-bot--all:rw',
        'agents-bot--all:ro',
        'reports_read',
        'chats--all:rw',
        'customers:rw',
      ],
    });

    return {
      organizationId: organization.id,
      licenseId: license.id,
      ownerAccountId: ownerAccount.id,
      agentAccountId: agentAccount.id,
      customerId: customer.id,
      trustedDomain,
      token,
      aiAgentId: aiAgent.id,
    };
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  function blockedEntries(licenseId: bigint) {
    return owner.auditLogEntry.findMany({
      where: { licenseId, action: 'compliance.ai_region_blocked' },
    });
  }

  // =========================================================================
  // 1. The retention ceiling
  // =========================================================================

  describe('retention', () => {
    /** A closed conversation of a given age, with one message in it. */
    async function seedClosedThread(workspace: UsWorkspace, closedAt: Date): Promise<string> {
      const chatId = nextId('h', 12);
      await owner.chat.create({
        data: {
          id: chatId,
          licenseId: workspace.licenseId,
          customerId: workspace.customerId,
          active: false,
          createdAt: closedAt,
        },
      });
      const threadId = nextId('r', 12);
      await owner.thread.create({
        data: {
          id: threadId,
          chatId,
          licenseId: workspace.licenseId,
          active: false,
          closedAt,
          createdAt: closedAt,
        },
      });
      return threadId;
    }

    const sweep = (dryRun: boolean) =>
      new RetentionRunner(appRole, {
        policy: FOREVER,
        mailDir,
        auditChainSecret: testEnv().AUDIT_CHAIN_SECRET,
      }).run({ dryRun });

    it('deletes a covered workspace’s old conversation and keeps an uncovered one’s', async () => {
      // The pair. Same region, same plan, same 800-day-old closed conversation,
      // same deployment configured to keep everything for a decade. The only
      // difference is the signed agreement, and it is the whole difference.
      const covered = await seedUsWorkspace('cov-ret', { baaSigned: true });
      const plain = await seedUsWorkspace('pln-ret', { baaSigned: false });
      const coveredThread = await seedClosedThread(covered, daysAgo(800));
      const plainThread = await seedClosedThread(plain, daysAgo(800));

      await sweep(false);

      expect(await owner.thread.findUnique({ where: { id: coveredThread } })).toBeNull();
      expect(await owner.thread.findUnique({ where: { id: plainThread } })).not.toBeNull();
    });

    it('keeps a covered workspace’s conversation that is inside the ceiling', async () => {
      // The ceiling is a maximum, not a purge: 100 days old is well within 365,
      // and a rule that deleted it would be deleting data the agreement never
      // asked anyone to delete.
      const covered = await seedUsWorkspace('cov-keep', { baaSigned: true });
      const recent = await seedClosedThread(covered, daysAgo(100));

      await sweep(false);

      expect(await owner.thread.findUnique({ where: { id: recent } })).not.toBeNull();
    });

    it('reports the windows each workspace was actually swept under', async () => {
      // An operator reading a dry-run should not have to re-derive the ceiling
      // to know what is about to go.
      const covered = await seedUsWorkspace('cov-rep', { baaSigned: true });
      const plain = await seedUsWorkspace('pln-rep', { baaSigned: false });

      const report = await sweep(true);

      const coveredRow = report.tenants.find((t) => t.licenseId === covered.licenseId.toString());
      const plainRow = report.tenants.find((t) => t.licenseId === plain.licenseId.toString());

      expect(coveredRow?.hipaaScope).toBe(true);
      expect(coveredRow?.policy.threadDays).toBe(365);
      expect(coveredRow?.policy.visitDays).toBe(90);
      // The audit window is a floor, not a ceiling — it is not capped with the
      // rest (HIPAA §164.316 requires the access record be kept).
      expect(coveredRow?.policy.auditDays).toBe(FOREVER.auditDays);

      expect(plainRow?.hipaaScope).toBe(false);
      expect(plainRow?.policy).toEqual(FOREVER);

      // The run's own `policy` stays the configuration, un-capped: it describes
      // the deployment, and the per-tenant rows describe what happened.
      expect(report.policy).toEqual(FOREVER);
      expect(report.totals.hipaaTenants).toBe(1);
    });

    it('counts in a dry-run what it would delete, and deletes nothing', async () => {
      const covered = await seedUsWorkspace('cov-dry', { baaSigned: true });
      const thread = await seedClosedThread(covered, daysAgo(800));

      const report = await sweep(true);

      expect(
        report.tenants.find((t) => t.licenseId === covered.licenseId.toString())?.threads,
      ).toBe(1);
      expect(await owner.thread.findUnique({ where: { id: thread } })).not.toBeNull();
    });

    it('records why the data went, not just that it went', async () => {
      // "Was this deleted early because we are covered, or because somebody
      // changed the configuration" are different incidents, and the trail is
      // the only place that distinction survives.
      const covered = await seedUsWorkspace('cov-audit', { baaSigned: true });
      await seedClosedThread(covered, daysAgo(800));

      await sweep(false);

      const entries = await owner.auditLogEntry.findMany({
        where: { licenseId: covered.licenseId, action: 'data.retention_pruned' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.metadata).toMatchObject({
        hipaa_scope: true,
        thread_days: 365,
        visit_days: 90,
      });
    });

    it('leaves an uncovered workspace’s sweep unrecorded when nothing expired', async () => {
      // The negative of the entry above: a no-op sweep is not an event, and the
      // ceiling must not manufacture one.
      const plain = await seedUsWorkspace('pln-audit', { baaSigned: false });
      await seedClosedThread(plain, daysAgo(800));

      await sweep(false);

      expect(
        await owner.auditLogEntry.count({
          where: { licenseId: plain.licenseId, action: 'data.retention_pruned' },
        }),
      ).toBe(0);
    });
  });

  // =========================================================================
  // 2. The AI region boundary
  // =========================================================================

  describe('AI inference', () => {
    it('refuses every AI surface for a covered workspace on an out-of-region provider', async () => {
      const covered = await seedUsWorkspace('cov-ai', { baaSigned: true });

      // Three different route files, so this proves the hook and not one
      // handler that happens to remember.
      const responses = await Promise.all([
        outOfRegion.post('/palette/ai-query', { query: 'how many chats' }, auth(covered.token)),
        outOfRegion.post(
          '/skills/compile',
          { instruction: 'reply with hello' },
          auth(covered.token),
        ),
        outOfRegion.post(
          '/copilot/knowledge',
          { name: 'Refunds', content: 'We refund within 30 days.' },
          auth(covered.token),
        ),
      ]);

      for (const response of responses) {
        expect(response.statusCode).toBe(403);
        const body = response.json() as {
          error: { type: string; details?: { region: string; provider_region: string } };
        };
        expect(body.error.type).toBe('not_allowed');
        // Both regions, because the person who can fix this reads a log.
        expect(body.error.details).toEqual({ region: 'us', provider_region: 'eu' });
      }
    });

    it('lets an uncovered workspace use the same surfaces on the same deployment', async () => {
      // The negative proof. Nothing about the deployment changed — only the
      // absence of an agreement — and a workspace that never signed one must
      // not be subjected to a rule it never agreed to.
      const plain = await seedUsWorkspace('pln-ai', { baaSigned: false });

      const palette = await outOfRegion.post(
        '/palette/ai-query',
        { query: 'how many chats' },
        auth(plain.token),
      );
      const compile = await outOfRegion.post(
        '/skills/compile',
        { instruction: 'reply with hello' },
        auth(plain.token),
      );

      expect(palette.statusCode).toBe(200);
      expect(compile.statusCode).toBe(200);
      expect(await blockedEntries(plain.licenseId)).toHaveLength(0);
    });

    it('lets a covered workspace use them when the provider is in region', async () => {
      // The constraint is about crossing the border, not about being covered.
      // Without this, "compliant" would mean "no AI", which is a different
      // product than the one the requirement describes.
      const covered = await seedUsWorkspace('cov-ok', { baaSigned: true });

      const palette = await inRegion.post(
        '/palette/ai-query',
        { query: 'how many chats' },
        auth(covered.token),
      );

      expect(palette.statusCode).toBe(200);
      expect(await blockedEntries(covered.licenseId)).toHaveLength(0);
    });

    it('refuses before the handler does any work', async () => {
      // A refusal that arrives after the source row is written is not a
      // refusal — the content has already been chunked and embedded by then,
      // which is the exact thing that was not supposed to happen.
      const covered = await seedUsWorkspace('cov-nowrite', { baaSigned: true });

      const response = await outOfRegion.post(
        '/copilot/knowledge',
        { name: 'Refunds', content: 'We refund within 30 days.' },
        auth(covered.token),
      );

      expect(response.statusCode).toBe(403);
      expect(await owner.knowledgeSource.count({ where: { licenseId: covered.licenseId } })).toBe(
        0,
      );
      expect(await owner.knowledgeChunk.count({ where: { licenseId: covered.licenseId } })).toBe(0);
    });

    it('writes the refusal into the covered workspace’s log and nobody else’s', async () => {
      const covered = await seedUsWorkspace('cov-log', { baaSigned: true });
      const neighbour = await seedUsWorkspace('nbr-log', { baaSigned: true });

      await outOfRegion.post('/palette/ai-query', { query: 'how many' }, auth(covered.token));

      const entries = await blockedEntries(covered.licenseId);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.actorId).toBe(covered.ownerAccountId);
      expect(entries[0]?.target).toBe(`license:${covered.licenseId}`);
      expect(entries[0]?.metadata).toMatchObject({
        region: 'us',
        provider_region: 'eu',
        provider: 'mock',
        route: '/api/v1/palette/ai-query',
      });

      // Region cannot separate these two — both are `us`, both are covered.
      // Only tenancy can, which is why the neighbour is here.
      expect(await blockedEntries(neighbour.licenseId)).toHaveLength(0);
    });

    it('leaves the customer’s message for a human instead of inferring it elsewhere', async () => {
      // The surface the constraint exists for: this content is what the
      // customer just typed. The message must survive — losing it would be a
      // worse outcome than the one the agreement is protecting against — and
      // the AI must not answer.
      const covered = await seedUsWorkspace('cov-chat', { baaSigned: true });
      await owner.skill.create({
        data: {
          licenseId: covered.licenseId,
          aiAgentId: covered.aiAgentId,
          name: 'Greeting',
          kind: 'ai_agent',
          steps: [{ type: 'send_message', source: 'text', text: 'The AI answered.' }],
          active: true,
          updatedAt: new Date(),
        },
      });

      const minted = await outOfRegion.post(
        '/customer/token',
        { organization_id: covered.organizationId },
        { origin: `https://${covered.trustedDomain}` },
      );
      expect(minted.statusCode).toBe(200);
      const { token } = minted.json() as { token: string };

      const sent = await outOfRegion.post(
        '/customer/chat/events',
        { text: 'Hello, where is my order' },
        auth(token),
      );

      // The customer's message is stored and the conversation is intact.
      expect(sent.statusCode).toBe(201);
      const chatId = (sent.json() as { chat_id: string }).chat_id;
      const events = await owner.event.findMany({
        where: { chatId },
        select: { text: true, authorType: true },
      });
      expect(events.map((e) => e.text)).toContain('Hello, where is my order');
      // Nothing was inferred: no bot ever spoke.
      expect(events.some((e) => e.authorType === 'bot')).toBe(false);
      expect(await blockedEntries(covered.licenseId)).toHaveLength(1);
    });

    it('still answers the customer when the provider is in region', async () => {
      // The same conversation on the allowing deployment, so the test above is
      // read as "the gate fired" and not "the skill never worked".
      const covered = await seedUsWorkspace('cov-chat-ok', { baaSigned: true });
      await owner.skill.create({
        data: {
          licenseId: covered.licenseId,
          aiAgentId: covered.aiAgentId,
          name: 'Greeting',
          kind: 'ai_agent',
          steps: [{ type: 'send_message', source: 'text', text: 'The AI answered.' }],
          active: true,
          updatedAt: new Date(),
        },
      });

      const minted = await inRegion.post(
        '/customer/token',
        { organization_id: covered.organizationId },
        { origin: `https://${covered.trustedDomain}` },
      );
      const { token } = minted.json() as { token: string };

      const sent = await inRegion.post(
        '/customer/chat/events',
        { text: 'Hello, where is my order' },
        auth(token),
      );

      expect(sent.statusCode).toBe(201);
      const chatId = (sent.json() as { chat_id: string }).chat_id;
      const events = await owner.event.findMany({
        where: { chatId },
        select: { text: true, authorType: true },
      });
      expect(events.some((e) => e.authorType === 'bot')).toBe(true);
    });

    it('is a residency verdict, not an address one — 403, never 421', async () => {
      // A covered workspace reaching its own region gets 403: the caller is
      // where they should be, and no address they could retry would fix a
      // provider this deployment chose. 421 would send them hunting for a door
      // that does not exist. C4-b's 421 still applies at the door itself.
      const covered = await seedUsWorkspace('cov-code', { baaSigned: true });

      const refused = await outOfRegion.post(
        '/palette/ai-query',
        { query: 'how many' },
        auth(covered.token),
      );
      expect(refused.statusCode).toBe(403);

      // ...and the European deployment still answers 421 for the same token,
      // before the AI question is ever reached.
      const wrongDoor = await outOfRegion.post(
        '/palette/ai-query',
        { query: 'how many' },
        { ...auth(covered.token), 'x-region': 'eu' },
      );
      expect(wrongDoor.statusCode).toBe(421);
    });
  });

  // =========================================================================
  // 3. PII in logs and telemetry
  // =========================================================================

  describe('logs', () => {
    /** Collects the lines pino actually wrote, so the assertion is on output. */
    class LineSink {
      readonly lines: string[] = [];
      write(chunk: string): boolean {
        this.lines.push(chunk);
        return true;
      }
      end(): void {}
      on(): void {}
      once(): void {}
      emit(): boolean {
        return false;
      }
    }

    it('never writes a customer’s address into the request line', async () => {
      // Unconditional, so this is asserted on an ordinary European workspace:
      // the request line is written before authentication resolves, so a mask
      // that waited for HIPAA scope would be a mask that is absent.
      const sink = new LineSink();
      const server = await startTestServer(
        { LOG_LEVEL: 'info' },
        { logStream: sink as unknown as NodeJS.WritableStream },
      );
      try {
        const token = await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.ownerAccountId,
          scopes: ['customers:ro'],
        });

        const response = await server.get(
          '/customers?query=jane.doe%40example.test&limit=5',
          auth(token),
        );
        expect(response.statusCode).toBe(200);

        const requestLines = sink.lines.filter((line) => line.includes('/customers'));
        expect(requestLines.length).toBeGreaterThan(0);
        const written = requestLines.join('\n');

        expect(written).not.toContain('jane.doe');
        expect(written).not.toContain('example.test');
        expect(written).toContain('[redacted]');
        // Still debuggable: the route and the harmless parameter survive.
        expect(written).toContain('/customers');
        expect(written).toContain('limit=5');
      } finally {
        await server.close();
      }
    });
  });
});
