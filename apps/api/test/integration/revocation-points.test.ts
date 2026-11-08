/**
 * The API's revocation points close the sockets they revoke (tm 426.2 · the
 * 2026-11-06 audit's F08 · NFR-S2).
 *
 * tm 426.1 taught the gateway to close the sockets a `principal_revoked`
 * envelope names; this file is the other half — every place the API stops
 * honouring a credential announces it, after its commit. Two kinds of proof:
 *
 *   - **end to end**, against a real gateway process (`startRtmPod`, the same
 *     entrypoint the Dockerfile runs): a logged-in member socket closes with
 *     4401 when the member is suspended, signs out, has the token revoked, or
 *     loses the workspace or the account to the root panel — and a socket the
 *     revocation does not name hears the next push;
 *   - **on the bus**, for every other point: the envelope, its target, and —
 *     from inside the publish, on a separate connection — that the change was
 *     already committed when it went out (memory
 *     post-commit-publish-needs-an-in-publish-probe: a subscriber racing the
 *     commit cannot tell). A point that changes nothing publishes nothing.
 *
 * The bus is shared by every integration shard (pub/sub ignores the Redis
 * database index) and licence ids repeat across shard databases, so every
 * envelope is matched by its organization id, which is random per seed.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  licenseChannel,
  readPrincipalRevoked,
  type BusEnvelope,
  type PrincipalRevokedEnvelope,
  type PrincipalRevokedTarget,
} from '@siyahtus/types';
import { deriveCodeChallenge, generateToken, hashToken } from '../../src/lib/crypto.js';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import { hashToken as hashLinkToken } from '../../src/services/auth/lifecycle-service.js';
import { SubscriptionPeriodEnd } from '../../src/services/billing/subscription-cancel.js';
import { RealtimePublisher } from '../../src/services/realtime/publisher.js';
import {
  grantToken,
  ownerClient,
  platformClient,
  seedFixtures,
  testEnv,
  TEST_PASSWORD,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import { bearer, createOperator, openActiveSession, TestClock } from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { PodSocket } from '../helpers/pod-socket.js';
import { reserveFreePorts, startRtmPod, stopPods, type Pod } from '../helpers/pods.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const BOOT_TIMEOUT_MS = 120_000;
const CLOSE_TIMEOUT_MS = 10_000;
const CREDENTIAL_REVOKED = 4401;
const PUSH = 'routing_status_set';
const REASON = { reason: 'Revocation reaches the sockets (tm 426.2)' };
const MEMBER_SCOPES = ['chats--access:rw', 'agents--my:rw', 'agents--all:ro', 'accounts--my:rw'];

/**
 * Every `principal_revoked` envelope on the channels it listens to, in arrival
 * order. `settle()` publishes a marker on a channel of its own and waits for
 * it: one subscriber connection receives in the order Redis processed the
 * publishes, so everything the API published before the request answered has
 * arrived once the marker has — which is what makes "nothing was published" an
 * observation rather than a timeout.
 */
class RevocationBus {
  readonly #sub: Redis;
  readonly #pub: Redis;
  readonly #marker = `test:revocation-marker:${randomUUID()}`;
  readonly #seen: PrincipalRevokedEnvelope[] = [];
  #markers = 0;
  #waiting: { id: string; resolve: () => void } | null = null;

  private constructor(url: string) {
    this.#sub = new Redis(url);
    this.#pub = new Redis(url);
    this.#sub.on('message', (channel: string, raw: string) => {
      if (channel === this.#marker) {
        if (this.#waiting?.id === raw) this.#waiting.resolve();
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const envelope = readPrincipalRevoked(parsed);
      if (envelope && envelope !== 'malformed') this.#seen.push(envelope);
    });
  }

  static async open(url: string, licenseIds: bigint[]): Promise<RevocationBus> {
    const bus = new RevocationBus(url);
    await bus.#sub.subscribe(bus.#marker, ...licenseIds.map((id) => licenseChannel(id)));
    return bus;
  }

