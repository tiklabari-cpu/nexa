/**
 * The CSAT loop, end to end and across all three applications
 * (FR-MOD-07.8 · 08.7.7 · 11.4).
 *
 * The three halves of this feature were each proven on their own — the widget
 * against a fake `fetch` (`widget.rating.test.ts`, `widget.close.test.ts`,
 * `widget.postchat.test.ts`), the endpoints against a real database
 * (`customer-chat.test.ts`), the report against seeded rows (`reports.spec.ts`
 * reads the tab, but the ratings behind its donut were put there by the seed).
 * Nothing joined them: no test had ever taken a vote a *visitor* cast in a
 * browser and found it on the agent's screen.
 *
 * That gap is exactly where this feature can break without anyone noticing. The
 * widget holds no socket, so the only thing that tells it a conversation ended
 * is a four-second poll noticing `chat` went null — a signal no unit test can
 * produce for real, and the one the entire closing experience (post-chat form,
 * rating prompt, ended banner) hangs off. So both ways a conversation can end
 * are driven here: the agent archiving it, and the visitor ending it themselves.
 *
 * The workspace's post-chat question is created by this file rather than the
 * seed. A field every visitor is asked after every chat is not something the
 * demo tenant should ship, and the closing experience with no post-chat field
 * configured is already the subject of `widget.spec.ts`.
 */
