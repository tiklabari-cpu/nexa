/**
 * First-run setup (FR-MOD-00.4) + Reports survey popover (FR-MOD-07.2).
 *
 * Three properties carry this suite. First, the sample-data seed is tenant-scoped:
 * it runs through a SECURITY DEFINER function that takes the tenant ids
 * explicitly, so a seed for one workspace must be invisible from another — the
 * same isolation guarantee the retention sweep is held to, and the reason a
 * second tenant exists in every fixture. Second, the two gates: `onboarding_completed`
 * rides along on `/auth/me`, `complete` is idempotent (skip and finish are one
 * call), and both writes need admin+ by scope *and* by role. Third, the survey
 * popover is a different shape on purpose: `reports_read`-gated like Reports
 * itself, no role check — a personalization signal, not workspace
 * configuration — and `answer: null` (a skip) is idempotent the same way
 * `complete` is.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { ADMIN_SCOPES, DEFAULT_AGENT_SCOPES } from '../../src/services/auth/principal.js';

interface State {
  completed: boolean;
  completed_at: string | null;
  demo_seeded: boolean;
  demo_seeded_at: string | null;
  survey_answer: string | null;
  survey_answered_at: string | null;
}

interface SeedResult {
  seeded: boolean;
  counts: { canned_responses: number; tags: number; customers: number; chats: number };
  state: State;
}

describe('onboarding (FR-MOD-00.4)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let ownerTokenA: string;
  let ownerTokenB: string;
  let agentTokenA: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const cannedCount = (licenseId: bigint) => owner.cannedResponse.count({ where: { licenseId } });
  const chatCount = (licenseId: bigint) => owner.chat.count({ where: { licenseId } });
  const demoVisitors = (organizationId: string) =>
    owner.customer.count({ where: { organizationId, name: 'Sample visitor' } });

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

    ownerTokenA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: [...ADMIN_SCOPES],
    });
    ownerTokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: [...ADMIN_SCOPES],
    });
    // An agent-role account. Even handed the configuration scope, the role gate
    // must still refuse it.
    agentTokenA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: [...DEFAULT_AGENT_SCOPES],
    });
  });

  // ==========================================================================
  // State + completion gate
  // ==========================================================================

  describe('state and completion', () => {
    it('a fresh workspace reads as not completed', async () => {
      const res = await server.get('/onboarding/state', auth(ownerTokenA));
      expect(res.statusCode).toBe(200);
      const state = res.json() as State;
      expect(state).toMatchObject({ completed: false, completed_at: null, demo_seeded: false });
    });

    it('/auth/me carries the onboarding gate for the shell', async () => {
      const before = (await server.get('/auth/me', auth(ownerTokenA))).json() as {
        onboarding_completed: boolean;
      };
      expect(before.onboarding_completed).toBe(false);

      await server.post('/onboarding/complete', undefined, auth(ownerTokenA));

      const after = (await server.get('/auth/me', auth(ownerTokenA))).json() as {
        onboarding_completed: boolean;
      };
      expect(after.onboarding_completed).toBe(true);
    });

    it('completing is idempotent — a second call keeps the original timestamp', async () => {
      const first = (
        await server.post('/onboarding/complete', undefined, auth(ownerTokenA))
      ).json() as State;
      expect(first.completed).toBe(true);
      expect(first.completed_at).not.toBeNull();

      const second = (
        await server.post('/onboarding/complete', undefined, auth(ownerTokenA))
      ).json() as State;
      expect(second.completed_at).toBe(first.completed_at);
    });
  });

  // ==========================================================================
  // Survey popover (FR-MOD-07.2)
  // ==========================================================================

  describe('survey popover', () => {
    it('a fresh workspace reads the survey as unanswered', async () => {
      const state = (await server.get('/onboarding/state', auth(ownerTokenA))).json() as State;
      expect(state.survey_answer).toBeNull();
      expect(state.survey_answered_at).toBeNull();
    });

    it('records a submitted answer', async () => {
      const res = await server.post(
        '/onboarding/survey',
        { answer: 'team_sharing' },
        auth(ownerTokenA),
      );
      expect(res.statusCode).toBe(200);
      const state = res.json() as State;
      expect(state.survey_answer).toBe('team_sharing');
      expect(state.survey_answered_at).not.toBeNull();
    });

    it('a skip (null answer) also gates it — idempotent, the original outcome sticks', async () => {
      const first = (
        await server.post('/onboarding/survey', { answer: null }, auth(ownerTokenA))
      ).json() as State;
      expect(first.survey_answer).toBeNull();
      expect(first.survey_answered_at).not.toBeNull();

      // A second call is accepted (200) but changes nothing — the skip already
      // answered it, the same idempotency `complete` has.
      const second = (
        await server.post('/onboarding/survey', { answer: 'other' }, auth(ownerTokenA))
      ).json() as State;
      expect(second.survey_answer).toBeNull();
      expect(second.survey_answered_at).toBe(first.survey_answered_at);
    });

    it('rejects an answer outside the five-option catalogue', async () => {
      const res = await server.post(
        '/onboarding/survey',
        { answer: 'not_a_real_option' },
        auth(ownerTokenA),
      );
      expect(res.statusCode).toBe(400);
    });

    it('is open to any caller who can read Reports — a personalization signal, not admin configuration', async () => {
      // A narrowly-scoped PAT on the agent-role account: only `reports_read`,
      // the same gate Reports itself is behind — not the admin
      // `properties.configuration:rw` the wizard's own writes require.
      const readOnlyToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['reports_read'],
      });
      const res = await server.post(
        '/onboarding/survey',
        { answer: 'spotting_problems' },
        auth(readOnlyToken),
      );
      expect(res.statusCode).toBe(200);
    });

    it('refuses a caller without reports_read', async () => {
      const res = await server.post('/onboarding/survey', { answer: 'other' }, auth(agentTokenA));
      expect(res.statusCode).toBe(403);
    });

    it('a survey answer for tenant A never appears in tenant B', async () => {
      await server.post('/onboarding/survey', { answer: 'revenue_impact' }, auth(ownerTokenA));
      const stateB = (await server.get('/onboarding/state', auth(ownerTokenB))).json() as State;
      expect(stateB.survey_answer).toBeNull();
      expect(stateB.survey_answered_at).toBeNull();
    });
  });

  // ==========================================================================
  // Sample data seed
  // ==========================================================================

  describe('sample data', () => {
    it('lays down saved replies, tags, a visitor and one conversation', async () => {
      const res = await server.post('/onboarding/seed-demo', undefined, auth(ownerTokenA));
      expect(res.statusCode).toBe(200);
      const result = res.json() as SeedResult;

      expect(result.seeded).toBe(true);
      expect(result.counts).toEqual({
        canned_responses: 3,
        tags: 2,
        customers: 1,
        chats: 1,
      });
      expect(result.state.demo_seeded).toBe(true);

      // The rows really landed, under tenant A.
      expect(await cannedCount(fx.a.licenseId)).toBe(3);
      expect(await chatCount(fx.a.licenseId)).toBe(1);
      expect(await owner.event.count({ where: { licenseId: fx.a.licenseId } })).toBe(3);
      expect(await demoVisitors(fx.a.organizationId)).toBe(1);

      // The sample conversation is active and assigned to the owner, so it shows
      // in their inbox on first run.
      const chat = await owner.chat.findFirst({ where: { licenseId: fx.a.licenseId } });
      expect(chat?.active).toBe(true);
    });

    it('is idempotent — a second call is a no-op with zero counts', async () => {
      await server.post('/onboarding/seed-demo', undefined, auth(ownerTokenA));
      const second = (
        await server.post('/onboarding/seed-demo', undefined, auth(ownerTokenA))
      ).json() as SeedResult;

      expect(second.seeded).toBe(false);
      expect(second.counts).toEqual({ canned_responses: 0, tags: 0, customers: 0, chats: 0 });
      // Still one set, not two.
      expect(await cannedCount(fx.a.licenseId)).toBe(3);
      expect(await chatCount(fx.a.licenseId)).toBe(1);
    });

    // ------------------------------------------------------------------------
    // Cross-tenant isolation (mandatory negative test)
    // ------------------------------------------------------------------------

    it('a seed for tenant A never appears in tenant B', async () => {
      await server.post('/onboarding/seed-demo', undefined, auth(ownerTokenA));

      // B has nothing from A's seed.
      expect(await cannedCount(fx.b.licenseId)).toBe(0);
      expect(await chatCount(fx.b.licenseId)).toBe(0);
      expect(await owner.tag.count({ where: { licenseId: fx.b.licenseId } })).toBe(0);
      expect(await demoVisitors(fx.b.organizationId)).toBe(0);

      // Seeding B in turn leaves A's set exactly as it was — isolation both ways.
      await server.post('/onboarding/seed-demo', undefined, auth(ownerTokenB));
      expect(await cannedCount(fx.a.licenseId)).toBe(3);
      expect(await cannedCount(fx.b.licenseId)).toBe(3);
      expect(await demoVisitors(fx.a.organizationId)).toBe(1);
      expect(await demoVisitors(fx.b.organizationId)).toBe(1);
    });
  });

  // ==========================================================================
  // Both gates: scope and role
  // ==========================================================================

  describe('authorization', () => {
    it('refuses an agent-role token even though it can read state', async () => {
      // Reading state is open to any signed-in agent…
      expect((await server.get('/onboarding/state', auth(agentTokenA))).statusCode).toBe(200);

      // …but neither write is, by scope (no configuration scope) nor role.
      expect(
        (await server.post('/onboarding/complete', undefined, auth(agentTokenA))).statusCode,
      ).toBe(403);
      expect(
        (await server.post('/onboarding/seed-demo', undefined, auth(agentTokenA))).statusCode,
      ).toBe(403);
      // And nothing was seeded despite the attempt.
      expect(await cannedCount(fx.a.licenseId)).toBe(0);
    });

    it('refuses an unauthenticated caller', async () => {
      expect((await server.get('/onboarding/state')).statusCode).toBe(401);
      expect((await server.post('/onboarding/complete')).statusCode).toBe(401);
    });
  });
});
