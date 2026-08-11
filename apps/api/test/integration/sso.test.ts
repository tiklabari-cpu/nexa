/**
 * SSO connection read surface (NFR-S11 · S11-a).
 *
 * `GET /settings/sso` lists the SAML identity providers a workspace federates
 * sign-in to. It is deliberately the whole of S11-a: the write endpoint is
 * S11-a2, assertion validation S11-b, the SP endpoints S11-d. So the properties
 * worth testing here are not CRUD but the boundary around a read:
 *
 *   - Two gates, not one. `access_rules:*` says the token may read access
 *     rules; `admin` says the person behind it may. A row names the workspace's
 *     identity provider — reconnaissance for a targeted phish, and once S11-h
 *     makes SSO the only way in, a map of the single door.
 *   - One workspace never reads another's federation, proven through the API
 *     rather than only at the RLS layer (`data-model.test.ts` covers that side).
 *   - The response carries the certificate in full and nothing beyond the
 *     declared attribute-mapping keys.
 *
 * Rejections first: this is a security surface.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** Shaped like the certificate an IdP publishes; the bytes are not parsed here. */
const PEM = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n';

describe('sso connections — read surface', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let ownerToken: string;
  let agentWithScopeToken: string;
  let ownerNoScopeToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const errorType = (res: { json: () => unknown }) =>
    (res.json() as { error: { type: string } }).error.type;

  interface WireConnection {
    id: string;
    name: string;
    idp_entity_id: string;
    idp_sso_url: string;
    idp_certificate_pem: string;
    attribute_mapping: Record<string, string>;
    allow_idp_initiated: boolean;
    enabled: boolean;
    created_at: string;
    updated_at: string;
  }
  const items = (res: { json: () => unknown }) => (res.json() as { items: WireConnection[] }).items;

  /** A connection as the write endpoint (S11-a2) will store one. */
  const connection = (overrides: Record<string, unknown> = {}) => ({
    licenseId: fx.a.licenseId,
    name: 'Okta (corp)',
    idpEntityId: 'https://idp.example.test/saml/metadata',
    idpSsoUrl: 'https://idp.example.test/saml/sso',
    idpCertificatePem: PEM,
    ...overrides,
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
    fx = await seedFixtures(owner);
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
});
