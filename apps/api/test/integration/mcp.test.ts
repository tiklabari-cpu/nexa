/**
 * MCP server discovery — FR-MOD-08.8.3-b. `GET /mcp/manifest` is the surface an
 * MCP client reads before it calls anything.
 *
 * The properties under test are boundary properties first, so the negatives
 * lead: an unauthenticated caller is refused, and a customer (widget) token is
 * turned away with a 404 (not a 403) so the agent tool surface cannot be mapped
 * from the widget (I4/NFR-S5). Only then the happy path — the four named tools —
 * and the isolation property that matters for a *static* catalogue: two different
 * licenses get byte-for-byte the same document, with no tenant identifier in it.
 *
 * The tool-call surface (`POST /mcp/tools/{tool}`), its scope gate and the
 * cross-tenant data tests belong to 08.8.3-c and are not exercised here.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MCP_PROTOCOL_VERSION } from '../../src/routes/mcp.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** The four tools the PRD names (KK "search_tickets/list_chats/get_report/summarize_chat"). */
const EXPECTED_TOOLS = ['search_tickets', 'list_chats', 'get_report', 'summarize_chat'];

interface ManifestTool {
  name: string;
  title: string;
  description: string;
  input_schema: Record<string, unknown>;
  required_scopes: string[];
}
interface Manifest {
  protocol_version: string;
  server: { name: string; url: string; version: string };
  tools: ManifestTool[];
}

describe('MCP manifest (FR-MOD-08.8.3-b)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let tokenA: string;
  let tokenB: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** A short-lived customer (widget) token for a license, minted the real way. */
  async function widgetToken(tenant = fx.a): Promise<string> {
    const res = await server.post(
      '/customer/token',
      { organization_id: tenant.organizationId },
      { origin: `https://${tenant.trustedDomain}` },
    );
    expect(res.statusCode).toBe(200);
    return (res.json() as { token: string }).token;
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

    // Two agents on two different licenses. A no-scope PAT is enough: the
    // manifest requires none, which is exactly the property proven below.
    tokenA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: [],
    });
    tokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: [],
    });
  });

  // --- Authentication boundary (negative first) ------------------------------

  it('refuses an unauthenticated caller with 401', async () => {
    const res = await server.get('/mcp/manifest');
    expect(res.statusCode).toBe(401);
  });

  it('refuses an unknown/garbage token with 401', async () => {
    const res = await server.get('/mcp/manifest', auth('not-a-real-token'));
    expect(res.statusCode).toBe(401);
  });

  it('hides the tool surface from a customer (widget) token behind a 404', async () => {
    // 404 rather than 403: the principal-kind gate must not confirm the endpoint
    // exists to a widget-facing credential (NFR-S5).
    const res = await server.get('/mcp/manifest', auth(await widgetToken()));
    expect(res.statusCode).toBe(404);
  });

  // --- Discovery (happy path) ------------------------------------------------

  it('lists exactly the four named tools with their schemas and scopes', async () => {
    const res = await server.get('/mcp/manifest', auth(tokenA));
    expect(res.statusCode).toBe(200);

    const body = res.json() as Manifest;
    expect(body.tools.map((t) => t.name)).toEqual(EXPECTED_TOOLS);

    for (const tool of body.tools) {
      expect(tool.title).toBeTruthy();
      expect(tool.description).toBeTruthy();
      // A usable descriptor: a JSON-Schema object and a non-empty scope list.
      expect(tool.input_schema).toMatchObject({ type: 'object' });
      expect(Array.isArray(tool.required_scopes)).toBe(true);
      expect(tool.required_scopes.length).toBeGreaterThan(0);
    }
  });

  it('advertises the server URL and protocol version', async () => {
    const res = await server.get('/mcp/manifest', auth(tokenA));
    const body = res.json() as Manifest;

    expect(body.protocol_version).toBe(MCP_PROTOCOL_VERSION);
    expect(body.server.name).toBe('nexa');
    expect(body.server.version).toBeTruthy();
    // The URL an MCP client points at: the mcp mount under the API prefix.
    expect(body.server.url).toMatch(/\/api\/v1\/mcp$/);
    expect(() => new URL(body.server.url)).not.toThrow();
  });

  // --- Isolation: a static catalogue leaks nothing tenant-specific -----------

  it('returns the same catalogue to two licenses, with no tenant identifier', async () => {
    const resA = await server.get('/mcp/manifest', auth(tokenA));
    const resB = await server.get('/mcp/manifest', auth(tokenB));
    expect(resA.statusCode).toBe(200);
    expect(resB.statusCode).toBe(200);

    // Byte-for-byte identical — the catalogue is static, not derived from who asked.
    expect(resA.json()).toEqual(resB.json());

    // And nothing tenant-specific rides along in either response.
    for (const raw of [resA.payload, resB.payload]) {
      expect(raw).not.toContain('license_id');
      expect(raw).not.toContain('organization_id');
      expect(raw).not.toContain(fx.a.organizationId);
      expect(raw).not.toContain(fx.b.organizationId);
      expect(raw).not.toContain(String(fx.a.licenseId));
      expect(raw).not.toContain(String(fx.b.licenseId));
    }
  });
});
