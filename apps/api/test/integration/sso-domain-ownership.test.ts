/**
 * Proving a domain, and what a workspace can and cannot do without proving it
 * (NFR-S11 · PLAN §D134 — §D116 MEDIUM (a), reopened).
 *
 * §D125 confined just-in-time provisioning to `verified_domains` and hardened
 * everything about the *shape* of a claim: exact equality, no suffix, no
 * wildcard, an empty list admits nobody, and the gate sits inside two SECURITY
 * DEFINER resolvers no route can skip. What it left open is who may make the
 * claim, and the answer was "the workspace itself" — which is no answer at all,
 * because the threat actor in the original finding is that workspace's owner.
 * `exactRole: 'owner'` is the narrowest gate in the product and it does not
 * constrain the person standing behind it.
 *
 * So the first test here is the attack, and it is written to fail against the
 * code as it stood before this suite existed: a workspace claims a domain it
 * has nothing to do with and asks its own identity provider to assert an
 * address inside it. Before, that returned a session. Now it is refused until
 * somebody reading `postmaster@` at that domain answers a challenge.
 *
 * The rest is the proof flow itself and the four ways it could be got around:
 * a token that is guessed, replayed, expired, or simply skipped by dropping the
 * domain from the list and putting it back.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VALID_CERTIFICATE_PEM } from '../helpers/certificates.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { FileMailer } from '../../src/services/mail/mailer.js';

/** The domain nobody in this test controls — the victim in §D116 MEDIUM (a). */
const VICTIM_DOMAIN = 'victim-corp.example';

interface WireDomain {
  domain: string;
  verified: boolean;
  verified_at: string | null;
  challenge_mailbox: string | null;
  challenge_sent_at: string | null;
}

interface WireConnection {
  id: string;
  verified_domains: string[];
  domains: WireDomain[];
}

