/**
 * Terms of service acceptance at sign-up (tm 257.9 · ADR
 * docs/adr/pilot-public-readiness.md K-f · PLAN §D203).
 *
 * With `TERMS_URL` set, `POST /auth/signup` must carry the `terms_version` the
 * deployment shows (`GET /deployment`), and the acceptance is written on the
 * new workspace's licence, with that version, inside `auth_signup` — the
 * transaction that creates the workspace. What is pinned here:
 *
 *   - a refusal writes nothing, and the two refusals are told apart
 *     (`terms_not_accepted` · `terms_outdated`) — the panel shows different
 *     text for each, and mixing them up sends someone round a loop;
 *   - the check sits where the task put it: after the body is parsed and the
 *     closed-sign-up refusal, before the region gate and the write;
 *   - with no `TERMS_URL` the field is ignored and the licence carries nothing
 *     — the flag-off behaviour every existing sign-up test pins unchanged;
 *   - the database half: an older API's call shape still works, and the two
 *     columns are null together or set together.
 *
 * Derived pilot operations work: no Ek A catalogue ID, so no requirement tag.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, seedFixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PASSWORD = 'a-quite-long-passphrase';
const LEGAL = {
  PRIVACY_POLICY_URL: 'https://siyahtus.test/privacy',
  TERMS_URL: 'https://siyahtus.test/terms',
  TERMS_VERSION: '2026-10-01',
};

function signupBody(email: string, extra: Record<string, unknown> = {}) {
  return {
    email,
    password: PASSWORD,
    name: 'Founder',
    organization_name: 'TermsCo',
    ...extra,
  };
}

describe('terms of service acceptance at sign-up', () => {
  let owner: PrismaClient;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await seedFixtures(owner);
  });

  async function withServer(
    overrides: Record<string, string | undefined>,
    body: (server: TestServer) => Promise<void>,
  ): Promise<void> {
    const server = await startTestServer(overrides);
    try {
      await clearRateLimits(server.app);
      await body(server);
    } finally {
      await clearRateLimits(server.app);
      await server.close();
    }
  }

  /** The licence the sign-up created for `email`, read as the table owner. */
  async function licenceOf(email: string) {
    const account = await owner.account.findUniqueOrThrow({ where: { email } });
    const membership = await owner.agentMembership.findFirstOrThrow({
      where: { agentId: account.id, role: 'owner' },
    });
    return owner.license.findUniqueOrThrow({ where: { id: membership.licenseId } });
  }

  /** Nothing of a refused sign-up may exist: no account, no organization. */
  async function expectNothingWritten(email: string, organizationsBefore: number) {
    expect(await owner.account.findUnique({ where: { email } })).toBeNull();
    expect(await owner.organization.count()).toBe(organizationsBefore);
  }

  describe('with TERMS_URL set', () => {
    it('refuses a sign-up without terms_version as terms_not_accepted, writing nothing', async () => {
      await withServer(LEGAL, async (server) => {
        const before = await owner.organization.count();
        const response = await server.post('/auth/signup', signupBody('nobox@terms.test'));

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toMatchObject({
          type: 'validation',
          details: { reason: 'terms_not_accepted' },
        });
        await expectNothingWritten('nobox@terms.test', before);
      });
    });

    it('refuses an earlier version as terms_outdated, writing nothing', async () => {
      await withServer(LEGAL, async (server) => {
        const before = await owner.organization.count();
        const response = await server.post(
          '/auth/signup',
          signupBody('stale@terms.test', { terms_version: '2026-01-01' }),
        );

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toMatchObject({
          type: 'validation',
          details: { reason: 'terms_outdated' },
        });
        await expectNothingWritten('stale@terms.test', before);
      });
    });

    it('records the accepted version and its time on the new licence, and audits it', async () => {
      await withServer(LEGAL, async (server) => {
        const startedAt = Date.now();
        const response = await server.post(
          '/auth/signup',
          signupBody('agreed@terms.test', { terms_version: '2026-10-01' }),
        );

        expect(response.statusCode).toBe(201);
        const licence = await licenceOf('agreed@terms.test');
        expect(licence.termsVersion).toBe('2026-10-01');
        expect(licence.termsAcceptedAt).not.toBeNull();
        expect(licence.termsAcceptedAt!.getTime()).toBeGreaterThanOrEqual(startedAt - 5_000);
        expect(licence.termsAcceptedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);

        const entries = await owner.auditLogEntry.findMany({
          where: { licenseId: licence.id, action: 'compliance.terms_accepted' },
        });
        expect(entries).toHaveLength(1);
        expect(entries[0]!.metadata).toMatchObject({ terms_version: '2026-10-01' });
      });
    });

    it('answers the closed sign-up refusal first, before asking for the terms', async () => {
      await withServer({ ...LEGAL, SIGNUP_ENABLED: 'false' }, async (server) => {
        const response = await server.post('/auth/signup', signupBody('closed@terms.test'));

        expect(response.statusCode).toBe(403);
        expect(response.json().error).toMatchObject({
          type: 'not_allowed',
          details: { reason: 'signup_closed' },
        });
      });
    });

    it('reads the body first: a malformed body is a plain validation error, not a terms one', async () => {
      await withServer(LEGAL, async (server) => {
        const response = await server.post('/auth/signup', {
          ...signupBody('not-an-address'),
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().error.type).toBe('validation');
        expect(response.json().error.details?.reason).toBeUndefined();
      });
    });

    it('refuses a terms_version longer than 64 characters as malformed', async () => {
      await withServer(LEGAL, async (server) => {
        const response = await server.post(
          '/auth/signup',
          signupBody('long@terms.test', { terms_version: 'v'.repeat(65) }),
        );

        expect(response.statusCode).toBe(400);
        expect(response.json().error.details?.reason).toBeUndefined();
      });
    });

    it('asks for the terms before the region gate answers', async () => {
      // `eu` deployment (the test default), `us` requested, box not ticked:
      // the terms refusal comes first, so the 421 is never reached.
      await withServer(LEGAL, async (server) => {
        const response = await server.post(
          '/auth/signup',
          signupBody('elsewhere@terms.test', { region: 'us' }),
        );

        expect(response.statusCode).toBe(400);
        expect(response.json().error.details).toMatchObject({ reason: 'terms_not_accepted' });
      });
    });

    it('records the acceptance with email verification on as well (tm 257.7)', async () => {
      await withServer({ ...LEGAL, SIGNUP_EMAIL_VERIFICATION: 'true' }, async (server) => {
        const refused = await server.post('/auth/signup', signupBody('both-no@terms.test'));
        expect(refused.statusCode).toBe(400);
        expect(refused.json().error.details).toMatchObject({ reason: 'terms_not_accepted' });

        const response = await server.post(
          '/auth/signup',
          signupBody('both@terms.test', { terms_version: '2026-10-01' }),
        );
        expect(response.statusCode).toBe(202);
        await server.app.backgroundMail.settled();

        const licence = await licenceOf('both@terms.test');
        expect(licence.termsVersion).toBe('2026-10-01');
        expect(licence.termsAcceptedAt).not.toBeNull();
        const account = await owner.account.findUniqueOrThrow({
          where: { email: 'both@terms.test' },
        });
        expect(account.emailVerifiedAt).toBeNull();
      });
    });
  });

  describe('with no TERMS_URL', () => {
    it('ignores terms_version, records nothing on the licence and writes no audit entry', async () => {
      await withServer(
        { PRIVACY_POLICY_URL: undefined, TERMS_URL: undefined, TERMS_VERSION: undefined },
        async (server) => {
          const plain = await server.post('/auth/signup', signupBody('plain@terms.test'));
          expect(plain.statusCode).toBe(201);
          // Any value, even one no deployment shows, is ignored rather than stored.
          const sent = await server.post(
            '/auth/signup',
            signupBody('sent@terms.test', { terms_version: 'whatever' }),
          );
          expect(sent.statusCode).toBe(201);

          for (const email of ['plain@terms.test', 'sent@terms.test']) {
            const licence = await licenceOf(email);
            expect(licence.termsVersion).toBeNull();
            expect(licence.termsAcceptedAt).toBeNull();
            expect(
              await owner.auditLogEntry.count({
                where: { licenseId: licence.id, action: 'compliance.terms_accepted' },
              }),
            ).toBe(0);
          }
        },
      );
    });

    it('requires no terms when only a privacy policy is named', async () => {
      await withServer(
        {
          PRIVACY_POLICY_URL: LEGAL.PRIVACY_POLICY_URL,
          TERMS_URL: undefined,
          TERMS_VERSION: undefined,
        },
        async (server) => {
          const response = await server.post('/auth/signup', signupBody('privacy@terms.test'));
          expect(response.statusCode).toBe(201);
          expect((await licenceOf('privacy@terms.test')).termsVersion).toBeNull();
        },
      );
    });
  });

  describe('the database half', () => {
    it("still serves the previous release's call shape, recording no acceptance", async () => {
      // An API from before this migration passes eight arguments (tm 257.7's
      // signature) — during a rollout it is still answering sign-ups.
      const rows = await owner.$queryRaw<Array<{ created_license: bigint }>>`
        SELECT created_license FROM auth_signup(
          'older-api@terms.test'::citext, 'Founder', 'not-a-real-hash', 'OlderCo', 14, 'eu',
          'http://localhost:5173/auth/callback', TRUE
        )`;
      const licence = await owner.license.findUniqueOrThrow({
        where: { id: rows[0]!.created_license },
      });
      expect(licence.termsVersion).toBeNull();
      expect(licence.termsAcceptedAt).toBeNull();
    });

    it('keeps the time and the version null together or set together', async () => {
      const rows = await owner.$queryRaw<Array<{ created_license: bigint }>>`
        SELECT created_license FROM auth_signup(
          'check@terms.test'::citext, 'Founder', 'not-a-real-hash', 'CheckCo', 14, 'eu',
          'http://localhost:5173/auth/callback', TRUE, '2026-10-01'
        )`;
      const id = rows[0]!.created_license;
      const licence = await owner.license.findUniqueOrThrow({ where: { id } });
      expect(licence.termsVersion).toBe('2026-10-01');
      expect(licence.termsAcceptedAt).not.toBeNull();

      await expect(
        owner.license.update({ where: { id }, data: { termsAcceptedAt: null } }),
      ).rejects.toThrow(/licenses_terms_acceptance_check/);
      await expect(
        owner.license.update({ where: { id }, data: { termsVersion: null } }),
      ).rejects.toThrow(/licenses_terms_acceptance_check/);
    });
  });
});
