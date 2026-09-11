/**
 * The rule bot (FR-MOD-06.6), end to end.
 *
 * PRD:577 asks for a chatbot that is separate from the AI Agent and carries no
 * LLM. The integration suite proves the engine and the isolation test reads the
 * import graph; what only the live stack can show is the whole chain in one
 * piece: an admin writes a rule in the real console, a real visitor in a real
 * cross-origin iframe types the words it matches, and the sentence the admin
 * typed comes back — byte for byte, because an answer a model shaped would not.
 *
 * Two things make the assertion mean something rather than merely pass:
 *
 *   - The reply is compared to the exact string that went into the editor. The
 *     AI path in this build answers from the knowledge base through
 *     `shapeAnswer`, so it could not produce this string even by accident.
 *   - The event is read back from the API and its `author_id` checked against
 *     the bot's own uuid. The AI responder authors as the fixed `'ai-agent'`
 *     id, so this distinguishes the two paths and not just their wording.
 *
 * Self-cleaning, and it has to be: this suite shares one seeded database and a
 * live rule bot on a seeded team would answer every other spec's visitor. The
 * bot is deleted in `finally`, and until then its rule keys on a stamped token
 * no other spec can type.
 */
import type { APIRequestContext } from '@playwright/test';
import {
  API_BASE,
  expect,
  ownerAccessToken,
  tenantSubdomain,
  test,
  widgetFrame,
} from './fixtures.js';

interface Bot {
  id: string;
  name: string;
  groups: Array<{ group_id: number; priority: string }>;
}

interface Event {
  text?: string;
  author_id: string | null;
  author_type: string;
}

async function bots(request: APIRequestContext, auth: Record<string, string>): Promise<Bot[]> {
  const response = await request.get(`${API_BASE}/settings/bots`, { headers: auth });
  expect(response.ok(), `listing bots failed: ${response.status()}`).toBeTruthy();
  return ((await response.json()) as { items: Bot[] }).items;
}

test.describe('rule bot (FR-MOD-06.6)', () => {
  test.use({ viewport: { width: 1680, height: 1050 } });

  test('an admin writes a rule and a visitor gets exactly that answer, with no AI in the path', async ({
    agentPage,
    browser,
    request,
    organizationId,
  }) => {
    test.slow();
    const stamp = Date.now().toString().slice(-6);
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const botName = `E2E hours bot ${stamp}`;
    // A token no other spec types, so the rule is inert for everyone else even
    // in the seconds it exists.
    const trigger = `nexahours${stamp}`;
    const answer = `We are open 09:00-18:00 CET (${stamp}).`;
    const site = tenantSubdomain(`rulebot-${stamp}`);
    let botId: string | null = null;

    try {
      // --- 1. The admin builds the bot in the real console -----------------
      await agentPage.goto('/app/team/ai-agents');
      const section = agentPage.getByRole('region', { name: 'Rule bots' });
      await expect(section).toBeVisible();

      await section.getByLabel('Bot name').fill(botName);
      await section.getByRole('button', { name: 'Add bot' }).click();
      await expect(section.getByText(botName, { exact: true })).toBeVisible();

      botId = (await bots(request, auth)).find((bot) => bot.name === botName)?.id ?? null;
      expect(botId, 'the console did not create the bot').toBeTruthy();

      // Attached to every team the workspace has, at `primary`. Which team the
      // visitor's chat is routed to is the routing rules' business and changes
      // with the seed; the requirement under test is that the *assignment* is
      // what gives the bot reach, so the test gives it reach everywhere rather
      // than guessing one team.
      const teamPicker = section.getByLabel(`Team for ${botName}`);
      const options = (await teamPicker.locator('option').all()).slice(1);
      const values = await Promise.all(options.map((option) => option.getAttribute('value')));
      for (const [index, value] of values.entries()) {
        await teamPicker.selectOption(value!);
        await section.getByLabel(`Priority for ${botName}`).selectOption('primary');
        await section.getByRole('button', { name: 'Attach' }).click();
        // Each attach sends the whole list, so the next one has to start from a
        // list that already includes this team.
        await expect
          .poll(async () => (await bots(request, auth)).find((b) => b.id === botId)?.groups.length)
          .toBe(index + 1);
      }

      // --- 2. …and the rule, as one condition and one action ---------------
      await section.getByLabel('Rule').fill(`Opening hours ${stamp}`);
      await section.getByLabel(`Condition kind for ${botName}`).selectOption('message_word');
      await section.getByLabel('Match').fill(trigger);
      await section.getByLabel(`Action kind for ${botName}`).selectOption('send_message');
      await section.getByLabel('Value').fill(answer);
      await section.getByRole('button', { name: 'Add rule' }).click();
      await expect(section.getByText(`Opening hours ${stamp}`)).toBeVisible();
      await agentPage.screenshot({ path: 'kanit/06.6-rule-bot-editor.png', fullPage: true });

      // --- 3. A real visitor, in a real cross-origin iframe ----------------
      const visitorContext = await browser.newContext();
      const visitor = await visitorContext.newPage();
      try {
        await visitor.goto(`${site.origin}/demo.html?organization_id=${organizationId}`);
        const frame = widgetFrame(visitor);
        await frame.getByRole('button', { name: 'Open chat' }).click();
        await expect(frame.getByRole('textbox', { name: 'Message' })).toBeVisible({
          timeout: 20_000,
        });

        await frame.getByRole('textbox', { name: 'Message' }).fill(`hi ${trigger} please`);
        await frame.getByRole('button', { name: 'Send' }).click();

        // The bot's sentence, exactly as it was typed into the editor. An
        // answer shaped by a model could not be this string.
        await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(answer, {
          timeout: 20_000,
        });
        await visitor.screenshot({ path: 'kanit/06.6-rule-bot-reply.png', fullPage: true });
      } finally {
        await visitorContext.close();
      }

      // --- 4. The same claim, put to the server rather than to the screen ---
      const list = await request.get(`${API_BASE}/chats?view=all&limit=50`, { headers: auth });
      expect(list.ok()).toBeTruthy();
      const chats = ((await list.json()) as { items: Array<{ id: string }> }).items;

      let reply: Event | undefined;
      for (const chat of chats) {
        const response = await request.get(`${API_BASE}/chats/${chat.id}/events?limit=50`, {
          headers: auth,
        });
        if (!response.ok()) continue;
        const events = ((await response.json()) as { items: Event[] }).items;
        reply = events.find((event) => event.text === answer);
        if (reply) break;
      }

      expect(reply, 'the bot reply is not in the transcript the API returns').toBeTruthy();
      // A bot, not an agent: the invoice and the response-time report both read
      // this column.
      expect(reply!.author_type).toBe('bot');
      // And WHICH bot — the AI responder authors as the fixed `ai-agent` id, so
      // this is the assertion that tells the two paths apart.
      expect(reply!.author_id).toBe(botId);
    } finally {
      // Leave the tenant as it was found: a live rule bot on a seeded team
      // would answer every other spec's visitor.
      if (botId) {
        await request.delete(`${API_BASE}/settings/bots/${botId}`, { headers: auth });
      }
    }
  });
});
