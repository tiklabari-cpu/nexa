/**
 * The three v1 channels together, end to end — FR-MOD-08.5.4 (Messenger),
 * FR-MOD-08.5.5 (Twilio SMS), FR-MOD-08.5.6 (WhatsApp), and with them
 * FR-MOD-08.5.1 (the card grid) and FR-MOD-02.1.4 (the Views group).
 *
 * Each channel arrived in two halves a long way apart: the mock adapter and the
 * connect/webhook/outbound routes in tm 35, the Settings card in 08.5.4-b /
 * 08.5.5-b / 08.5.6-b. Both halves were green the whole time and the channels
 * still did not work as a product — until the cards landed, `/channels` had no
 * writer any admin could reach, so the inbox's Views group could never show a
 * row and the webhook had no address to resolve. That is the shape of gap this
 * whole phase exists to close, and a per-layer test cannot see it.
 *
 * So this drives all three at once, in the order a person would: connect three
 * different kinds of credential in Settings → each provider POSTs its own
 * webhook shape → each conversation is in the inbox, readable, answerable →
 * the Views group lists three rows and the "connect a channel" promo is gone →
 * disconnect and every surface is honest again.
 *
 * Three at once rather than three files, because the claim is partly about
 * them coexisting: three rows in one rail, three cards in one grid, three
 * addresses one webhook dispatcher has to tell apart. `instagram.spec.ts` and
 * `telegram.spec.ts` already prove one channel deeply (address ownership,
 * cross-tenant refusal); this proves the set.
 *
 * Messages are delivered by POSTing the public webhook rather than by writing
 * to the database, because an anonymous POST carrying nothing but the connected
 * address is exactly what Meta/Twilio do and exactly what has to work. The
 * reply used to be asserted twice — the composer for what the *agent* sees, an
 * admin `/channels/{type}/messages` POST for what would reach the *customer* —
 * because the two were not wired to each other. They are now: an agent's reply
 * is dispatched to the provider by the chat core itself, so the composer is the
 * whole send. What this file could not do until M-CHOBS-a was *observe* that
 * send — the log row it writes had no reader, so a channel that had silently
 * stopped delivering left every assertion here green. It now reads that log
 * back through `GET /channels/{type}/messages`.
 */
import { request as newApiContext, type APIRequestContext, type Locator } from '@playwright/test';
import {
  ACME_OWNER,
  API_BASE,
  channelWebhook,
  expect,
  ownerAccessTokenFor,
  test,
} from './fixtures.js';

/**
 * One stamp for the whole file, so every address, sender and message text is
 * unique to this run and the tests below can share them across the serial
 * chain. Six digits is enough to keep a phone number inside the adapter's
 * `^\+?[0-9]{3,20}$` shape while still reading like a real number.
 */
const STAMP = Date.now().toString().slice(-6);

/** Everything that differs between the three channels, and nothing that does not. */
interface Subject {
  /** Human name, for test titles and failure messages. */
  label: string;
  /** The Settings card's `data-testid` suffix. */
  card: string;
  /** The `/channels/:type/…` segment — the provider, which is not always the card. */
  type: string;
  /** The row label in the Inbox Views group. */
  view: string;
  /** The card's not-connected button, which opens the connect modal. */
  connectCta: string;
  /** The connect modal's accessible name. */
  dialog: string;
  /** The channel address: what the card shows back and what the webhook routes on. */
  address: string;
  /** The customer's own address — the reply has to resolve back to this. */
  sender: string;
  /** The name the provider passes for the sender, shown in the conversation list. */
  senderName: string;
  /** Fill the connect modal's fields. The submit button is pressed by the caller. */
  fill: (dialog: Locator) => Promise<void>;
  /** The provider's own inbound webhook body — a different shape per provider. */
  inbound: (text: string) => Record<string, unknown>;
  /** The shape of provider message id an outbound send comes back with. */
  providerMessageId: RegExp;
  /** The wording of the disconnect confirmation this card asks with. */
  disconnectConfirm: string;
}

