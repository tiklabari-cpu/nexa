/**
 * The inbox below the desktop layout (GV-04 · tm 385).
 *
 * Runs in the `narrow-375` and `narrow-768` projects only (`playwright.config.ts`
 * `NARROW_SPECS`): a phone and a tablet held upright, with touch. The flow is
 * the one the item is for — a Team Lead, away from a desk, opens their team's
 * conversation, reads it, takes it over from the Team Member holding it and
 * answers — and every claim about the layout is a measurement: the document is
 * never wider than the window, which panes are on screen, a finger-sized
 * target. The PNGs are only evidence.
 *
 *   375 px  one pane at a time: the list, or the conversation opened from it,
 *           with a way back; Details is a sheet from below.
 *   768 px  two panes: the list beside the transcript; Details is a sheet,
 *           closed until asked for.
 *
 * The Views menu slides in over the list at both widths, and neither shows the
 * "designed for desktop" band an unadapted screen still shows.
 */
import type { Page, TestInfo } from '@playwright/test';
import { assertNoBlockingViolations, scanScreen } from './a11y.js';
import {
  ACME_TEAM_LEAD,
  API_BASE,
  DEMO,
  allChats,
  expect,
  openWidget,
  ownerAccessToken,
  ownerAccessTokenFor,
  signInAs,
  test,
  visitorSends,
  type ChatSummary,
} from './fixtures.js';

/** Priya Nair — the seeded Acme teammate with the plain agent role. */
const MEMBER = { email: 'agent2@acme.localhost', password: DEMO.password, orgPrefix: 'Acme' };

const BAND = 'The console is designed for desktop';

/** How far the document is wider than the window, in px (0 = no sideways scroll). */
async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    return Math.max(root.scrollWidth - root.clientWidth, body.scrollWidth - body.clientWidth);
  });
}

/** The shell's <main> scrolls sideways neither: the inbox fits, it does not slide inside. */
async function mainOverflow(page: Page): Promise<number> {
  return page
    .getByRole('main')
    .evaluate((main) => Math.max(0, main.scrollWidth - main.clientWidth));
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  expect(await sidewaysOverflow(page)).toBe(0);
  expect(await mainOverflow(page)).toBe(0);
}

function projectWidth(testInfo: TestInfo): number {
  return testInfo.project.use.viewport?.width ?? 1280;
}

