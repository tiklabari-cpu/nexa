/**
 * Shareable report links — the "link" half of "Share export/link"
 * (FR-MOD-07.3.1).
 *
 * This slice opens the first anonymous read of *tenant business data* in the
 * product. The public knowledge base already serves org-scoped content without a
 * session, but it serves what a workspace deliberately published; this serves
 * conversation volume, response times and satisfaction to whoever holds a URL.
 * So the properties under test are the boundary itself, and the negatives are
 * written and asserted before the positives, in the order the requirement is
 * actually defended in:
 *
 *   - **cross-tenant**: tenant A's share token resolves to A's figures and can
 *     never carry B's, whatever B has in the same window;
 *   - a link is **time-limited** — an expired token no longer resolves;
 *   - a link is **revocable** — a revoked token no longer resolves, and
 *     revocation cannot be undone by revoking again;
 *   - a link is **scope-limited** — it answers for the one group it was minted
 *     for, and a token that may not read a group may not mint a link to it
 *     either (fail closed, so minting cannot launder a missing permission into
 *     an anonymous URL that has it);
 *   - the **raw token leaks nowhere**: not into the list response, not into the
 *     row (hash + last four only), not into the request log at `trace`, and not
 *     into the audit trail.
 *
 * Only then the positive: a live token reads the right report, and the table it
 * gets is byte-identical to the CSV export of the same group and window — which
 * is the structural guarantee that a share can never expose more than an export
 * already does.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { hashToken } from '../../src/lib/crypto.js';
import { MAX_LIVE_SHARE_LINKS } from '../../src/services/reports/report-share.js';

interface ShareLink {
  id: string;
  group: string;
  from: string;
  to: string;
  token_last_four: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  expired: boolean;
}

interface CreatedShareLink extends ShareLink {
  token: string;
}

interface SharedReport {
  group: string;
  label: string;
  from: string;
  to: string;
  generated_at: string;
  expires_at: string;
  headers: string[];
  rows: Array<Array<string | number | null>>;
}

interface ErrorBody {
  error: { message: string };
}

/** `JSON.stringify` that survives a row's `licenseId` BigInt. */
const dump = (value: unknown): string =>
  JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item));

const LINKS = '/reports/share-links';
const SHARED = '/reports/shared';

/** Collects the lines pino actually wrote, so the leak assertion is on output. */
class LineSink {
  readonly lines: string[] = [];
  write(chunk: string): boolean {
    this.lines.push(chunk);
    return true;
  }
  end(): void {}
  on(): void {}
  once(): void {}
  emit(): boolean {
    return false;
  }
}

