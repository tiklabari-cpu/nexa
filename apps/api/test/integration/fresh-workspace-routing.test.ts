/**
 * Acceptance — a workspace opened by signup can route its first conversation
 * (FR-MOD-04.5, Must/MVP · M-TEAM-c).
 *
 * This is the reason the item exists. `GET /groups` was read-only and nothing
 * created a team, so a workspace born from `POST /auth/signup` had none — and
 * routing resolves an agent through `group_agents` (ADR-08 step 2). The first
 * visitor message was therefore written with an empty `chat_access`: the
 * conversation existed, the customer was waiting in it, and the only person in
 * the workspace could not see it anywhere in their inbox.
 *
 * So the assertions here are deliberately not about response bodies. They are
 * about the two things that were actually broken:
 *
 *   - the first chat carries a `chat_access` row for the team signup created,
 *   - and the owner *sees* it, through a `chats--access` token, whose reach is
 *     exactly the team membership.
 *
 * The last test is the counterfactual and is what stops the rest from being
 * self-congratulation: the same workspace with its only team removed reproduces
 * the old behaviour precisely — empty `chat_access`, invisible to the owner,
 * visible only to a `chats--all` holder. If the seed stopped happening, that
 * test would keep passing and every other test in this file would fail, which
 * is the shape a regression should have.
 *
 * `groups.test.ts` covers the team endpoints and `group-members.test.ts` the
 * membership ones; neither asks whether a workspace nobody configured works.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, resetDatabase } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const STRONG_PASSWORD = 'a-quite-long-passphrase';

interface ChatListBody {
  items: Array<{ id: string }>;
}

/** A workspace as it exists a second after someone signed up for it. */
interface Workspace {
  accountId: string;
  licenseId: bigint;
  organizationId: string;
  /** The one thing signup cannot know: which site may embed the widget. */
  domain: string;
}