  async settle(): Promise<void> {
    const id = String(++this.#markers);
    const arrived = new Promise<void>((resolve) => {
      this.#waiting = { id, resolve };
    });
    await this.#pub.publish(this.#marker, id);
    await arrived;
  }

  /** The targets announced for this workspace since the last {@link clear}. */
  async targets(tenant: TenantFixture): Promise<PrincipalRevokedTarget[]> {
    await this.settle();
    return this.#seen
      .filter(
        (envelope) =>
          envelope.organizationId === tenant.organizationId &&
          envelope.licenseId === tenant.licenseId.toString(),
      )
      .map((envelope) => envelope.target);
  }

  clear(): void {
    this.#seen.length = 0;
  }

  async close(): Promise<void> {
    await Promise.all([this.#sub.quit(), this.#pub.quit()]);
  }
}

describe('the API announces every revocation to the gateways (tm 426.2)', () => {
  let owner: PrismaClient;
  let platformDb: PrismaClient;
  let server: TestServer;
  let platform: PlatformTestServer;
  let clock: TestClock;
  let rtm: Pod;
  let bus: RevocationBus;
  let pusher: Redis;
  let fx: Fixtures;
  let operatorToken: string;
  const sockets: PodSocket[] = [];

  beforeAll(async () => {
    owner = ownerClient();
    platformDb = platformClient();
    clock = new TestClock(Date.now());
    server = await startTestServer();
    platform = await buildPlatformTestServer(
      { RATE_LIMIT_PLATFORM_PER_MIN: '100000' },
      { now: clock.read, mailer: new MemoryMailer() },
    );
    const [port] = (await reserveFreePorts(1)) as [number];
    rtm = await startRtmPod('rtm', port);
    pusher = new Redis(testEnv().REDIS_URL);
  }, BOOT_TIMEOUT_MS);

  beforeEach(async () => {
    clock.now = Date.now();
    // Enterprise, for the SCIM points: directory provisioning is behind the
    // `sso` entitlement. Every test seeds the same plan, so a licence id the
    // next seed reuses never carries another plan in a per-licence cache.
    fx = await seedFixtures(owner, { plan: 'enterprise' });
    await clearRateLimits(server.app);
    bus = await RevocationBus.open(testEnv().REDIS_URL, [fx.a.licenseId, fx.b.licenseId]);
    const operator = await createOperator(platformDb, { role: 'superadmin', clock });
    operatorToken = await openActiveSession(platformDb, operator, clock);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const socket of sockets) socket.close();
    sockets.length = 0;
    await bus.close();
  });

  afterAll(async () => {
    await stopPods(rtm ? [rtm] : []);
    await pusher?.quit();
    await platform?.close();
    await server?.close();
    await platformDb?.$disconnect();
    await owner?.$disconnect();
  }, BOOT_TIMEOUT_MS);

  // --- helpers -----------------------------------------------------------------

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  function pat(tenant: TenantFixture, ownerId: string, scopes = MEMBER_SCOPES): Promise<string> {
    return grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId,
      scopes,
    });
  }

  async function tokenId(token: string): Promise<string> {
    const row = await owner.apiToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(token) },
      select: { id: true },
    });
    return row.id;
  }

  async function connect(tenant: TenantFixture, token: string) {
    const socket = await PodSocket.connect(rtm, { organizationId: tenant.organizationId });
    sockets.push(socket);
    const response = await socket.request('login', {
      token: `Bearer ${token}`,
      pushes: { '3.6': [PUSH] },
    });
    return { socket, response };
  }

  async function login(tenant: TenantFixture, token: string): Promise<PodSocket> {
    const { socket, response } = await connect(tenant, token);
    expect(response.success, JSON.stringify(response.payload)).toBe(true);
    return socket;
  }

  async function closedWith(socket: PodSocket): Promise<number> {
    const closed = await Promise.race([
      socket.closed,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CLOSE_TIMEOUT_MS)),
    ]);
    if (closed === null) throw new Error('the socket stayed open');
    return closed.code;
  }

  /** A push to every member of the workspace, published the way the API does. */
  async function pushToAll(tenant: TenantFixture, marker: string): Promise<void> {
    const envelope: BusEnvelope = {
      v: 1,
      licenseId: tenant.licenseId.toString(),
      organizationId: tenant.organizationId,
      action: PUSH,
      audience: { allAgents: true },
      payload: { marker },
      at: Date.now(),
    };
    await pusher.publish(licenseChannel(tenant.licenseId), JSON.stringify(envelope));
  }

  /** `socket` hears the next push of the workspace — the gateway is still serving it. */
  async function hearsNextPush(socket: PodSocket, tenant: TenantFixture): Promise<string> {
    const marker = randomUUID();
    const heard = socket.waitFor(
      (frame) =>
        frame.type === 'push' && frame.action === PUSH && frame.payload['marker'] === marker,
    );
    await pushToAll(tenant, marker);
    await heard;
    return marker;
  }

  /**
   * Run `probe` inside every revocation `redis` publishes, before it goes out —
   * on the test's own connection, which cannot see an uncommitted transaction.
   */
  function probeRevocations(
    redis: Redis,
    probe: (target: PrincipalRevokedTarget) => Promise<boolean>,
  ): boolean[] {
    const seen: boolean[] = [];
    const target = redis as unknown as {
      publish: (channel: string, message: string) => Promise<number>;
    };
    const original = target.publish.bind(redis);
    vi.spyOn(target, 'publish').mockImplementation(async (channel, message) => {
      const envelope = readPrincipalRevoked(JSON.parse(message));
      if (envelope && envelope !== 'malformed') seen.push(await probe(envelope.target));
      return original(channel, message);
    });
    return seen;
  }

  /** The probe for a `token` target: the row it names is already revoked. */
  async function tokenRevoked(target: PrincipalRevokedTarget): Promise<boolean> {
    if (target.kind !== 'token') return false;
    const row = await owner.apiToken.findUniqueOrThrow({
      where: { id: target.tokenId },
      select: { revokedAt: true },
    });
    return row.revokedAt !== null;
  }

  /** The tenant API's password sign-in, end to end: login → authorize → token. */
  async function signIn(tenant: TenantFixture, email: string) {
    const verifier = generateToken(48).slice(0, 64);
    const login = await server.post('/auth/login', { email, password: TEST_PASSWORD });
    expect(login.statusCode, login.body).toBe(200);
    const authorized = await server.post('/auth/authorize', {
      client_id: tenant.clientId,
      redirect_uri: tenant.redirectUri,
      code_challenge: deriveCodeChallenge(verifier),
      email,
      password: TEST_PASSWORD,
      license_id: tenant.licenseId.toString(),
    });
    expect(authorized.statusCode, authorized.body).toBe(200);
    const code = (authorized.json() as { code: string }).code;
    const exchange = () =>
      server.post('/auth/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: tenant.clientId,
        redirect_uri: tenant.redirectUri,
      });
    const exchanged = await exchange();
    expect(exchanged.statusCode, exchanged.body).toBe(200);
    return {
      grant: exchanged.json() as { access_token: string; refresh_token: string },
      exchange,
    };
  }

  async function refresh(tenant: TenantFixture, refreshToken: string) {
    return server.post('/auth/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: tenant.clientId,
    });
  }

  const platformPost = (path: string, body: Record<string, unknown> = {}) =>
    platform.app.inject({
      method: 'POST',
      url: `${PLATFORM_PREFIX}${path}`,
      headers: bearer(operatorToken),
      payload: { ...REASON, ...body },
    });

  async function joinB(accountId: string): Promise<void> {
    await owner.agentMembership.create({
      data: { licenseId: fx.b.licenseId, agentId: accountId, role: 'agent' },
    });
  }

  async function organizationName(tenant: TenantFixture): Promise<string> {
    const row = await owner.organization.findUniqueOrThrow({
      where: { id: tenant.organizationId },
      select: { name: true },
    });
    return row.name;
  }

  // --- end to end: a real gateway closes what the API revoked ------------------

  describe('a logged-in socket closes, and the next push does not reach it', () => {
    it('suspending a member closes every socket they hold; a teammate keeps hearing the workspace', async () => {
      const agentToken = await pat(fx.a, fx.a.agentAccountId);
      const agentSecond = await pat(fx.a, fx.a.agentAccountId);
      const ownerToken = await pat(fx.a, fx.a.ownerAccountId, ['agents--all:rw', 'agents--all:ro']);
      const agentSocket = await login(fx.a, agentToken);
      const agentTab = await login(fx.a, agentSecond);
      const ownerSocket = await login(fx.a, ownerToken);
      const committed = probeRevocations(server.app.redis, async () => {
        const row = await owner.agentMembership.findUniqueOrThrow({
          where: {
            licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
          },
          select: { suspended: true },
        });
        return row.suspended;
      });

      const response = await server.put(
        `/agents/${fx.a.agentAccountId}/suspension`,
        { suspended: true },
        auth(ownerToken),
      );
      expect(response.statusCode, response.body).toBe(200);

      expect(await closedWith(agentSocket)).toBe(CREDENTIAL_REVOKED);
      expect(await closedWith(agentTab)).toBe(CREDENTIAL_REVOKED);
      expect(committed).toEqual([true]);
      expect(await bus.targets(fx.a)).toEqual([{ kind: 'agent', agentId: fx.a.agentAccountId }]);
      const marker = await hearsNextPush(ownerSocket, fx.a);
      expect(agentSocket.pushes(PUSH).some((frame) => frame.payload['marker'] === marker)).toBe(
        false,
      );
      // The reconnect the client makes is refused: the membership is suspended.
      const again = await connect(fx.a, agentToken);
      expect(again.response.success).toBe(false);

      // Suspending again changes nothing and announces nothing; neither does
      // the reinstatement.
      bus.clear();
      const repeat = await server.put(
        `/agents/${fx.a.agentAccountId}/suspension`,
        { suspended: true },
        auth(ownerToken),
      );
      expect(repeat.statusCode).toBe(200);
      const reinstated = await server.put(
        `/agents/${fx.a.agentAccountId}/suspension`,
        { suspended: false },
        auth(ownerToken),
      );
      expect(reinstated.statusCode).toBe(200);
      expect(await bus.targets(fx.a)).toEqual([]);
    });

    it('signing out closes the socket the session opened, even after the REST client refreshed past its token', async () => {
      const { grant } = await signIn(fx.a, fx.a.agentEmail);
      // The panel's socket logs in with the access token it holds when it
      // connects; the REST client refreshes past it.
      const sessionSocket = await login(fx.a, grant.access_token);
      const refreshed = await refresh(fx.a, grant.refresh_token);
      expect(refreshed.statusCode, refreshed.body).toBe(200);
      const next = refreshed.json() as { access_token: string; refresh_token: string };
      const patSocket = await login(fx.a, await pat(fx.a, fx.a.agentAccountId));
      const first = await tokenId(grant.access_token);
      const second = await tokenId(next.access_token);
      const committed = probeRevocations(server.app.redis, tokenRevoked);

      // What the panel's sign-out sends (`auth-store.ts`): the access token it
      // holds now, then the refresh token.
      for (const token of [next.access_token, next.refresh_token]) {
        const revoked = await server.post('/auth/revoke', { token });
        expect(revoked.statusCode, revoked.body).toBe(200);
      }

      expect(await closedWith(sessionSocket)).toBe(CREDENTIAL_REVOKED);
      const targets = await bus.targets(fx.a);
      expect(targets).toContainEqual({ kind: 'token', tokenId: first });
      expect(targets).toContainEqual({ kind: 'token', tokenId: second });
      expect(committed).toEqual([true, true]);
      // The member's personal token is not the session: its socket stays.
      await hearsNextPush(patSocket, fx.a);
      expect(patSocket.isOpen()).toBe(true);
      expect((await connect(fx.a, grant.access_token)).response.success).toBe(false);
    });

    it('revoking a personal token closes its socket and only its socket', async () => {
      const revokedToken = await pat(fx.a, fx.a.agentAccountId);
      const keptToken = await pat(fx.a, fx.a.agentAccountId);
      const revokedSocket = await login(fx.a, revokedToken);
      const keptSocket = await login(fx.a, keptToken);
      const id = await tokenId(revokedToken);
      const committed = probeRevocations(server.app.redis, tokenRevoked);

      const response = await server.del(`/auth/personal-access-tokens/${id}`, auth(keptToken));
      expect(response.statusCode, response.body).toBe(204);

      expect(await closedWith(revokedSocket)).toBe(CREDENTIAL_REVOKED);
      expect(await bus.targets(fx.a)).toEqual([{ kind: 'token', tokenId: id }]);
      expect(committed).toEqual([true]);
      await hearsNextPush(keptSocket, fx.a);
    });

    it("suspending a workspace from the root panel closes its member sockets; another workspace's stay", async () => {
      const ownerSocket = await login(fx.a, await pat(fx.a, fx.a.ownerAccountId));
      const agentSocket = await login(fx.a, await pat(fx.a, fx.a.agentAccountId));
      const otherSocket = await login(fx.b, await pat(fx.b, fx.b.agentAccountId));
      const committed = probeRevocations(platform.app.redis, async () => {
        const row = await owner.license.findUniqueOrThrow({
          where: { id: fx.a.licenseId },
          select: { status: true },
        });
        return row.status === 'suspended';
      });

      const response = await platformPost(`/workspaces/${fx.a.licenseId}/suspend`);
      expect(response.statusCode, response.body).toBe(200);

      expect(await closedWith(ownerSocket)).toBe(CREDENTIAL_REVOKED);
      expect(await closedWith(agentSocket)).toBe(CREDENTIAL_REVOKED);
      expect(committed).toEqual([true]);
      expect(await bus.targets(fx.a)).toEqual([{ kind: 'license' }]);
      expect(await bus.targets(fx.b)).toEqual([]);
      await hearsNextPush(otherSocket, fx.b);

      // Already suspended: unchanged, nothing announced.
      bus.clear();
      const repeat = await platformPost(`/workspaces/${fx.a.licenseId}/suspend`);
      expect(repeat.statusCode, repeat.body).toBe(200);
      expect(await bus.targets(fx.a)).toEqual([]);
    });

    it("suspending an account from the root panel closes the person's sockets in every workspace", async () => {
      await joinB(fx.a.agentAccountId);
      const inA = await login(fx.a, await pat(fx.a, fx.a.agentAccountId));
      const inB = await login(fx.b, await pat(fx.b, fx.a.agentAccountId));
      const ownerSocket = await login(fx.a, await pat(fx.a, fx.a.ownerAccountId));
      const committed = probeRevocations(platform.app.redis, async () => {
        const row = await owner.account.findUniqueOrThrow({
          where: { id: fx.a.agentAccountId },
          select: { platformSuspendedAt: true },
        });
        return row.platformSuspendedAt !== null;
      });

      const response = await platformPost(`/accounts/${fx.a.agentAccountId}/suspend`);
      expect(response.statusCode, response.body).toBe(200);

      expect(await closedWith(inA)).toBe(CREDENTIAL_REVOKED);
      expect(await closedWith(inB)).toBe(CREDENTIAL_REVOKED);
      expect(committed).toEqual([true, true]);
      const agent = { kind: 'agent', agentId: fx.a.agentAccountId };
      expect(await bus.targets(fx.a)).toEqual([agent]);
      expect(await bus.targets(fx.b)).toEqual([agent]);
      await hearsNextPush(ownerSocket, fx.a);

      bus.clear();
      const repeat = await platformPost(`/accounts/${fx.a.agentAccountId}/suspend`);
      expect(repeat.statusCode, repeat.body).toBe(200);
      expect(await bus.targets(fx.a)).toEqual([]);
    });

    it("disabling an operator closes the socket their session as a member opened; the member's own stays (tm 430)", async () => {
      const impersonator = await createOperator(platformDb, { role: 'support', clock });
      const impersonatorToken = await openActiveSession(platformDb, impersonator, clock);
      const started = await platform.app.inject({
        method: 'POST',
        url: `${PLATFORM_PREFIX}/support/impersonations`,
        headers: bearer(impersonatorToken),
        payload: {
          ...REASON,
          license_id: fx.a.licenseId.toString(),
          account_id: fx.a.agentAccountId,
          mode: 'read_only',
        },
      });
      expect(started.statusCode, started.body).toBe(201);
      const handoff = new URL((started.json() as { handoff_url: string }).handoff_url);
      const code = decodeURIComponent(handoff.hash.replace(/^#code=/, ''));
      const traded = await server.post('/auth/impersonation/exchange', { code });
      expect(traded.statusCode, traded.body).toBe(200);
      const asMember = (traded.json() as { access_token: string }).access_token;
      const impersonationSocket = await login(fx.a, asMember);
      const memberSocket = await login(fx.a, await pat(fx.a, fx.a.agentAccountId));
      const id = await tokenId(asMember);
      const committed = probeRevocations(platform.app.redis, tokenRevoked);

      const response = await platformPost(`/admins/${impersonator.id}/disable`);
      expect(response.statusCode, response.body).toBe(200);

      expect(await closedWith(impersonationSocket)).toBe(CREDENTIAL_REVOKED);
      expect(await bus.targets(fx.a)).toEqual([{ kind: 'token', tokenId: id }]);
      expect(committed).toEqual([true]);
      await hearsNextPush(memberSocket, fx.a);
      expect((await connect(fx.a, asMember)).response.success).toBe(false);
    });
  });

  // --- on the bus: the other points --------------------------------------------

  describe('every other revocation point publishes, after its commit', () => {
    const membershipSuspended = () =>
      owner.agentMembership
        .findUniqueOrThrow({
          where: {
            licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
          },
          select: { suspended: true },
        })
        .then((row) => row.suspended);

    function scimToken(): Promise<string> {
      return grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        kind: 'scim',
        scopes: [],
      });
    }

    const scimHeaders = (token: string) => ({
      ...auth(token),
      'content-type': 'application/scim+json',
    });

    it('a SCIM deactivation announces the member, once', async () => {
      const token = await scimToken();
      const committed = probeRevocations(server.app.redis, membershipSuspended);
      const deactivate = { Operations: [{ op: 'replace', path: 'active', value: false }] };

      const response = await server.patch(
        `/scim/v2/Users/${fx.a.agentAccountId}`,
        deactivate,
        scimHeaders(token),
      );
      expect(response.statusCode, response.body).toBe(200);
      const repeat = await server.patch(
        `/scim/v2/Users/${fx.a.agentAccountId}`,
        deactivate,
        scimHeaders(token),
      );
      expect(repeat.statusCode, repeat.body).toBe(200);

      expect(await bus.targets(fx.a)).toEqual([{ kind: 'agent', agentId: fx.a.agentAccountId }]);
      expect(committed).toEqual([true]);
    });

    it('a SCIM deprovision announces the member, once', async () => {
      const token = await scimToken();
      const committed = probeRevocations(server.app.redis, membershipSuspended);

      for (let i = 0; i < 2; i += 1) {
        const response = await server.del(`/scim/v2/Users/${fx.a.agentAccountId}`, auth(token));
        expect(response.statusCode, response.body).toBe(204);
      }

      expect(await bus.targets(fx.a)).toEqual([{ kind: 'agent', agentId: fx.a.agentAccountId }]);
      expect(committed).toEqual([true]);
    });

    it('a password reset announces the member in every workspace they belong to', async () => {
      await joinB(fx.a.agentAccountId);
      const personal = await pat(fx.a, fx.a.agentAccountId);
      const link = 'r'.repeat(43);
      await owner.passwordResetToken.create({
        data: {
          accountId: fx.a.agentAccountId,
          tokenHash: hashLinkToken(link),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      const committed = probeRevocations(server.app.redis, async () => {
        const row = await owner.apiToken.findUniqueOrThrow({
          where: { tokenHash: hashToken(personal) },
          select: { revokedAt: true },
        });
        return row.revokedAt !== null;
      });

      const response = await server.post('/auth/password-reset/confirm', {
        token: link,
        password: 'a-brand-new-long-passphrase',
      });
      expect(response.statusCode, response.body).toBe(204);

      const agent = { kind: 'agent', agentId: fx.a.agentAccountId };
      expect(await bus.targets(fx.a)).toEqual([agent]);
      expect(await bus.targets(fx.b)).toEqual([agent]);
      expect(committed).toEqual([true, true]);
    });

    it('a refresh token presented twice ends its family and announces every access token in it', async () => {
      const { grant } = await signIn(fx.a, fx.a.agentEmail);
      const rotated = await refresh(fx.a, grant.refresh_token);
      expect(rotated.statusCode, rotated.body).toBe(200);
      const next = rotated.json() as { access_token: string };
      const ids = [await tokenId(grant.access_token), await tokenId(next.access_token)];
      const committed = probeRevocations(server.app.redis, tokenRevoked);

      const replayed = await refresh(fx.a, grant.refresh_token);
      expect(replayed.statusCode).toBe(401);

      const targets = await bus.targets(fx.a);
      expect(targets).toHaveLength(2);
      for (const id of ids) expect(targets).toContainEqual({ kind: 'token', tokenId: id });
      expect(committed).toEqual([true, true]);
    });

    it('an authorization code exchanged twice ends the sessions it produced and announces them', async () => {
      const { grant, exchange } = await signIn(fx.a, fx.a.agentEmail);
      const id = await tokenId(grant.access_token);
      const committed = probeRevocations(server.app.redis, tokenRevoked);

      const replayed = await exchange();
      expect(replayed.statusCode).toBe(401);

      expect(await bus.targets(fx.a)).toEqual([{ kind: 'token', tokenId: id }]);
      expect(committed).toEqual([true]);
    });

    it('revoking an access token alone announces that token, and nothing for an unknown one', async () => {
      const { grant } = await signIn(fx.a, fx.a.agentEmail);
      const id = await tokenId(grant.access_token);
      const committed = probeRevocations(server.app.redis, tokenRevoked);

      expect((await server.post('/auth/revoke', { token: grant.access_token })).statusCode).toBe(
        200,
      );
      expect((await server.post('/auth/revoke', { token: 'not-a-token' })).statusCode).toBe(200);

      expect(await bus.targets(fx.a)).toEqual([{ kind: 'token', tokenId: id }]);
      expect(committed).toEqual([true]);
    });

    it("the root panel's session and token revocations announce exactly the credentials they ended", async () => {
      await joinB(fx.a.agentAccountId);
      const inA = await signIn(fx.a, fx.a.agentEmail);
      const inB = await signIn(fx.b, fx.a.agentEmail);
      const personal = await pat(fx.a, fx.a.agentAccountId);
      const sessionA = await tokenId(inA.grant.access_token);
      const sessionB = await tokenId(inB.grant.access_token);
      const personalId = await tokenId(personal);
      const committed = probeRevocations(platform.app.redis, tokenRevoked);

      // Sessions only: the personal token stays, and is not announced.
      const sessions = await platformPost(`/accounts/${fx.a.agentAccountId}/revoke-sessions`);
      expect(sessions.statusCode, sessions.body).toBe(200);
      expect(await bus.targets(fx.a)).toEqual([{ kind: 'token', tokenId: sessionA }]);
      expect(await bus.targets(fx.b)).toEqual([{ kind: 'token', tokenId: sessionB }]);
      expect(committed).toEqual([true, true]);
      expect(await tokenRevoked({ kind: 'token', tokenId: personalId })).toBe(false);

      // Everything left: the personal token.
      bus.clear();
      const everything = await platformPost(`/accounts/${fx.a.agentAccountId}/revoke-tokens`);
      expect(everything.statusCode, everything.body).toBe(200);
      expect(await bus.targets(fx.a)).toEqual([{ kind: 'token', tokenId: personalId }]);
      expect(await bus.targets(fx.b)).toEqual([]);

      // A forced reset ends the sessions opened since.
      bus.clear();
      const again = await signIn(fx.a, fx.a.agentEmail);
      const forced = await platformPost(`/accounts/${fx.a.agentAccountId}/force-password-reset`);
      expect(forced.statusCode, forced.body).toBe(200);
      expect(await bus.targets(fx.a)).toEqual([
        { kind: 'token', tokenId: await tokenId(again.grant.access_token) },
      ]);
    });

    it('erasing an account from the root panel announces the person in every workspace', async () => {
      await joinB(fx.a.agentAccountId);
      const committed = probeRevocations(platform.app.redis, async () => {
        const row = await owner.account.findUnique({ where: { id: fx.a.agentAccountId } });
        return row === null || row.email !== fx.a.agentEmail;
      });

      const response = await platform.app.inject({
        method: 'POST',
        url: `${PLATFORM_PREFIX}/accounts/${fx.a.agentAccountId}/erase`,
        headers: bearer(operatorToken),
        payload: { ...REASON, confirm_email: fx.a.agentEmail },
      });
      expect(response.statusCode, response.body).toBe(200);

      const agent = { kind: 'agent', agentId: fx.a.agentAccountId };
      expect(await bus.targets(fx.a)).toEqual([agent]);
      expect(await bus.targets(fx.b)).toEqual([agent]);
      expect(committed).toEqual([true, true]);
    });

    it('scheduling a deletion suspends the workspace and announces it — unless it was suspended already', async () => {
      const committed = probeRevocations(platform.app.redis, async () => {
        const row = await owner.license.findUniqueOrThrow({
          where: { id: fx.a.licenseId },
          select: { status: true, purgeScheduledAt: true },
        });
        return row.status === 'suspended' && row.purgeScheduledAt !== null;
      });

      const scheduled = await platformPost(`/workspaces/${fx.a.licenseId}/delete`, {
        confirm_name: await organizationName(fx.a),
      });
      expect(scheduled.statusCode, scheduled.body).toBe(200);
      expect(await bus.targets(fx.a)).toEqual([{ kind: 'license' }]);
      expect(committed).toEqual([true]);

      // B is suspended first; its deletion announces nothing more.
      const suspended = await platformPost(`/workspaces/${fx.b.licenseId}/suspend`);
      expect(suspended.statusCode, suspended.body).toBe(200);
      bus.clear();
      const later = await platformPost(`/workspaces/${fx.b.licenseId}/delete`, {
        confirm_name: await organizationName(fx.b),
      });
      expect(later.statusCode, later.body).toBe(200);
      expect(await bus.targets(fx.b)).toEqual([]);
    });

    it('a workspace whose export window ended after a cancellation is closed and announced', async () => {
      const now = new Date();
      await owner.license.update({ where: { id: fx.a.licenseId }, data: { status: 'read_only' } });
      await owner.subscription.create({
        data: {
          licenseId: fx.a.licenseId,
          status: 'canceled',
          seats: 2,
          currentPeriodEnd: new Date(now.getTime() - 40 * 86_400_000),
          endedAt: new Date(now.getTime() - 31 * 86_400_000),
          exportUntil: new Date(now.getTime() - 86_400_000),
        },
      });
      const committed = probeRevocations(server.app.redis, async () => {
        const row = await owner.license.findUniqueOrThrow({
          where: { id: fx.a.licenseId },
          select: { status: true },
        });
        return row.status === 'canceled';
      });

      const report = await new SubscriptionPeriodEnd({
        db: owner,
        auditChainSecret: testEnv().AUDIT_CHAIN_SECRET,
        publisher: new RealtimePublisher(server.app.redis, server.app.log),
      }).run({ now });

      expect(report.closed).toBe(1);
      expect(await bus.targets(fx.a)).toEqual([{ kind: 'license' }]);
      expect(committed).toEqual([true]);
    });
  });
});