describe('report share links (FR-MOD-07.3.1)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  /** Owner-role token holding both halves: may manage sharing, may read reports. */
  let manageToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const mint = (token: string, body: unknown = { group: 'overview' }) =>
    server.post(LINKS, body, auth(token));

  const mintOk = async (body: unknown = { group: 'overview' }): Promise<CreatedShareLink> => {
    const response = await mint(manageToken, body);
    expect(response.statusCode).toBe(201);
    return response.json() as CreatedShareLink;
  };

  const list = async (token = manageToken): Promise<ShareLink[]> => {
    const response = await server.get(LINKS, auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: ShareLink[] }).items;
  };

  const read = (token: string) => server.get(`${SHARED}?token=${encodeURIComponent(token)}`);

  /**
   * One closed chat in the named tenant, dated now — the smallest thing the
   * Overview report counts. `chats` is the row the cross-tenant assertion reads.
   */
  async function seedChat(which: 'a' | 'b'): Promise<void> {
    const tenant = fx[which];
    const customer = await owner.customer.create({
      data: { organizationId: tenant.organizationId, name: `Visitor ${which}` },
      select: { id: true },
    });
    const chatId = generateShortId();
    const at = new Date();
    await owner.chat.create({
      data: { id: chatId, licenseId: tenant.licenseId, customerId: customer.id, createdAt: at },
    });
    await owner.thread.create({
      data: {
        id: generateShortId(),
        chatId,
        licenseId: tenant.licenseId,
        active: false,
        createdAt: at,
        closedAt: at,
      },
    });
  }

  /**
   * Move a link wholly into the past — minted eight days ago, lapsed one day
   * ago — which is exactly the state the clock would have produced. Both stamps
   * move together because `report_share_links_expires_after_created_check`
   * refuses a row whose expiry precedes its own creation, and that constraint is
   * the point: an expiry cannot be dragged backwards to fake one, and the way to
   * cut a live link off early is to revoke it.
   */
  const agePastExpiry = async (id: string): Promise<void> => {
    const day = 86_400_000;
    await owner.reportShareLink.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - 8 * day), expiresAt: new Date(Date.now() - day) },
    });
  };

  /** The `chats` figure out of an Overview share payload. */
  const chatsIn = (report: SharedReport): number => {
    const row = report.rows.find((cells) => cells[0] === 'chats');
    expect(row).toBeDefined();
    return Number(row?.[1]);
  };

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
    manageToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_manage', 'reports_read'],
    });
  });

  // --- Cross-tenant: the one that must never regress -------------------------

  it("a share token never opens another workspace's figures", async () => {
    // A has one chat in the window; B has three. If the shared read were ever
    // to resolve its tenant from anything but the link's own row, the figure
    // would move — and this is the assertion that would catch it.
    await seedChat('a');
    await seedChat('b');
    await seedChat('b');
    await seedChat('b');

    const link = await mintOk({ group: 'overview' });
    const response = await read(link.token);
    expect(response.statusCode).toBe(200);

    const report = response.json() as SharedReport;
    expect(chatsIn(report)).toBe(1);
  });

  it("one workspace cannot revoke another's link", async () => {
    const link = await mintOk();
    const bToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['reports_manage', 'reports_read'],
    });

    // 404, not 403: a 403 would confirm the id names something in another
    // workspace, which is itself a cross-tenant fact.
    const response = await server.del(`${LINKS}/${link.id}`, auth(bToken));
    expect(response.statusCode).toBe(404);
    // And the link is untouched — the refusal is not a partial write.
    expect((await read(link.token)).statusCode).toBe(200);
  });

  it("another workspace's list does not show the link", async () => {
    await mintOk();
    const bToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['reports_manage', 'reports_read'],
    });

    expect(await list(bToken)).toEqual([]);
  });

  // --- Time-limited ----------------------------------------------------------

  it('an expired token no longer resolves', async () => {
    const link = await mintOk();
    expect((await read(link.token)).statusCode).toBe(200);

    await agePastExpiry(link.id);

    const response = await read(link.token);
    expect(response.statusCode).toBe(404);
  });

  it('refuses a lifetime longer than the cap, rather than clamping it', async () => {
    // Clamping would hand back a link that expires 275 days before the caller
    // believes it does, with nothing in the response saying so.
    const response = await mint(manageToken, { group: 'overview', expires_in_days: 365 });
    expect(response.statusCode).toBe(400);
  });

  it('always stamps an expiry, even when the caller names none', async () => {
    const link = await mintOk();
    expect(new Date(link.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(link.expired).toBe(false);
  });

  it('flags an expired link in the list instead of hiding it', async () => {
    const link = await mintOk();
    await agePastExpiry(link.id);

    // "Why did my link stop working?" has to be answerable from the screen; a
    // row that vanishes the moment it lapses answers it with nothing.
    const [row] = await list();
    expect(row?.id).toBe(link.id);
    expect(row?.expired).toBe(true);
  });

  // --- Revocable -------------------------------------------------------------

  it('a revoked token no longer resolves', async () => {
    const link = await mintOk();
    expect((await read(link.token)).statusCode).toBe(200);

    expect((await server.del(`${LINKS}/${link.id}`, auth(manageToken))).statusCode).toBe(204);

    const response = await read(link.token);
    expect(response.statusCode).toBe(404);
  });

  it('stamps the revocation rather than deleting the row', async () => {
    const link = await mintOk();
    await server.del(`${LINKS}/${link.id}`, auth(manageToken));

    // The record that this access existed and was withdrawn is what an access
    // review is for; a deleted row says neither.
    const row = await owner.reportShareLink.findUnique({ where: { id: link.id } });
    expect(row?.revokedAt).not.toBeNull();
    // …and it leaves the "who can read our numbers" list, because its answer
    // to that question is now no.
    expect(await list()).toEqual([]);
  });

  it('revoking twice does not move the stamp', async () => {
    const link = await mintOk();
    expect((await server.del(`${LINKS}/${link.id}`, auth(manageToken))).statusCode).toBe(204);
    const first = await owner.reportShareLink.findUnique({ where: { id: link.id } });

    expect((await server.del(`${LINKS}/${link.id}`, auth(manageToken))).statusCode).toBe(404);
    const second = await owner.reportShareLink.findUnique({ where: { id: link.id } });
    expect(second?.revokedAt?.toISOString()).toBe(first?.revokedAt?.toISOString());
  });

  // --- Scope-limited, fail closed --------------------------------------------

  it('refuses to mint a link for a group the caller may not read', async () => {
    // `reports_manage` says the token may manage sharing; the group's own scope
    // says it may read the report. Without the second check, minting would be a
    // way to launder a missing permission into an anonymous URL that has it.
    const manageOnly = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_manage'],
    });

    const response = await mint(manageOnly, { group: 'overview' });
    expect(response.statusCode).toBe(403);
    expect(await list()).toEqual([]);
  });

  it('refuses a token holding no sharing scope at all', async () => {
    const readOnly = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_read'],
    });

    expect((await mint(readOnly)).statusCode).toBe(403);
    expect((await server.get(LINKS, auth(readOnly))).statusCode).toBe(403);
  });

  it('refuses an ordinary agent even when the token carries the scope', async () => {
    // The scope says the token may, the role says the person may — the pairing
    // `/reports/scheduled-exports` already uses for the same reason.
    const agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['reports_manage', 'reports_read'],
    });

    expect((await mint(agentToken)).statusCode).toBe(403);
  });

  it('refuses an unknown report group', async () => {
    const response = await mint(manageToken, { group: 'not-a-report' });
    expect(response.statusCode).toBe(400);
  });

  it('answers only for the group the link names', async () => {
    await seedChat('a');
    const link = await mintOk({ group: 'leads' });

    const report = (await read(link.token)).json() as SharedReport;
    // The token carries no group parameter, so it cannot be pointed at another
    // report; the resolved payload proves it answers for the one it was minted
    // for, with that group's own table shape.
    expect(report.group).toBe('leads');
    expect(report.headers).toEqual(['date', 'count']);
  });

  it('rejects a window wider than a report may cover', async () => {
    // The same NFR-P7 bound the JSON groups and the export are held to — and
    // the one surface where the person who runs the aggregation is not the one
    // who chose the window.
    const to = new Date();
    const from = new Date(to.getTime() - 400 * 86_400_000);
    const response = await mint(manageToken, {
      group: 'overview',
      from: from.toISOString(),
      to: to.toISOString(),
    });
    expect(response.statusCode).toBe(400);
  });

  it('bounds how many live links a workspace may hold', async () => {
    for (let i = 0; i < MAX_LIVE_SHARE_LINKS; i += 1) await mintOk();

    // An unbounded set of standing anonymous credentials is what this feature
    // would decay into; refusing is the only limit that does not depend on
    // somebody remembering to tidy up.
    expect((await mint(manageToken)).statusCode).toBe(400);

    // Revoking one makes room — which is the hygiene the bound is buying.
    const [first] = await list();
    expect((await server.del(`${LINKS}/${first?.id}`, auth(manageToken))).statusCode).toBe(204);
    expect((await mint(manageToken)).statusCode).toBe(201);
  });

  // --- The token leaks nowhere ------------------------------------------------

  it('returns the token once and never again', async () => {
    const link = await mintOk();
    expect(link.token).toEqual(expect.any(String));

    const rows = await list();
    // Not "the list omits a `token` key" — the assertion is that the value
    // itself appears nowhere in the response at all.
    expect(dump(rows)).not.toContain(link.token);
    expect(rows[0]?.token_last_four).toBe(link.token.slice(-4));
  });

  it('stores only the digest, never the token', async () => {
    const link = await mintOk();
    const row = await owner.reportShareLink.findUniqueOrThrow({ where: { id: link.id } });

    expect(row.tokenHash).toBe(hashToken(link.token));
    expect(dump(row)).not.toContain(link.token);
  });

  it('keeps the token out of the audit trail', async () => {
    const link = await mintOk();

    const entries = await owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action: 'report_share.created' },
    });
    expect(entries).toHaveLength(1);
    // What was shared, over what window, until when — and nothing that helps
    // anyone present the credential. The trail is read under a different scope
    // from the row, so not even the last four belong here.
    expect(dump(entries[0])).not.toContain(link.token);
    expect(dump(entries[0]?.metadata)).not.toContain(link.token.slice(-4));
    expect(entries[0]?.metadata).toMatchObject({ group: 'overview' });
  });

  it('sends the minted token with no-store', async () => {
    const response = await mint(manageToken);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  // --- The positive: a live token reads the right report ----------------------

  it('reads the group and window the link pinned', async () => {
    await seedChat('a');
    const to = new Date();
    const from = new Date(to.getTime() - 3 * 86_400_000);
    const link = await mintOk({
      group: 'overview',
      from: from.toISOString(),
      to: to.toISOString(),
    });

    const response = await read(link.token);
    expect(response.statusCode).toBe(200);
    const report = response.json() as SharedReport;

    expect(report.group).toBe('overview');
    expect(report.label).toBe('Overview');
    expect(report.from).toBe(from.toISOString());
    expect(report.to).toBe(to.toISOString());
    expect(report.expires_at).toBe(link.expires_at);
    expect(report.headers).toEqual(['metric', 'value']);
    expect(chatsIn(report)).toBe(1);
    // Never from a shared cache: it is a snapshot behind a bearer token.
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('hands out the same table the export of that group would', async () => {
    await seedChat('a');
    const to = new Date();
    const from = new Date(to.getTime() - 3 * 86_400_000);
    const link = await mintOk({
      group: 'overview',
      from: from.toISOString(),
      to: to.toISOString(),
    });

    const report = (await read(link.token)).json() as SharedReport;
    const csv = await server.get(
      `/reports/export?group=overview&from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`,
      auth(manageToken),
    );
    expect(csv.statusCode).toBe(200);

    // One aggregation behind both surfaces, so a share can never expose more
    // than an export of the same group and window already does — and the two
    // cannot drift into disagreeing about a number.
    const [head, ...body] = csv.body.trimEnd().split('\r\n');
    expect(head?.split(',')).toEqual(report.headers);
    expect(body).toEqual(report.rows.map((row) => row.join(',')));
  });

  it('answers one indistinguishable 404 for every miss', async () => {
    const live = await mintOk();
    const revoked = await mintOk();
    await server.del(`${LINKS}/${revoked.id}`, auth(manageToken));
    const expired = await mintOk();
    await agePastExpiry(expired.id);

    const unknown = await read('a'.repeat(43));
    const misses = [unknown, await read(revoked.token), await read(expired.token)];
    for (const response of misses) {
      expect(response.statusCode).toBe(404);
      // Same status *and* same body: a per-case message would tell the holder
      // of a dead token that it was once real (NFR-S5).
      expect((response.json() as ErrorBody).error.message).toBe(
        (unknown.json() as ErrorBody).error.message,
      );
    }
    // …while the live one still works, so the uniformity is not "everything 404s".
    expect((await read(live.token)).statusCode).toBe(200);
  });

  it('needs no session, and gains nothing from one', async () => {
    await seedChat('a');
    const link = await mintOk();

    const anonymous = await read(link.token);
    // A valid agent token presented here changes nothing: the handler never
    // reads `principal`, so having an account cannot widen the anonymous path.
    const withSession = await server.get(
      `${SHARED}?token=${encodeURIComponent(link.token)}`,
      auth(manageToken),
    );

    expect(anonymous.statusCode).toBe(200);
    expect(withSession.statusCode).toBe(200);
    expect(withSession.json()).toMatchObject({
      group: (anonymous.json() as SharedReport).group,
      headers: (anonymous.json() as SharedReport).headers,
    });
  });

  it('rejects a token too short to be one, before any lookup', async () => {
    expect((await read('short')).statusCode).toBe(400);
    expect((await server.get(SHARED)).statusCode).toBe(400);
  });
});

/**
 * The request line at `trace` — the level an operator actually turns on when
 * chasing a bug, and the one where a credential in a URL becomes a credential in
 * a log file that outlives the incident.
 *
 * Its own server because the log stream has to be installed at construction:
 * `server.ts` disables request logging in tests unless one is supplied.
 */
describe('report share links — the token stays out of the log (NFR-S9 · FR-MOD-07.3.1)', () => {
  let owner: PrismaClient;
  let server: TestServer | undefined;
  let sink: LineSink;

  beforeAll(async () => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it('never writes the token, at trace level, with request logging on', async () => {
    sink = new LineSink();
    server = await startTestServer(
      { LOG_LEVEL: 'trace' },
      { logStream: sink as unknown as NodeJS.WritableStream },
    );
    const fx = await seedFixtures(owner);
    await clearRateLimits(server.app);

    const manageToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_manage', 'reports_read'],
    });

    const created = await server.post(
      LINKS,
      { group: 'overview' },
      { authorization: `Bearer ${manageToken}` },
    );
    expect(created.statusCode).toBe(201);
    const link = created.json() as CreatedShareLink;

    const read = await server.get(`${SHARED}?token=${encodeURIComponent(link.token)}`);
    expect(read.statusCode).toBe(200);

    // The whole point of carrying it as `?token=`: `lib/log-redact.ts` already
    // masks the value of a query key called `token`, so the request line
    // survives — path, method, status, all still debuggable — with the
    // credential removed. A path segment would have been logged verbatim.
    const written = sink.lines.join('\n');
    expect(written).toContain('/reports/shared');
    expect(written).not.toContain(link.token);
    expect(written).toContain('token=[redacted]');
  });
});
