/**
 * Only the agent a conversation is assigned to answers the customer, and
 * "Take chat" is how it becomes theirs (tm 475 · owner decision 2026-11-06).
 *
 * The integration suite pins the server's half — the 409 on a reply from
 * anyone else, the lock that makes one Take win, the AI falling silent
 * (`reply-requires-assignment.test.ts`, `claim-from-ai.test.ts`) — and the web
 * suite the strip above the composer against a mocked API (`ReplyArea.test.tsx`).
 * What only real browsers prove is the whole chain at once: two consoles
 * signed in as two people pressing Take on the same waiting chat, one winning
 * and the other's strip turning into "This chat is with …"; the winner's reply
 * reaching the visitor and taking the queue notice off their widget; and, in
 * the AI's phase, Take stopping the AI before the agent writes.
 *
 * Every chat here is created by this spec, and every setting it changes (a
 * team of its own, the AI agent's assignment mode, a knowledge source) is put
 * back in `finally`.
 */
import { randomBytes } from 'node:crypto';
import type {
  APIRequestContext,
  Browser,
  BrowserContext,
  Page,
  Response,
  Route,
} from '@playwright/test';
import {
  API_BASE,
  DEMO,
  expect,
  freeARoutingSlot,
  openWidget,
  ownerAccessToken,
  ownerAccessTokenFor,
  signInThroughApi,
  tenantSubdomain,
  test,
  visitorSends,
  widgetFrame,
  type TenantOwner,
} from './fixtures.js';

/** The seeded Acme agent with no takeover right (Priya Nair, role `agent`). */
const MEMBER: TenantOwner = {
  email: 'agent2@acme.localhost',
  password: DEMO.password,
  orgPrefix: 'Acme',
};

interface RosterEntry {
  id: string;
  email: string;
  concurrent_chats_limit: number;
}

interface ChatRead {
  thread: {
    assignee_id: string | null;
    queue_position: number | null;
    ai_mode?: string | null;
  } | null;
}

/** A panel signed in as a second person — its own context, so its own session (not the owner's). */
async function secondConsole(browser: Browser, request: APIRequestContext) {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await signInThroughApi(page, request, MEMBER);
  return { context, page };
}

/** The visitor's first message through the widget; returns the chat it opened. */
async function visitorOpens(page: Page, text: string): Promise<string> {
  const opened = page.waitForResponse(
    (response) =>
      response.url().includes('/customer/chat/events') &&
      response.request().method() === 'POST' &&
      response.ok(),
  );
  await visitorSends(page, text);
  return ((await (await opened).json()) as { chat_id: string }).chat_id;
}

