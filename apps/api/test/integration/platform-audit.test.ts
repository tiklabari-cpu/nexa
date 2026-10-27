/**
 * The root panel's audit chain (tm 389.5 · FR-ADMIN-05/06 ·
 * docs/platform-admin/design.md §B2, §C audit).
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no test title carries one as a
 * requirement tag (CONVENTIONS §7.3); the letters (a)–(f) are the task's
 * acceptance list.
 */
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadPlatformOpenApiDocument } from '@siyahtus/contract';
import { derivePlatformKey } from '../../src/lib/platform-keys.js';
import { generateTotp, generateTotpSecret } from '../../src/lib/totp.js';
import { buildPlatformServer, PLATFORM_PREFIX } from '../../src/platform-server.js';
import {
  deriveChainKey,
  verifyAuditChain,
  verifyExportSignature,
} from '../../src/services/audit/audit-chain.js';
import { checkPlatformExport } from '../../src/services/platform/audit-export-check.js';
import { PLATFORM_AUDIT_ACTIONS } from '../../src/services/platform/platform-audit.js';
import {
  grantToken,
  ownerClient,
  platformClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import {
  bearer,
  createOperator,
  nextCode,
  platformSettingsKey,
  TestClock,
  type TestOperator,
} from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { HTTP_METHODS } from '../helpers/route-inventory.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const CHAIN_SECRET = testEnv().AUDIT_CHAIN_SECRET;
const PLATFORM_KEY = Buffer.from(derivePlatformKey(platformSettingsKey(), 'auditChain'), 'hex');
const reason = { reason: 'tm 389.5 test' };

function errorType(response: LightMyRequestResponse): string | undefined {
  try {
    return (response.json() as { error?: { type?: string } }).error?.type;
  } catch {
    return undefined;
  }
}

/** Every mutation the contract documents, with the entry it says it writes. */
function documentedMutations(): Array<{
  where: string;
  audit: string | undefined;
  safe: boolean;
}> {
  const out = [];
  for (const [path, item] of Object.entries(loadPlatformOpenApiDocument().paths)) {
    for (const method of HTTP_METHODS) {
      const op = (item as Record<string, Record<string, unknown> | undefined>)[method];
      if (!op || method === 'get') continue;
      out.push({
        where: `${method.toUpperCase()} ${path}`,
        audit: op['x-platform-audit'] as string | undefined,
        safe: op['x-platform-safe'] === true,
      });
    }
  }
  return out;
}

const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

describe('the platform audit chain (tm 389.5)', () => {
  let platform: PlatformTestServer;
  let tenant: TestServer;
  let db: PrismaClient;
  let clock: TestClock;
  let mailer: MemoryMailer;
  let fx: Fixtures;

  const request = (
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<LightMyRequestResponse> =>
    platform.app.inject({
      method: method.toUpperCase() as 'GET',
      url: `${PLATFORM_PREFIX}${path}`,
      headers: options.token ? bearer(options.token) : {},
      ...(options.body === undefined ? {} : { payload: options.body as object }),
    });

  async function signIn(operator: TestOperator): Promise<string> {
    const login = await request('POST', '/auth/login', {
      body: { email: operator.email, password: operator.password },
    });
    expect(login.statusCode, login.body).toBe(200);
    const verify = await request('POST', '/auth/totp/verify', {
      token: login.json().token,
      body: { code: nextCode(operator, clock) },
    });
    expect(verify.statusCode, verify.body).toBe(200);
    return verify.json().token as string;
  }

  const entries = () => owner.platformAuditLog.findMany({ orderBy: { chainSeq: 'asc' } });
  const verify = async (token: string) => {
    const response = await request('POST', '/audit/verify', { token });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as {
      ok: boolean;
      checked: number;
      head_seq: string | null;
      findings: Array<{ kind: string; seq: string | null }>;
    };
  };

  /** Edit the append-only table as its owner — the attacker this chain is for. */
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

  beforeAll(async () => {
    db = platformClient();
    clock = new TestClock();
    mailer = new MemoryMailer();
    platform = await buildPlatformTestServer({}, { now: clock.read, mailer });
    tenant = await startTestServer();
  });

  afterAll(async () => {
    await platform?.close();
    await tenant?.close();
    await db?.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(tenant.app);
    const keys = await platform.app.redis.keys('rl:*');
    if (keys.length > 0) await platform.app.redis.del(...keys);
    mailer.clear();
  });

  it('(a) refuses an operator mutation without a reason, writes nothing, and changes nothing', async () => {
    const superadmin = await createOperator(db, { clock });
    const target = await createOperator(db, { role: 'support', clock });
    const token = await signIn(superadmin);
    const before = await owner.platformAuditLog.count();

    for (const body of [{}, { reason: '  ' }, { reason: 'no' }, { reason: 'x'.repeat(501) }]) {
      const refused = await request('POST', `/admins/${target.id}/disable`, { token, body });
      expect(refused.statusCode, refused.body).toBe(400);
      expect(errorType(refused)).toBe('platform_reason_required');
    }
    expect(await owner.platformAuditLog.count()).toBe(before);
    expect(
      (await owner.platformAdmin.findUniqueOrThrow({ where: { id: target.id } })).disabledAt,
    ).toBeNull();

    const done = await request('POST', `/admins/${target.id}/disable`, {
      token,
      body: { reason: '  left the company  ' },
    });
    expect(done.statusCode, done.body).toBe(200);
    expect((await entries()).at(-1)).toMatchObject({
      action: 'admin.disabled',
      adminId: superadmin.id,
      targetType: 'admin',
      targetId: target.id,
      reason: 'left the company',
      licenseId: null,
    });

    // The operator's own session needs no reason, only a record.
    const out = await request('POST', '/auth/logout', { token });
    expect(out.statusCode).toBe(204);
    expect((await entries()).at(-1)).toMatchObject({
      action: 'admin.signed_out',
      reason: null,
      targetType: 'session',
    });
  });

  it('(b) every mutation of the sign-in and operator routes writes the entry the contract names; refusals are recorded too', async () => {
    const superadmin = await createOperator(db, { clock });
    const failed = await request('POST', '/auth/login', {
      body: { email: superadmin.email, password: 'not-the-password' },
    });
    expect(failed.statusCode).toBe(401);

    const login = await request('POST', '/auth/login', {
      body: { email: superadmin.email, password: superadmin.password },
    });
    const passwordToken = login.json().token as string;
    const wrong = await request('POST', '/auth/totp/verify', {
      token: passwordToken,
      body: { code: '000000' },
    });
    expect(wrong.statusCode).toBe(401);
    const verified = await request('POST', '/auth/totp/verify', {
      token: passwordToken,
      body: { code: nextCode(superadmin, clock) },
    });
    const token = verified.json().token as string;

    const ok = (response: LightMyRequestResponse) => {
      expect(response.statusCode, response.body).toBeLessThan(300);
      return response;
    };
    ok(
      await request('POST', '/auth/totp/reverify', {
        token,
        body: { code: nextCode(superadmin, clock) },
      }),
    );
    ok(await request('POST', '/auth/recovery/regenerate', { token }));

    // An invitation, accepted, enrolled.
    ok(
      await request('POST', '/admins/invites', {
        token,
        body: { email: 'invited@ops.siyahtus.test', role: 'support', ...reason },
      }),
    );
    const mail = mailer.sent.find((m) => m.kind === 'platform_invitation')!;
    const inviteToken = /#token=([A-Za-z0-9_-]+)/.exec(mail.body)![1]!;
    const accepted = ok(
      await request('POST', '/auth/invite/accept', {
        body: { token: inviteToken, password: 'a-good-long-operator-password' },
      }),
    );
    const pending = accepted.json().token as string;
    const enroll = ok(await request('POST', '/auth/totp/enroll', { token: pending }));
    clock.advance(30_000);
    const activated = ok(
      await request('POST', '/auth/totp/activate', {
        token: pending,
        body: { code: generateTotp(enroll.json().secret as string, clock.now) },
      }),
    );
    const newcomer = (
      await owner.platformAdmin.findUniqueOrThrow({
        where: { email: 'invited@ops.siyahtus.test' },
      })
    ).id;
    expect(activated.json().token).toBeTruthy();

    // A second invitation, withdrawn.
    const second = ok(
      await request('POST', '/admins/invites', {
        token,
        body: { email: 'second@ops.siyahtus.test', role: 'billing', ...reason },
      }),
    );
    const secondId = second.json().invite.id as string;
    ok(await request('POST', `/admins/invites/${secondId}/revoke`, { token, body: reason }));

    // Every operator-management action on the newcomer.
    ok(
      await request('POST', `/admins/${newcomer}/role`, {
        token,
        body: { role: 'billing', ...reason },
      }),
    );
    ok(await request('POST', `/admins/${newcomer}/disable`, { token, body: reason }));
    ok(await request('POST', `/admins/${newcomer}/enable`, { token, body: reason }));
    ok(await request('POST', `/admins/${newcomer}/reset-two-factor`, { token, body: reason }));
    ok(await request('POST', `/admins/${newcomer}/revoke-sessions`, { token, body: reason }));

    // A workspace note (tm 389.9).
    ok(
      await request('POST', `/workspaces/${fx.a.licenseId}/notes`, {
        token,
        body: { body: 'Prefers email.', ...reason },
      }),
    );

    // Every workspace action (tm 389.10), each from a state it changes.
    const ws = `/workspaces/${fx.a.licenseId}`;
    const action = (path: string, body: Record<string, unknown> = {}, method = 'POST') =>
      request(method, `${ws}/${path}`, { token, body: { ...body, ...reason } });
    ok(await action('extend-trial', { days: 3 }));
    ok(await action('activate'));
    ok(await action('set-read-only'));
    ok(await action('set-active'));
    ok(await action('set-plan', { plan: 'enterprise' }));
    ok(await action('subscription/cancel'));
    ok(await action('subscription/resume'));
    ok(await action('overrides', { seat_ceiling: 50 }, 'PUT'));
    await owner.account.update({
      where: { id: fx.a.ownerAccountId },
      data: { emailVerifiedAt: null },
    });
    ok(await action('resend-owner-verification'));
    await owner.$queryRaw`SELECT created_license FROM sandbox_create(${fx.a.licenseId}, ${fx.a.ownerAccountId}::uuid)`;
    ok(await action('sandbox/reset'));
    // The destructive half wants a code younger than five minutes.
    ok(
      await request('POST', '/auth/totp/reverify', {
        token,
        body: { code: nextCode(superadmin, clock) },
      }),
    );
    ok(await action('suspend'));
    ok(await action('unsuspend'));
    ok(
      await action('force-ownership-transfer', {
        to_account_id: fx.a.agentAccountId,
        verification_checklist: { ticket_id: 'SUP-1', signed_request: true, phone_verified: true },
      }),
    );
    const { name } = await owner.organization.findUniqueOrThrow({
      where: { id: fx.a.organizationId },
    });
    ok(await action('delete', { confirm_name: name }));
    ok(await action('delete/cancel'));

    // Every account action (tm 389.11), on B's agent — A's agent owns A by now.
    const person = fx.b.agentAccountId;
    const onAccount = (path: string, body: Record<string, unknown> = {}) =>
      request('POST', `/accounts/${person}/${path}`, { token, body: { ...body, ...reason } });
    await owner.account.update({ where: { id: person }, data: { emailVerifiedAt: null } });
    ok(await onAccount('resend-verification'));
    ok(await onAccount('force-password-reset'));
    await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: person,
      scopes: ['chats--all:ro'],
      kind: 'oauth',
    });
    ok(await onAccount('revoke-sessions'));
    await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: person,
      scopes: ['chats--all:ro'],
    });
    ok(await onAccount('revoke-tokens'));
    await owner.accountTwoFactor.create({
      data: { accountId: person, secret: generateTotpSecret(), activatedAt: new Date() },
    });
    ok(await onAccount('reset-two-factor'));
    ok(await onAccount('suspend'));
    ok(await onAccount('unsuspend'));
    ok(await onAccount('export'));
    ok(await onAccount('erase', { confirm_email: fx.b.agentEmail }));

    // The deployment settings (tm 389.13): a change, and maintenance on and off again.
    ok(await request('PATCH', '/settings', { token, body: { trial_days: 21, ...reason } }));
    const maintenance = (enabled: boolean) =>
      request('PUT', '/settings/maintenance', {
        token,
        body: { enabled, mode: 'read_only', ...reason },
      });
    ok(await maintenance(true));
    ok(await maintenance(false));
    // The Operations page's three mutations (tm 389.14). No scheduler is listening in this
    // suite, so the run request is answered `no_listener` — and recorded all the same.
    ok(await request('POST', '/operations/scheduler/sla/run', { token, body: reason }));
    ok(await request('POST', '/operations/partitions/ensure', { token, body: reason }));
    ok(
      await request('POST', '/auth/totp/reverify', {
        token,
        body: { code: nextCode(superadmin, clock) },
      }),
    );
    ok(await request('POST', '/operations/unverified-signups/purge', { token, body: reason }));
    // The AI settings' three (tm 389.17): a change (the stub — no key to keep out of the
    // trail), a connection test and a re-embedding, waited for so the suite closes on it.
    ok(
      await request('PUT', '/settings/ai', {
        token,
        body: { llm: { provider: 'mock' }, ...reason },
      }),
    );
    ok(
      await request('POST', '/settings/ai/test-connection', {
        token,
        body: { target: 'llm', ...reason },
      }),
    );
    ok(await request('POST', '/settings/ai/reembed', { token, body: reason }));
    await platform.app.platformAiOperations.idle();

    // The Security page's two (tm 389.16): a block, then lifting it.
    const blocked = ok(
      await request('POST', '/security/blocklist', {
        token,
        body: { kind: 'domain', value: 'audit-chain.test', ...reason },
      }),
    );
    ok(
      await request('DELETE', `/security/blocklist/${blocked.json().id as string}`, {
        token,
        body: reason,
      }),
    );

    // "Enter as the customer" (tm 389.15), opened and ended — on B's owner: A is suspended by now
    // (cancelling a deletion keeps the suspension), and nobody can be entered as in it.
    const impersonation = ok(
      await request('POST', '/support/impersonations', {
        token,
        body: {
          license_id: fx.b.licenseId.toString(),
          account_id: fx.b.ownerAccountId,
          mode: 'read_only',
          ...reason,
        },
      }),
    ).json() as { impersonation: { id: string } };
    ok(
      await request('POST', `/support/impersonations/${impersonation.impersonation.id}/end`, {
        token,
        body: reason,
      }),
    );

    // The superadmin's own sessions.
    ok(await request('DELETE', '/auth/sessions', { token }));
    ok(await request('POST', '/auth/logout', { token }));

    const trail = await entries();
    const actions = new Set(trail.map((entry) => entry.action));
    const documented = documentedMutations()
      .map((op) => op.audit)
      .filter((action): action is string => action !== undefined);
    expect(documented.length).toBeGreaterThanOrEqual(16);
    for (const action of documented) expect(actions, action).toContain(action);
    expect(actions).toContain('admin.sign_in_failed');
    expect(actions).toContain('admin.totp_failed');

    // Positions are gapless from 1, and each entry is who did what to whom.
    expect(trail.map((entry) => entry.chainSeq)).toEqual(trail.map((_, i) => BigInt(i + 1)));
    const by = (action: string) => trail.find((entry) => entry.action === action)!;
    expect(by('admin.sign_in_failed')).toMatchObject({
      adminId: null,
      targetId: null,
      reason: null,
    });
    expect(by('admin.signed_in')).toMatchObject({
      adminId: superadmin.id,
      targetId: superadmin.id,
    });
    expect(by('admin.totp_failed')).toMatchObject({
      adminId: superadmin.id,
      payload: { step: 'verify' },
    });
    expect(by('admin.totp_verified').payload).toEqual({ method: 'totp' });
    expect(by('admin.invite_accepted')).toMatchObject({ adminId: newcomer, targetId: newcomer });
    expect(by('admin.invited')).toMatchObject({
      targetType: 'invite',
      reason: 'tm 389.5 test',
      payload: { email: 'invited@ops.siyahtus.test', role: 'support', mail: 'sent' },
    });
    expect(by('admin.invite_revoked')).toMatchObject({ targetId: secondId });
    expect(by('admin.role_changed')).toMatchObject({
      targetId: newcomer,
      payload: { from: 'support', to: 'billing' },
    });
    for (const entry of trail) {
      expect(entry.ip, entry.action).toBeTruthy();
      expect(JSON.stringify(entry.payload), entry.action).not.toMatch(/password|secret|token/i);
    }
    // No secret anywhere in the trail: not the invitation token, not a code.
    expect(
      JSON.stringify(
        trail.map((e) => ({ ...e, chainSeq: String(e.chainSeq), licenseId: String(e.licenseId) })),
      ),
    ).not.toContain(inviteToken);
  });

  it('(c) verify is green on an intact chain and names the position of every edit, deletion and relink', async () => {
    const superadmin = await createOperator(db, { clock });
    const reader = await createOperator(db, { role: 'readonly', clock });
    const token = await signIn(superadmin);
    for (let i = 0; i < 3; i++) {
      await request('POST', `/admins/${reader.id}/revoke-sessions`, { token, body: reason });
    }
    // The readonly role may verify: it is an auditor's question, and changes nothing.
    const readerToken = await signIn(reader);
    const count = await owner.platformAuditLog.count();

    const intact = await verify(readerToken);
    expect(intact).toMatchObject({ ok: true, findings: [] });
    expect(intact.checked).toBe(count); // verify itself writes nothing
    expect(intact.head_seq).toBe(String(intact.checked));

    // An edited payload: that entry's hash, and only that position.
    await tamper(`UPDATE platform_audit_log SET payload = '{"ended":99}' WHERE chain_seq = 3`);
    const edited = await verify(readerToken);
    expect(edited.ok).toBe(false);
    expect(edited.findings).toEqual([expect.objectContaining({ kind: 'hash_mismatch', seq: '3' })]);

    // A removed entry: the gap, at the first missing position.
    await tamper('DELETE FROM platform_audit_log WHERE chain_seq = 5');
    const removed = await verify(readerToken);
    expect(removed.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'sequence_gap', seq: '5' })]),
    );

    // A removed tail leaves nothing to break — the head says it.
    const last = (await entries()).at(-1)!.chainSeq;
    await tamper(`DELETE FROM platform_audit_log WHERE chain_seq = ${last}`);
    const tail = await verify(readerToken);
    expect(tail.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'head_mismatch', seq: String(last) }),
      ]),
    );
  });

  it('(c) a relinked entry is caught even when its own hash is recomputed — without the key that is the best an attacker can do', async () => {
    const superadmin = await createOperator(db, { clock });
    const token = await signIn(superadmin);
    await request('POST', `/admins/${superadmin.id}/revoke-sessions`, { token, body: reason });
    await tamper(`UPDATE platform_audit_log SET prev_hash = 'forged' WHERE chain_seq = 2`);
    const report = await verify(await signIn(superadmin));
    expect(report.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'broken_link', seq: '2' }),
        expect.objectContaining({ kind: 'hash_mismatch', seq: '2' }),
      ]),
    );
  });

  it('(d) an action on a workspace lands in its own trail as SiyahTuş support — the owner sees it, the reason stays home — and neither half survives the other failing', async () => {
    const superadmin = await createOperator(db, { clock });
    const token = await signIn(superadmin);
    const licenseId = fx.a.licenseId;
    const log = platform.app.platformAuditLog;

    const addNote = (body: string) =>
      log.run(
        (note: { id: string }) => ({
          adminId: superadmin.id,
          action: 'workspace.note_added',
          targetType: 'workspace',
          targetId: licenseId.toString(),
          licenseId,
          reason: 'customer asked about the invoice on the phone',
          payload: { note_id: note.id },
          ip: '203.0.113.7',
        }),
        (tx) =>
          tx.platformNote.create({
            data: { licenseId, adminId: superadmin.id, body },
            select: { id: true },
          }),
      );

    const note = await addNote('called on Tuesday');
    const platformEntry = (await entries()).at(-1)!;
    expect(platformEntry).toMatchObject({
      action: 'workspace.note_added',
      licenseId,
      payload: { note_id: note.id },
    });

    const tenantEntry = await owner.auditLogEntry.findFirstOrThrow({
      where: { licenseId, actorType: 'platform' },
    });
    expect(tenantEntry).toMatchObject({
      action: 'platform.workspace_note_added',
      actorId: superadmin.id,
      target: `license:${licenseId}`,
      ip: '203.0.113.7',
      metadata: { platform_seq: platformEntry.chainSeq.toString() },
    });
    expect(JSON.stringify(tenantEntry.metadata)).not.toContain('invoice');
    // Its own chain is intact with the entry in it.
    const trail = await owner.auditLogEntry.findMany({
      where: { licenseId },
      orderBy: [{ chainSeq: 'asc' }],
    });
    expect(
      verifyAuditChain(trail, { key: deriveChainKey(CHAIN_SECRET, licenseId) }).findings,
    ).toEqual([]);
    // The other workspace has no such entry.
    expect(
      await owner.auditLogEntry.count({
        where: { licenseId: fx.b.licenseId, actorType: 'platform' },
      }),
    ).toBe(0);

    // The owner reads it on their own audit screen.
    const ownerToken = await grantToken(owner, {
      licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['audit_log--all:ro'],
    });
    const screen = await tenant.get('/audit-log?action=platform.workspace_note_added', {
      authorization: `Bearer ${ownerToken}`,
    });
    expect(screen.statusCode, screen.body).toBe(200);
    expect(screen.json().items).toEqual([
      expect.objectContaining({
        action: 'platform.workspace_note_added',
        actor_type: 'platform',
        actor_id: superadmin.id,
      }),
    ]);

    // And the root panel reads the same trail, one workspace only.
    const mirrored = await request('GET', `/audit/workspaces/${licenseId}`, { token });
    expect(mirrored.statusCode, mirrored.body).toBe(200);
    const items = mirrored.json().items as Array<{ id: string; action: string }>;
    expect(items.map((item) => item.id)).toContain(tenantEntry.id);
    const ids = new Set(
      (await owner.auditLogEntry.findMany({ where: { licenseId: fx.b.licenseId } })).map(
        (e) => e.id,
      ),
    );
    expect(items.filter((item) => ids.has(item.id))).toEqual([]);
    expect((await request('GET', '/audit/workspaces/999999999', { token })).statusCode).toBe(404);

    // The workspace's half cannot be written: the platform half and the action go too.
    const notesBefore = await owner.platformNote.count();
    const platformBefore = await owner.platformAuditLog.count();
    const tenantBefore = await owner.auditLogEntry.count({ where: { licenseId } });
    await owner.$executeRawUnsafe(`
      CREATE FUNCTION tm3895_refuse_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'tenant audit refused for the test'; END $$`);
    await owner.$executeRawUnsafe(
      `CREATE TRIGGER tm3895_refuse_audit BEFORE INSERT ON audit_log
       FOR EACH ROW WHEN (NEW.license_id = ${licenseId}) EXECUTE FUNCTION tm3895_refuse_audit()`,
    );
    try {
      await expect(addNote('this one must not survive')).rejects.toThrow(/tenant audit refused/);
    } finally {
      await owner.$executeRawUnsafe('DROP TRIGGER tm3895_refuse_audit ON audit_log');
      await owner.$executeRawUnsafe('DROP FUNCTION tm3895_refuse_audit()');
    }
    expect(await owner.platformNote.count()).toBe(notesBefore);
    expect(await owner.platformAuditLog.count()).toBe(platformBefore);
    expect(await owner.auditLogEntry.count({ where: { licenseId } })).toBe(tenantBefore);
    // The chain carries on from where it stood.
    await addNote('after the refusal');
    expect((await verify(token)).ok).toBe(true);
  });

  it('(d) the service refuses a business action without a reason, and a workspace action without its workspace', async () => {
    const superadmin = await createOperator(db, { clock });
    const log = platform.app.platformAuditLog;
    await expect(
      log.record({ adminId: superadmin.id, action: 'admin.disabled', targetType: 'admin' }),
    ).rejects.toThrow(/needs a reason/);
    await expect(
      log.record({
        adminId: superadmin.id,
        action: 'workspace.suspended',
        targetType: 'workspace',
        reason: 'chargeback',
      }),
    ).rejects.toThrow(/needs the workspace/);
    await expect(
      log.record({
        adminId: superadmin.id,
        action: 'settings.updated',
        targetType: 'settings',
        licenseId: fx.a.licenseId,
        reason: 'not about a workspace',
      }),
    ).rejects.toThrow(/cannot name a workspace/);
    expect(await owner.platformAuditLog.count()).toBe(0);
  });

  it('(e) exports the chain as NDJSON whose signature verifies — and stops verifying when a byte or the range changes', async () => {
    const superadmin = await createOperator(db, { clock });
    const other = await createOperator(db, { role: 'support', clock });
    const token = await signIn(superadmin);
    await request('POST', `/admins/${other.id}/revoke-sessions`, { token, body: reason });
    const total = await owner.platformAuditLog.count();
    expect(total).toBeGreaterThanOrEqual(3);

    const subjectOf = (response: LightMyRequestResponse) => ({
      scope: 'platform',
      count: Number(response.headers['x-siyahtus-export-count']),
      firstSeq: response.headers['x-siyahtus-export-first-seq']
        ? BigInt(String(response.headers['x-siyahtus-export-first-seq']))
        : null,
      lastSeq: response.headers['x-siyahtus-export-last-seq']
        ? BigInt(String(response.headers['x-siyahtus-export-last-seq']))
        : null,
      body: response.body,
    });

    const all = await request('GET', '/audit/export', { token });
    expect(all.statusCode, all.body).toBe(200);
    expect(all.headers['content-type']).toMatch(/application\/x-ndjson/);
    expect(all.headers['cache-control']).toBe('no-store');
    expect(all.headers['x-siyahtus-export-chain-ok']).toBe('true');
    const lines = all.body
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(total);
    expect(lines.map((line) => line.chain_seq)).toEqual(lines.map((_, i) => String(i + 1)));
    expect(lines[0]).toMatchObject({ prev_hash: null, hash: expect.any(String) });
    expect(lines[1].prev_hash).toBe(lines[0].hash);

    const signature = String(all.headers['x-siyahtus-signature']);
    const subject = subjectOf(all);
    expect(verifyExportSignature(PLATFORM_KEY, subject, signature)).toBe(true);
    expect(
      verifyExportSignature(
        PLATFORM_KEY,
        { ...subject, body: subject.body.replace('"1"', '"9"') },
        signature,
      ),
    ).toBe(false);
    expect(
      verifyExportSignature(PLATFORM_KEY, { ...subject, count: subject.count - 1 }, signature),
    ).toBe(false);
    // The runbook's offline check: the file and the header, no database.
    const offline = checkPlatformExport({
      body: all.body,
      signature,
      settingsKey: platformSettingsKey(),
    });
    expect(offline).toMatchObject({
      signatureOk: true,
      count: total,
      firstSeq: '1',
      chain: { ok: true },
    });
    const doctored = checkPlatformExport({
      body: all.body.replace('"tm 389.5 test"', '"tm 389.5 TEST"'),
      signature,
      settingsKey: platformSettingsKey(),
    });
    expect(doctored.signatureOk).toBe(false);
    expect(doctored.chain.findings).toEqual([expect.objectContaining({ kind: 'hash_mismatch' })]);
    // The tenant key for the same bytes is not this chain's key.
    expect(
      verifyExportSignature(deriveChainKey(CHAIN_SECRET, fx.a.licenseId), subject, signature),
    ).toBe(false);

    // Paged: each page signed on its own, linked onto the one before.
    const first = await request('GET', '/audit/export?limit=2', { token });
    expect(first.headers['x-siyahtus-export-has-more']).toBe('true');
    const cursor = String(first.headers['x-siyahtus-export-cursor']);
    const rest = await request('GET', `/audit/export?cursor=${cursor}&limit=1000`, { token });
    expect(rest.headers['x-siyahtus-export-has-more']).toBe('false');
    expect(rest.headers['x-siyahtus-export-chain-ok']).toBe('true');
    expect(rest.headers['x-siyahtus-export-first-seq']).toBe('3');
    expect(first.body + rest.body).toBe(all.body);
    for (const page of [first, rest]) {
      expect(
        verifyExportSignature(
          PLATFORM_KEY,
          subjectOf(page),
          String(page.headers['x-siyahtus-signature']),
        ),
      ).toBe(true);
    }
    // Caught up, the position stays.
    const caughtUp = await request(
      'GET',
      `/audit/export?cursor=${String(rest.headers['x-siyahtus-export-cursor'])}`,
      {
        token,
      },
    );
    expect(caughtUp.body).toBe('');
    expect(caughtUp.headers['x-siyahtus-export-cursor']).toBe(
      rest.headers['x-siyahtus-export-cursor'],
    );
    expect((await request('GET', '/audit/export?cursor=not-a-cursor', { token })).statusCode).toBe(
      400,
    );

    // The list: newest first, filtered, keyset-paged.
    const page = await request('GET', `/audit?admin_id=${superadmin.id}&limit=2`, { token });
    expect(page.statusCode, page.body).toBe(200);
    const listed = page.json() as {
      data: Array<{ chain_seq: string }>;
      next_cursor: string | null;
    };
    expect(listed.data.map((e) => e.chain_seq)).toEqual([String(total), String(total - 1)]);
    const next = await request(
      'GET',
      `/audit?admin_id=${superadmin.id}&cursor=${listed.next_cursor}`,
      {
        token,
      },
    );
    expect((next.json() as { data: Array<{ chain_seq: string }> }).data[0]?.chain_seq).toBe(
      String(total - 2),
    );
    const byAction = await request('GET', '/audit?action=admin.sessions_revoked', { token });
    expect((byAction.json() as { data: unknown[] }).data).toHaveLength(1);
    expect(JSON.stringify(page.json())).not.toContain('"hash"');
    expect((await request('GET', '/audit?action=made.up', { token })).statusCode).toBe(400);
  });

  it('(e) the bootstrap superadmin is the chain’s first entry', async () => {
    const { bootstrapPlatformAdmin } =
      await import('../../src/services/platform/bootstrap-admin.js');
    const admin = await bootstrapPlatformAdmin(db, {
      email: 'first@ops.siyahtus.test',
      password: 'a-good-long-operator-password',
      audit: platform.app.platformAuditLog,
    });
    expect(await entries()).toEqual([
      expect.objectContaining({
        chainSeq: 1n,
        action: 'admin.bootstrapped',
        adminId: admin.id,
        payload: { email: 'first@ops.siyahtus.test', role: 'superadmin', via: 'cli' },
      }),
    ]);
  });
});

