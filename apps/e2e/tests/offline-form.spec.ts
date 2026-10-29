/**
 * The offline form (FR-MOD-08.7.7 — the "ticket/prospect" half of "Forms builder
 * (pre-chat/post-chat/ticket/prospect)"), end to end.
 *
 * The claim under test is the acceptance criterion's second destination:
 * _"widget'ta gösterim → contact/**ticket**'a yazma"_. Everything below it is
 * proven elsewhere — the four placements by the integration suite, the request
 * body by `widget.offline.test.ts`, the builder's entity derivation by
 * `SettingsForms.test.tsx`. What only the live stack can show is the whole chain
 * in one piece: an admin builds two questions in the console, a visitor answers
 * them in a real cross-origin iframe, and an agent reads one answer on a ticket
 * and the other on the contact.
 *
 * One thing is faked and it is worth naming: availability. It is a count of the
 * workspace's accepting agents (and, since WG-09, whether an AI would answer),
 * and the seed makes every member of this tenant accepting — turning them off
 * would change routing for the rest of the suite, which shares one database and
 * runs serially. So the visitor's state poll is intercepted and made to say
 * what `agents_only` with nobody there says (`online` false, `can_start_chat`
 * false, `answered_by` none), and nothing else is: the token mint that carries
 * the two forms, the `POST /customer/ticket` that opens the ticket, and every
 * read and save the console makes are the real thing.
 *
 * The second test is WG-09's own (tm 341): the admin picks "Only when agents
 * are accepting chats" on the real screen, and a workspace that built no
 * question gets the form with its built-in fields — which the server takes only
 * because of that setting.
 *
 * Self-cleaning: the two definitions are removed at the end, so the tenant is
 * left as it was found. The ticket is not — the seed reseeds without truncating
 * and `tickets.spec.ts` already accumulates them.
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
import type { Page } from '@playwright/test';
import { fromNode } from './stack-ports.js';

/** The state poll, saying nobody can take a chat under `agents_only` — and nothing else changed. */
async function nobodyAvailable(visitor: Page): Promise<void> {
  await visitor.route(
    (url) => url.pathname === '/api/v1/customer/chat',
    async (route) => {
      const response = await route.fetch({ url: fromNode(route.request().url()) });
      const body = (await response.json()) as Record<string, unknown>;
      await route.fulfill({
        response,
        json: { ...body, online: false, can_start_chat: false, answered_by: 'none' },
      });
    },
  );
}

interface Definition {
  id: string;
  entity: string;
  label: string;
  form_placement: string | null;
}

/** Every custom field the tenant has defined, form question or not. */
async function definitions(
  request: APIRequestContext,
  auth: Record<string, string>,
): Promise<Definition[]> {
  const response = await request.get(`${API_BASE}/settings/custom-fields`, { headers: auth });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { items: Definition[] }).items;
}