import { request as newApiContext, type APIRequestContext } from '@playwright/test';
import {
  expect,
  test,
  ACME_OWNER,
  API_BASE,
  HOST_PAGE,
  openWidget,
  ownerAccessTokenFor,
  signIn,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

/**
 * The question this workspace asks once a conversation is over — a `contact`
 * custom field with `form_placement: 'post_chat'`. No `?`, so the label can go
 * straight into a `RegExp` below without escaping.
 */
const POST_CHAT_LABEL = 'What could we have done better';

/** The `csat` block of `GET /reports/reviews` — what the donut draws. */
interface Csat {
  good: number;
  bad: number;
  responses: number;
  score: number | null;
}

let apiCtx: APIRequestContext;
let ownerToken: string;
let postChatFieldId = '';

function authorized(): { authorization: string } {
  return { authorization: `Bearer ${ownerToken}` };
}

/**
 * The satisfaction figures the report is serving right now.
 *
 * Read from the API rather than asserted against a hard-coded seed constant:
 * the fixture is retuned from time to time, and what this file actually claims
 * is a *delta* — one more vote than a moment ago — which only a before/after
 * pair can express honestly.
 */
async function csat(): Promise<Csat> {
  const response = await apiCtx.get(`${API_BASE}/reports/reviews`, { headers: authorized() });
  expect(
    response.ok(),
    `reviews report failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return ((await response.json()) as { csat: Csat }).csat;
}

test.beforeAll(async () => {
  apiCtx = await newApiContext.newContext({
    extraHTTPHeaders: { 'user-agent': 'nexa-e2e-csat' },
  });
  ownerToken = await ownerAccessTokenFor(apiCtx, ACME_OWNER);

  // A run that died mid-file leaves the definition behind, and (license, entity,
  // label) is unique — the create below would then fail with a 400 that reads
  // like a product bug and is not one. Clear ours first.
  const existing = await apiCtx.get(`${API_BASE}/settings/custom-fields?entity=contact`, {
    headers: authorized(),
  });
  expect(existing.ok(), `listing custom fields failed: ${existing.status()}`).toBe(true);
  const items = ((await existing.json()) as { items: Array<{ id: string; label: string }> }).items;
  for (const stale of items.filter((item) => item.label === POST_CHAT_LABEL)) {
    await apiCtx.delete(`${API_BASE}/settings/custom-fields/${stale.id}`, {
      headers: authorized(),
    });
  }

  const created = await apiCtx.post(`${API_BASE}/settings/custom-fields`, {
    headers: authorized(),
    data: {
      entity: 'contact',
      label: POST_CHAT_LABEL,
      type: 'text',
      form_placement: 'post_chat',
    },
  });
  expect(
    created.ok(),
    `creating the post-chat field failed: ${created.status()} ${await created.text()}`,
  ).toBe(true);
  postChatFieldId = ((await created.json()) as { id: string }).id;
});

test.afterAll(async () => {
  // Put the workspace back. Every later spec's visitor would otherwise be asked
  // this question the moment their conversation ends, and the files that close
  // one (`demo-flow`, `widget`) assert on what the panel shows afterwards.
  if (postChatFieldId) {
    await apiCtx.delete(`${API_BASE}/settings/custom-fields/${postChatFieldId}`, {
      headers: authorized(),
    });
  }
  await apiCtx?.dispose();
});

test('an archived conversation asks the visitor the workspace questions, takes a 👍, and the vote reaches Reports → Reviews', async ({
  browser,
  organizationId,
}) => {
  // Two applications, a poll interval and three navigations — comfortably past
  // the default budget, and slow for reasons that are the product's, not a bug.
  test.slow();

  // Separate contexts: the visitor and the agent are different people on
  // different sites, and sharing storage would let a bug in one mask the other.
  const visitorContext = await browser.newContext();
  const agentContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const agent = await agentContext.newPage();

  // Six digits, not a bare `Date.now()`: a 13-digit run is card-length, and card
  // masking (FR-MOD-08.9.5) rewrites the Luhn-valid ones — including the answers
  // typed into the post-chat form, which go through the same masker.
  const stamp = Date.now().toString().slice(-6);
  const visitorName = `Casey Rivera ${stamp}`;
  const answer = `Reply a little faster ${stamp}`;

  try {
    await signIn(agent);
    // Routing assigns nothing to an agent who is not accepting work.
    await agent.getByLabel('Availability').selectOption('accepting_chats');

    // Arrive through the greeting card rather than `openWidget`, so this visitor
    // has a name. The answers they leave below have to be findable on a *person*
    // in the CRM, and an anonymous visitor is only addressable as "the most
    // recent one" — which is not a proof, it is a coincidence waiting to break.
    await visitor.goto(`${HOST_PAGE}/demo.html?organization_id=${organizationId}`);
    const frame = widgetFrame(visitor);
    await frame.getByRole('button', { name: "Let's chat" }).click();
    await frame.getByRole('textbox', { name: 'Your name' }).fill(visitorName);
    await frame.getByRole('button', { name: 'Start chat' }).click();

    const question = `My chain keeps slipping — ${stamp}`;
    await visitorSends(visitor, question);

    // --- The agent answers, then archives -----------------------------------
    const list = agent.getByRole('region', { name: 'Conversations' });
    await expect(list).toContainText(question, { timeout: 20_000 });
    await list.getByRole('button').first().click();
    await expect(agent.locator('main')).toContainText(question);

    const reply = `Bring it in and we will fit a new chain — ${stamp}`;
    await agent.getByRole('radio', { name: 'Reply' }).click();
    await agent.getByPlaceholder('Type your reply').fill(reply);
    await agent.getByRole('button', { name: 'Send' }).click();
    await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(reply, {
      timeout: 20_000,
    });

    await agent.getByRole('button', { name: /Archive conversation/i }).click();
    await expect(agent.locator('main')).not.toContainText('Type your reply');

    // --- The visitor is asked, without touching anything --------------------
    // Nobody reloads the widget here. The panel has no socket, so this appearing
    // at all is the four-second poll noticing the conversation went away — the
    // single mechanism the whole closing experience depends on.
    const postChat = frame.getByRole('form', { name: 'A few last questions' });
    await expect(postChat).toBeVisible({ timeout: 20_000 });
    await expect(frame.getByText('Chat ended.')).toBeVisible();

    await frame.getByRole('textbox', { name: POST_CHAT_LABEL }).fill(answer);
    await visitor.screenshot({ path: 'kanit/csat-postchat-form.png', fullPage: true });
    await postChat.getByRole('button', { name: 'Send answers' }).click();
    await expect(postChat.getByText('Thanks, we have your answers.')).toBeVisible();

    // --- …and votes ---------------------------------------------------------
    const rating = frame.getByRole('group', { name: 'Rate this chat' });
    await expect(rating).toBeVisible();

    // Read the baseline as late as possible: everything above writes to this
    // workspace, and a figure taken at the top of the test would be measuring
    // the setup as well as the vote.
    const before = await csat();

    await rating.getByRole('button', { name: '👍 Good' }).click();
    await expect(rating.getByText('Thanks for your feedback!')).toBeVisible();
    await visitor.screenshot({ path: 'kanit/csat-widget-rated.png', fullPage: true });

    // One vote, on the good side, and nothing else moved.
    await expect.poll(async () => (await csat()).good, { timeout: 20_000 }).toBe(before.good + 1);
    const after = await csat();
    expect(after.bad).toBe(before.bad);
    expect(after.responses).toBe(before.responses + 1);

    // --- The answers are on the contact the agent can see -------------------
    // The rating and the form answers travel by different routes (a chat-scoped
    // rating, a contact-scoped custom field), so proving one says nothing about
    // the other. Case-insensitive: the CRM styles field labels uppercase.
    await agent.goto('/app/customers');
    await agent.getByRole('searchbox', { name: 'Search customers' }).fill(visitorName);
    await agent
      .getByRole('button', { name: new RegExp(visitorName) })
      .first()
      .click();
    const stored = agent.getByLabel(new RegExp(POST_CHAT_LABEL, 'i'));
    await expect(stored).toHaveValue(answer);
    // The panel scrolls independently of the page, and the custom fields card
    // sits below its fold — a `fullPage` shot without this is evidence of a
    // contact, not of the answer on it.
    await stored.scrollIntoViewIfNeeded();
    await agent.screenshot({ path: 'kanit/csat-crm-answer.png', fullPage: true });

    // --- …and the vote is on the donut --------------------------------------
    await agent.goto('/app/reports');
    await expect(agent.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
    await agent.getByRole('tab', { name: 'Reviews' }).click();

    const satisfaction = agent.getByRole('region', { name: 'Satisfaction (CSAT)' });
    await expect(satisfaction).toBeVisible();
    // The donut is an `<svg role="img">`; its accessible label is the only place
    // its slices are readable as text, and it must quote the server rather than
    // a figure of the screen's own.
    await expect(satisfaction.getByRole('img')).toHaveAccessibleName(
      new RegExp(`${after.good} of ${after.responses} rated good`),
    );
    await expect(
      satisfaction.getByText('Rated good', { exact: true }).locator('xpath=..'),
    ).toContainText(String(after.good));
    await agent.screenshot({ path: 'kanit/csat-reports-reviews.png', fullPage: true });
  } finally {
    await visitorContext.close();
    await agentContext.close();
  }
});

test('a visitor who ends the chat themselves is asked the same questions, and their 👎 lands in the same report', async ({
  browser,
  organizationId,
}) => {
  test.slow();

  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  const stamp = Date.now().toString().slice(-6);
  const answer = `The queue wait was long ${stamp}`;

  try {
    await openWidget(visitor, organizationId);
    await visitorSends(visitor, `Do you fit mudguards? — ${stamp}`);

    // --- The visitor ends it ------------------------------------------------
    const frame = widgetFrame(visitor);
    await frame.getByRole('button', { name: 'More options' }).click();
    await frame.getByRole('menuitem', { name: 'End chat' }).click();

    // The confirmation is a real dialog, and cancelling it must be possible —
    // so the button that actually sends the request is addressed through it,
    // not by the name it shares with the menu item that opened it.
    const confirm = frame.getByRole('dialog', { name: 'End this chat?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'End chat' }).click();

    await expect(frame.getByText('Chat ended.')).toBeVisible();

    // Same closing experience as the archived case above, reached the other way
    // round: here the widget knows immediately rather than learning from a poll.
    const postChat = frame.getByRole('form', { name: 'A few last questions' });
    await expect(postChat).toBeVisible();
    await frame.getByRole('textbox', { name: POST_CHAT_LABEL }).fill(answer);
    await postChat.getByRole('button', { name: 'Send answers' }).click();
    await expect(postChat.getByText('Thanks, we have your answers.')).toBeVisible();

    const before = await csat();
    const rating = frame.getByRole('group', { name: 'Rate this chat' });
    await rating.getByRole('button', { name: '👎 Not good' }).click();
    await expect(rating.getByText('Thanks for your feedback!')).toBeVisible();
    await visitor.screenshot({ path: 'kanit/csat-visitor-ended.png', fullPage: true });

    // The unhappy vote counts too, and on the other side of the donut.
    await expect.poll(async () => (await csat()).bad, { timeout: 20_000 }).toBe(before.bad + 1);
    const after = await csat();
    expect(after.good).toBe(before.good);
    expect(after.responses).toBe(before.responses + 1);
  } finally {
    await visitorContext.close();
  }
});