describe('the closed list over the contract (tm 389.5 · (f))', () => {
  it('names an audit entry from the closed list on every documented mutation — or says it is safe', () => {
    const mutations = documentedMutations();
    expect(mutations.length).toBeGreaterThanOrEqual(17);
    const wrong: string[] = [];
    for (const op of mutations) {
      if (op.safe) {
        if (op.audit !== undefined) wrong.push(`${op.where}: safe and audited`);
        continue;
      }
      if (op.audit === undefined) wrong.push(`${op.where}: no x-platform-audit`);
      else if (!(PLATFORM_AUDIT_ACTIONS as readonly string[]).includes(op.audit)) {
        wrong.push(`${op.where}: ${op.audit} is not in PLATFORM_AUDIT_ACTIONS`);
      }
    }
    expect(wrong).toEqual([]);
    expect(mutations.filter((op) => op.safe).map((op) => op.where)).toEqual(['POST /audit/verify']);
  });

  it('documents the action list exactly as the code closes it', () => {
    const schemas = loadPlatformOpenApiDocument().components?.schemas as
      Record<string, { enum: string[] }> | undefined;
    const schema = schemas!['PlatformAuditAction']!;
    expect(schema.enum).toEqual([...PLATFORM_AUDIT_ACTIONS]);
  });

  it('refuses at boot a mutation that declares no entry, and a read that declares one', async () => {
    const app = await buildPlatformServer({ env: testEnv() });
    try {
      expect(() =>
        app.post(
          '/platform/v1/forgot-the-entry',
          { config: { platform: { permission: 'admins.manage' } } },
          async () => ({}),
        ),
      ).toThrow(/declares config.platform.audit/);
      expect(() =>
        app.get(
          '/platform/v1/audited-read',
          {
            config: {
              platform: {
                permission: 'admins.read',
                audit: { action: 'admin.disabled', target: 'admin' },
              },
            },
          },
          async () => ({}),
        ),
      ).toThrow(/a read is not audited/);
      expect(() =>
        app.post(
          '/platform/v1/made-up',
          {
            config: {
              platform: {
                permission: 'admins.manage',
                audit: { action: 'admin.made_up' as 'admin.disabled', target: 'admin' },
              },
            },
          },
          async () => ({}),
        ),
      ).toThrow(/unknown audit action/);
      expect(() =>
        app.post(
          '/platform/v1/safe-and-audited',
          {
            config: {
              platform: {
                permission: 'audit.read',
                safe: true,
                audit: { action: 'admin.disabled', target: 'admin' },
              },
            },
          },
          async () => ({}),
        ),
      ).toThrow(/safe route changes nothing/);
    } finally {
      await app.close();
    }
  });
});