test.describe('a reply needs the assignment, and Take gives it (tm 475)', () => {
  test('two agents press Take on the same waiting chat at once: one wins and answers, the other is told it is someone else’s (FR-MOD-08.6.3)', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }) => {
    test.setTimeout(180_000);
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const roster = (
      (await (await request.get(`${API_BASE}/agents`, { headers: auth })).json()) as {
        items: RosterEntry[];
      }
    ).items;
    const owner = roster.find((agent) => agent.email === DEMO.email);
    const member = roster.find((agent) => agent.email === MEMBER.email);
    expect(owner, 'the seeded owner is not on the roster').toBeTruthy();
    expect(member, 'the seeded agent is not on the roster').toBeTruthy();
    // Take is refused at the chat limit, and earlier specs in a shard fill it.
    await freeARoutingSlot(request, auth, owner!.id, owner!.concurrent_chats_limit);
    await freeARoutingSlot(request, auth, member!.id, member!.concurrent_chats_limit);

    const name = `Race desk ${randomBytes(3).toString('hex')}`;
    const created = await request.post(`${API_BASE}/groups`, {
      data: { name, assignment_mode: 'manual' },
      headers: auth,
    });
    expect(created.status(), await created.text()).toBe(201);
    const teamId = ((await created.json()) as { id: number }).id;
    let chatId: string | undefined;
    const contexts: BrowserContext[] = [];
    try {
      for (const agent of [owner!, member!]) {
        const joined = await request.put(`${API_BASE}/groups/${teamId}/agents/${agent.id}`, {
          data: { priority: 'normal' },
          headers: auth,
        });
        expect(joined.ok(), await joined.text()).toBe(true);
      }

      // --- A visitor waits in the team's queue --------------------------------------
      const visitorContext = await browser.newContext({ locale: 'en-US' });
      contexts.push(visitorContext);
      const visitor = await visitorContext.newPage();
      const stamp = Date.now().toString().slice(-6);
      const question = `Çekim talebim onaylanmadı ${stamp}`;
      await openWidget(visitor, organizationId);
      chatId = await visitorOpens(visitor, question);
      const handed = await request.post(`${API_BASE}/chats/${chatId}/transfer`, {
        data: { group_id: teamId },
        headers: auth,
      });
      expect(handed.ok(), await handed.text()).toBe(true);
      const queued = (await (
        await request.get(`${API_BASE}/chats/${chatId}`, { headers: auth })
      ).json()) as ChatRead;
      expect(queued.thread?.assignee_id).toBeNull();
      expect(queued.thread?.queue_position).not.toBeNull();

      const frame = widgetFrame(visitor);
      const transcript = frame.getByRole('log', { name: 'Conversation' });
      const status = frame.locator('.nx-status');
      // A fresh document: the first poll is the server's word alone.
      await visitor.reload();
      const launcher = frame.getByRole('button', { name: 'Open chat' });
      await expect(launcher.or(transcript)).toBeVisible();
      if (await launcher.isVisible()) await launcher.click();
      await expect(transcript).toContainText(question);
      await expect(status).toContainText('in the queue');

      // --- Two consoles, two people, the same chat ---------------------------------
      const second = await secondConsole(browser, request);
      contexts.push(second.context);
      const consoles = [
        { page: agentPage, account: owner!, credential: null as TenantOwner | null },
        { page: second.page, account: member!, credential: MEMBER },
      ];
      for (const { page } of consoles) {
        await page.goto(`/app/inbox?chat=${chatId}`);
        const strip = page.getByTestId('reply-claim-bar');
        await expect(strip).toHaveAttribute('data-claim', 'claim', { timeout: 20_000 });
        await expect(strip).toContainText('Take this chat to reply to the customer.');
      }

      // Held until both requests are in flight, so the two Takes truly race on
      // the server — not one landing and the other's strip changing first.
      let arrived = 0;
      let releaseBoth!: () => void;
      const both = new Promise<void>((resolve) => {
        releaseBoth = resolve;
      });
      const hold = async (route: Route): Promise<void> => {
        arrived += 1;
        if (arrived === 2) releaseBoth();
        await both;
        await route.continue();
      };
      const claimUrl = `**/chats/${chatId}/claim`;
      const answered: Array<Promise<Response>> = [];
      for (const { page } of consoles) {
        await page.route(claimUrl, hold);
        answered.push(
          page.waitForResponse(
            (response) =>
              response.url().endsWith(`/chats/${chatId}/claim`) &&
              response.request().method() === 'POST',
          ),
        );
      }
      await Promise.all(
        consoles.map(({ page }) =>
          page
            .getByTestId('reply-claim-bar')
            .getByRole('button', { name: 'Take chat', exact: true })
            .click(),
        ),
      );
      const responses = await Promise.all(answered);
      // The routes stay until the pages close. An `unroute` here, with the
      // re-reads the claim set off still in flight, is the suspected cause of
      // a full-run red (tm 475.6): both re-reads came back fresh on the wire,
      // yet the winner's panel kept the queued chat and its strip.
      const statuses = responses.map((response) => response.status());
      expect([...statuses].sort()).toEqual([200, 409]);
      const refusedBody = (await responses[statuses.indexOf(409)]!.json()) as {
        error: { type: string; details?: { reason?: string } };
      };
      expect(refusedBody.error.type).toBe('chat_claim_refused');
      expect(refusedBody.error.details?.reason).toBe('claimed');

      const winner = consoles[statuses.indexOf(200)]!;
      const loser = consoles[statuses.indexOf(409)]!;
      const taken = (await (
        await request.get(`${API_BASE}/chats/${chatId}`, { headers: auth })
      ).json()) as ChatRead;
      expect(taken.thread?.assignee_id).toBe(winner.account.id);
      expect(taken.thread?.queue_position).toBeNull();

      // The loser: told why, and the strip now says the chat is someone else's.
      const loserStrip = loser.page.getByTestId('reply-claim-bar');
      await expect(loserStrip.getByRole('alert')).toHaveText('Someone else took this chat first.');
      await expect(loserStrip).toHaveAttribute('data-claim', 'other', { timeout: 10_000 });
      await expect(loserStrip).toContainText('This chat is with');
      await expect(loserStrip.getByRole('button', { name: 'Take chat' })).toHaveCount(0);
      await loser.page.screenshot({ path: 'kanit/tm475-take-race-loser.png', fullPage: true });

      // The winner answers from the composer, and the visitor reads it.
      await expect(winner.page.getByTestId('reply-claim-bar')).toHaveCount(0, { timeout: 10_000 });
      const answer = `Kontrol ediyorum, bir dakika ${stamp}`;
      await winner.page.locator('#composer-input').fill(answer);
      await winner.page.getByRole('button', { name: 'Send' }).click();
      await expect(transcript).toContainText(answer, { timeout: 20_000 });
      await expect(status).not.toContainText('in the queue');
      await visitor.screenshot({ path: 'kanit/tm475-take-race-visitor.png', fullPage: true });

      // The loser cannot answer the visitor behind the winner's back.
      const loserToken =
        loser.credential === null
          ? await ownerAccessToken(request)
          : await ownerAccessTokenFor(request, loser.credential);
      const behind = await request.post(`${API_BASE}/chats/${chatId}/events`, {
        headers: { authorization: `Bearer ${loserToken}` },
        data: { type: 'message', text: `Ben de buradayım ${stamp}` },
      });
      expect(behind.status()).toBe(409);
      const behindBody = (await behind.json()) as {
        error: { type: string; details?: { reason?: string } };
      };
      expect(behindBody.error.type).toBe('reply_requires_assignment');
      expect(behindBody.error.details?.reason).toBe('assigned_to_other');
      await visitor.waitForTimeout(2_000);
      await expect(transcript).not.toContainText(`Ben de buradayım ${stamp}`);
    } finally {
      for (const context of contexts) await context.close();
      if (chatId) {
        await request.post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth });
      }
      await request.delete(`${API_BASE}/groups/${teamId}`, { headers: auth });
    }
  });

  test('in the AI’s phase, Take stops the AI and the agent answers (FR-MOD-08.6.3)', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }) => {
    test.setTimeout(180_000);
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const me = (await (await request.get(`${API_BASE}/auth/me`, { headers: auth })).json()) as {
      account_id: string;
    };
    const aiAgents = (
      (await (await request.get(`${API_BASE}/ai-agents`, { headers: auth })).json()) as {
        items: Array<{ id: string; kind: string }>;
      }
    ).items;
    const aiAgentId = aiAgents.find((item) => item.kind === 'ai_agent')?.id;
    expect(aiAgentId, 'the seeded workspace has an AI agent').toBeTruthy();
    const settingsUrl = `${API_BASE}/ai-agents/${aiAgentId}/handoff-settings`;
    const before = (await (await request.get(settingsUrl, { headers: auth })).json()) as {
      assignment_mode: string;
    };

    const run = Date.now().toString().slice(-6);
    const marker = `takeai${run}`;
    const passage =
      `A ${marker} withdrawal is reviewed within 24 hours. ` +
      `The ${marker} review result is sent by e-mail.`;
    let sourceId: string | undefined;
    let chatId: string | undefined;
    const context = await browser.newContext({ locale: 'en-US' });
    try {
      // "AI first": the AI answers before anyone is assigned (AI-11 · K9), so
      // the chat is nobody's and in the AI's hands — the phase under test.
      const aiFirst = await request.put(settingsUrl, {
        data: { assignment_mode: 'ai_first' },
        headers: auth,
      });
      expect(aiFirst.ok(), await aiFirst.text()).toBe(true);

      // A knowledge source only this run's question matches, so the AI answers
      // rather than handing the chat to a person.
      await agentPage.goto('/app/playbook?view=skills');
      await agentPage
        .getByRole('tablist', { name: 'AI Agent' })
        .getByRole('tab', { name: 'Knowledge' })
        .click();
      await agentPage.getByLabel('Title').fill(`Take from AI proof ${run}`);
      await agentPage.getByLabel('Content').fill(passage);
      const [added] = await Promise.all([
        agentPage.waitForResponse(
          (response) =>
            response.request().method() === 'POST' && response.url().endsWith('/knowledge-sources'),
          // Indexed on save: the first source on a cold stack took more than 10 s.
          { timeout: 30_000 },
        ),
        agentPage.getByRole('button', { name: 'Add source' }).click(),
      ]);
      sourceId = ((await added.json()) as { id: string }).id;

      // --- The AI answers the visitor; nobody is assigned --------------------------
      const visitor = await context.newPage();
      await openWidget(visitor, organizationId, {
        host: tenantSubdomain(`take-ai-${run}`).origin,
      });
      const aiLines = widgetFrame(visitor).locator('.nx-row--bot .nx-bubble');
      const agentLines = widgetFrame(visitor).locator('.nx-row--agent .nx-bubble');
      chatId = await visitorOpens(visitor, `How long does a ${marker} withdrawal take?`);
      await expect(aiLines).toHaveCount(1, { timeout: 30_000 });
      await expect(aiLines.last()).toContainText(marker);
      const inAi = (await (
        await request.get(`${API_BASE}/chats/${chatId}`, { headers: auth })
      ).json()) as ChatRead;
      expect(inAi.thread).toMatchObject({ assignee_id: null, queue_position: null, ai_mode: 'ai' });

      // --- The console: Reply waits for Take -------------------------------------------
      await agentPage.goto(`/app/inbox?chat=${chatId}`);
      const badge = agentPage.locator('[data-ai-mode]');
      await expect(badge).toHaveAttribute('data-ai-mode', 'ai', { timeout: 20_000 });
      const strip = agentPage.getByTestId('reply-claim-bar');
      await expect(strip).toHaveAttribute('data-claim', 'claim');
      const answer = `A person here, checking your ${marker} withdrawal ${run}`;
      await agentPage.locator('#composer-input').fill(answer);
      await expect(agentPage.getByRole('button', { name: 'Send' })).toBeDisabled();
      await agentPage.screenshot({ path: 'kanit/tm475-take-from-ai-strip.png', fullPage: true });

      await Promise.all([
        agentPage.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response.url().endsWith(`/chats/${chatId}/claim`) &&
            response.status() === 200,
        ),
        strip.getByRole('button', { name: 'Take chat', exact: true }).click(),
      ]);
      await expect(strip).toHaveCount(0, { timeout: 10_000 });
      await expect(badge).toHaveAttribute('data-ai-mode', 'human', { timeout: 10_000 });
      const taken = (await (
        await request.get(`${API_BASE}/chats/${chatId}`, { headers: auth })
      ).json()) as ChatRead;
      expect(taken.thread).toMatchObject({ assignee_id: me.account_id, ai_mode: 'human' });

      // The words typed before Take are still there, and now they send.
      await expect(agentPage.locator('#composer-input')).toHaveValue(answer);
      await agentPage.getByRole('button', { name: 'Send' }).click();
      await expect(agentLines.last()).toContainText(answer, { timeout: 20_000 });

      // The AI stays silent on the visitor's next message.
      await visitorSends(visitor, `Is a ${marker} withdrawal reviewed by a person?`);
      await visitor.waitForTimeout(4_000);
      await expect(aiLines).toHaveCount(1);
      await visitor.screenshot({ path: 'kanit/tm475-take-from-ai-visitor.png', fullPage: true });
    } finally {
      await context.close();
      await request.put(settingsUrl, {
        data: { assignment_mode: before.assignment_mode },
        headers: auth,
      });
      if (chatId) {
        await request.post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth });
      }
      if (sourceId) {
        await request
          .delete(`${API_BASE}/knowledge-sources/${sourceId}`, { headers: auth })
          .catch(() => {});
      }
    }
  });
});