const SUBJECTS: readonly Subject[] = [
  {
    label: 'Messenger',
    card: 'messenger',
    type: 'messenger',
    view: 'Messenger',
    // The only card whose CTA names the provider: the button itself stands in
    // for the Facebook redirect, so no authorization code is ever typed.
    connectCta: 'Connect with Facebook (mock)',
    dialog: 'Connect Facebook Messenger',
    address: `1043${STAMP}`,
    sender: `PSID${STAMP}`,
    senderName: `Ines Ferreira ${STAMP}`,
    fill: async (dialog) => {
      await dialog.getByLabel('Facebook Page id').fill(`1043${STAMP}`);
      await dialog.getByLabel('Page name (optional)').fill(`Acme Bikes ${STAMP}`);
    },
    inbound: (text) => ({
      recipient: { id: `1043${STAMP}` },
      sender: { id: `PSID${STAMP}`, name: `Ines Ferreira ${STAMP}` },
      message: { text },
    }),
    providerMessageId: /^mid\./,
    disconnectConfirm: 'Disconnect Messenger?',
  },
  {
    label: 'WhatsApp',
    card: 'whatsapp',
    type: 'whatsapp',
    view: 'WhatsApp',
    connectCta: 'Connect',
    dialog: 'Connect WhatsApp',
    address: `+1555${STAMP}`,
    sender: `+1777${STAMP}`,
    senderName: `Yusuf Demir ${STAMP}`,
    fill: async (dialog) => {
      await dialog.getByLabel('WhatsApp Business Account id').fill(`waba_${STAMP}`);
      await dialog.getByLabel('Phone number').fill(`+1555${STAMP}`);
    },
    inbound: (text) => ({
      to: `+1555${STAMP}`,
      from: `+1777${STAMP}`,
      text: { body: text },
      profile_name: `Yusuf Demir ${STAMP}`,
    }),
    providerMessageId: /^wamid\./,
    disconnectConfirm: 'Disconnect WhatsApp?',
  },
  {
    label: 'SMS',
    // The card is `sms` (what the channel does) but the type is `twilio` (who
    // runs it) — the one place in the grid where the two differ, and the reason
    // a card-id-driven test would silently pass against the wrong channel.
    card: 'sms',
    type: 'twilio',
    view: 'SMS',
    connectCta: 'Connect',
    dialog: 'Connect SMS (Twilio)',
    address: `+1666${STAMP}`,
    sender: `+1888${STAMP}`,
    senderName: `Marta Kowalska ${STAMP}`,
    fill: async (dialog) => {
      await dialog.getByLabel('Twilio Account SID').fill(`AC${STAMP}mockaccountsid`);
      await dialog.getByLabel('Twilio Auth token').fill(`mock-auth-token-${STAMP}`);
      await dialog.getByLabel('Phone number').fill(`+1666${STAMP}`);
    },
    inbound: (text) => ({
      To: `+1666${STAMP}`,
      From: `+1888${STAMP}`,
      Body: text,
      FromName: `Marta Kowalska ${STAMP}`,
    }),
    providerMessageId: /^SM/,
    disconnectConfirm: 'Disconnect SMS?',
  },
];

/** The customer's question and the agent's answer, per channel. */
const question = (subject: Subject): string => `${subject.label} order ${STAMP}: where is my bike?`;
const answer = (subject: Subject): string => `It ships tomorrow — ${subject.label} ${STAMP}`;

/** The chat each inbound message opened, so teardown can archive it by id. */
const chatIds = new Map<string, string>();

let apiCtx: APIRequestContext;

test.beforeAll(async () => {
  apiCtx = await newApiContext.newContext({
    extraHTTPHeaders: { 'user-agent': 'nexa-e2e-channels' },
  });
});

/**
 * A freshly minted owner bearer header, per call.
 *
 * Deliberately not hoisted into `beforeAll` and reused. One token minted at
 * file scope was accepted by the first tests here and then came back 401 for
 * the teardown a few tests later — every test in this file signs the owner in
 * through the browser, and the account's OAuth tokens do not all survive that.
 * The cost is three extra requests per call against a test server whose
 * anonymous limit is raised to 2000/min; the alternative was a teardown that
 * silently did nothing. `telegram.spec.ts` mints per leg for the same reason.
 */
