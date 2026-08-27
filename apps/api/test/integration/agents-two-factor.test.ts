/**
 * GET /agents reflects real two-factor enrollment (S11-2FA-h).
 *
 * The Teammates table's 2FA column (`TeamPage.tsx`) reads `two_factor_enabled`
 * off the membership row that `TwoFactorService.activate`/`disable` write
 * (S11-2FA-d/e). Before that wiring the column had no writer at all — this
 * proves the column now tracks a real enrollment end to end, through the same
 * two HTTP endpoints the Settings screen and the Team screen actually call,
 * rather than trusting that the plumbing lines up.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { generateTotp } from '../../src/lib/totp.js';

describe('GET /agents two-factor column (S11-2FA-h)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;

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
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents--all:ro'],
    });
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it('is false before enrollment, true right after activation, and untouched for a colleague who never enrolled', async () => {
    const ownerSession = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--my:rw'],
    });

    const rowFor = (
      body: { items: Array<{ id: string; two_factor_enabled: boolean }> },
      id: string,
    ) => body.items.find((agent) => agent.id === id);

    const before = await server.get('/agents', auth(adminToken));
    expect(before.statusCode).toBe(200);
    expect(rowFor(before.json(), fx.a.ownerAccountId)?.two_factor_enabled).toBe(false);

    const enroll = await server.post('/auth/2fa/enroll', undefined, auth(ownerSession));
    expect(enroll.statusCode).toBe(200);
    const activate = await server.post(
      '/auth/2fa/activate',
      { code: generateTotp(enroll.json().secret as string, Date.now()) },
      auth(ownerSession),
    );
    expect(activate.statusCode).toBe(200);

    const after = await server.get('/agents', auth(adminToken));
    expect(after.statusCode).toBe(200);
    expect(rowFor(after.json(), fx.a.ownerAccountId)?.two_factor_enabled).toBe(true);
    // A teammate who never touched /auth/2fa still reads false — activating
    // one account is not a blanket flip for the whole roster.
    expect(rowFor(after.json(), fx.a.agentAccountId)?.two_factor_enabled).toBe(false);
  });
});