test.describe('offline form — ticket + prospect (FR-MOD-08.7.7)', () => {
  test.use({ viewport: { width: 1680, height: 1050 } });

  test('an admin builds the two questions, a visitor answers them, and they land on the ticket and the contact', async ({
    agentPage,
    browser,
    request,
    organizationId,
  }) => {
    test.slow();
    const stamp = Date.now().toString().slice(-6);
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const ticketLabel = `Affected order ${stamp}`;
    const prospectLabel = `Company ${stamp}`;
    const subject = `Nobody was around — ${stamp}`;
    const site = tenantSubdomain(`offline-${stamp}`);
    const created: string[] = [];

    try {
      // --- 1. The admin builds both questions in the real console ----------
      await agentPage.goto('/app/settings/chat-forms');
      const builder = agentPage.getByRole('region', { name: 'Chat forms' });
      await expect(builder).toBeVisible();
      const placement = builder.getByLabel('Asked');

      // The requirement counts four forms; the selector offers four.
      await expect
        .poll(() => placement.locator('option').allTextContents())
        .toEqual([
          'Before the chat',
          'After the chat',
          'Offline message — about the request',
          'Offline message — about the person',
        ]);

      for (const [label, option] of [
        [ticketLabel, 'Offline message — about the request'],
        [prospectLabel, 'Offline message — about the person'],
      ] as const) {
        await builder.getByPlaceholder('Order number').fill(label);
        await placement.selectOption({ label: option });
        await builder.getByRole('button', { name: 'Add field' }).click();
        await expect(builder.getByText(label, { exact: true })).toBeVisible();
      }
      await agentPage.screenshot({
        path: 'kanit/08.7.7-chat-forms-builder.png',
        fullPage: true,
      });

      // The placement decided the entity, without the admin choosing one: a
      // question about the request is a *ticket* field, one about the person a
      // contact field.
      const defs = await definitions(request, auth);
      const ticketDef = defs.find((d) => d.label === ticketLabel)!;
      const prospectDef = defs.find((d) => d.label === prospectLabel)!;
      created.push(ticketDef.id, prospectDef.id);
      expect(ticketDef.entity).toBe('ticket');
      expect(ticketDef.form_placement).toBe('ticket');
      expect(prospectDef.entity).toBe('contact');
      expect(prospectDef.form_placement).toBe('prospect');

      // --- 2. A real visitor, in a real cross-origin iframe -----------------
      const visitorContext = await browser.newContext();
      const visitor = await visitorContext.newPage();
      try {
        // The one thing faked, and only this: availability on the state poll.
        // The mint below is untouched, so the questions the widget renders are
        // the ones the admin just built.
        await nobodyAvailable(visitor);

        await visitor.goto(`${site.origin}/demo.html?organization_id=${organizationId}`);
        const frame = widgetFrame(visitor);
        await frame.getByRole('button', { name: 'Open chat' }).click();

        // The composer is gone and the offline form is in its place: there is
        // nobody behind the live door, so it is not offered.
        const form = frame.getByRole('form', { name: 'Leave a message' });
        await expect(form).toBeVisible({ timeout: 20_000 });
        await expect(frame.getByRole('textbox', { name: 'Message' })).toBeHidden();

        await form.getByRole('textbox', { name: 'How can we help?' }).fill(subject);
        await form.getByRole('textbox', { name: 'Your name' }).fill(`Dana ${stamp}`);
        await form.getByRole('textbox', { name: 'Email' }).fill(`dana-${stamp}@example.com`);
        await form.getByRole('textbox', { name: ticketLabel }).fill(`ORD-${stamp}`);
        await form.getByRole('textbox', { name: prospectLabel }).fill(`Acme ${stamp}`);
        await visitor.screenshot({ path: 'kanit/08.7.7-widget-offline-form.png', fullPage: true });

        await form.getByRole('button', { name: 'Send message' }).click();
        // The thank-you only appears once the server answered 201 — a failure
        // shows the error line instead, so this is the proof the write landed.
        await expect(frame.getByText(/we have your message/i)).toBeVisible({ timeout: 20_000 });
      } finally {
        await visitorContext.close();
      }

      // --- 3. An agent reads the answers back in the console ----------------
      await agentPage.goto('/app/inbox');
      await agentPage.getByRole('button', { name: 'All tickets' }).click();
      const grid = agentPage.getByRole('table', { name: 'Tickets' });
      await expect(grid).toBeVisible();
      // The grid opens newest-activity first, so a ticket opened seconds ago is
      // on the first page — and its row is the visitor's own words.
      await grid.getByRole('button', { name: subject }).click();

      // The `ticket` question's answer is on the ticket, in the pane's custom
      // fields — the same place every other ticket custom field is read.
      await expect(agentPage.getByLabel(ticketLabel)).toHaveValue(`ORD-${stamp}`);
      await agentPage.screenshot({
        path: 'kanit/08.7.7-ticket-form-answer.png',
        fullPage: true,
      });

      // …and the `prospect` question's answer is on the contact, in the CRM.
      // One screen asked both; they went to two records.
      await agentPage.goto('/app/customers');
      await agentPage.getByPlaceholder('Name, email or phone…').fill(`dana-${stamp}@example.com`);
      await agentPage.getByRole('button', { name: new RegExp(`Dana ${stamp}`) }).click();
      await expect(agentPage.getByLabel(prospectLabel)).toHaveValue(`Acme ${stamp}`);
    } finally {
      // Leave the tenant as it was found: a stray form question would put an
      // input on every ticket pane and contact panel the rest of the suite opens.
      for (const id of created) {
        await request.delete(`${API_BASE}/settings/custom-fields/${id}`, { headers: auth });
      }
    }
  });

  test('"only when agents are accepting chats": the built-in form alone, no question built (WG-09)', async ({
    agentPage,
    browser,
    request,
    organizationId,
  }) => {
    test.slow();
    const stamp = Date.now().toString().slice(-6);
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const subject = `Gece çekim sorusu — ${stamp}`;
    const site = tenantSubdomain(`avail-${stamp}`);
    // No question of the tenant's own is on either offline form: this is the
    // form with nothing but its built-in fields.
    expect(
      (await definitions(request, auth)).filter(
        (d) => d.form_placement === 'ticket' || d.form_placement === 'prospect',
      ),
    ).toEqual([]);

    try {
      // --- 1. The admin picks the mode on the real screen -------------------
      await agentPage.goto('/app/settings/widget');
      const appearance = agentPage.getByRole('region', { name: /Widget appearance/ });
      const availability = appearance.getByRole('group', { name: 'Availability' });
      await expect(availability.getByRole('radio', { name: /^Always/ })).toBeChecked();
      await availability
        .getByRole('radio', { name: /^Only when agents are accepting chats/ })
        .check();
      const save = appearance.getByRole('button', { name: 'Save', exact: true });
      await save.click();
      await expect(save).toBeDisabled();
      await agentPage.screenshot({ path: 'kanit/11.7-widget-availability.png', fullPage: true });
      const saved = await request.get(`${API_BASE}/settings/widget`, { headers: auth });
      expect(((await saved.json()) as { availability_mode: string }).availability_mode).toBe(
        'agents_only',
      );

      // --- 2. A visitor with nobody to answer leaves a message --------------
      const visitorContext = await browser.newContext();
      const visitor = await visitorContext.newPage();
      try {
        await nobodyAvailable(visitor);
        await visitor.goto(`${site.origin}/demo.html?organization_id=${organizationId}`);
        const frame = widgetFrame(visitor);
        await frame.getByRole('button', { name: 'Open chat' }).click();

        const form = frame.getByRole('form', { name: 'Leave a message' });
        await expect(form).toBeVisible({ timeout: 20_000 });
        await expect(frame.getByRole('textbox', { name: 'Message' })).toBeHidden();
        // The built-in three and nothing else.
        await expect(form.getByRole('textbox')).toHaveCount(3);

        await form.getByRole('textbox', { name: 'How can we help?' }).fill(subject);
        await form.getByRole('textbox', { name: 'Your name' }).fill(`Deniz ${stamp}`);
        await form.getByRole('textbox', { name: 'Email' }).fill(`deniz-${stamp}@example.com`);
        await form.getByRole('button', { name: 'Send message' }).click();
        // Only a 201 shows the thank-you; under `always` this workspace would be
        // refused, having built no question.
        await expect(frame.getByText(/we have your message/i)).toBeVisible({ timeout: 20_000 });
      } finally {
        await visitorContext.close();
      }

      // --- 3. The message is a ticket in the console ------------------------
      await agentPage.goto('/app/inbox');
      await agentPage.getByRole('button', { name: 'All tickets' }).click();
      const grid = agentPage.getByRole('table', { name: 'Tickets' });
      await expect(grid.getByRole('button', { name: subject })).toBeVisible();
    } finally {
      // Back to the default: the rest of the suite expects `always`.
      await request.put(`${API_BASE}/settings/widget`, {
        headers: auth,
        data: { availability_mode: 'always' },
      });
    }
  });
});