async function ownerAuth(): Promise<Record<string, string>> {
  return { authorization: `Bearer ${await ownerAccessTokenFor(apiCtx, ACME_OWNER)}` };
}

test.afterAll(async () => {
  const auth = await ownerAuth();

  // Put the workspace back even when a test above failed halfway through.
  // Every later file that touches channels — `instagram.spec.ts`,
  // `settings.spec.ts`, `telegram.spec.ts` — asserts against a workspace with
  // nothing connected (the promo, a Connect button), so a leaked connection
  // here would fail three specs that have nothing wrong with them.
  for (const subject of SUBJECTS) {
    await apiCtx
      .post(`${API_BASE}/channels/${subject.type}/disconnect`, { headers: auth })
      // A 404 means it was already disconnected, which is the desired state.
      .catch(() => {});
  }

  // And archive the three conversations they delivered. This is not tidiness:
  // routing gives a chat to an agent who is under their concurrent limit
  // (`routing-service.ts` counts `threads WHERE active`), and the seeded
  // teammate these landed on is the same one `skills-routing.spec.ts` later
  // expects a skill-matched chat to route to. Left open, three extra active
  // threads fill that agent and the other file fails with a routing timeout
  // that has nothing to do with its own subject. Measured: it did.
  //
  // Asserted rather than best-effort: a teardown that quietly 403s leaves
  // exactly the pollution it was written to prevent, and the file it breaks is
  // not this one — so a silent failure here would be diagnosed twenty minutes
  // away, in a spec with no clue pointing back.
  for (const chatId of chatIds.values()) {
    const closed = await apiCtx.post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth });
    expect(
      closed.ok(),
      `archiving channel chat ${chatId} failed: ${closed.status()} ${await closed.text()}`,
    ).toBe(true);
  }

  await apiCtx?.dispose();
});

// Serial: each test starts from the state the previous one left. Connecting is
// the setup for delivery, delivery is the setup for the Views rail, and the
// disconnect at the end is the "and it goes away again" half of the claim.
test.describe.configure({ mode: 'serial' });

