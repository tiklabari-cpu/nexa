/**
 * SSO connections — the read surface (S11-a) and the write surface (S11-a2).
 *
 * `GET /settings/sso` lists the SAML identity providers a workspace federates
 * sign-in to; `POST`/`PATCH`/`DELETE` write them. Assertion validation is S11-b
 * and the SP endpoints S11-d, so nothing here signs anybody in. What is tested
 * is the boundary around configuring the trust anchor:
 *
 *   - **Reading** is gated twice. `access_rules:*` says the token may read
 *     access rules; `admin` says the person behind it may. A row names the
 *     workspace's identity provider — reconnaissance for a targeted phish, and
 *     once S11-h makes SSO the only way in, a map of the single door.
 *   - **Writing is owner only, and an admin is refused.** Whoever sets
 *     `idp_certificate_pem` chooses the key assertions are verified against, and
 *     can therefore mint a signed assertion for any colleague and sign in as
 *     them. That is a strictly larger power than an admin otherwise holds, so
 *     the admin rejection is a first-class test, not an edge case.
 *   - **Certificates are parsed, not pattern-matched** — chains, expired keys
 *     and 1024-bit RSA are refused at the endpoint. (`sso-connection.test.ts`
 *     covers the rules exhaustively; here they are proven to be wired in.)
 *   - **Rotation** revokes the old certificate at commit unless an overlap is
 *     asked for, and the overlap is bounded.
 *   - One workspace never reads *or writes* another's federation.
 *   - Every change lands in the audit trail, and the certificate never does.
 *
 * Rejections first: this is a security surface.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CERTIFICATE_CHAIN_PEM,
  EXPIRED_CERTIFICATE_PEM,
  ROTATED_CERTIFICATE_PEM,
  UNPARSEABLE_CERTIFICATE_PEM,
  VALID_CERTIFICATE_FINGERPRINT,
  VALID_CERTIFICATE_PEM,
  WEAK_CERTIFICATE_PEM,
  WEAK_EC_CERTIFICATE_PEM,
} from '../helpers/certificates.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** Shaped like the certificate an IdP publishes; the bytes are not parsed here. */
const PEM = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n';