describe('a fresh workspace routes its first conversation (FR-MOD-04.5)', () => {
  let owner: PrismaClient;
  let server: TestServer;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    // No `seedFixtures` on purpose. Every other suite starts from two
    // hand-built tenants that were given a team, a routing rule and an online
    // agent by the fixture — the exact configuration this item is about *not*
    // having. Starting from an empty database means the only workspace in it is
    // one the product itself created.
    await resetDatabase(owner);
    await clearRateLimits(server.app);
  });

  /**
   * Sign up, then do the single piece of setup a real founder still has to do
   * before a visitor can reach them: name the site the widget is embedded on.
   * Written directly rather than through `PUT /settings/trusted-domains` — it
   * is the precondition for the visitor path, not the thing under test.
   */
  async function signUp(name: string): Promise<Workspace> {
    const response = await server.post('/auth/signup', {
      email: `founder@${name}.test`,
      password: STRONG_PASSWORD,
      name: 'Founder',
      organization_name: name,
    });
    expect(response.statusCode).toBe(201);

    const { account } = response.json() as { account: { id: string } };
    const license = await owner.license.findFirstOrThrow({
      where: { organization: { name } },
      select: { id: true, organizationId: true },
    });

    const domain = `shop-${name}.example.test`;
    await owner.trustedDomain.create({
      data: {
        organizationId: license.organizationId,
        licenseId: license.id,
        domain,
        includeSubdomains: false,
      },
    });

    return {
      accountId: account.id,
      licenseId: license.id,
      organizationId: license.organizationId,
      domain,
    };
  }

  /** The teams the workspace has, with their members. */
  const teamsOf = (ws: Workspace) =>
    owner.group.findMany({
      where: { licenseId: ws.licenseId },
      include: { agents: true },
      orderBy: { id: 'asc' },
    });

  /**
   * A visitor arriving on the workspace's site and sending one message — the
   * whole customer path, from minting a widget token to the chat being created.
   * Each call is a different visitor: no `customer_id` is presented, so
   * `/customer/token` creates a fresh identity.
   */
  async function firstMessageFrom(ws: Workspace, text: string): Promise<string> {
    const minted = await server.post(
      '/customer/token',
      { organization_id: ws.organizationId },
      { origin: `https://${ws.domain}` },
    );
    expect(minted.statusCode).toBe(200);
    const { token } = minted.json() as { token: string };

    const sent = await server.post('/customer/chat/events', { text }, auth(token));
    expect(sent.statusCode).toBe(201);
    return (sent.json() as { chat_id: string }).chat_id;
  }

  const accessGroupIds = async (chatId: string): Promise<bigint[]> => {
    const rows = await owner.chatAccess.findMany({ where: { chatId }, select: { groupId: true } });
    return rows.map((r) => r.groupId);
  };

  const visibleChatIds = async (token: string): Promise<string[]> => {
    const response = await server.get('/chats', auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as ChatListBody).items.map((c) => c.id);
  };

  /** A token for the owner, carrying exactly the scopes named. */
  const tokenFor = (ws: Workspace, scopes: string[]) =>
    grantToken(owner, {
      licenseId: ws.licenseId,
      organizationId: ws.organizationId,
      ownerId: ws.accountId,
      scopes,
    });

  // =========================================================================

  it('opens the first conversation on the team signup created, and gives it to the founder', async () => {
    const ws = await signUp('freshco');

    const teams = await teamsOf(ws);
    expect(teams).toHaveLength(1);
    expect(teams[0]!.name).toBe('General');
    expect(teams[0]!.agents).toMatchObject([{ agentId: ws.accountId, priority: 'primary' }]);

    const chatId = await firstMessageFrom(ws, 'Hello, is anyone there?');

    // The assertion the item is named after: not an empty list.
    expect(await accessGroupIds(chatId)).toEqual([teams[0]!.id]);

    // Assigned outright rather than queued, and the reason is worth stating
    // because the Prisma model suggests otherwise: `AgentMembership.routingStatus`
    // defaults to `offline`, but `auth_signup` writes `accepting_chats` for the
    // owner explicitly (`20260724090000_account_lifecycle`), so the founder is a
    // candidate for `#selectAgent` before they have opened anything. The seeded
    // `group_agents` row is therefore a real routing candidate and not merely an
    // access grant.
    const thread = await owner.thread.findFirstOrThrow({ where: { chatId } });
    expect(thread.assigneeId).toBe(ws.accountId);
    expect(thread.queuePosition).toBeNull();

    // And the founder can reach it with a team-scoped credential — the end of
    // the path the audit found broken.
    expect(await visibleChatIds(await tokenFor(ws, ['chats--access:ro']))).toEqual([chatId]);
  });

  it('holds it for the team when the founder has stepped away', async () => {
    const ws = await signUp('awayco');

    // Not accepting chats, which is the state that isolates the thing being
    // tested. While the founder is assignable, `chatVisibilityFilter` has two
    // reasons to show them the chat — their team, and their own `chat_users`
    // row — and the second would hide the loss of the first. Stepping away
    // removes it: now the team access row is the only thing standing between
    // this conversation and nobody.
    await owner.agentMembership.update({
      where: { licenseId_agentId: { licenseId: ws.licenseId, agentId: ws.accountId } },
      data: { routingStatus: 'not_accepting_chats' },
    });

    const chatId = await firstMessageFrom(ws, 'My order has not arrived');

    const [team] = await teamsOf(ws);
    expect(await accessGroupIds(chatId)).toEqual([team!.id]);

    const thread = await owner.thread.findFirstOrThrow({ where: { chatId } });
    expect(thread.assigneeId).toBeNull();
    expect(thread.queuePosition).toBe(1);
    expect(await owner.chatUser.count({ where: { chatId, userType: 'agent' } })).toBe(0);

    // `chats--access`, not `chats--all`: the scope whose reach *is* the team
    // membership. An admin-wide token would see the chat either way and would
    // prove nothing about the seed.
    expect(await visibleChatIds(await tokenFor(ws, ['chats--access:ro']))).toEqual([chatId]);
  });

  it('reproduces the old failure once the only team is gone', async () => {
    const ws = await signUp('bareco');

    // Through the endpoint rather than the table, so this is a workspace that
    // genuinely arrived here by using the product. Neither delete guard applies
    // yet: no routing rule targets the team and no chat is open through it.
    const [team] = await teamsOf(ws);
    const removed = await server.del(
      `/groups/${team!.id}`,
      auth(await tokenFor(ws, ['groups--all:rw'])),
    );
    expect(removed.statusCode).toBe(204);

    const chatId = await firstMessageFrom(ws, 'Hello?');

    // Exactly the state the audit's K1 finding described. The conversation is
    // created — nothing is lost, which is what `RoutingService`'s `no_group`
    // branch intends — but it reaches nobody's inbox.
    expect(await accessGroupIds(chatId)).toEqual([]);
    expect(await visibleChatIds(await tokenFor(ws, ['chats--access:ro']))).toEqual([]);

    // Visible only to a token that ignores teams altogether, which is precisely
    // why the bug survived: an owner-shaped credential in a console screen would
    // have shown the chat and reported the workspace as working.
    expect(await visibleChatIds(await tokenFor(ws, ['chats--all:ro']))).toEqual([chatId]);
  });
});