test.describe('Messenger + WhatsApp + SMS (FR-MOD-08.5.4-.6)', () => {
  /**
   * The "before" half of the acceptance criterion, asserted rather than
   * assumed. Without it the connected assertions prove far less — a rail row
   * that was always there, or a card that always said Connect, would satisfy
   * them.
   *
   * It is also where the removal of the unbuilt-channel path is checked at the
   * only level that can see it (08.5-c, K08.5.1). These three cards were the
   * last placeholders in the grid: the status, the notify-me button and its
   * `localStorage` key are gone from `Channels.tsx`, so no card in this section
   * may render that label — including the two (Instagram, Telegram) this file
   * does not otherwise touch.
   */
  test('offers no channel views and three connectable cards while nothing is connected', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/inbox');

    // FR-MOD-02.1.4: no known channel connected → the promo, not an empty group.
    const views = agentPage.getByRole('navigation', { name: 'Inbox views' });
    await expect(agentPage.getByTestId('channel-promo')).toBeVisible();
    for (const subject of SUBJECTS) {
      await expect(views.getByRole('link', { name: subject.view })).toHaveCount(0);
    }

    await agentPage.goto('/app/settings');
    const channels = agentPage.getByRole('region', { name: 'Channels' });

    for (const subject of SUBJECTS) {
      const card = channels.getByTestId(`channel-${subject.card}`);
      await expect(card.getByText('Not connected')).toBeVisible();
      await expect(card.getByRole('button', { name: subject.connectCta })).toBeVisible();
    }

    // Nothing in the grid is a placeholder any more — not these three, not the
    // two channels this file leaves alone. The whole section, not per card,
    // because the dead code removed was shared by all of them.
    await expect(channels.getByText('Coming soon')).toHaveCount(0);
  });

  /**
   * Three different kinds of credential, one grid. Messenger's button carries
   * a mock OAuth code the admin never sees; WhatsApp asks for two plain
   * identifiers; SMS asks for a secret the server verifies and throws away.
   */
  test('connects all three from Settings, each showing back its own address', async ({
    agentPage,
  }) => {
    // Three modals, three round trips, on a dev server that may still be cold.
    test.slow();

    await agentPage.goto('/app/settings');
    const channels = agentPage.getByRole('region', { name: 'Channels' });

    for (const subject of SUBJECTS) {
      const card = channels.getByTestId(`channel-${subject.card}`);
      await card.getByRole('button', { name: subject.connectCta }).click();

      const dialog = agentPage.getByRole('dialog', { name: subject.dialog });
      await expect(dialog).toBeVisible();

      const submit = dialog.getByRole('button', { name: 'Connect' });
      // Nothing may be submitted empty — a channel connected without its
      // address is one no webhook could ever reach (FR-EK-A.1).
      await expect(submit).toBeDisabled();
      await subject.fill(dialog);
      await expect(submit).toBeEnabled();

      // Wait for the POST rather than the redraw: the card is fed by an
      // invalidated query, and asserting the badge before the round trip lands
      // would be asserting optimism.
      const connected = agentPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/channels/${subject.type}/connect`) &&
          response.request().method() === 'POST',
      );
      await submit.click();
      const response = await connected;
      expect(response.status(), `${subject.label} connect failed: ${await response.text()}`).toBe(
        200,
      );
      await expect(dialog).toHaveCount(0);

      // "Connected", not "Not connected" — the latter contains the former as a
      // substring, so the absent negative is what makes the positive mean
      // anything.
      await expect(card.getByText('Not connected')).toHaveCount(0);
      await expect(card.getByText('Connected')).toBeVisible();
      // The address an admin has to read back to know which page/number this
      // is — and the same value each webhook below resolves.
      await expect(card.getByText(subject.address)).toBeVisible();
      await expect(card.getByRole('button', { name: 'Disconnect' })).toBeVisible();
    }

    // The Twilio auth token is the one secret in the set: the server validates
    // it at connect and does not store it, so no read can hand it back.
    const listed = await apiCtx.get(`${API_BASE}/channels`, { headers: await ownerAuth() });
    expect(listed.ok(), `listing channels failed: ${listed.status()}`).toBe(true);
    expect(await listed.text()).not.toContain(`mock-auth-token-${STAMP}`);

    await agentPage.screenshot({ path: 'kanit/channels-connected.png', fullPage: true });
  });

  // One test per channel rather than one loop inside a single test: each gets
  // its own timeout budget, and a failure names the channel that broke instead
  // of the first one that did.
  for (const subject of SUBJECTS) {
    test(`delivers a ${subject.label} message to the inbox and answers it`, async ({
      agentPage,
      request,
    }) => {
      const text = question(subject);

      // Anonymous, public, routed by the connected address alone. No session,
      // no token — exactly what the provider sends.
      const { chat_id: chatId } = await channelWebhook(
        request,
        subject.type,
        subject.inbound(text),
      );
      expect(chatId).toBeTruthy();
      chatIds.set(subject.type, chatId);

      await agentPage.goto('/app/inbox');
      const list = agentPage.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(text, { timeout: 20_000 });
      // The provider's own name for the sender, so an agent knows who wrote in
      // rather than seeing another anonymous "Visitor".
      await expect(list).toContainText(subject.senderName);

      await list.getByRole('button').filter({ hasText: text }).first().click();
      await expect(agentPage.locator('main')).toContainText(text);

      // The composer works on a channel-originated chat exactly as it does on a
      // website one — same chat core underneath — and sending it is now the
      // whole delivery: `sendEvent` hands an agent's reply to the channel
      // dispatcher once the event is committed (FR-MOD-08.5.4-.8).
      //
      // This leg used to POST `/channels/{type}/messages` by hand right here,
      // because the composer and the provider were not wired to each other.
      // That call is gone: repeating it now would send the customer the same
      // answer twice. What it used to assert — a provider-shaped message id and
      // the writer resolved back from the chat — is asserted against the real
      // console reply in `channels-adapters.test.ts`, which can read
      // `channel_messages`; e2e keeps the half only it can see.
      const reply = answer(subject);
      const composer = agentPage.getByPlaceholder('Type your reply');
      await composer.fill(reply);
      await composer.press('Enter');
      await expect(agentPage.locator('main')).toContainText(reply);

      // …and the half e2e could not see until M-CHOBS-a existed. The composer
      // assertion above proves the agent's screen; it says nothing about the
      // provider, and `dispatchAgentReply` swallows a delivery failure on
      // purpose (a customer's outage must not fail the agent's request). So a
      // channel that stopped delivering entirely would have left every
      // assertion in this file green. `GET /channels/:type/messages` is the
      // record of what actually crossed, and `provider_message_id` is set only
      // by the adapter's own `send`.
      await expect
        .poll(
          async () => {
            const log = await apiCtx.get(
              `${API_BASE}/channels/${subject.type}/messages?direction=outbound&chat_id=${chatId}`,
              { headers: await ownerAuth() },
            );
            if (!log.ok()) return `HTTP ${log.status()}`;
            const { items } = (await log.json()) as {
              items: { text: string | null; provider_message_id: string | null }[];
            };
            const sent = items.find((item) => item.text === reply);
            return sent ? Boolean(sent.provider_message_id) : 'not delivered';
          },
          { timeout: 20_000 },
        )
        .toBe(true);
    });
  }

  test('lists all three in the Views group, alongside the conversations they delivered', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/inbox');
    const views = agentPage.getByRole('navigation', { name: 'Inbox views' });

    // Three rows, each reading Connected, and the promo that belongs only to a
    // workspace with nothing connected is gone. The rows are links into
    // Settings → Channels rather than filters — the group's job here is to say
    // which channels are live, and the three conversations below are what says
    // they are actually delivering.
    for (const subject of SUBJECTS) {
      const row = views.getByRole('link', { name: subject.view });
      await expect(row).toBeVisible();
      await expect(row).toContainText('Connected');
    }
    await expect(agentPage.getByTestId('channel-promo')).toHaveCount(0);

    // Three conversations, one per channel, each showing the customer the
    // provider named and the answer the agent just sent — the list preview is
    // the *last* event, so the reply is what it reads by now, not the question.
    const list = agentPage.getByRole('region', { name: 'Conversations' });
    for (const subject of SUBJECTS) {
      await expect(list).toContainText(subject.senderName, { timeout: 20_000 });
      await expect(list).toContainText(answer(subject));
    }

    await agentPage.screenshot({ path: 'kanit/channels-views.png', fullPage: true });
  });

  test('disconnects all three, and every surface tells the truth again', async ({ agentPage }) => {
    test.slow();

    await agentPage.goto('/app/settings');
    const channels = agentPage.getByRole('region', { name: 'Channels' });

    for (const subject of SUBJECTS) {
      const card = channels.getByTestId(`channel-${subject.card}`);

      // Disconnecting stops inbound messages, so each card asks first.
      let asked: string | null = null;
      agentPage.once('dialog', (d) => {
        asked = d.message();
        return d.accept();
      });
      const removed = agentPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/channels/${subject.type}/disconnect`) &&
          response.request().method() === 'POST',
      );
      await card.getByRole('button', { name: 'Disconnect' }).click();
      expect((await removed).status()).toBe(204);
      await expect.poll(() => asked).toContain(subject.disconnectConfirm);

      await expect(card.getByText('Not connected')).toBeVisible();
      await expect(card.getByRole('button', { name: subject.connectCta })).toBeVisible();
    }

    // The rail follows the same live state rather than latching: the rows go,
    // and the promo an unconnected workspace should see comes back.
    await agentPage.goto('/app/inbox');
    const views = agentPage.getByRole('navigation', { name: 'Inbox views' });
    await expect(agentPage.getByTestId('channel-promo')).toBeVisible();
    for (const subject of SUBJECTS) {
      await expect(views.getByRole('link', { name: subject.view })).toHaveCount(0);
    }

    // The conversations they delivered are still here. Disconnecting a channel
    // stops new messages; it does not erase the history an agent answered.
    const list = agentPage.getByRole('region', { name: 'Conversations' });
    for (const subject of SUBJECTS) {
      await expect(list).toContainText(subject.senderName);
    }
  });
});
