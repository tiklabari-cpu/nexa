/**
 * Saved replies: personal replies, variables and the fallback phrase (IN-06 · tm 363).
 *
 * Every visibility claim is made through `GET /settings/canned-responses` as a
 * particular caller, not by reading the row back — the property is what each
 * person is *sent*, and a row that exists but is filtered out of the wrong
 * list is the feature working.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { defaultScopesForRole } from '@siyahtus/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Reply {
  id: string;
  shortcut: string;
  text: string;
  visibility: string;
  owner_account_id: string | null;
}

describe('saved replies: personal, variables, fallback (IN-06)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  /** The workspace owner, curating the library (`--all:rw`). */
  let curatorToken: string;
  /** An Ekip Üyesi's sign-in session: the role's default set, nothing added. */
  let memberToken: string;
  /** The owner again, with only the member's two canned scopes. */
  let secondMemberToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const list = async (token: string) => {
    const res = await server.get('/settings/canned-responses?scope=chat', auth(token));
    expect(res.statusCode).toBe(200);
    return res.json() as {
      items: Reply[];
      fallback_text: string | null;
      company_name: string | null;
    };
  };
  const shortcuts = async (token: string) => (await list(token)).items.map((i) => i.shortcut);
  const save = (token: string, body: Record<string, unknown>) =>
    server.post('/settings/canned-responses', body, auth(token));

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
    const a = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
    [curatorToken, memberToken, secondMemberToken] = await Promise.all([
      grantToken(owner, {
        ...a,
        ownerId: fx.a.ownerAccountId,
        scopes: ['canned_responses--all:rw'],
      }),
      grantToken(owner, {
        ...a,
        ownerId: fx.a.agentAccountId,
        kind: 'oauth',
        clientId: fx.a.clientId,
        scopes: defaultScopesForRole('agent'),
      }),
      grantToken(owner, {
        ...a,
        ownerId: fx.a.ownerAccountId,
        scopes: ['canned_responses--groups:ro', 'canned_responses--my:rw'],
      }),
    ]);
  });

  it('lets an Ekip Üyesi save a personal reply only they are sent (FR-MOD-08.7.2)', async () => {
    const created = await save(memberToken, {
      shortcut: 'imzam',
      text: 'Saygılarımla, Mert',
      visibility: 'private',
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      visibility: 'private',
      group_id: null,
      owner_account_id: fx.a.agentAccountId,
    });

    expect(await shortcuts(memberToken)).toContain('imzam');
    // The curator holds `--all:ro` and still is not sent it (RL-03 default).
    expect(await shortcuts(curatorToken)).not.toContain('imzam');
    expect(await shortcuts(secondMemberToken)).not.toContain('imzam');
  });

  it('refuses a shared reply to a member who may only write their own', async () => {
    const shared = await save(memberToken, { shortcut: 'herkes', text: 'x', visibility: 'all' });
    expect(shared.statusCode).toBe(403);
    // The default visibility is shared, so leaving it out is refused too.
    expect((await save(memberToken, { shortcut: 'varsayilan', text: 'x' })).statusCode).toBe(403);
    const team = await save(memberToken, {
      shortcut: 'ekip',
      text: 'x',
      visibility: 'group',
      group_id: 1,
    });
    expect(team.statusCode).toBe(403);
  });

  it('lets two agents own the same personal shortcut beside a shared one', async () => {
    const shared = await save(curatorToken, { shortcut: 'selam', text: 'Merhaba!' });
    expect(shared.statusCode).toBe(201);

    const mine = await save(memberToken, {
      shortcut: 'selam',
      text: 'Selam, ben Mert',
      visibility: 'private',
    });
    const theirs = await save(secondMemberToken, {
      shortcut: 'selam',
      text: 'Selam, ben Ece',
      visibility: 'private',
    });
    expect(mine.statusCode).toBe(201);
    expect(theirs.statusCode).toBe(201);

    // Each is sent the shared one and their own, not the other agent's.
    const memberTexts = (await list(memberToken)).items
      .filter((i) => i.shortcut === 'selam')
      .map((i) => i.text)
      .sort();
    expect(memberTexts).toEqual(['Merhaba!', 'Selam, ben Mert']);

    // One agent cannot own it twice, and the shared rule still holds.
    const again = await save(memberToken, { shortcut: 'selam', text: 'x', visibility: 'private' });
    expect(again.statusCode).toBe(403);
    expect((await save(curatorToken, { shortcut: 'selam', text: 'y' })).statusCode).toBe(403);
  });

  it("hides another person's personal reply from edit and delete, the curator included", async () => {
    const created = await save(memberToken, {
      shortcut: 'notum',
      text: 'Kendi notum',
      visibility: 'private',
    });
    const { id } = created.json() as Reply;

    const edit = await server.patch(
      `/settings/canned-responses/${id}`,
      { text: 'Yöneticinin metni' },
      auth(curatorToken),
    );
    expect(edit.statusCode).toBe(404);
    expect(
      (await server.del(`/settings/canned-responses/${id}`, auth(curatorToken))).statusCode,
    ).toBe(404);

    const own = await server.patch(
      `/settings/canned-responses/${id}`,
      { text: 'Güncel notum' },
      auth(memberToken),
    );
    expect(own.statusCode).toBe(200);
    expect((own.json() as Reply).text).toBe('Güncel notum');
    expect(
      (await server.del(`/settings/canned-responses/${id}`, auth(memberToken))).statusCode,
    ).toBe(204);
  });

  it('keeps shared replies out of a member’s write reach', async () => {
    const shared = await save(curatorToken, { shortcut: 'iade', text: 'İade 3 gün sürer.' });
    const { id } = shared.json() as Reply;

    expect(
      (await server.patch(`/settings/canned-responses/${id}`, { text: 'x' }, auth(memberToken)))
        .statusCode,
    ).toBe(403);
    expect(
      (await server.del(`/settings/canned-responses/${id}`, auth(memberToken))).statusCode,
    ).toBe(403);

    // Nor can a member publish their own personal reply to everyone.
    const mine = await save(memberToken, { shortcut: 'benim', text: 'x', visibility: 'private' });
    const publish = await server.patch(
      `/settings/canned-responses/${(mine.json() as Reply).id}`,
      { visibility: 'all' },
      auth(memberToken),
    );
    expect(publish.statusCode).toBe(403);
  });

  it('makes a curator the author of a reply they turn personal, and back', async () => {
    const shared = await save(curatorToken, { shortcut: 'kisisel', text: 'x' });
    const { id } = shared.json() as Reply;

    const personal = await server.patch(
      `/settings/canned-responses/${id}`,
      { visibility: 'private' },
      auth(curatorToken),
    );
    expect(personal.statusCode).toBe(200);
    expect(personal.json()).toMatchObject({
      visibility: 'private',
      owner_account_id: fx.a.ownerAccountId,
    });
    expect(await shortcuts(memberToken)).not.toContain('kisisel');

    const back = await server.patch(
      `/settings/canned-responses/${id}`,
      { visibility: 'all' },
      auth(curatorToken),
    );
    expect(back.json()).toMatchObject({ visibility: 'all', owner_account_id: null });
    expect(await shortcuts(memberToken)).toContain('kisisel');

    const withTeam = await save(curatorToken, {
      shortcut: 'takimli',
      text: 'x',
      visibility: 'private',
      group_id: 1,
    });
    expect(withTeam.statusCode).toBe(400);
  });

  it('refuses a reply naming an unknown variable and accepts the catalogue (FR-MOD-08.7.2)', async () => {
    const unknown = await save(memberToken, {
      shortcut: 'hatali',
      text: 'Merhaba {{customer.nmae}}',
      visibility: 'private',
    });
    expect(unknown.statusCode).toBe(400);
    expect(JSON.stringify(unknown.json())).toContain('customer.nmae');

    const malformed = await save(curatorToken, {
      shortcut: 'kirik',
      text: 'Merhaba {{customer.name}',
    });
    expect(malformed.statusCode).toBe(400);

    const known = await save(curatorToken, {
      shortcut: 'karsilama',
      text: 'Merhaba {{customer.first_name}}, ben {{agent.first_name}}. {{ids}} yok, {{chat.id}} / {{thread.id}}',
    });
    // `{{ids}}` is malformed (no dot), so the whole text is refused …
    expect(known.statusCode).toBe(400);
    const ok = await save(curatorToken, {
      shortcut: 'karsilama',
      text: 'Merhaba {{customer.first_name}}, ben {{agent.first_name}} ({{company.name}}). {{chat.id}} / {{thread.id}}',
    });
    expect(ok.statusCode).toBe(201);

    const { id } = ok.json() as Reply;
    const badEdit = await server.patch(
      `/settings/canned-responses/${id}`,
      { text: '{{ticket.id}}' },
      auth(curatorToken),
    );
    expect(badEdit.statusCode).toBe(400);
  });

  it('stores the fallback phrase for curators and sends it to every member', async () => {
    expect((await list(memberToken)).fallback_text).toBeNull();
    // `{{company.name}}` rides on the same read: the company endpoint is an admin's.
    const company = await owner.organization.findUniqueOrThrow({
      where: { id: fx.a.organizationId },
      select: { name: true },
    });
    expect(((await list(memberToken)) as { company_name?: string }).company_name).toBe(
      company.name,
    );

    const set = await server.put(
      '/settings/canned-response-fallback',
      { fallback_text: '  Değerli üyemiz ' },
      auth(curatorToken),
    );
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ fallback_text: 'Değerli üyemiz' });
    expect((await list(memberToken)).fallback_text).toBe('Değerli üyemiz');

    expect(
      (
        await server.put(
          '/settings/canned-response-fallback',
          { fallback_text: 'Benim' },
          auth(memberToken),
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await server.put(
          '/settings/canned-response-fallback',
          { fallback_text: '  ' },
          auth(curatorToken),
        )
      ).statusCode,
    ).toBe(400);

    const reset = await server.put(
      '/settings/canned-response-fallback',
      { fallback_text: null },
      auth(curatorToken),
    );
    expect(reset.json()).toEqual({ fallback_text: null });
  });

  it('keeps the pairing in the database: a personal row needs an owner and no team', async () => {
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO canned_responses (id, license_id, shortcut, text, visibility, updated_at)
         VALUES (gen_random_uuid(), ${fx.a.licenseId}, 'sahipsiz', 'x', 'private', now())`,
      ),
    ).rejects.toThrow(/canned_responses_visibility_check/);
    await expect(
      owner.$executeRawUnsafe(
        `INSERT INTO canned_responses (id, license_id, shortcut, text, visibility, owner_account_id, updated_at)
         VALUES (gen_random_uuid(), ${fx.a.licenseId}, 'paylasimli', 'x', 'all', '${fx.a.agentAccountId}', now())`,
      ),
    ).rejects.toThrow(/canned_responses_visibility_check/);
  });

  it("never sends another workspace's fallback or personal replies", async () => {
    await owner.cannedResponseSettings.create({
      data: { licenseId: fx.b.licenseId, fallbackText: 'Öteki' },
    });
    await owner.cannedResponse.create({
      data: {
        licenseId: fx.b.licenseId,
        shortcut: 'oteki',
        text: 'x',
        visibility: 'private',
        ownerAccountId: fx.b.ownerAccountId,
        updatedAt: new Date(),
      },
    });
    const body = await list(curatorToken);
    expect(body.fallback_text).toBeNull();
    expect(body.items.map((i) => i.shortcut)).not.toContain('oteki');
  });
});