describe('sso domain ownership', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let mailer: FileMailer;
  let mailDir: string;
  let fx: Fixtures;
  let ownerWriteToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const errorType = (res: { json: () => unknown }) =>
    (res.json() as { error: { type: string } }).error.type;
  const message = (res: { json: () => unknown }) =>
    (res.json() as { error: { message: string } }).error.message;

  const createBody = (domains: string[]) => ({
    name: 'Okta (corp)',
    idp_entity_id: 'https://idp.example.test/saml/metadata',
    idp_sso_url: 'https://idp.example.test/saml/sso',
    idp_certificate_pem: VALID_CERTIFICATE_PEM,
    verified_domains: domains,
  });

  async function createConnection(domains: string[]): Promise<WireConnection> {
    const res = await server.post('/settings/sso', createBody(domains), auth(ownerWriteToken));
    expect(res.statusCode, JSON.stringify(res.json())).toBe(201);
    return res.json() as WireConnection;
  }

  const challenge = (id: string, domain: string, body: Record<string, unknown> = {}) =>
    server.post(`/settings/sso/${id}/domains/${domain}/challenge`, body, auth(ownerWriteToken));

  const verify = (id: string, domain: string, token: string) =>
    server.post(`/settings/sso/${id}/domains/${domain}/verify`, { token }, auth(ownerWriteToken));

  /**
   * The code that landed in the mailbox.
   *
   * Read out of the spool rather than out of the database, because the database
   * only holds a digest — which is the property under test as much as anything
   * else here. The message is what somebody at the domain actually receives.
   */
  async function mailedToken(domain: string): Promise<string> {
    const outbox = await mailer.outbox();
    const letter = outbox.find((m) => m.subject.includes(domain));
    expect(letter, `no challenge was mailed for ${domain}`).toBeDefined();
    const code = /Verification code: (\S+)/.exec(letter!.body)?.[1];
    expect(code, 'the message carried no code').toBeTruthy();
    return code!;
  }

  /** Claim a domain and prove it, the way a real workspace would. */
  async function prove(id: string, domain: string): Promise<void> {
    const sent = await challenge(id, domain);
    expect(sent.statusCode, JSON.stringify(sent.json())).toBe(202);
    const res = await verify(id, domain, await mailedToken(domain));
    expect(res.statusCode, JSON.stringify(res.json())).toBe(200);
  }

  beforeAll(async () => {
    owner = ownerClient();
    // A real spool: the token exists only in the message, so a mock that keeps
    // nothing would leave this suite testing the endpoints and not the flow.
    mailDir = await mkdtemp(join(tmpdir(), 'nexa-sso-domains-'));
    mailer = new FileMailer(mailDir);
    server = await startTestServer({}, { mailer });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
    await rm(mailDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner, { plan: 'enterprise' });
    await clearRateLimits(server.app);
    // One spool per test. Several assertions here are "nothing was mailed",
    // which a shared directory would turn into "nothing was mailed since the
    // suite started" — true of no test after the first.
    await rm(mailDir, { recursive: true, force: true });
    ownerWriteToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
  });

  // --- The finding itself ---------------------------------------------------

  it('will not provision from a domain the workspace merely claimed', async () => {
    // The attack, end to end at the resolver: a workspace with `sso` writes
    // somebody else's domain into its own connection and asks the provisioning
    // function for an address inside it. Before §D134 this returned an account
    // id and a fresh membership — the two halves of §D116 — because the list it
    // was checked against was the list the attacker had just written.
    const created = await createConnection([VICTIM_DOMAIN]);

    const [result] = await owner.$queryRaw<
      Array<{
        account_id: string | null;
        account_created: boolean;
        membership_created: boolean;
        domain_rejected: boolean;
      }>
    >`SELECT * FROM auth_provision_sso_account(
        ${created.id}::uuid, ${`ceo@${VICTIM_DOMAIN}`}::citext, 'CEO', 'agent')`;

    expect(result).toEqual({
      account_id: null,
      account_created: false,
      membership_created: false,
      domain_rejected: true,
    });
    // And no row was left behind for the address to be squatted with.
    expect(await owner.account.count({ where: { email: `ceo@${VICTIM_DOMAIN}` } })).toBe(0);
  });

  it('provisions from that same domain once ownership is proved', async () => {
    // The other half of the finding: the rule has to be a gate, not a wall. The
    // only thing that changed between this test and the one above is that
    // somebody reading `postmaster@` at the domain answered.
    const created = await createConnection([VICTIM_DOMAIN]);
    await prove(created.id, VICTIM_DOMAIN);

    const [result] = await owner.$queryRaw<
      Array<{ account_id: string | null; membership_created: boolean; domain_rejected: boolean }>
    >`SELECT * FROM auth_provision_sso_account(
        ${created.id}::uuid, ${`ceo@${VICTIM_DOMAIN}`}::citext, 'CEO', 'agent')`;

    expect(result!.domain_rejected).toBe(false);
    expect(result!.membership_created).toBe(true);
    expect(result!.account_id).toBeTruthy();
  });

  it('leaves an existing member signing in, proved or not', async () => {
    // The one relaxation §D134 makes, and the reason for it. The harm in §D116
    // is two acts of *creation* — a membership nobody consented to, and an
    // account row for an address that never signed up. Somebody who already
    // holds both is not being adopted by their next sign-in, and refusing them
    // would lock every federation that predates this migration out of its own
    // workspace, since the lists it inherited were derived facts and never
    // proofs.
    const created = await createConnection(['acme.test']);
    const existing = await owner.account.findFirst({ where: { id: fx.a.agentAccountId } });

    const [result] = await owner.$queryRaw<
      Array<{ account_id: string | null; membership_created: boolean; domain_rejected: boolean }>
    >`SELECT * FROM auth_provision_sso_account(
        ${created.id}::uuid, ${existing!.email}::citext, 'Agent', 'agent')`;

    expect(result!.domain_rejected).toBe(false);
    // Nothing was created: the membership was already there and stays untouched.
    expect(result!.membership_created).toBe(false);
    expect(result!.account_id).toBe(fx.a.agentAccountId);
  });

  it('refuses a stranger whose account exists but who is not a member', async () => {
    // The gap the relaxation above could have opened. "Already has an account"
    // is not consent — squatting is off the table for them, but adoption is
    // exactly what §D116 named, so an unproved domain must still refuse.
    const created = await createConnection([VICTIM_DOMAIN]);
    const stranger = await owner.account.create({
      data: { email: `cfo@${VICTIM_DOMAIN}`, name: 'CFO', passwordHash: null },
    });

    const [result] = await owner.$queryRaw<
      Array<{ membership_created: boolean; domain_rejected: boolean }>
    >`SELECT * FROM auth_provision_sso_account(
        ${created.id}::uuid, ${stranger.email}::citext, 'CFO', 'agent')`;

    expect(result).toEqual({
      account_id: null,
      account_created: false,
      membership_created: false,
      domain_rejected: true,
    });
    expect(
      await owner.agentMembership.count({
        where: { licenseId: fx.a.licenseId, agentId: stranger.id },
      }),
    ).toBe(0);
  });

  // --- The proof flow -------------------------------------------------------

  it('mails a code to a reserved mailbox at the domain, and never returns it', async () => {
    const created = await createConnection(['acme.test']);

    const sent = await challenge(created.id, 'acme.test');
    expect(sent.statusCode).toBe(202);
    expect(sent.json()).toMatchObject({
      domain: 'acme.test',
      verified: false,
      verified_at: null,
      challenge_mailbox: 'postmaster@acme.test',
    });

    const outbox = await mailer.outbox();
    const letter = outbox.find((m) => m.subject.includes('acme.test'));
    expect(letter!.to).toBe('postmaster@acme.test');
    // The message says plainly that ignoring it is safe. Its most likely reader
    // did not ask for it, so a message that pressured them would be a phishing
    // template we wrote ourselves.
    expect(letter!.body).toContain('ignore this message');

    // The token is in the message and nowhere else the caller can reach: the
    // response carries no code, and the row carries only a digest.
    const code = await mailedToken('acme.test');
    expect(JSON.stringify(sent.json())).not.toContain(code);
    const row = await owner.ssoDomainVerification.findFirst({ where: { domain: 'acme.test' } });
    expect(row!.tokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row!.tokenHash).not.toBe(code);
  });

  it('accepts the mailed code once, and never again', async () => {
    const created = await createConnection(['acme.test']);
    const sent = await challenge(created.id, 'acme.test');
    expect(sent.statusCode).toBe(202);
    const code = await mailedToken('acme.test');

    const first = await verify(created.id, 'acme.test', code);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ domain: 'acme.test', verified: true });

    // The digest is discarded when the token is spent, so a replay finds
    // nothing to compare against. (The endpoint answers 200 because the domain
    // *is* proved — a retried request must not read as a failure of the thing
    // it is retrying — but no second proof was created and no code was needed.)
    const row = await owner.ssoDomainVerification.findFirst({ where: { domain: 'acme.test' } });
    expect(row!.tokenHash).toBeNull();
    const replay = await verify(created.id, 'acme.test', code);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ verified: true });
  });

  it('moves the domain into verified_domains only after the code comes back', async () => {
    const created = await createConnection(['acme.test', 'corp.acme.test']);
    expect(created.verified_domains).toEqual([]);

    await prove(created.id, 'acme.test');

    const list = await server.get('/settings/sso', auth(ownerWriteToken));
    const [connection] = (list.json() as { items: WireConnection[] }).items;
    expect(connection!.verified_domains).toEqual(['acme.test']);
    // Both claims are still listed — the screen has to be able to show the one
    // that is still pending, or an owner cannot tell a domain that failed from
    // a domain nobody has got round to.
    expect(connection!.domains.map((d) => [d.domain, d.verified])).toEqual([
      ['acme.test', true],
      ['corp.acme.test', false],
    ]);
  });

  it('refuses a wrong code without consuming the challenge', async () => {
    const created = await createConnection(['acme.test']);
    await challenge(created.id, 'acme.test');
    const code = await mailedToken('acme.test');

    const wrong = await verify(created.id, 'acme.test', 'not-the-code');
    expect(wrong.statusCode).toBe(400);
    expect(errorType(wrong)).toBe('validation');

    // The outstanding challenge survives on purpose: consuming it would let
    // anybody holding a stale token — or simply guessing — lock the workspace
    // out of proving its own domain.
    const retry = await verify(created.id, 'acme.test', code);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ verified: true });
  });

  it('refuses a code past its window, and says so', async () => {
    const created = await createConnection(['acme.test']);
    await challenge(created.id, 'acme.test');
    const code = await mailedToken('acme.test');

    // Aged in the row rather than by waiting three days. The expiry is computed
    // from `challenge_sent_at`, so moving it is the same as time passing.
    await owner.ssoDomainVerification.updateMany({
      where: { domain: 'acme.test' },
      data: { challengeSentAt: new Date(Date.now() - 73 * 3_600_000) },
    });

    const res = await verify(created.id, 'acme.test', code);
    expect(res.statusCode).toBe(400);
    expect(message(res)).toContain('expired');
  });

  it('refuses a verify with no challenge outstanding', async () => {
    const created = await createConnection(['acme.test']);
    const res = await verify(created.id, 'acme.test', 'anything');
    expect(res.statusCode).toBe(400);
    expect(message(res)).toContain('No verification code');
  });

  it('will not mail a second challenge straight away', async () => {
    // The endpoint sends mail to an address the *caller* names, so an unbounded
    // one is a way to make this product mail a stranger's postmaster on demand.
    // Bounded from the row's own timestamp, so the bound does not disappear
    // when a cache does.
    const created = await createConnection(['acme.test']);
    expect((await challenge(created.id, 'acme.test')).statusCode).toBe(202);

    const again = await challenge(created.id, 'acme.test');
    expect(again.statusCode).toBe(400);
    expect(message(again)).toContain('Wait a minute');

    // A minute later it goes out again — this is a bound, not a one-shot.
    await owner.ssoDomainVerification.updateMany({
      where: { domain: 'acme.test' },
      data: { challengeSentAt: new Date(Date.now() - 61_000) },
    });
    expect((await challenge(created.id, 'acme.test')).statusCode).toBe(202);
  });

  it('will not challenge a domain that is already proved', async () => {
    const created = await createConnection(['acme.test']);
    await prove(created.id, 'acme.test');

    const res = await challenge(created.id, 'acme.test');
    expect(res.statusCode).toBe(400);
    expect(message(res)).toContain('already verified');
  });

  it('sends only to a reserved local part, whatever the caller asks for', async () => {
    // The security property of the closed set: an arbitrary mailbox would let
    // the claimant nominate one they already control, which is the finding with
    // an extra step.
    const created = await createConnection([VICTIM_DOMAIN]);

    const attacker = await challenge(created.id, VICTIM_DOMAIN, { mailbox: 'attacker' });
    expect(attacker.statusCode).toBe(400);
    expect(errorType(attacker)).toBe('validation');
    const injected = await challenge(created.id, VICTIM_DOMAIN, {
      mailbox: 'me@attacker.example',
    });
    expect(injected.statusCode).toBe(400);
    expect(await mailer.outbox()).toHaveLength(0);

    // One of the five is fine.
    const allowed = await challenge(created.id, VICTIM_DOMAIN, { mailbox: 'webmaster' });
    expect(allowed.statusCode).toBe(202);
    expect(allowed.json()).toMatchObject({ challenge_mailbox: `webmaster@${VICTIM_DOMAIN}` });
  });

  it('finds the domain however the URL spells it', async () => {
    const created = await createConnection(['acme.test']);
    const res = await challenge(created.id, 'ACME.test.');
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ domain: 'acme.test' });
  });

  it('answers 404 for a domain the connection does not claim', async () => {
    const created = await createConnection(['acme.test']);
    const res = await challenge(created.id, 'other.test');
    expect(res.statusCode).toBe(404);
    expect(await mailer.outbox()).toHaveLength(0);
  });

  // --- The ways a proof could be got around ---------------------------------

  it('keeps a proof when the same list is saved again', async () => {
    // A PATCH that resends the list is what a form submission looks like, and
    // resetting the verification on every save would make the feature unusable
    // in the ordinary case.
    const created = await createConnection(['acme.test']);
    await prove(created.id, 'acme.test');

    const res = await server.patch(
      `/settings/sso/${created.id}`,
      { verified_domains: ['acme.test', 'corp.acme.test'] },
      auth(ownerWriteToken),
    );
    expect(res.statusCode).toBe(200);
    expect((res.json() as WireConnection).verified_domains).toEqual(['acme.test']);
  });

  it('destroys the proof when the domain leaves the list, and does not restore it', async () => {
    // Otherwise "remove it and add it back" is a way to keep a proof for a
    // domain the workspace has stopped claiming — and, worse, a way to inherit
    // one. Dropping the claim drops the proof; re-adding starts over.
    const created = await createConnection(['acme.test']);
    await prove(created.id, 'acme.test');

    const dropped = await server.patch(
      `/settings/sso/${created.id}`,
      { verified_domains: ['corp.acme.test'] },
      auth(ownerWriteToken),
    );
    expect(dropped.statusCode).toBe(200);
    expect(await owner.ssoDomainVerification.count({ where: { domain: 'acme.test' } })).toBe(0);

    const restored = await server.patch(
      `/settings/sso/${created.id}`,
      { verified_domains: ['acme.test'] },
      auth(ownerWriteToken),
    );
    expect(restored.statusCode).toBe(200);
    expect((restored.json() as WireConnection).verified_domains).toEqual([]);
  });

  it('ignores a proof whose claim is gone, even written straight into the table', async () => {
    // The fail-closed half of "two tables must not drift". The resolvers
    // intersect proofs with the claim list, so a row that outlived its claim —
    // a trigger that did not fire, a hand-written UPDATE — provisions nobody.
    const created = await createConnection(['acme.test']);
    await owner.ssoDomainVerification.create({
      data: {
        connectionId: created.id,
        licenseId: fx.a.licenseId,
        domain: VICTIM_DOMAIN,
        verifiedAt: new Date(),
      },
    });

    const [proved] = await owner.$queryRaw<
      Array<{ sso_connection_proved_domains: string[] }>
    >`SELECT sso_connection_proved_domains(${created.id}::uuid)`;
    expect(proved!.sso_connection_proved_domains).toEqual([]);
  });

  it('never lets one workspace prove a domain on a connection it does not own', async () => {
    const created = await createConnection(['acme.test']);
    const outsider = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['access_rules:rw'],
    });

    // 404 rather than 403: row level security scopes the read, so a foreign
    // connection id matches nothing and the ids stay un-enumerable (NFR-S5).
    const sent = await server.post(
      `/settings/sso/${created.id}/domains/acme.test/challenge`,
      {},
      auth(outsider),
    );
    expect(sent.statusCode).toBe(404);
    expect(await mailer.outbox()).toHaveLength(0);
  });

  it('records the challenge and the proof, and neither records the code', async () => {
    const created = await createConnection(['acme.test']);
    await prove(created.id, 'acme.test');
    const code = await mailedToken('acme.test');

    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'settings.security_updated' },
      orderBy: { createdAt: 'asc' },
    });
    const domainEntries = entries.filter(
      (e) => (e.metadata as { resource?: string }).resource === 'sso_domain',
    );
    expect(domainEntries.map((e) => (e.metadata as { operation: string }).operation)).toEqual([
      'challenge_sent',
      'verified',
    ]);
    for (const entry of domainEntries) {
      expect(entry.metadata).toMatchObject({
        domain: 'acme.test',
        mailbox: 'postmaster@acme.test',
      });
      expect(JSON.stringify(entry.metadata)).not.toContain(code);
    }
  });
});