test.describe('the inbox on a narrow window (GV-04)', () => {
  test('a Team Lead opens, reads, takes over and answers their team’s conversation', async ({
    browser,
    request,
    organizationId,
  }, testInfo) => {
    test.setTimeout(120_000);
    const width = projectWidth(testInfo);
    const phone = width < 768;
    const tag = phone ? '375' : '768';

    const stamp = Date.now().toString().slice(-6);
    const question = `Narrow ${tag} question ${stamp}`;
    const owner = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const member = { authorization: `Bearer ${await ownerAccessTokenFor(request, MEMBER)}` };

    const visitorContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const leadContext = await browser.newContext({
      viewport: testInfo.project.use.viewport ?? { width, height: 812 },
      hasTouch: true,
    });
    try {
      // A visitor writes in; the owner routes it to Sales, which the lead leads,
      // and hands it to the Team Member — so there is a holder to take it from.
      const visitor = await visitorContext.newPage();
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);
      let ours: ChatSummary | undefined;
      await expect
        .poll(async () => {
          ours = (await allChats(request, owner)).find((c) => c.last_event?.text === question);
          return ours?.id ?? null;
        })
        .not.toBeNull();
      const chatId = ours!.id;

      const teams = (await (await request.get(`${API_BASE}/groups`, { headers: owner })).json())
        .items as Array<{ id: number; name: string }>;
      const sales = teams.find((team) => team.name === 'Sales')!;
      const agents = (await (await request.get(`${API_BASE}/agents`, { headers: owner })).json())
        .items as Array<{ id: string; name: string }>;
      const leadId = agents.find((a) => a.name === ACME_TEAM_LEAD.name)!.id;
      const memberId = agents.find((a) => a.name === 'Priya Nair')!.id;
      const available = await request.put(`${API_BASE}/agents/me/routing-status`, {
        headers: member,
        data: { routing_status: 'accepting_chats' },
      });
      expect(available.ok(), await available.text()).toBe(true);
      for (const target of [{ group_id: sales.id }, { agent_id: memberId }]) {
        const moved = await request.post(`${API_BASE}/chats/${chatId}/transfer`, {
          headers: owner,
          data: target,
        });
        expect(moved.ok(), await moved.text()).toBe(true);
      }
      // Every widget visitor shares one name: a stamped line names the row.
      const marker = `Routed to Sales ${tag} ${stamp}`;
      const said = await request.post(`${API_BASE}/chats/${chatId}/events`, {
        headers: owner,
        data: { type: 'message', text: marker },
      });
      expect(said.ok(), await said.text()).toBe(true);

      // --- The inbox, with no band, and nothing sliding sideways ---------------
      const lead = await leadContext.newPage();
      await signInAs(lead, ACME_TEAM_LEAD.email, ACME_TEAM_LEAD.password);
      await lead.goto('/app/inbox');
      await expect(lead.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
      await expect(lead.getByRole('region', { name: BAND })).toHaveCount(0);

      // The Views menu is not beside the list: it slides in, and a view picked closes it.
      const views = lead.getByRole('navigation', { name: 'Inbox views' });
      await expect(views).toBeHidden();
      const openViews = lead.getByRole('button', { name: 'Views', exact: true });
      expect((await openViews.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await openViews.tap();
      await expect(views).toBeVisible();
      await expect(openViews).toHaveAttribute('aria-expanded', 'true');
      await views.getByRole('button', { name: /^My team/ }).tap();
      await expect(views).toBeHidden();
      await expect(lead.getByRole('heading', { level: 2, name: 'My team' })).toBeVisible();

      const list = lead.getByRole('region', { name: 'Conversations' });
      const row = list.getByRole('listitem').filter({ hasText: marker });
      await expect(row).toHaveCount(1);
      await expectNoSidewaysScroll(lead);
      const log = lead.getByRole('log', { name: 'Conversation transcript' });
      if (phone) {
        // One pane: the list fills the screen beside the rail.
        const box = (await list.boundingBox())!;
        expect(box.x + box.width).toBeLessThanOrEqual(width);
        expect(box.width).toBeGreaterThan(width - 80);
        await expect(log).toHaveCount(0);
      }
      await lead.screenshot({ path: `kanit/385-inbox-${tag}-list.png` });
      assertNoBlockingViolations(await scanScreen(lead, `Inbox list (${tag} px)`, testInfo));

      // --- Open it and read it -------------------------------------------------
      await row.locator('button[data-chat-row]').tap();
      await expect(log).toContainText(marker);
      await expect(log).toContainText(question);
      if (phone) {
        // The conversation replaced the list; the way back is a finger's size.
        await expect(list).toBeHidden();
        const back = lead.getByRole('button', { name: 'Back to conversations' });
        const box = (await back.boundingBox())!;
        expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
      } else {
        // Two panes: the list stays beside the transcript; Details starts closed.
        await expect(list).toBeVisible();
        const listBox = (await list.boundingBox())!;
        const logBox = (await log.boundingBox())!;
        expect(logBox.x).toBeGreaterThanOrEqual(listBox.x + listBox.width - 1);
        expect(logBox.x + logBox.width).toBeLessThanOrEqual(width);
        await expect(lead.getByRole('complementary', { name: 'Conversation details' })).toHaveCount(
          0,
        );
      }
      // The composer sits at the bottom of the window, inside it.
      const send = lead.getByRole('button', { name: 'Send' });
      const sendBox = (await send.boundingBox())!;
      expect(sendBox.height).toBeGreaterThanOrEqual(44);
      expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(
        testInfo.project.use.viewport?.height ?? 812,
      );
      await expectNoSidewaysScroll(lead);
      await lead.screenshot({ path: `kanit/385-inbox-${tag}-conversation.png` });
      assertNoBlockingViolations(
        await scanScreen(lead, `Inbox conversation (${tag} px)`, testInfo),
      );

      // --- Details: a sheet from below, that opens and closes ------------------
      await lead.getByRole('button', { name: 'Show details panel' }).tap();
      const sheet = lead.getByRole('dialog', { name: 'Conversation details' });
      await expect(sheet).toBeVisible();
      await expect(
        sheet.getByRole('complementary', { name: 'Conversation details' }),
      ).toBeVisible();
      const sheetBox = (await sheet.boundingBox())!;
      expect(sheetBox.width).toBeGreaterThanOrEqual(width - 1);
      await expectNoSidewaysScroll(lead);
      await lead.screenshot({ path: `kanit/385-inbox-${tag}-details.png` });
      assertNoBlockingViolations(await scanScreen(lead, `Inbox details (${tag} px)`, testInfo));
      await sheet.getByRole('button', { name: /collapse/i }).tap();
      await expect(sheet).toHaveCount(0);

      // --- Take it over from the Team Member ------------------------------------
      if (phone) await lead.getByRole('button', { name: 'Back to conversations' }).tap();
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: /^Take over / }).tap();
      const dialog = lead.getByRole('dialog', { name: 'Take over this chat?' });
      await expect(dialog).toContainText('Priya Nair');
      const taken = lead.waitForResponse(
        (response) =>
          response.url().endsWith(`/chats/${chatId}/takeover`) &&
          response.request().method() === 'POST',
      );
      await dialog.getByRole('button', { name: 'Take over' }).tap();
      expect((await taken).status()).toBe(200);
      await expect(dialog).toHaveCount(0);
      await expect
        .poll(
          async () =>
            (
              (await (
                await request.get(`${API_BASE}/chats/${chatId}`, { headers: owner })
              ).json()) as { thread: { assignee_id: string | null } }
            ).thread.assignee_id,
        )
        .toBe(leadId);

      // --- And answer it ----------------------------------------------------------
      if (phone && (await list.isVisible())) {
        await row.locator('button[data-chat-row]').tap();
      }
      await expect(log).toContainText(question);
      const reply = `On it from the road — ${tag} ${stamp}`;
      await lead.getByPlaceholder('Type your reply').fill(reply);
      await lead.getByRole('button', { name: 'Send' }).tap();
      await expect(log).toContainText(reply);
      await expectNoSidewaysScroll(lead);
      await lead.screenshot({ path: `kanit/385-inbox-${tag}-answered.png` });
    } finally {
      await Promise.all([visitorContext.close(), leadContext.close()]);
    }
  });

  test('an unadapted screen still shows the band; the inbox beside it does not', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/customers');
    await expect(agentPage.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: BAND })).toBeVisible();
    expect(await sidewaysOverflow(agentPage)).toBe(0);

    await agentPage.getByRole('link', { name: 'Inbox' }).tap();
    await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('region', { name: BAND })).toHaveCount(0);
  });

  test('the conversation timeline opens from the Details sheet and fits the window (ID-09)', async ({
    agentPage,
  }, testInfo) => {
    const tag = projectWidth(testInfo) < 768 ? '375' : '768';
    await agentPage.goto('/app/inbox');
    await agentPage.locator('button[data-chat-row]').first().tap();
    await agentPage.getByRole('button', { name: 'Show details panel' }).tap();
    const sheet = agentPage.getByRole('dialog', { name: 'Conversation details' });
    await sheet.getByRole('button', { name: 'Timeline', exact: true }).tap();

    await expect(agentPage.getByRole('heading', { name: 'Timeline', level: 1 })).toBeVisible();
    await expect(agentPage).toHaveURL(/\/app\/inbox\/timeline/);
    await expect(agentPage.getByRole('region', { name: BAND })).toHaveCount(0);
    await agentPage.waitForLoadState('networkidle');
    await expectNoSidewaysScroll(agentPage);
    await agentPage.screenshot({ path: `kanit/385-timeline-${tag}.png` });
    assertNoBlockingViolations(await scanScreen(agentPage, `Timeline (${tag} px)`, testInfo));
  });
});
