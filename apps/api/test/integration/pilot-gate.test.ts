/**
 * The pilot's refusal gate (tm 257.13 · ADR docs/adr/pilot-public-readiness.md
 * K-c), on the real server with every real plugin in front of it.
 *
 * The real refused routes are proven where they live — billing writes and the
 * HIPAA BAA in `pilot-billing.test.ts` (257.2); channels (257.3) and apps
 * (257.18) follow — so the gate itself is proven on routes this
 * file registers itself: one public and one that needs a credential, both
 * flagged `pilotRefused`, plus a path-list surface and an unflagged control.
 * Every refusal is checked twice: with the switch on it is 403 `pilot_mode`
 * and the handler never runs; with it off the very same request reaches the
 * handler, which is what "off changes nothing" means here.
 *
 * Derived pilot operations work: no Ek A catalogue ID, so no requirement tag.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PilotRefusedPath } from '../../src/plugins/pilot-gate.js';
import { API_PREFIX, buildServer } from '../../src/server.js';
import { grantToken, ownerClient, seedFixtures, testEnv } from '../helpers/fixtures.js';
import { clearRateLimits } from '../helpers/server.js';

const BASE = `${API_PREFIX}/__pilot-test`;

/** Refused by path rather than by flag: writes under `/prefixed/`, and one exact GET. */
const PATHS: readonly PilotRefusedPath[] = [
  { methods: ['PATCH', 'DELETE'], pathRegex: /^\/api\/v1\/__pilot-test\/prefixed\// },
  { methods: ['GET'], pathRegex: /^\/api\/v1\/__pilot-test\/read-refused$/ },
];

interface Harness {
  app: FastifyInstance;
  /** Handler names in the order they ran — a refusal must leave no entry. */
  reached: string[];
  send: (options: InjectOptions) => Promise<LightMyRequestResponse>;
}

async function startHarness(pilotMode: 'true' | 'false'): Promise<Harness> {
  const app = await buildServer({
    env: testEnv({ PILOT_MODE: pilotMode }),
    pilotRefusedPaths: PATHS,
  });
  const reached: string[] = [];
  await app.register(
    async (scope) => {
      const handler = (name: string) => async () => {
        reached.push(name);
        return { reached: name };
      };
      scope.post(
        '/public-refused',
        { config: { public: true, pilotRefused: true } },
        handler('public-refused'),
      );
      scope.post('/authed-refused', { config: { pilotRefused: true } }, handler('authed-refused'));
      scope.post('/open', { config: { public: true } }, handler('open'));
      scope.get('/prefixed/item', { config: { public: true } }, handler('prefixed-get'));
      scope.patch('/prefixed/item', { config: { public: true } }, handler('prefixed-patch'));
      scope.get('/read-refused', { config: { public: true } }, handler('read-refused'));
    },
    { prefix: BASE },
  );
  await app.ready();
  await clearRateLimits(app);
  return { app, reached, send: (options) => app.inject(options) };
}

function expectPilotRefusal(response: LightMyRequestResponse): void {
  expect(response.statusCode).toBe(403);
  const { error } = response.json();
  expect(error.type).toBe('not_allowed');
  expect(error.details).toStrictEqual({ reason: 'pilot_mode' });
}

describe('pilot gate', () => {
  let owner: PrismaClient;
  let token: string;

  beforeAll(async () => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  beforeEach(async () => {
    const fx = await seedFixtures(owner);
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--my:ro'],
    });
  });

  describe('with PILOT_MODE=true', () => {
    let h: Harness;

    beforeEach(async () => {
      h = await startHarness('true');
    });

    afterEach(async () => {
      await clearRateLimits(h.app);
      await h.app.close();
    });

    it('refuses a flagged public route, with no principal at all', async () => {
      expectPilotRefusal(await h.send({ method: 'POST', url: `${BASE}/public-refused` }));
      expect(h.reached).toEqual([]);
    });

    it('refuses a flagged route that needs a credential, holding a good one', async () => {
      const response = await h.send({
        method: 'POST',
        url: `${BASE}/authed-refused`,
        headers: { authorization: `Bearer ${token}` },
      });
      expectPilotRefusal(response);
      expect(h.reached).toEqual([]);
    });

    it('still answers 401 to no credential on a route that needs one — authentication speaks first', async () => {
      const response = await h.send({ method: 'POST', url: `${BASE}/authed-refused` });
      expect(response.statusCode).toBe(401);
      expect(h.reached).toEqual([]);
    });

    it('refuses before the body is parsed: a malformed JSON body gets the 403, not a 400', async () => {
      for (const url of [`${BASE}/public-refused`, `${BASE}/prefixed/item`]) {
        const response = await h.send({
          method: url.endsWith('item') ? 'PATCH' : 'POST',
          url,
          headers: { 'content-type': 'application/json' },
          payload: '{"broken',
        });
        expectPilotRefusal(response);
      }
      expect(h.reached).toEqual([]);
    });

    it('matches the path list by method: GET passes, PATCH is refused', async () => {
      const read = await h.send({ method: 'GET', url: `${BASE}/prefixed/item` });
      expect(read.statusCode).toBe(200);

      expectPilotRefusal(await h.send({ method: 'PATCH', url: `${BASE}/prefixed/item` }));
      expect(h.reached).toEqual(['prefixed-get']);
    });

    it('cannot be stepped around with a query string or a percent-encoded segment', async () => {
      // The router decodes `%70` to `p` and serves the real handler, while
      // `request.url` keeps the raw string — so the gate matches the route.
      for (const url of [
        `${BASE}/prefixed/item?then=write`,
        `${API_PREFIX}/__pilot-test/%70refixed/item`,
        `${API_PREFIX}/__pilot-test/prefixed/%69tem`,
      ]) {
        expectPilotRefusal(await h.send({ method: 'PATCH', url }));
      }
      expectPilotRefusal(await h.send({ method: 'GET', url: `${BASE}/read-refused?x=1` }));
      expect(h.reached).toEqual([]);
    });

    it('refuses HEAD where it refuses GET — Fastify serves HEAD from the GET handler', async () => {
      expectPilotRefusal(await h.send({ method: 'GET', url: `${BASE}/read-refused` }));
      const head = await h.send({ method: 'HEAD', url: `${BASE}/read-refused` });
      expect(head.statusCode).toBe(403);
      expect(h.reached).toEqual([]);
    });

    it('leaves an unflagged route alone', async () => {
      const response = await h.send({ method: 'POST', url: `${BASE}/open` });
      expect(response.statusCode).toBe(200);
      expect(h.reached).toEqual(['open']);
    });
  });

  describe('with PILOT_MODE=false', () => {
    let h: Harness;

    beforeEach(async () => {
      h = await startHarness('false');
    });

    afterEach(async () => {
      await clearRateLimits(h.app);
      await h.app.close();
    });

    it('reaches every handler the switch would refuse', async () => {
      const authed = { authorization: `Bearer ${token}` };
      expect((await h.send({ method: 'POST', url: `${BASE}/public-refused` })).statusCode).toBe(
        200,
      );
      expect(
        (await h.send({ method: 'POST', url: `${BASE}/authed-refused`, headers: authed }))
          .statusCode,
      ).toBe(200);
      expect((await h.send({ method: 'PATCH', url: `${BASE}/prefixed/item` })).statusCode).toBe(
        200,
      );
      expect((await h.send({ method: 'GET', url: `${BASE}/read-refused` })).statusCode).toBe(200);
      expect(h.reached).toEqual([
        'public-refused',
        'authed-refused',
        'prefixed-patch',
        'read-refused',
      ]);
    });

    it('parses the body as before: a malformed JSON body is a 400 again', async () => {
      const response = await h.send({
        method: 'POST',
        url: `${BASE}/public-refused`,
        headers: { 'content-type': 'application/json' },
        payload: '{"broken',
      });
      expect(response.statusCode).toBe(400);
      expect(h.reached).toEqual([]);
    });
  });
});
