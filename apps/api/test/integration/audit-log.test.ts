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
});
