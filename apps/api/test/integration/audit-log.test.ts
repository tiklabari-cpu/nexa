/**
 * Append-only audit trail (NFR-S12).
 *
 * The writer added in this slice is the only thing that inserts into
 * `audit_log`. Four properties matter, and each fails independently, so each is
 * asserted on its own:
 *
 *   1. Every security-relevant action records exactly one entry — no more (a
 *      double write would inflate the trail) and no fewer (a missing write
 *      erases the evidence).
 *   2. The log is append-only *at the database*: the application role may
 *      INSERT and SELECT but not UPDATE or DELETE, so an attacker who reached
 *      the app role still cannot rewrite history.
 *   3. No entry leaks across tenants — a workspace sees only its own trail.
 *   4. No credential or unverified PII is ever written.
 */
import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import { withTenant } from '../../src/lib/tenant.js';
import { writeAuditEntry } from '../../src/services/audit/audit-log.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  TEST_PASSWORD,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** sha256-hex, matching how the lifecycle service hashes reset tokens. */
function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('audit log writer (NFR-S12)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const contextA = () => ({ licenseId: fx.a.licenseId, organizationId: fx.a.organizationId });

  /** How many entries a tenant holds for an action. */
  const count = (action: string, licenseId = fx.a.licenseId) =>
    owner.auditLogEntry.count({ where: { licenseId, action } });

  const latest = (action: string, licenseId = fx.a.licenseId) =>
    owner.auditLogEntry.findFirst({
      where: { licenseId, action },
      orderBy: { createdAt: 'desc' },
    });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    // /settings/security and /websites resolve the license default brand now.
    await Promise.all([
      seedDefaultBrand(owner, fx.a.licenseId),
      seedDefaultBrand(owner, fx.b.licenseId),
    ]);
    await clearRateLimits(server.app);
    // The owner holds every scope these actions need, and the owner *role* so
    // the invitation gate (admin-or-above) is satisfied.
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: [
        'access_rules:rw',
        'billing_manage',
        'accounts--my:rw',
        'accounts--all:rw',
        'webhooks--all:rw',
        'canned_responses--all:rw',
        'tags--all:rw',
        'tickets--all:rw',
        'agents-bot--all:rw',
        'agents--all:rw',
      ],
    });
  });

  // =========================================================================
  // One entry per action, correctly attributed
  // =========================================================================

  describe('each security action appends exactly one entry', () => {
    it('records a trusted domain being added', async () => {
      const before = await count('settings.trusted_domain_added');
      const res = await server.post(
        '/settings/trusted-domains',
        { domain: 'audit.example' },
        auth(adminToken),
      );
      expect(res.statusCode).toBe(201);
      const { id } = res.json() as { id: string };

      expect(await count('settings.trusted_domain_added')).toBe(before + 1);
      const entry = await latest('settings.trusted_domain_added');
      expect(entry?.actorId).toBe(fx.a.ownerAccountId);
      expect(entry?.actorType).toBe('agent');
      expect(entry?.target).toBe(`trusted_domain:${id}`);
      expect(entry?.metadata).toMatchObject({ domain: 'audit.example' });
      // Every entry carries the request id so a log line and its record tie up.
      expect((entry?.metadata as Record<string, unknown>).request_id).toBeTruthy();
    });

    it('records a trusted domain being removed (and not a no-op delete)', async () => {
      const added = await server.post(
        '/settings/trusted-domains',
        { domain: 'gone.example' },
        auth(adminToken),
      );
      const { id } = added.json() as { id: string };

      const before = await count('settings.trusted_domain_removed');
      const removed = await server.del(`/settings/trusted-domains/${id}`, auth(adminToken));
      expect(removed.statusCode).toBe(204);
      expect(await count('settings.trusted_domain_removed')).toBe(before + 1);
      expect((await latest('settings.trusted_domain_removed'))?.target).toBe(
        `trusted_domain:${id}`,
      );

      // A delete that matched nothing must not write an entry.
      const beforeMiss = await count('settings.trusted_domain_removed');
      const miss = await server.del(`/settings/trusted-domains/${id}`, auth(adminToken));
      expect(miss.statusCode).toBe(404);
      expect(await count('settings.trusted_domain_removed')).toBe(beforeMiss);
    });

    it('records a webhook being created, with the host but never the secret', async () => {
      const before = await count('webhook.created');
      const res = await server.post(
        '/webhooks',
        { url: 'https://hooks.audit.example/receiver', action: 'chat_started' },
        auth(adminToken),
      );
      expect(res.statusCode).toBe(201);
      const body = res.json() as { id: string; secret: string };

      expect(await count('webhook.created')).toBe(before + 1);
      const entry = await latest('webhook.created');
      expect(entry?.actorId).toBe(fx.a.ownerAccountId);
      expect(entry?.actorType).toBe('agent');
      expect(entry?.target).toBe(`webhook:${body.id}`);
      expect(entry?.metadata).toMatchObject({
        action: 'chat_started',
        type: 'license',
        url_host: 'hooks.audit.example',
      });
      // The host, and only the host: not the path, and never the signing secret
      // the register response returned exactly once.
      const blob = JSON.stringify({ target: entry?.target, metadata: entry?.metadata });
      expect(blob).not.toContain('/receiver');
      expect(blob).not.toContain(body.secret);
    });

    it('records a webhook being removed (and not a no-op delete)', async () => {
      const created = (
        await server.post(
          '/webhooks',
          { url: 'https://gone.audit.example/hook', action: 'ticket_created' },
          auth(adminToken),
        )
      ).json() as { id: string };

      const before = await count('webhook.deleted');
      const removed = await server.del(`/webhooks/${created.id}`, auth(adminToken));
      expect(removed.statusCode).toBe(204);
      expect(await count('webhook.deleted')).toBe(before + 1);
      const entry = await latest('webhook.deleted');
      expect(entry?.target).toBe(`webhook:${created.id}`);
      expect(entry?.metadata).toMatchObject({
        action: 'ticket_created',
        type: 'license',
        url_host: 'gone.audit.example',
      });

      // A repeat delete matches nothing (404) and must not write an entry.
      const beforeMiss = await count('webhook.deleted');
      const miss = await server.del(`/webhooks/${created.id}`, auth(adminToken));
      expect(miss.statusCode).toBe(404);
      expect(await count('webhook.deleted')).toBe(beforeMiss);
    });

    it("a cross-tenant webhook delete writes to no one's log", async () => {
      const mine = (
        await server.post(
          '/webhooks',
          { url: 'https://a-only.audit.example/hook', action: 'chat_started' },
          auth(adminToken),
        )
      ).json() as { id: string };

      // A tenant-B admin holding the write scope aims at tenant A's webhook id.
      const tokenB = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['webhooks--all:rw'],
      });

      const beforeA = await count('webhook.deleted', fx.a.licenseId);
      const beforeB = await count('webhook.deleted', fx.b.licenseId);
      const res = await server.del(`/webhooks/${mine.id}`, auth(tokenB));
      expect(res.statusCode).toBe(404);

      // RLS matched nothing, so neither log gained an entry — and A's webhook is
      // untouched, still there for its own owner to remove and record.
      expect(await count('webhook.deleted', fx.a.licenseId)).toBe(beforeA);
      expect(await count('webhook.deleted', fx.b.licenseId)).toBe(beforeB);
      const byOwner = await server.del(`/webhooks/${mine.id}`, auth(adminToken));
      expect(byOwner.statusCode).toBe(204);
      expect(await count('webhook.deleted', fx.a.licenseId)).toBe(beforeA + 1);
    });

    it('records a security-settings change with the field names touched', async () => {
      const before = await count('settings.security_updated');
      const res = await server.patch(
        '/settings/security',
        { require_two_factor: true, max_file_size_bytes: 2_000_000 },
        auth(adminToken),
      );
      expect(res.statusCode).toBe(200);
      expect(await count('settings.security_updated')).toBe(before + 1);

      const entry = await latest('settings.security_updated');
      expect(entry?.actorType).toBe('agent');
      expect((entry?.metadata as { fields: string[] }).fields).toEqual(
        expect.arrayContaining(['require_two_factor', 'max_file_size_bytes']),
      );
    });

    it('records a routing-rule change', async () => {
      const group = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      });
      const rule = await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          name: 'Everything else',
          kind: 'chat',
          isFallback: true,
          targetGroupId: group.id,
          priority: 100,
        },
        select: { id: true },
      });

      const before = await count('settings.routing_rule_updated');
      const res = await server.patch(
        `/settings/routing-rules/${rule.id}`,
        { priority: 50 },
        auth(adminToken),
      );
      expect(res.statusCode).toBe(200);
      expect(await count('settings.routing_rule_updated')).toBe(before + 1);
      expect((await latest('settings.routing_rule_updated'))?.target).toBe(
        `routing_rule:${rule.id}`,
      );
    });

    it('records a subscription change', async () => {
      const before = await count('billing.subscription_updated');
      const res = await server.patch('/billing/subscription', { seats: 5 }, auth(adminToken));
      expect(res.statusCode).toBe(200);
      expect(await count('billing.subscription_updated')).toBe(before + 1);
      expect((await latest('billing.subscription_updated'))?.metadata).toMatchObject({
        fields: ['seats'],
      });
    });

    it('records a personal access token being created, then revoked', async () => {
      const beforeCreate = await count('pat.created');
      // A session can only mint a token no stronger than itself, so the PAT asks
      // for a scope the admin token already holds.
      const created = await server.post(
        '/auth/personal-access-tokens',
        { name: 'ci', scopes: ['accounts--my:rw'] },
        auth(adminToken),
      );
      expect(created.statusCode).toBe(201);
      const { id } = created.json() as { id: string };

      expect(await count('pat.created')).toBe(beforeCreate + 1);
      const createEntry = await latest('pat.created');
      expect(createEntry?.target).toBe(`token:${id}`);
      expect((createEntry?.metadata as { scopes: string[] }).scopes).toContain('accounts--my:rw');

      const beforeRevoke = await count('pat.revoked');
      const revoked = await server.del(`/auth/personal-access-tokens/${id}`, auth(adminToken));
      expect(revoked.statusCode).toBe(204);
      expect(await count('pat.revoked')).toBe(beforeRevoke + 1);
      expect((await latest('pat.revoked'))?.target).toBe(`token:${id}`);
    });

    it('records a teammate being invited, then the invitation revoked', async () => {
      const before = await count('member.invited');
      const invited = await server.post(
        '/invitations',
        { emails: ['newbie@example.test'], role: 'agent' },
        auth(adminToken),
      );
      expect(invited.statusCode).toBe(201);
      const { items } = invited.json() as { items: Array<{ id: string }> };
      const invitationId = items[0]!.id;

      expect(await count('member.invited')).toBe(before + 1);
      const inviteEntry = await latest('member.invited');
      expect(inviteEntry?.target).toBe(`invitation:${invitationId}`);
      expect(inviteEntry?.metadata).toMatchObject({ role: 'agent' });

      const beforeRevoke = await count('member.invitation_revoked');
      const revoked = await server.del(`/invitations/${invitationId}`, auth(adminToken));
      expect(revoked.statusCode).toBe(204);
      expect(await count('member.invitation_revoked')).toBe(beforeRevoke + 1);
    });

    it("records a teammate's role change, once, with only the from/to roles", async () => {
      // The "rol değişimi" NFR-S12 names by hand. The owner promotes the seeded
      // agent to admin; exactly one entry lands, attributed to the actor, and its
      // metadata is the two roles and nothing else — never the whole membership.
      const before = await count('member.role_changed');
      const res = await server.put(
        `/agents/${fx.a.agentAccountId}/role`,
        { role: 'admin' },
        auth(adminToken),
      );
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: fx.a.agentAccountId, role: 'admin' });

      expect(await count('member.role_changed')).toBe(before + 1);
      const entry = await latest('member.role_changed');
      expect(entry?.actorId).toBe(fx.a.ownerAccountId);
      expect(entry?.actorType).toBe('agent');
      expect(entry?.target).toBe(`account:${fx.a.agentAccountId}`);
      expect(entry?.metadata).toMatchObject({ from: 'agent', to: 'admin' });
      expect((entry?.metadata as Record<string, unknown>).request_id).toBeTruthy();

      // A repeat request for the role the agent now holds is a no-op: no second,
      // misleading entry.
      const again = await server.put(
        `/agents/${fx.a.agentAccountId}/role`,
        { role: 'admin' },
        auth(adminToken),
      );
      expect(again.statusCode).toBe(200);
      expect(await count('member.role_changed')).toBe(before + 1);
    });

    it('records a successful workspace sign-in', async () => {
      const before = await count('auth.login');
      const res = await server.post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });
      expect(res.statusCode).toBe(200);

      expect(await count('auth.login')).toBe(before + 1);
      const entry = await latest('auth.login');
      expect(entry?.actorId).toBe(fx.a.ownerAccountId);
      expect(entry?.actorType).toBe('agent');
      expect(entry?.target).toBe(`client:${fx.a.clientId}`);
    });

    it('records a failed sign-in against the workspace, with no actor', async () => {
      const before = await count('auth.login_failed');
      const res = await server.post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
        email: fx.a.ownerEmail,
        password: 'wrong-password',
        license_id: fx.a.licenseId.toString(),
      });
      expect(res.statusCode).toBe(401);

      expect(await count('auth.login_failed')).toBe(before + 1);
      const entry = await latest('auth.login_failed');
      // Unknown actor: the attempt is real but we will not trust who it claimed
      // to be, so 'system' with no actor id.
      expect(entry?.actorType).toBe('system');
      expect(entry?.actorId).toBeNull();
      expect(entry?.metadata).toMatchObject({ reason: 'invalid_credentials' });
    });

    it('records a password reset, attributed to the account', async () => {
      const token = 'r'.repeat(43);
      await owner.passwordResetToken.create({
        data: {
          accountId: fx.a.ownerAccountId,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const before = await count('auth.password_reset');
      const res = await server.post('/auth/password-reset/confirm', {
        token,
        password: 'a-fresh-long-passphrase',
      });
      expect(res.statusCode).toBe(204);

      // The owner belongs to exactly one workspace here, so exactly one entry.
      expect(await count('auth.password_reset')).toBe(before + 1);
      const entry = await latest('auth.password_reset');
      expect(entry?.actorId).toBe(fx.a.ownerAccountId);
      expect(entry?.actorType).toBe('agent');
    });
  });

  // =========================================================================
  // Targeted settings-family deletes (data.deleted, 08.9.7-d)
  // =========================================================================

  describe('a targeted settings delete records exactly one data.deleted entry', () => {
    it('records a canned response being deleted (and not a no-op delete)', async () => {
      const response = await owner.cannedResponse.create({
        data: { licenseId: fx.a.licenseId, shortcut: 'audit-d', text: 'gone soon' },
        select: { id: true },
      });

      const before = await count('data.deleted');
      const removed = await server.del(
        `/settings/canned-responses/${response.id}`,
        auth(adminToken),
      );
      expect(removed.statusCode).toBe(204);
      expect(await count('data.deleted')).toBe(before + 1);
      const entry = await latest('data.deleted');
      expect(entry?.target).toBe(`canned_response:${response.id}`);
      expect(entry?.metadata).toMatchObject({ kind: 'canned_response' });
      // The deleted reply's own text never reaches the append-only log.
      expect(JSON.stringify(entry?.metadata)).not.toContain('gone soon');

      // A repeat delete matches nothing (404) and must not write an entry.
      const beforeMiss = await count('data.deleted');
      const miss = await server.del(
        `/settings/canned-responses/${response.id}`,
        auth(adminToken),
      );
      expect(miss.statusCode).toBe(404);
      expect(await count('data.deleted')).toBe(beforeMiss);
    });

    it('records a tag being deleted (and not a no-op delete)', async () => {
      const tag = await owner.tag.create({
        data: { licenseId: fx.a.licenseId, name: 'audit-d-tag' },
        select: { id: true },
      });

      const before = await count('data.deleted');
      const removed = await server.del(`/settings/tags/${tag.id}`, auth(adminToken));
      expect(removed.statusCode).toBe(204);
      expect(await count('data.deleted')).toBe(before + 1);
      const entry = await latest('data.deleted');
      expect(entry?.target).toBe(`tag:${tag.id}`);
      expect(entry?.metadata).toMatchObject({ kind: 'tag' });

      const beforeMiss = await count('data.deleted');
      const miss = await server.del(`/settings/tags/${tag.id}`, auth(adminToken));
      expect(miss.statusCode).toBe(404);
      expect(await count('data.deleted')).toBe(beforeMiss);
    });

    it('records a ticket rule being deleted (and not a no-op delete)', async () => {
      const rule = await owner.ticketRule.create({
        data: {
          licenseId: fx.a.licenseId,
          name: 'audit-d-rule',
          conditions: { source: 'email' },
          actions: { priority: 10 },
        },
        select: { id: true },
      });

      const before = await count('data.deleted');
      const removed = await server.del(`/settings/ticket-rules/${rule.id}`, auth(adminToken));
      expect(removed.statusCode).toBe(204);
      expect(await count('data.deleted')).toBe(before + 1);
      const entry = await latest('data.deleted');
      expect(entry?.target).toBe(`ticket_rule:${rule.id}`);
      expect(entry?.metadata).toMatchObject({ kind: 'ticket_rule' });

      const beforeMiss = await count('data.deleted');
      const miss = await server.del(`/settings/ticket-rules/${rule.id}`, auth(adminToken));
      expect(miss.statusCode).toBe(404);
      expect(await count('data.deleted')).toBe(beforeMiss);
    });

    it('records a ticket e-mail template being deleted (and not a no-op delete)', async () => {
      const template = await owner.ticketEmailTemplate.create({
        data: {
          licenseId: fx.a.licenseId,
          name: 'audit-d-template',
          subject: 'Re: {{ ticket.subject }}',
          body: 'Thanks for reaching out.',
        },
        select: { id: true },
      });

      const before = await count('data.deleted');
      const removed = await server.del(
        `/settings/ticket-email-templates/${template.id}`,
        auth(adminToken),
      );
      expect(removed.statusCode).toBe(204);
      expect(await count('data.deleted')).toBe(before + 1);
      const entry = await latest('data.deleted');
      expect(entry?.target).toBe(`ticket_email_template:${template.id}`);
      expect(entry?.metadata).toMatchObject({ kind: 'ticket_email_template' });
      // The deleted template's own text never reaches the append-only log.
      expect(JSON.stringify(entry?.metadata)).not.toContain('Thanks for reaching out');

      const beforeMiss = await count('data.deleted');
      const miss = await server.del(
        `/settings/ticket-email-templates/${template.id}`,
        auth(adminToken),
      );
      expect(miss.statusCode).toBe(404);
      expect(await count('data.deleted')).toBe(beforeMiss);
    });

    it('records a custom field being deleted (and not a no-op delete)', async () => {
      const field = await owner.customFieldDefinition.create({
        data: { licenseId: fx.a.licenseId, entity: 'ticket', label: 'audit-d-field', type: 'text' },
        select: { id: true },
      });

      const before = await count('data.deleted');
      const removed = await server.del(`/settings/custom-fields/${field.id}`, auth(adminToken));
      expect(removed.statusCode).toBe(204);
      expect(await count('data.deleted')).toBe(before + 1);
      const entry = await latest('data.deleted');
      expect(entry?.target).toBe(`custom_field:${field.id}`);
      expect(entry?.metadata).toMatchObject({ kind: 'custom_field' });

      const beforeMiss = await count('data.deleted');
      const miss = await server.del(`/settings/custom-fields/${field.id}`, auth(adminToken));
      expect(miss.statusCode).toBe(404);
      expect(await count('data.deleted')).toBe(beforeMiss);
    });

    it("a cross-tenant targeted delete writes to no one's log", async () => {
      const mine = await owner.cannedResponse.create({
        data: { licenseId: fx.a.licenseId, shortcut: 'audit-d-cross', text: 'tenant a only' },
        select: { id: true },
      });

      // A tenant-B admin holding the write scope aims at tenant A's record id.
      const tokenB = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['canned_responses--all:rw'],
      });

      const beforeA = await count('data.deleted', fx.a.licenseId);
      const beforeB = await count('data.deleted', fx.b.licenseId);
      const res = await server.del(`/settings/canned-responses/${mine.id}`, auth(tokenB));
      expect(res.statusCode).toBe(404);

      // RLS matched nothing, so neither log gained an entry — and A's record is
      // untouched, still there for its own owner to remove and record.
      expect(await count('data.deleted', fx.a.licenseId)).toBe(beforeA);
      expect(await count('data.deleted', fx.b.licenseId)).toBe(beforeB);
      const byOwner = await server.del(`/settings/canned-responses/${mine.id}`, auth(adminToken));
      expect(byOwner.statusCode).toBe(204);
      expect(await count('data.deleted', fx.a.licenseId)).toBe(beforeA + 1);
    });
  });

  // =========================================================================
  // Content and integration deletes (data.deleted, 08.9.7-e)
  // =========================================================================

  describe('a targeted content/integration delete records exactly one data.deleted entry', () => {
    it('records a website being deleted (and not a no-op delete)', async () => {
      const created = (
        await server.post('/websites', { domain: 'audit-e.example' }, auth(adminToken))
      ).json() as { id: string };

      const before = await count('data.deleted');
      const removed = await server.del(`/websites/${created.id}`, auth(adminToken));
      expect(removed.statusCode).toBe(204);
      expect(await count('data.deleted')).toBe(before + 1);
      const entry = await latest('data.deleted');
      expect(entry?.target).toBe(`website:${created.id}`);
      expect(entry?.metadata).toMatchObject({ kind: 'website' });

      const beforeMiss = await count('data.deleted');
      const miss = await server.del(`/websites/${created.id}`, auth(adminToken));
      expect(miss.statusCode).toBe(404);
      expect(await count('data.deleted')).toBe(beforeMiss);
    });

    it('records an AI-agent skill being deleted (and not a no-op delete)', async () => {
      const skill = (
        await server.post('/skills', { name: 'audit-e-skill' }, auth(adminToken))
      ).json() as { id: string };

      const before = await count('data.deleted');
      const removed = await server.del(`/skills/${skill.id}`, auth(adminToken));
      expect(removed.statusCode).toBe(204);
      expect(await count('data.deleted')).toBe(before + 1);
      const entry = await latest('data.deleted');
      expect(entry?.target).toBe(`skill:${skill.id}`);
      expect(entry?.metadata).toMatchObject({ kind: 'skill' });

      const beforeMiss = await count('data.deleted');
      const miss = await server.del(`/skills/${skill.id}`, auth(adminToken));
      expect(miss.statusCode).toBe(404);
      expect(await count('data.deleted')).toBe(beforeMiss);
    });

    it('records an AI-agent knowledge source being deleted (and not a no-op delete)', async () => {
      const agent = await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada' },
        select: { id: true },
      });
      const source = (
        await server.post(
          '/knowledge-sources',
          { ai_agent_id: agent.id, name: 'audit-e-source', type: 'article', content: 'gone soon' },
          auth(adminToken),
        )
      ).json() as { id: string };

      const before = await count('data.deleted');
      const removed = await server.del(`/knowledge-sources/${source.id}`, auth(adminToken));
      expect(removed.statusCode).toBe(204);
      expect(await count('data.deleted')).toBe(before + 1);
      const entry = await latest('data.deleted');
      expect(entry?.target).toBe(`knowledge_source:${source.id}`);
      expect(entry?.metadata).toMatchObject({ kind: 'knowledge_source' });
      // The deleted source's own text never reaches the append-only log.
      expect(JSON.stringify(entry?.metadata)).not.toContain('gone soon');

      const beforeMiss = await count('data.deleted');
      const miss = await server.del(`/knowledge-sources/${source.id}`, auth(adminToken));
      expect(miss.statusCode).toBe(404);
      expect(await count('data.deleted')).toBe(beforeMiss);
    });

    it('records a copilot knowledge source being deleted (and not a no-op delete)', async () => {
      const source = (
        await server.post(
          '/copilot/knowledge',
          { name: 'audit-e-copilot', content: 'gone soon too' },
          auth(adminToken),
        )
      ).json() as { id: string };

      const before = await count('data.deleted');
      const removed = await server.del(`/copilot/knowledge/${source.id}`, auth(adminToken));
      expect(removed.statusCode).toBe(204);
      expect(await count('data.deleted')).toBe(before + 1);
      const entry = await latest('data.deleted');
      expect(entry?.target).toBe(`copilot_source:${source.id}`);
      expect(entry?.metadata).toMatchObject({ kind: 'copilot_source' });
      expect(JSON.stringify(entry?.metadata)).not.toContain('gone soon too');

      const beforeMiss = await count('data.deleted');
      const miss = await server.del(`/copilot/knowledge/${source.id}`, auth(adminToken));
      expect(miss.statusCode).toBe(404);
      expect(await count('data.deleted')).toBe(beforeMiss);
    });

    it('records an app being disconnected (and not a no-op disconnect)', async () => {
      const APP = 'hubspot';
      const started = await server.post(`/settings/apps/${APP}/oauth/start`, {}, auth(adminToken));
      expect(started.statusCode).toBe(200);
      const { state } = started.json() as { state: string };
      const connected = await server.post(
        `/settings/apps/${APP}/oauth/callback`,
        { state, code: 'mock-auth-code' },
        auth(adminToken),
      );
      expect(connected.statusCode).toBe(200);

      const before = await count('data.deleted');
      const removed = await server.del(`/settings/apps/${APP}`, auth(adminToken));
      expect(removed.statusCode).toBe(204);
      expect(await count('data.deleted')).toBe(before + 1);
      const entry = await latest('data.deleted');
      expect(entry?.target).toBe(`app_installation:${APP}`);
      expect(entry?.metadata).toMatchObject({ kind: 'app_installation' });

      const beforeMiss = await count('data.deleted');
      const miss = await server.del(`/settings/apps/${APP}`, auth(adminToken));
      expect(miss.statusCode).toBe(404);
      expect(await count('data.deleted')).toBe(beforeMiss);
    });

    it("a cross-tenant content delete writes to no one's log", async () => {
      const mine = (
        await server.post('/websites', { domain: 'audit-e-cross.example' }, auth(adminToken))
      ).json() as { id: string };

      // A tenant-B admin holding the write scope aims at tenant A's record id.
      const tokenB = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['access_rules:rw'],
      });

      const beforeA = await count('data.deleted', fx.a.licenseId);
      const beforeB = await count('data.deleted', fx.b.licenseId);
      const res = await server.del(`/websites/${mine.id}`, auth(tokenB));
      expect(res.statusCode).toBe(404);

      // RLS matched nothing, so neither log gained an entry — and A's record is
      // untouched, still there for its own owner to remove and record.
      expect(await count('data.deleted', fx.a.licenseId)).toBe(beforeA);
      expect(await count('data.deleted', fx.b.licenseId)).toBe(beforeB);
      const byOwner = await server.del(`/websites/${mine.id}`, auth(adminToken));
      expect(byOwner.statusCode).toBe(204);
      expect(await count('data.deleted', fx.a.licenseId)).toBe(beforeA + 1);
    });
  });

  // =========================================================================
  // Append-only, enforced by the database
  // =========================================================================

  describe('the log cannot be rewritten', () => {
    async function seedEntry(): Promise<string> {
      const res = await server.post(
        '/settings/trusted-domains',
        { domain: 'tamper.example' },
        auth(adminToken),
      );
      const row = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, action: 'settings.trusted_domain_added' },
        orderBy: { createdAt: 'desc' },
      });
      expect(res.statusCode).toBe(201);
      return row!.id;
    }

    it('refuses UPDATE from the application role', async () => {
      const id = await seedEntry();
      await expect(
        withTenant(
          appRole,
          contextA(),
          (tx) => tx.$executeRaw`UPDATE audit_log SET action = 'tampered' WHERE id = ${id}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/i);

      const after = await owner.auditLogEntry.findUnique({ where: { id } });
      expect(after?.action).toBe('settings.trusted_domain_added');
    });

    it('refuses DELETE from the application role', async () => {
      const id = await seedEntry();
      await expect(
        withTenant(
          appRole,
          contextA(),
          (tx) => tx.$executeRaw`DELETE FROM audit_log WHERE id = ${id}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/i);

      expect(await owner.auditLogEntry.findUnique({ where: { id } })).not.toBeNull();
    });

    it('refuses an insert with no tenant context — fail closed', async () => {
      await expect(
        appRole.$executeRaw`INSERT INTO audit_log (id, license_id, action)
          VALUES (gen_random_uuid(), ${fx.a.licenseId}, 'sneaky')`,
      ).rejects.toThrow(/row-level security/i);
    });

    it("refuses to write an entry into another tenant's log", async () => {
      // Tenant A's context is set, but the row claims tenant B's licence. The
      // INSERT policy's WITH CHECK rejects it — an actor cannot plant a record
      // in a workspace that is not theirs.
      await expect(
        withTenant(appRole, contextA(), (tx) =>
          writeAuditEntry(tx, { licenseId: fx.b.licenseId }, { action: 'auth.login' }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  // =========================================================================
  // The 30-day retention window (NFR-S12) does not weaken append-only
  //
  // Pruning old entries is the one delete the log allows, and only through the
  // SECURITY DEFINER `audit_prune_expired`. These tests sit next to "the log
  // cannot be rewritten" to show that adding that hole left the append-only
  // guarantee intact: the function respects the window, refuses a wiping cutoff,
  // and never becomes a table-level DELETE for the application role.
  // =========================================================================

  describe('pruning does not make the log writable', () => {
    const DAY = 86_400_000;
    const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

    async function seedAt(licenseId: bigint, createdAt: Date): Promise<string> {
      const row = await owner.auditLogEntry.create({
        data: { licenseId, actorType: 'system', action: 'auth.login', metadata: {}, createdAt },
        select: { id: true },
      });
      return row.id;
    }

    it('prunes only rows past the cutoff, through the one guarded function', async () => {
      const old = await seedAt(fx.a.licenseId, daysAgo(40));
      const recent = await seedAt(fx.a.licenseId, daysAgo(1));

      const rows = await appRole.$queryRaw<Array<{ n: bigint }>>`
        SELECT audit_prune_expired(${fx.a.licenseId}, ${daysAgo(30)}) AS n`;
      expect(Number(rows[0]?.n)).toBe(1);

      // Past the window is gone; the last 30 days are untouched.
      expect(await owner.auditLogEntry.findUnique({ where: { id: old } })).toBeNull();
      expect(await owner.auditLogEntry.findUnique({ where: { id: recent } })).not.toBeNull();
    });

    it('cannot be used to erase the live log: a non-past cutoff is refused', async () => {
      const recent = await seedAt(fx.a.licenseId, daysAgo(1));
      // now() and null both raise — there is no argument that selects live rows.
      await expect(
        appRole.$queryRaw`SELECT audit_prune_expired(${fx.a.licenseId}, now()) AS n`,
      ).rejects.toThrow();
      await expect(
        appRole.$queryRaw`SELECT audit_prune_expired(${fx.a.licenseId}, NULL::timestamptz) AS n`,
      ).rejects.toThrow();
      expect(await owner.auditLogEntry.findUnique({ where: { id: recent } })).not.toBeNull();
    });

    it('leaves the table-level DELETE revoke intact — nexa_app still cannot delete', async () => {
      const old = await seedAt(fx.a.licenseId, daysAgo(40));
      // Even a row the function would prune cannot be removed by a direct DELETE:
      // the append-only grant is unchanged; the function is the only door.
      await expect(
        withTenant(
          appRole,
          contextA(),
          (tx) => tx.$executeRaw`DELETE FROM audit_log WHERE id = ${old}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/i);
      expect(await owner.auditLogEntry.findUnique({ where: { id: old } })).not.toBeNull();
    });
  });

  // =========================================================================
  // Cross-tenant invisibility (mandatory negative test)
  // =========================================================================

  describe('one tenant never sees another tenant’s trail', () => {
    it('hides tenant B entries from a tenant A reader', async () => {
      // A real entry in B's log, written as the owner (who bypasses RLS).
      await owner.auditLogEntry.create({
        data: {
          licenseId: fx.b.licenseId,
          actorType: 'system',
          action: 'auth.login',
          metadata: {},
        },
      });
      // And a genuine entry in A's log, through the API.
      await server.post(
        '/settings/trusted-domains',
        { domain: 'a-only.example' },
        auth(adminToken),
      );

      const visibleToA = await withTenant(appRole, contextA(), (tx) =>
        tx.auditLogEntry.findMany({ select: { licenseId: true } }),
      );
      expect(visibleToA.length).toBeGreaterThan(0);
      expect(visibleToA.every((e) => e.licenseId === fx.a.licenseId)).toBe(true);

      // And by id: B's entry is invisible even when asked for directly (IDOR).
      const bEntry = await owner.auditLogEntry.findFirst({ where: { licenseId: fx.b.licenseId } });
      const reached = await withTenant(appRole, contextA(), (tx) =>
        tx.auditLogEntry.findUnique({ where: { id: bEntry!.id } }),
      );
      expect(reached).toBeNull();
    });
  });

  // =========================================================================
  // No credential or unverified PII is ever written
  // =========================================================================

  describe('secrets and unverified PII never reach the log', () => {
    it('stores neither the password, the token, nor the attempted address', async () => {
      // A created PAT (its plaintext), a good login and a bad login — every path
      // that handles a secret or an address.
      const created = await server.post(
        '/auth/personal-access-tokens',
        { name: 'ci', scopes: ['accounts--my:rw'] },
        auth(adminToken),
      );
      expect(created.statusCode).toBe(201);
      const { token: patPlaintext } = created.json() as { token: string };

      await server.post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
        email: fx.a.ownerEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });

      const attemptedEmail = 'attacker@example.test';
      await server.post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
        email: attemptedEmail,
        password: 'nope',
        license_id: fx.a.licenseId.toString(),
      });

      const entries = await owner.auditLogEntry.findMany({ where: { licenseId: fx.a.licenseId } });
      // Serialise only the fields a caller controls; licenseId is a bigint and
      // not part of what could leak.
      const haystack = JSON.stringify(
        entries.map((e) => ({ target: e.target, metadata: e.metadata })),
      );

      expect(entries.length).toBeGreaterThan(0);
      expect(haystack).not.toContain(TEST_PASSWORD);
      expect(haystack).not.toContain(patPlaintext);
      // The failed-login address belonged to whoever was typed, not the
      // workspace, so it is never recorded.
      expect(haystack).not.toContain(attemptedEmail);
    });
  });

  // =========================================================================
  // NFR-S12 end-to-end verification (08.9.7-k)
  //
  // The slices above each proved one piece: a writer per action, a reader, a
  // 30-day prune. This block proves the *whole* NFR-S12 claim as one story,
  // against the code rather than by assumption:
  //
  //   "Temel audit (login, rol değişimi, veri silme, webhook değişimi, son 30
  //    gün) tüm planlarda."
  //
  // — the four named event families all reach one read of the trail; the trail
  // is written and read the same on a trial and on a paid licence (there is no
  // plan gate to lift — none was ever built); the 30-day window survives a
  // prune through the reader; and none of it leaks across tenants. The
  // Enterprise-only "extended + SIEM" clause is deliberately NOT built here
  // (no entitlement mechanism exists — a separate item).
  // =========================================================================

  describe('the four NFR-S12 families, all plans, one trail', () => {
    const WEBHOOK_URL = 'https://hooks.s12.example/receiver';

    /** An owner-role reader token with the audit read scope, per tenant. */
    const readerToken = (t: { licenseId: bigint; organizationId: string; ownerAccountId: string }) =>
      grantToken(owner, {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        ownerId: t.ownerAccountId,
        scopes: ['audit_log--all:ro'],
      });

    /** Sign a tenant's owner in through the real /auth/authorize path. */
    const signIn = (t: {
      clientId: string;
      redirectUri: string;
      ownerEmail: string;
      licenseId: bigint;
    }) =>
      server.post('/auth/authorize', {
        client_id: t.clientId,
        redirect_uri: t.redirectUri,
        code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
        email: t.ownerEmail,
        password: TEST_PASSWORD,
        license_id: t.licenseId.toString(),
      });

    const actionsOf = (res: { json: () => unknown }) =>
      (res.json() as { items: Array<{ action: string }> }).items.map((e) => e.action);

    const FOUR_FAMILIES = [
      'auth.login', // login
      'member.role_changed', // rol değişimi
      'webhook.created', // webhook değişimi …
      'webhook.deleted', // … (both halves)
      'data.deleted', // veri silme
    ] as const;

    /** Produce all four NFR-S12 families in one tenant, via the API. */
    async function produceFourFamilies(
      t: {
        clientId: string;
        redirectUri: string;
        ownerEmail: string;
        licenseId: bigint;
        agentAccountId: string;
      },
      token: string,
    ): Promise<void> {
      expect((await signIn(t)).statusCode).toBe(200);

      const role = await server.put(`/agents/${t.agentAccountId}/role`, { role: 'admin' }, auth(token));
      expect(role.statusCode).toBe(200);

      const created = (
        await server.post('/webhooks', { url: WEBHOOK_URL, action: 'chat_started' }, auth(token))
      ).json() as { id: string };
      expect((await server.del(`/webhooks/${created.id}`, auth(token))).statusCode).toBe(204);

      const tag = await owner.tag.create({
        data: { licenseId: t.licenseId, name: `s12-${t.licenseId}` },
        select: { id: true },
      });
      expect((await server.del(`/settings/tags/${tag.id}`, auth(token))).statusCode).toBe(204);
    }

    it('surfaces login, role change, webhook change and data deletion in one read', async () => {
      // The adminToken from beforeEach holds every write scope these four use.
      await produceFourFamilies(fx.a, adminToken);

      const res = await server.get('/audit-log', auth(await readerToken(fx.a)));
      expect(res.statusCode).toBe(200);
      // Every family NFR-S12 names by hand is present, under the exact action.
      expect(actionsOf(res)).toEqual(expect.arrayContaining([...FOUR_FAMILIES]));
    });

    it('writes the trail on a trial and on a paid licence alike — no plan gate', async () => {
      // Fixtures ship both tenants as a trial. Turn B into a paid, active
      // subscription on a different plan label — 'enterprise', the very tier the
      // source platform reserves audit behind. NFR-S12 puts basic audit on
      // *every* plan, so the writer must consult neither license.plan nor
      // license.status. Written through the owner connection on purpose: it
      // bypasses the single-plan subscription validator, and `plan` is a
      // free-form column.
      await owner.license.update({
        where: { id: fx.b.licenseId },
        data: { plan: 'enterprise', status: 'active', trialEndsAt: null },
      });
      expect(
        await owner.license.findUnique({
          where: { id: fx.b.licenseId },
          select: { plan: true, status: true },
        }),
      ).toMatchObject({ plan: 'enterprise', status: 'active' });

      const beforeA = await count('auth.login', fx.a.licenseId);
      const beforeB = await count('auth.login', fx.b.licenseId);

      // Each workspace's owner signs in — the trial and the paid licence.
      expect((await signIn(fx.a)).statusCode).toBe(200);
      expect((await signIn(fx.b)).statusCode).toBe(200);

      // Both trails gained exactly one sign-in: the plan changed nothing.
      expect(await count('auth.login', fx.a.licenseId)).toBe(beforeA + 1);
      expect(await count('auth.login', fx.b.licenseId)).toBe(beforeB + 1);
    });

    it("a reader never sees another tenant's four events", async () => {
      // Produce all four families in tenant B, as B's owner.
      const bAdmin = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['agents--all:rw', 'webhooks--all:rw', 'tags--all:rw'],
      });
      await produceFourFamilies(fx.b, bAdmin);

      // Tenant A produced nothing here, so its reader's trail holds none of B's
      // families — RLS confines the read, not a clause the reader could forget.
      const inA = actionsOf(await server.get('/audit-log', auth(await readerToken(fx.a))));
      for (const family of FOUR_FAMILIES) expect(inA).not.toContain(family);

      // And B's own reader does see them — proof the events were really written,
      // not merely absent everywhere.
      const inB = actionsOf(await server.get('/audit-log', auth(await readerToken(fx.b))));
      expect(inB).toEqual(expect.arrayContaining([...FOUR_FAMILIES]));
    });

    it('after pruning, the reader shows the last 30 days and not older entries', async () => {
      const DAY = 86_400_000;
      const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

      // One entry a day past the 30-day window, one a day inside it.
      const stale = await owner.auditLogEntry.create({
        data: {
          licenseId: fx.a.licenseId,
          actorType: 'system',
          action: 'auth.login',
          target: 'token:stale',
          metadata: {},
          createdAt: daysAgo(31),
        },
        select: { id: true },
      });
      const kept = await owner.auditLogEntry.create({
        data: {
          licenseId: fx.a.licenseId,
          actorType: 'system',
          action: 'auth.login',
          target: 'token:kept',
          metadata: {},
          createdAt: daysAgo(29),
        },
        select: { id: true },
      });

      // Retention prunes everything older than 30 days, through the one guarded
      // door the append-only log allows.
      const pruned = await appRole.$queryRaw<Array<{ n: bigint }>>`
        SELECT audit_prune_expired(${fx.a.licenseId}, ${daysAgo(30)}) AS n`;
      expect(Number(pruned[0]?.n)).toBe(1);

      // The reader, defaulting to the last 30 days, shows the 29-day entry and
      // never the 31-day one — which pruning has now physically removed as well.
      const res = await server.get('/audit-log', auth(await readerToken(fx.a)));
      expect(res.statusCode).toBe(200);
      const targets = (res.json() as { items: Array<{ target: string | null }> }).items.map(
        (e) => e.target,
      );
      expect(targets).toContain('token:kept');
      expect(targets).not.toContain('token:stale');

      expect(await owner.auditLogEntry.findUnique({ where: { id: stale.id } })).toBeNull();
      expect(await owner.auditLogEntry.findUnique({ where: { id: kept.id } })).not.toBeNull();
    });
  });
});
