/**
 * Access review report — SOC 2 CC6.1 evidence (NFR-C6 · C6-e).
 *
 * This is a security surface before it is a report, so the refusals come first,
 * and the properties that matter are the ones a mocked repository could not
 * prove: they live in Postgres, in RLS, and in the audit trail.
 *
 *   - **Doubly gated**, exactly as `/audit-log` is: `audit_log--all:ro` *and*
 *     `minimumRole: admin`. An ordinary agent holding the scope is refused; an
 *     admin without it is refused. `reports_read` — the scope every charting
 *     integration holds — buys nothing here at all, which is the whole reason
 *     this endpoint does not use it.
 *   - **One tenant only.** Another workspace's members, and another workspace's
 *     credentials, are invisible — enforced by RLS, not by a clause in the
 *     builder.
 *   - **No credential value, ever.** Neither the plaintext (which does not exist
 *     server-side) nor the stored digest appears in any format.
 *   - **Evidence, not judgement** (§C-A23): the payload carries facts and
 *     timestamps and no score, flag or recommendation.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface ReviewMember {
  account_id: string;
  email: string;
  role: string;
  status: string;
  suspended: boolean;
  awaiting_approval: boolean;
  two_factor_enabled: boolean;
  provisioned_via: string;
  member_since: string;
  last_login_at: string | null;
  last_login_method: string | null;
}

interface ReviewCredential {
  id: string;
  kind: string;
  name: string | null;
  scopes: string[];
  owner_id: string;
  owner_name: string | null;
  owner_email: string | null;
  owner_is_member: boolean;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

interface Review {
  generated_at: string;
  audit_trail_starts_at: string | null;
  members: ReviewMember[];
  credentials: ReviewCredential[];
}

describe('access review report (C6-e)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  /** Owner role (≥ admin) holding the audit scope — the happy path. */
  let ownerToken: string;
  /** Agent role, but *holding* the scope — isolates the role gate. */
  let agentWithScopeToken: string;
  /** Admin role holding only `reports_read` — isolates the scope gate. */
  let adminReportsOnlyToken: string;
  /** Tenant B's owner, for the isolation probes. */
  let otherOwnerToken: string;

  let adminAccountId: string;
  let suspendedAccountId: string;
  let awaitingAccountId: string;
  let scimAccountId: string;
  /** A token whose owner is nobody in this workspace — the orphan credential. */
  let orphanOwnerId: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const errorType = (res: { json: () => unknown }) =>
    (res.json() as { error: { type: string } }).error.type;
  const review = (res: { json: () => unknown }) => res.json() as Review;
  const memberOf = (body: Review, accountId: string): ReviewMember | undefined =>
    body.members.find((member) => member.account_id === accountId);

  /** A member of tenant A with an explicit standing. Returns the account id. */
  async function addMember(
    tenant: TenantFixture,
    label: string,
    data: Partial<Prisma.AgentMembershipUncheckedCreateInput> & { role: string },
  ): Promise<string> {
    const account = await owner.account.create({
      data: {
        email: `${label}-${tenant.licenseId}@example.test`,
        name: `${label} person`,
        passwordHash: null,
      },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: tenant.licenseId, agentId: account.id, ...data },
    });
    return account.id;
  }

  /** An audit entry, inserted through the owner connection (bypasses RLS). */
  async function seedEntry(
    tenant: TenantFixture,
    action: string,
    actorId: string | null,
    createdAt: Date,
  ): Promise<void> {
    await owner.auditLogEntry.create({
      data: {
        licenseId: tenant.licenseId,
        actorId,
        actorType: 'agent',
        action,
        metadata: {} as Prisma.InputJsonObject,
        createdAt,
      },
    });
  }

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);

    adminAccountId = await addMember(fx.a, 'admin', { role: 'admin', twoFactorEnabled: true });
    suspendedAccountId = await addMember(fx.a, 'suspended', { role: 'agent', suspended: true });
    awaitingAccountId = await addMember(fx.a, 'awaiting', {
      role: 'agent',
      awaitingApproval: true,
    });
    scimAccountId = await addMember(fx.a, 'directory', {
      role: 'agent',
      scimExternalId: 'idp-user-7',
    });

    ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['audit_log--all:ro'],
    });
    agentWithScopeToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['audit_log--all:ro'],
    });
    adminReportsOnlyToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: adminAccountId,
      scopes: ['reports_read'],
    });
    otherOwnerToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['audit_log--all:ro'],
    });

    orphanOwnerId = '99999999-9999-4999-8999-999999999999';
  });

  // --- The gates ----------------------------------------------------------

  it('refuses an agent-role caller even when the token holds the scope', async () => {
    const res = await server.get('/reports/access-review', auth(agentWithScopeToken));

    expect(res.statusCode).toBe(403);
    expect(errorType(res)).toBe('authorization');
  });

  it('refuses an admin whose token holds only reports_read', async () => {
    // The point of not gating this on `reports_read`: a charting integration is
    // routinely granted it, and the roster plus the credential inventory is a
    // much larger authority than a chat-volume graph.
    const res = await server.get('/reports/access-review', auth(adminReportsOnlyToken));

    expect(res.statusCode).toBe(403);
    expect(errorType(res)).toBe('authorization');
  });

  it('refuses an unauthenticated caller', async () => {
    const res = await server.get('/reports/access-review');

    expect(res.statusCode).toBe(401);
  });

  // --- Memberships --------------------------------------------------------

  it('lists every membership of the workspace with its role and standing', async () => {
    const res = await server.get('/reports/access-review', auth(ownerToken));
    expect(res.statusCode).toBe(200);

    const body = review(res);
    expect(body.members.map((m) => m.account_id).sort()).toEqual(
      [
        fx.a.ownerAccountId,
        fx.a.agentAccountId,
        adminAccountId,
        suspendedAccountId,
        awaitingAccountId,
        scimAccountId,
      ].sort(),
    );
    expect(memberOf(body, fx.a.ownerAccountId)?.role).toBe('owner');
    expect(memberOf(body, adminAccountId)?.two_factor_enabled).toBe(true);
    expect(memberOf(body, fx.a.agentAccountId)?.two_factor_enabled).toBe(false);
    expect(memberOf(body, fx.a.ownerAccountId)?.email).toBe(fx.a.ownerEmail);
  });

  it('derives a status from the flags, and keeps both flags alongside it', async () => {
    const body = review(await server.get('/reports/access-review', auth(ownerToken)));

    expect(memberOf(body, fx.a.ownerAccountId)?.status).toBe('active');
    expect(memberOf(body, suspendedAccountId)?.status).toBe('suspended');
    expect(memberOf(body, awaitingAccountId)?.status).toBe('awaiting_approval');
    expect(memberOf(body, awaitingAccountId)?.awaiting_approval).toBe(true);
    expect(memberOf(body, suspendedAccountId)?.suspended).toBe(true);
  });

  it('reports a suspended member as suspended even when they also await approval', async () => {
    // Precedence, not a coin toss: the column answers "can this person get in",
    // and a suspended member cannot whatever the other flag says.
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: suspendedAccountId } },
      data: { awaitingApproval: true },
    });

    const body = review(await server.get('/reports/access-review', auth(ownerToken)));

    expect(memberOf(body, suspendedAccountId)?.status).toBe('suspended');
    expect(memberOf(body, suspendedAccountId)?.awaiting_approval).toBe(true);
  });

  it('says which memberships the directory manages', async () => {
    const body = review(await server.get('/reports/access-review', auth(ownerToken)));

    expect(memberOf(body, scimAccountId)?.provisioned_via).toBe('scim');
    expect(memberOf(body, fx.a.ownerAccountId)?.provisioned_via).toBe('manual');
  });

  // --- Last sign-in -------------------------------------------------------

  it('takes last sign-in from the trail, keeping the newer of password and SSO', async () => {
    await seedEntry(fx.a, 'auth.login', fx.a.ownerAccountId, new Date('2026-08-01T10:00:00.000Z'));
    await seedEntry(
      fx.a,
      'auth.sso_login',
      fx.a.ownerAccountId,
      new Date('2026-08-09T10:00:00.000Z'),
    );

    const body = review(await server.get('/reports/access-review', auth(ownerToken)));

    expect(memberOf(body, fx.a.ownerAccountId)?.last_login_at).toBe('2026-08-09T10:00:00.000Z');
    expect(memberOf(body, fx.a.ownerAccountId)?.last_login_method).toBe('sso');
  });

  it('does not count a failed sign-in as a sign-in', async () => {
    // The distinction is the whole value of the column: an account someone has
    // been hammering must not read as an account in daily use.
    await seedEntry(
      fx.a,
      'auth.login_failed',
      fx.a.agentAccountId,
      new Date('2026-08-10T10:00:00.000Z'),
    );

    const body = review(await server.get('/reports/access-review', auth(ownerToken)));

    expect(memberOf(body, fx.a.agentAccountId)?.last_login_at).toBeNull();
    expect(memberOf(body, fx.a.agentAccountId)?.last_login_method).toBeNull();
  });

  it('publishes where the trail begins, so a null sign-in is not read as "never"', async () => {
    const oldest = new Date('2026-07-20T00:00:00.000Z');
    await seedEntry(fx.a, 'auth.login', fx.a.ownerAccountId, oldest);
    await seedEntry(fx.a, 'auth.login', fx.a.ownerAccountId, new Date('2026-08-02T00:00:00.000Z'));

    const body = review(await server.get('/reports/access-review', auth(ownerToken)));

    expect(body.audit_trail_starts_at).toBe(oldest.toISOString());
  });

  it('reports an empty trail as null rather than inventing a horizon', async () => {
    const body = review(await server.get('/reports/access-review', auth(ownerToken)));

    expect(body.audit_trail_starts_at).toBeNull();
    expect(memberOf(body, fx.a.ownerAccountId)?.last_login_at).toBeNull();
  });

  // --- Credential inventory ----------------------------------------------

  it('inventories live credentials of every kind, with owner and scopes', async () => {
    await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: 'system:scim',
      kind: 'scim',
      scopes: [],
    });
    await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      kind: 'oauth',
      scopes: ['chats--all:rw'],
    });

    const body = review(await server.get('/reports/access-review', auth(ownerToken)));

    expect(body.credentials.map((c) => c.kind).sort()).toEqual([
      'oauth',
      'pat',
      'pat',
      'pat',
      'scim',
    ]);
    // The caller's own credential is in its own inventory — an access review
    // that quietly omitted the token asking for it would be worthless.
    const self = body.credentials.find((c) => c.owner_id === fx.a.ownerAccountId);
    expect(self?.scopes).toEqual(['audit_log--all:ro']);
    expect(self?.owner_email).toBe(fx.a.ownerEmail);
    expect(self?.owner_is_member).toBe(true);
    // A SCIM credential belongs to the workspace, not a person, so its sentinel
    // owner resolves to nobody — and says so rather than guessing.
    const scim = body.credentials.find((c) => c.kind === 'scim');
    expect(scim?.owner_id).toBe('system:scim');
    expect(scim?.owner_is_member).toBe(false);
    expect(scim?.owner_email).toBeNull();
  });

  it('flags a credential whose owner is no longer a member', async () => {
    // Revoking a membership does not revoke that person's personal access
    // token. That orphan is exactly what CC6.1 asks after.
    await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: orphanOwnerId,
      scopes: ['chats--all:ro'],
    });

    const body = review(await server.get('/reports/access-review', auth(ownerToken)));
    const orphan = body.credentials.find((c) => c.owner_id === orphanOwnerId);

    expect(orphan).toBeDefined();
    expect(orphan?.owner_is_member).toBe(false);
    expect(orphan?.owner_name).toBeNull();
  });

  it('omits revoked and expired credentials, and keeps ones expiring later', async () => {
    await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: adminAccountId,
      scopes: [],
      revokedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: adminAccountId,
      scopes: [],
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
    });
    const future = new Date(Date.now() + 86_400_000);
    await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: adminAccountId,
      scopes: [],
      expiresAt: future,
    });

    const body = review(await server.get('/reports/access-review', auth(ownerToken)));
    const expiries = body.credentials
      .filter((c) => c.owner_id === adminAccountId)
      .map((c) => c.expires_at);

    // Only what can still open the door today: the admin's never-expiring
    // `reports_read` token and the one lapsing tomorrow. The revoked and the
    // long-expired rows are gone — listing them would inflate the door count,
    // which is the one number this report exists to state correctly.
    expect(expiries.sort()).toEqual([future.toISOString(), null].sort());
    expect(expiries).not.toContain('2020-01-01T00:00:00.000Z');
  });

  // --- Leakage ------------------------------------------------------------

  it('never returns a credential value or its stored digest', async () => {
    const plaintext = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: adminAccountId,
      scopes: ['chats--all:ro'],
    });
    const stored = await owner.apiToken.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, ownerId: adminAccountId },
      select: { tokenHash: true },
    });

    const json = await server.get('/reports/access-review', auth(ownerToken));
    const csv = await server.get(
      '/reports/access-review?format=csv&section=credentials',
      auth(ownerToken),
    );

    for (const body of [json.body, csv.body]) {
      expect(body).not.toContain(plaintext);
      expect(body).not.toContain(stored.tokenHash);
      expect(body).not.toMatch(/token_hash|"token"/);
    }
  });

  // --- Tenant isolation ---------------------------------------------------

  it('shows a workspace only its own members and credentials', async () => {
    await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.agentAccountId,
      scopes: ['chats--all:ro'],
    });
    await seedEntry(fx.b, 'auth.login', fx.b.ownerAccountId, new Date('2026-08-05T00:00:00.000Z'));

    const mine = review(await server.get('/reports/access-review', auth(ownerToken)));

    expect(mine.members.map((m) => m.account_id)).not.toContain(fx.b.ownerAccountId);
    expect(mine.credentials.map((c) => c.owner_id)).not.toContain(fx.b.agentAccountId);
    // B's trail is B's: it must not move A's horizon either.
    expect(mine.audit_trail_starts_at).toBeNull();

    const theirs = review(await server.get('/reports/access-review', auth(otherOwnerToken)));

    expect(theirs.members.map((m) => m.account_id).sort()).toEqual(
      [fx.b.ownerAccountId, fx.b.agentAccountId].sort(),
    );
    expect(theirs.members.map((m) => m.email)).not.toContain(fx.a.ownerEmail);
    expect(theirs.audit_trail_starts_at).toBe('2026-08-05T00:00:00.000Z');
  });

  // --- CSV export ---------------------------------------------------------

  it('exports the member table as a named CSV download', async () => {
    const res = await server.get('/reports/access-review?format=csv', auth(ownerToken));

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="nexa-access-review-members-\d{4}-\d{2}-\d{2}\.csv"/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff');

    const lines = res.body.split('\r\n').filter(Boolean);
    expect(lines[0]).toBe(
      'account_id,name,email,role,status,two_factor_enabled,provisioned_via,member_since,last_login_at,last_login_method',
    );
    // Header plus one row per membership — the same six the JSON carries.
    expect(lines).toHaveLength(7);
    expect(res.body).toContain(fx.a.ownerEmail);
  });

  it('exports the credential table under its own section', async () => {
    const res = await server.get(
      '/reports/access-review?format=csv&section=credentials',
      auth(ownerToken),
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('nexa-access-review-credentials-');
    expect(res.body.split('\r\n')[0]).toBe(
      'credential_id,kind,name,owner_id,owner_email,owner_is_member,scopes,created_at,last_used_at,expires_at',
    );
    expect(res.body).toContain('audit_log--all:ro');
  });

  it('rejects a section or format it does not serve', async () => {
    // A typo must not silently fall back to the members table: an evidence file
    // labelled by its filename would then contain the wrong evidence.
    const badSection = await server.get(
      '/reports/access-review?format=csv&section=tokens',
      auth(ownerToken),
    );
    const badFormat = await server.get('/reports/access-review?format=pdf', auth(ownerToken));

    expect(badSection.statusCode).toBe(400);
    expect(badFormat.statusCode).toBe(400);
  });

  // --- Evidence, not judgement (§C-A23) -----------------------------------

  it('carries no verdict about the access it lists', async () => {
    const body = await server.get('/reports/access-review', auth(ownerToken));

    // The report feeds a human control; a score or a "consider revoking" would
    // be the product answering the question the auditor must be seen to answer.
    expect(body.body).not.toMatch(/risk|score|stale|recommend|should_|violation/i);
  });
});