describe('sso connections', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let ownerToken: string;
  let agentWithScopeToken: string;
  let ownerNoScopeToken: string;
  let ownerWriteToken: string;
  let adminWriteToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const errorType = (res: { json: () => unknown }) =>
    (res.json() as { error: { type: string } }).error.type;

  interface WireConnection {
    id: string;
    name: string;
    idp_entity_id: string;
    idp_sso_url: string;
    idp_certificate_pem: string;
    previous_certificate_pem: string | null;
    previous_certificate_expires_at: string | null;
    verified_domains: string[];
    attribute_mapping: Record<string, string>;
    allow_idp_initiated: boolean;
    enabled: boolean;
    created_at: string;
    updated_at: string;
  }
  const items = (res: { json: () => unknown }) => (res.json() as { items: WireConnection[] }).items;
  const wire = (res: { json: () => unknown }) => res.json() as WireConnection;

  /** A connection row, written straight to the database. */
  const connection = (overrides: Record<string, unknown> = {}) => ({
    licenseId: fx.a.licenseId,
    name: 'Okta (corp)',
    idpEntityId: 'https://idp.example.test/saml/metadata',
    idpSsoUrl: 'https://idp.example.test/saml/sso',
    idpCertificatePem: PEM,
    verifiedDomains: ['acme.test'],
    ...overrides,
  });

  /** A well-formed create body, so a test only states what it is varying. */
  const createBody = (overrides: Record<string, unknown> = {}) => ({
    name: 'Okta (corp)',
    idp_entity_id: 'https://idp.example.test/saml/metadata',
    idp_sso_url: 'https://idp.example.test/saml/sso',
    idp_certificate_pem: VALID_CERTIFICATE_PEM,
    verified_domains: ['acme.test'],
    ...overrides,
  });

  /** Create through the API and return the stored connection. */
  async function create(overrides: Record<string, unknown> = {}): Promise<WireConnection> {
    const res = await server.post('/settings/sso', createBody(overrides), auth(ownerWriteToken));
    expect(res.statusCode).toBe(201);
    return wire(res);
  }

  /** A real admin-role principal (fixtures ship only owner + agent). */
  async function createAdmin(tenant: TenantFixture): Promise<string> {
    const account = await owner.account.create({
      data: { email: `admin-${tenant.licenseId}@example.test`, name: 'Admin', passwordHash: null },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: tenant.licenseId,
        agentId: account.id,
        role: 'admin',
        routingStatus: 'accepting_chats',
      },
    });
    return account.id;
  }

  /** The audit entries this endpoint wrote, newest last. */
  const auditEntries = () =>
    owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'settings.security_updated' },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    // SSO configuration is Enterprise (NFR-S11 · FR-MOD-11.5), so the workspace
    // under test has to hold the plan that includes it — this suite is about the
    // federation rules, not about who may buy them.
    fx = await seedFixtures(owner, { plan: 'enterprise' });
    await clearRateLimits(server.app);

    ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:ro'],
    });
    agentWithScopeToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['access_rules:ro'],
    });
    ownerNoScopeToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: [],
    });
    ownerWriteToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
    adminWriteToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: await createAdmin(fx.a),
      scopes: ['access_rules:rw'],
    });
  });

  // --- Rejections first ------------------------------------------------------

  it('refuses an unauthenticated caller with 401', async () => {
    const res = await server.get('/settings/sso');
    expect(res.statusCode).toBe(401);
  });

  it('refuses an agent — even one holding the scope (role gate)', async () => {
    await owner.ssoConnection.create({ data: connection() });

    const res = await server.get('/settings/sso', auth(agentWithScopeToken));
    expect(res.statusCode).toBe(403);
    expect(errorType(res)).toBe('authorization');
  });

  it('refuses an owner whose token lacks the access-rules scope (scope gate)', async () => {
    // The mirror of the test above: together they pin both gates, so neither can
    // be dropped while the other keeps the suite green.
    await owner.ssoConnection.create({ data: connection() });

    const res = await server.get('/settings/sso', auth(ownerNoScopeToken));
    expect(res.statusCode).toBe(403);
    expect(errorType(res)).toBe('authorization');
  });

  // --- Cross-tenant isolation ------------------------------------------------

  it("never lists another workspace's identity provider", async () => {
    await owner.ssoConnection.create({ data: connection({ name: 'Ours' }) });
    await owner.ssoConnection.create({
      data: connection({ licenseId: fx.b.licenseId, name: 'Theirs' }),
    });

    const res = await server.get('/settings/sso', auth(ownerToken));
    expect(res.statusCode).toBe(200);
    expect(items(res).map((c) => c.name)).toEqual(['Ours']);
    // Not just the label: nothing of the other workspace's IdP reaches the wire.
    expect(JSON.stringify(res.json())).not.toContain('Theirs');
  });

  it('answers an empty list for a workspace that has configured nothing', async () => {
    // The screen (S11-g) renders its empty state from this, so "no federation"
    // must be an ordinary 200 rather than a 404 or an error.
    const res = await server.get('/settings/sso', auth(ownerToken));
    expect(res.statusCode).toBe(200);
    expect(items(res)).toEqual([]);
  });

  // --- The shape it promises -------------------------------------------------

  it('returns the stored connection, certificate included, ordered by name', async () => {
    await owner.ssoConnection.create({
      data: connection({
        name: 'Zeta IdP',
        idpEntityId: 'https://zeta.example.test/metadata',
      }),
    });
    await owner.ssoConnection.create({
      data: connection({
        name: 'Alpha IdP',
        attributeMapping: { email: 'urn:oid:0.9.2342.19200300.100.1.3', name: 'displayName' },
        allowIdpInitiated: true,
        enabled: true,
      }),
    });

    const res = await server.get('/settings/sso', auth(ownerToken));
    expect(res.statusCode).toBe(200);
    expect(items(res).map((c) => c.name)).toEqual(['Alpha IdP', 'Zeta IdP']);

    const [alpha] = items(res);
    expect(alpha).toMatchObject({
      idp_entity_id: 'https://idp.example.test/saml/metadata',
      idp_sso_url: 'https://idp.example.test/saml/sso',
      attribute_mapping: { email: 'urn:oid:0.9.2342.19200300.100.1.3', name: 'displayName' },
      allow_idp_initiated: true,
      enabled: true,
    });
    // Sent whole, not masked: it is the IdP's *public* signing certificate, and
    // it is the field an admin compares against their IdP console to confirm a
    // rotation landed. The secret in this feature is the SCIM token (S11-e).
    expect(alpha!.idp_certificate_pem).toBe(PEM);
    expect(new Date(alpha!.created_at).getTime()).toBeGreaterThan(0);
    expect(new Date(alpha!.updated_at).getTime()).toBeGreaterThan(0);
  });

  it('exposes only the declared attribute-mapping keys', async () => {
    // The column is JSON, so a row can hold keys nobody declared. Passing those
    // through would put fields in the response the contract says cannot appear
    // (`additionalProperties: false`) — and a mapping naming `role` would read
    // to a client as if an assertion could set one.
    await owner.ssoConnection.create({
      data: connection({
        attributeMapping: { email: 'mail', role: 'admin', suspended: false },
      }),
    });

    const res = await server.get('/settings/sso', auth(ownerToken));
    expect(items(res)[0]!.attribute_mapping).toEqual({ email: 'mail' });
  });

  it('reads a mapping that names no field as "not configured"', async () => {
    // The default. A connection saved without a mapping must read as an empty
    // object rather than null or an absent key — the screen (S11-g) and the
    // resolver (S11-d) both branch on "did this connection say", and three
    // spellings of "no" is where that branch goes wrong.
    await owner.ssoConnection.create({ data: connection() });

    const res = await server.get('/settings/sso', auth(ownerToken));
    expect(res.statusCode).toBe(200);
    expect(items(res)[0]!.attribute_mapping).toEqual({});
  });

  // --- Write surface: who may write (S11-a2) ---------------------------------

  it('refuses an unauthenticated writer with 401', async () => {
    expect((await server.post('/settings/sso', createBody())).statusCode).toBe(401);
    expect(
      (await server.patch('/settings/sso/' + crypto.randomUUID(), { name: 'x' })).statusCode,
    ).toBe(401);
    expect((await server.del('/settings/sso/' + crypto.randomUUID())).statusCode).toBe(401);
  });

  it('REFUSES AN ADMIN holding the write scope — owner only', async () => {
    // The central claim of this endpoint. An admin can already change every
    // other setting on this route file; they cannot change the key that decides
    // whose signature is believed, because that is not "administering settings",
    // it is being able to sign in as any colleague in the workspace.
    const res = await server.post('/settings/sso', createBody(), auth(adminWriteToken));
    expect(res.statusCode).toBe(403);
    expect(errorType(res)).toBe('authorization');
    expect(await owner.ssoConnection.count()).toBe(0);
  });

  it('refuses an admin on every write verb, not just create', async () => {
    // A gate that holds on `POST` and leaks on `PATCH` would be no gate at all:
    // rewriting an existing connection's certificate is the same takeover.
    const created = await create();

    const patched = await server.patch(
      `/settings/sso/${created.id}`,
      { idp_certificate_pem: ROTATED_CERTIFICATE_PEM },
      auth(adminWriteToken),
    );
    expect(patched.statusCode).toBe(403);

    const deleted = await server.del(`/settings/sso/${created.id}`, auth(adminWriteToken));
    expect(deleted.statusCode).toBe(403);

    const row = await owner.ssoConnection.findFirstOrThrow({ where: { id: created.id } });
    expect(row.idpCertificatePem).toBe(VALID_CERTIFICATE_PEM);
  });

  it('refuses an ordinary agent holding the write scope', async () => {
    const agentWriteToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['access_rules:rw'],
    });

    const res = await server.post('/settings/sso', createBody(), auth(agentWriteToken));
    expect(res.statusCode).toBe(403);
    expect(errorType(res)).toBe('authorization');
  });

  it('refuses the owner when the token lacks the write scope', async () => {
    // The mirror of the role gate: the person may, the credential may not. A
    // read-only token is the one an integration is most likely to be holding.
    const res = await server.post('/settings/sso', createBody(), auth(ownerToken));
    expect(res.statusCode).toBe(403);
    expect(errorType(res)).toBe('authorization');
  });

  // --- Write surface: what may be written ------------------------------------

  it('refuses a certificate it cannot parse', async () => {
    // Certificate-shaped, and it satisfies the storage CHECK. Only parsing
    // catches it.
    const res = await server.post(
      '/settings/sso',
      createBody({ idp_certificate_pem: UNPARSEABLE_CERTIFICATE_PEM }),
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(400);
    expect(errorType(res)).toBe('validation');
    expect(await owner.ssoConnection.count()).toBe(0);
  });

  it('refuses an expired certificate', async () => {
    const res = await server.post(
      '/settings/sso',
      createBody({ idp_certificate_pem: EXPIRED_CERTIFICATE_PEM }),
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(400);
    expect(errorType(res)).toBe('validation');
  });

  it('refuses a key too weak to be trusted with sign-in', async () => {
    // 1024-bit RSA: in date, well-formed, forgeable.
    const res = await server.post(
      '/settings/sso',
      createBody({ idp_certificate_pem: WEAK_CERTIFICATE_PEM }),
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(400);
  });

  it('refuses an EC key on a curve below P-256', async () => {
    // P-192: in date, well-formed, forgeable — the EC equivalent of the RSA case
    // above, proving the curve rule is wired into the endpoint, not just the
    // pure function (`sso-connection.test.ts` covers the curve list itself).
    const res = await server.post(
      '/settings/sso',
      createBody({ idp_certificate_pem: WEAK_EC_CERTIFICATE_PEM }),
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(400);
    expect(errorType(res)).toBe('validation');
    expect(await owner.ssoConnection.count()).toBe(0);
  });

  // --- Write surface: the domains a connection may provision from (§D116) ----

  it('normalises the verified domains it stores, and deduplicates them', async () => {
    // Case, surrounding space and the DNS root dot are three spellings of one
    // domain. Storing them as three would mean an address matching one and not
    // the others, and a list an owner reads as three different claims.
    const created = await create({
      verified_domains: ['ACME.test', ' acme.test. ', 'Corp.Acme.Test'],
    });
    expect(created.verified_domains).toEqual(['acme.test', 'corp.acme.test']);
  });

  it('refuses a wildcard rather than expanding it', async () => {
    // The refusal is the fix. `*.acme.test` reads like a convenience and is the
    // vulnerability back again: running `acme.test` says nothing about who
    // controls `payroll.acme.test`, and the moment one form of suffix matching
    // is accepted, "verified" stops meaning "we checked this exact name".
    const res = await server.post(
      '/settings/sso',
      createBody({ verified_domains: ['*.acme.test'] }),
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(400);
    expect(errorType(res)).toBe('validation');
    // Named, not merely refused: this is the mistake somebody makes first.
    expect((res.json() as { error: { message: string } }).error.message).toContain('wildcard');
    expect(await owner.ssoConnection.count()).toBe(0);
  });

  it('refuses anything that is not a bare domain, and an empty list', async () => {
    for (const domains of [
      ['https://acme.test'], // a URL
      ['acme.test/path'], // a path
      ['acme.test:443'], // a port
      ['ada@acme.test'], // an address
      ['localhost'], // a machine, not a domain
      ['.acme.test'], // a leading dot
      ['-acme.test'], // a label opening with a hyphen
      ['acme .test'], // a space
      [], // nothing at all — a federation that would refuse every first sign-in
    ]) {
      const res = await server.post(
        '/settings/sso',
        createBody({ verified_domains: domains }),
        auth(ownerWriteToken),
      );
      expect(res.statusCode, JSON.stringify(domains)).toBe(400);
    }
    expect(await owner.ssoConnection.count()).toBe(0);
  });

  it('bounds how many domains one connection may claim', async () => {
    const res = await server.post(
      '/settings/sso',
      createBody({
        verified_domains: Array.from({ length: 21 }, (_, i) => `d${i}.acme.test`),
      }),
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(400);
  });

  it('replaces the domain list wholesale on a patch, leaving the rest alone', async () => {
    const created = await create({ verified_domains: ['acme.test', 'old.acme.test'] });

    const res = await server.patch(
      `/settings/sso/${created.id}`,
      { verified_domains: ['acme.test'] },
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(200);
    expect(wire(res).verified_domains).toEqual(['acme.test']);
    // The certificate is untouched: a domain change is not a rotation.
    expect(wire(res).idp_certificate_pem).toBe(created.idp_certificate_pem);

    // And it cannot be emptied — a connection that provisions nobody is a
    // decision with a switch (`enabled`), not a side effect of clearing a field.
    const emptied = await server.patch(
      `/settings/sso/${created.id}`,
      { verified_domains: [] },
      auth(ownerWriteToken),
    );
    expect(emptied.statusCode).toBe(400);
    const after = await owner.ssoConnection.findFirst({ where: { id: created.id } });
    expect(after!.verifiedDomains).toEqual(['acme.test']);
  });

  it('refuses a pasted chain rather than trusting its first certificate', async () => {
    const res = await server.post(
      '/settings/sso',
      createBody({ idp_certificate_pem: CERTIFICATE_CHAIN_PEM }),
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(400);
  });

  it('requires https for the sign-on URL, and refuses a dangerous scheme', async () => {
    // This value becomes a redirect the browser follows, so the scheme is a
    // security boundary rather than a formatting preference.
    for (const url of [
      'http://idp.example.test/sso',
      'javascript:alert(1)',
      '//evil.example/sso',
      'https://user:pw@idp.example.test/sso',
    ]) {
      const res = await server.post(
        '/settings/sso',
        createBody({ idp_sso_url: url }),
        auth(ownerWriteToken),
      );
      expect({ url, status: res.statusCode }).toEqual({ url, status: 400 });
    }
    expect(await owner.ssoConnection.count()).toBe(0);
  });

  it('allows plain http on loopback, so a local IdP harness can be configured', async () => {
    // The exception the storage CHECK deliberately left to this layer — S11-c
    // serves its mock IdP from 127.0.0.1.
    const created = await create({ idp_sso_url: 'http://127.0.0.1:8088/sso' });
    expect(created.idp_sso_url).toBe('http://127.0.0.1:8088/sso');
  });

  it('refuses an attribute mapping naming a field an assertion may not fill', async () => {
    // Rejected, not dropped. A mapping silently discarded reads to an admin as a
    // saved one — and a `role` mapping that appears to have been accepted is a
    // dangerous thing to believe.
    const res = await server.post(
      '/settings/sso',
      createBody({ attribute_mapping: { email: 'mail', role: 'admin' } }),
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(400);
    expect(errorType(res)).toBe('validation');
  });

  it('refuses a second connection for the same identity provider', async () => {
    await create();
    const res = await server.post('/settings/sso', createBody(), auth(ownerWriteToken));
    expect(res.statusCode).toBe(403);
    expect(errorType(res)).toBe('not_allowed');
  });

  // --- Write surface: what it stores -----------------------------------------

  it('stores a connection off by default, in the caller`s own workspace', async () => {
    const created = await create({ attribute_mapping: { email: 'mail' } });

    // Both switches start closed: writing the configuration and opening the door
    // are two decisions, and an IdP-initiated flow gives up the replay binding.
    expect(created).toMatchObject({
      name: 'Okta (corp)',
      idp_entity_id: 'https://idp.example.test/saml/metadata',
      idp_sso_url: 'https://idp.example.test/saml/sso',
      idp_certificate_pem: VALID_CERTIFICATE_PEM,
      attribute_mapping: { email: 'mail' },
      allow_idp_initiated: false,
      enabled: false,
      previous_certificate_pem: null,
      previous_certificate_expires_at: null,
    });

    // The tenant comes from the credential, never the body — there is no field
    // to aim at another workspace with.
    const row = await owner.ssoConnection.findFirstOrThrow({ where: { id: created.id } });
    expect(row.licenseId).toBe(fx.a.licenseId);
    expect(await owner.ssoConnection.count({ where: { licenseId: fx.b.licenseId } })).toBe(0);
  });

  it('normalises the sign-on URL it stores', async () => {
    // What is stored is what S11-d builds the redirect from, so it is stored as
    // parsed: host case and an implicit path are the same endpoint.
    const created = await create({ idp_sso_url: 'https://IdP.Example.Test' });
    expect(created.idp_sso_url).toBe('https://idp.example.test/');
  });

  it('lets the owner turn on the IdP-initiated flow deliberately', async () => {
    const created = await create({ allow_idp_initiated: true, enabled: true });
    expect(created).toMatchObject({ allow_idp_initiated: true, enabled: true });
  });

  // --- Certificate rotation --------------------------------------------------

  it('revokes the old certificate the moment a new one is written', async () => {
    // The default, and the reason it is the default: a rotation is how a
    // workspace answers a compromised IdP key, and an overlap there would keep
    // the attacker's certificate valid for as long as it was convenient.
    const created = await create();

    const res = await server.patch(
      `/settings/sso/${created.id}`,
      { idp_certificate_pem: ROTATED_CERTIFICATE_PEM },
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(200);
    expect(wire(res)).toMatchObject({
      idp_certificate_pem: ROTATED_CERTIFICATE_PEM,
      previous_certificate_pem: null,
      previous_certificate_expires_at: null,
    });

    // Not merely hidden on the wire — gone from the row.
    const row = await owner.ssoConnection.findFirstOrThrow({ where: { id: created.id } });
    expect(row.previousCertificatePem).toBeNull();
    expect(row.previousCertificateExpiresAt).toBeNull();
  });

  it('bridges a planned key roll when the rotation asks for an overlap', async () => {
    const created = await create();
    const before = Date.now();

    const res = await server.patch(
      `/settings/sso/${created.id}`,
      { idp_certificate_pem: ROTATED_CERTIFICATE_PEM, retain_previous_certificate_hours: 24 },
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(200);
    expect(wire(res).idp_certificate_pem).toBe(ROTATED_CERTIFICATE_PEM);
    expect(wire(res).previous_certificate_pem).toBe(VALID_CERTIFICATE_PEM);

    const expiresAt = new Date(wire(res).previous_certificate_expires_at!).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 24 * 3_600_000);
    expect(expiresAt).toBeLessThan(before + 25 * 3_600_000);
  });

  it('bounds the overlap a rotation may ask for', async () => {
    const created = await create();
    const res = await server.patch(
      `/settings/sso/${created.id}`,
      { idp_certificate_pem: ROTATED_CERTIFICATE_PEM, retain_previous_certificate_hours: 169 },
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(400);
  });

  it('stops honouring an overlap once its window closes', async () => {
    // The property the design rests on. The row keeps the bytes until the next
    // write; nothing above `activePreviousCertificate` can tell they are there,
    // so a lapsed certificate is never one forgotten sweep away from verifying
    // an assertion.
    const created = await create();
    await server.patch(
      `/settings/sso/${created.id}`,
      { idp_certificate_pem: ROTATED_CERTIFICATE_PEM, retain_previous_certificate_hours: 1 },
      auth(ownerWriteToken),
    );

    await owner.ssoConnection.update({
      where: { id: created.id },
      data: { previousCertificateExpiresAt: new Date(Date.now() - 1_000) },
    });

    const res = await server.get('/settings/sso', auth(ownerToken));
    expect(items(res)[0]).toMatchObject({
      previous_certificate_pem: null,
      previous_certificate_expires_at: null,
    });
    // The row still holds them — this is about interpretation, not cleanup.
    const row = await owner.ssoConnection.findFirstOrThrow({ where: { id: created.id } });
    expect(row.previousCertificatePem).toBe(VALID_CERTIFICATE_PEM);
  });

  it('closes an open overlap on request, for when the old key turns out to be compromised', async () => {
    const created = await create();
    await server.patch(
      `/settings/sso/${created.id}`,
      { idp_certificate_pem: ROTATED_CERTIFICATE_PEM, retain_previous_certificate_hours: 48 },
      auth(ownerWriteToken),
    );

    const res = await server.patch(
      `/settings/sso/${created.id}`,
      { revoke_previous_certificate: true },
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(200);
    expect(wire(res).previous_certificate_pem).toBeNull();

    const row = await owner.ssoConnection.findFirstOrThrow({ where: { id: created.id } });
    expect(row.previousCertificatePem).toBeNull();
    expect(row.previousCertificateExpiresAt).toBeNull();
  });

  it('refuses rotation controls that would mean nothing', async () => {
    const created = await create();

    // An overlap with no rotation to bridge.
    expect(
      (
        await server.patch(
          `/settings/sso/${created.id}`,
          { retain_previous_certificate_hours: 24 },
          auth(ownerWriteToken),
        )
      ).statusCode,
    ).toBe(400);

    // "Retain" the certificate already in use — a form resubmit, not a rotation.
    expect(
      (
        await server.patch(
          `/settings/sso/${created.id}`,
          {
            idp_certificate_pem: VALID_CERTIFICATE_PEM,
            retain_previous_certificate_hours: 24,
          },
          auth(ownerWriteToken),
        )
      ).statusCode,
    ).toBe(400);

    // Revoke and rotate at once: the rotation already decides the old one's fate,
    // so honouring both would need an order nobody stated.
    expect(
      (
        await server.patch(
          `/settings/sso/${created.id}`,
          { idp_certificate_pem: ROTATED_CERTIFICATE_PEM, revoke_previous_certificate: true },
          auth(ownerWriteToken),
        )
      ).statusCode,
    ).toBe(400);
  });

  it('will not bridge from a certificate that is not usable itself', async () => {
    const created = await create();
    // Age the stored certificate out from under the connection.
    await owner.ssoConnection.update({
      where: { id: created.id },
      data: { idpCertificatePem: EXPIRED_CERTIFICATE_PEM },
    });

    const res = await server.patch(
      `/settings/sso/${created.id}`,
      { idp_certificate_pem: ROTATED_CERTIFICATE_PEM, retain_previous_certificate_hours: 24 },
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(400);
  });

  it('treats a resaved certificate as no rotation at all', async () => {
    // A settings form that resends every field must not silently drop a live
    // overlap. Compared by fingerprint, so re-wrapped PEM is still the same
    // certificate.
    const created = await create();
    await server.patch(
      `/settings/sso/${created.id}`,
      { idp_certificate_pem: ROTATED_CERTIFICATE_PEM, retain_previous_certificate_hours: 24 },
      auth(ownerWriteToken),
    );

    const res = await server.patch(
      `/settings/sso/${created.id}`,
      { name: 'Okta (corp, renamed)', idp_certificate_pem: ROTATED_CERTIFICATE_PEM },
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(200);
    expect(wire(res).name).toBe('Okta (corp, renamed)');
    expect(wire(res).previous_certificate_pem).toBe(VALID_CERTIFICATE_PEM);
  });

  it('will not switch on a connection whose certificate cannot verify anything', async () => {
    // Otherwise `enabled` advertises a door that refuses everyone, and the
    // failure surfaces as "SSO is broken" long after the change that caused it.
    const created = await create();
    await owner.ssoConnection.update({
      where: { id: created.id },
      data: { idpCertificatePem: EXPIRED_CERTIFICATE_PEM },
    });

    const refused = await server.patch(
      `/settings/sso/${created.id}`,
      { enabled: true },
      auth(ownerWriteToken),
    );
    expect(refused.statusCode).toBe(400);

    // Enabling in the same breath as a good certificate is fine.
    const accepted = await server.patch(
      `/settings/sso/${created.id}`,
      { enabled: true, idp_certificate_pem: ROTATED_CERTIFICATE_PEM },
      auth(ownerWriteToken),
    );
    expect(accepted.statusCode).toBe(200);
    expect(wire(accepted).enabled).toBe(true);
  });

  // --- Removal ---------------------------------------------------------------

  it('removes a connection, and answers 404 for one that is not there', async () => {
    const created = await create();

    expect(
      (await server.del(`/settings/sso/${created.id}`, auth(ownerWriteToken))).statusCode,
    ).toBe(204);
    expect(await owner.ssoConnection.count()).toBe(0);

    expect(
      (await server.del(`/settings/sso/${created.id}`, auth(ownerWriteToken))).statusCode,
    ).toBe(404);
  });

  // --- Cross-tenant ----------------------------------------------------------

  it("never writes, rotates or removes another workspace's federation", async () => {
    const theirs = await owner.ssoConnection.create({
      data: connection({ licenseId: fx.b.licenseId, name: 'Theirs' }),
    });

    // 404 rather than 403 throughout: a 403 would confirm the id is real and
    // turn it into an enumeration oracle (NFR-S5).
    const patched = await server.patch(
      `/settings/sso/${theirs.id}`,
      { idp_certificate_pem: ROTATED_CERTIFICATE_PEM },
      auth(ownerWriteToken),
    );
    expect(patched.statusCode).toBe(404);

    const deleted = await server.del(`/settings/sso/${theirs.id}`, auth(ownerWriteToken));
    expect(deleted.statusCode).toBe(404);

    // Untouched: this is the write that would plant an attacker-controlled trust
    // anchor against somebody else's accounts.
    const row = await owner.ssoConnection.findFirstOrThrow({ where: { id: theirs.id } });
    expect(row.idpCertificatePem).toBe(PEM);
    expect(row.name).toBe('Theirs');
  });

  // --- Audit trail -----------------------------------------------------------

  it('records who configured which trust anchor, without storing the certificate', async () => {
    const created = await create();

    const entries = await auditEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: 'settings.security_updated',
      target: `sso_connection:${created.id}`,
      actorId: fx.a.ownerAccountId,
    });

    const metadata = entries[0]!.metadata as Record<string, unknown>;
    expect(metadata['resource']).toBe('sso_connection');
    expect(metadata['operation']).toBe('created');
    expect(metadata['fields']).toEqual(
      expect.arrayContaining(['name', 'idp_entity_id', 'idp_sso_url', 'idp_certificate_pem']),
    );
    // The fingerprint answers "which certificate was installed" — a digest of a
    // public certificate, and what an IdP console shows next to it.
    expect(metadata['certificate_fingerprint']).toBe(VALID_CERTIFICATE_FINGERPRINT);
    // The certificate itself never reaches an append-only table nobody can scrub.
    expect(JSON.stringify(entries[0]!.metadata)).not.toContain('BEGIN CERTIFICATE');
    expect(JSON.stringify(entries[0]!.metadata)).not.toContain(
      VALID_CERTIFICATE_PEM.split('\n')[1],
    );
  });

  it('records a rotation and a removal too', async () => {
    const created = await create();
    await server.patch(
      `/settings/sso/${created.id}`,
      { idp_certificate_pem: ROTATED_CERTIFICATE_PEM },
      auth(ownerWriteToken),
    );
    await server.del(`/settings/sso/${created.id}`, auth(ownerWriteToken));

    const entries = await auditEntries();
    expect(entries.map((e) => (e.metadata as Record<string, unknown>)['operation'])).toEqual([
      'created',
      'updated',
      'deleted',
    ]);
    // A federation that quietly disappears is as much an incident as one that
    // quietly appears, so the delete names the connection it closed.
    expect(entries[2]!.target).toBe(`sso_connection:${created.id}`);
  });

  it('writes no audit entry for a change that was refused', async () => {
    // The trail records what happened, and a rejected write did not happen.
    await server.post(
      '/settings/sso',
      createBody({ idp_certificate_pem: EXPIRED_CERTIFICATE_PEM }),
      auth(ownerWriteToken),
    );
    await server.post('/settings/sso', createBody(), auth(adminWriteToken));

    expect(await auditEntries()).toHaveLength(0);
  });
});
