/**
 * The ticket HelpDesk surface (PRD FR-MOD-13.6) in a real browser.
 *
 * The web unit suite pins each control's exact request — including merge and
 * unmerge, which mutate cross-ticket state the seed cannot reset between runs
 * and so are proven there rather than here. What only the live stack proves is
 * that the pane created from a conversation actually reaches the API: a priority
 * that survives its round-trip (the select is bound to server data, so a value
 * that sticks is a write that landed) and a follower that comes back from the
 * server as a removable row.
 *
 * Kept idempotent because the e2e seed reseeds without truncating: the ticket is
 * created *or reopened*, priority is set to the same level each run, and adding a
 * follower is a server-side no-op when it is already there.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_BASE, expect, ownerAccessToken, test } from './fixtures.js';

test.describe('ticket HelpDesk surface', () => {
  // The transcript header is deliberately tight; at the default width its
  // right-side actions slide under the details panel. A roomy desktop viewport
  // keeps "Create ticket" clickable without collapsing the panel.
  test.use({ viewport: { width: 1680, height: 1050 } });

  test('sets a ticket priority and adds a follower against the live API', async ({ agentPage }) => {
    await agentPage.goto('/app/inbox');

    // Open the first seeded conversation, then create a ticket from it.
    await agentPage
      .getByRole('region', { name: 'Conversations' })
      .getByRole('button')
      .first()
      .click();
    await agentPage.getByRole('button', { name: 'Create ticket', exact: true }).click();
    await agentPage.getByRole('button', { name: 'Create', exact: true }).click();

    // A fresh chat opens the ticket pane directly; a chat that already carries a
    // ticket (a re-run) offers "Open it". Either way we end up on the pane.
    const openExisting = agentPage.getByRole('button', { name: 'Open it' });
    const priority = agentPage.getByLabel('Priority');
    await priority.or(openExisting).first().waitFor();
    if (await openExisting.isVisible()) await openExisting.click();
    await expect(priority).toBeVisible();

    // The select is controlled by the server's value, so it only reads Urgent
    // once the PATCH has round-tripped — which is the proof the write landed.
    await priority.selectOption('100');
    await expect(priority).toHaveValue('100');

    // Follow the ticket. The picker is disabled until the agent list loads and
    // when everyone already follows (possible on a re-run), so accept either an
    // enabled picker to add through or a follower row that is already present.
    const followerSelect = agentPage.getByLabel('Add a follower');
    const removeButton = agentPage.getByRole('button', { name: /^Remove / });
    await expect
      .poll(async () => (await followerSelect.isEnabled()) || (await removeButton.count()) > 0)
      .toBe(true);
    if (await followerSelect.isEnabled()) {
      await followerSelect.selectOption({ index: 1 });
      await agentPage.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await expect(removeButton.first()).toBeVisible();
  });

  /**
   * The Tickets grid (FR-MOD-02.7). The unit suite proves the sort maths and the
   * URL round-trip; what only the live stack proves is that the sort actually
   * rides in the URL — a header click that lands in the address bar, and a pasted
   * link that reopens the grid already sorted — and that a row is the way into
   * the ticket conversation. The seed carries no tickets, so one is created (or
   * reused on a re-run) first, exactly as the priority test does.
   */
  test('sorts the tickets grid from the URL and opens a ticket from a row', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/inbox');

    // Ensure at least one ticket exists. The create resolves to the ticket pane
    // (a fresh chat) or an "Open it" prompt (a chat that already carries one, on
    // a re-run) — either way a ticket now exists, which is all the grid needs.
    await agentPage
      .getByRole('region', { name: 'Conversations' })
      .getByRole('button')
      .first()
      .click();
    await agentPage.getByRole('button', { name: 'Create ticket', exact: true }).click();
    await agentPage.getByRole('button', { name: 'Create', exact: true }).click();
    await agentPage
      .getByRole('button', { name: 'Tickets', exact: true })
      .or(agentPage.getByRole('button', { name: 'Open it' }))
      .first()
      .waitFor();

    // Open the grid from the nav (works from the pane or the chat alike).
    await agentPage.getByRole('button', { name: 'All tickets' }).click();

    // The grid is a sortable table; a header click writes the sort into the URL.
    const grid = agentPage.getByRole('table', { name: 'Tickets' });
    await expect(grid).toBeVisible();
    await agentPage.getByRole('button', { name: 'Subject' }).click();
    await expect(agentPage).toHaveURL(/ticket_sort=subject/);
    await expect(agentPage.getByRole('columnheader', { name: /Subject/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    // A pasted link reopens the grid already sorted — the point of URL sorting.
    await agentPage.goto('/app/inbox?ticket_sort=subject&ticket_order=desc');
    const sortedGrid = agentPage.getByRole('table', { name: 'Tickets' });
    await expect(sortedGrid).toBeVisible();
    await expect(agentPage.getByRole('columnheader', { name: /Subject/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );

    // A row opens the ticket conversation behind it.
    await sortedGrid.getByRole('row').nth(1).getByRole('button').first().click();
    await expect(agentPage.getByRole('button', { name: 'Tickets', exact: true })).toBeVisible();
  });

  /**
   * The Tickets view filter (FR-MOD-02.7 / 02.1.2), the other half of the
   * grid's URL contract alongside sort. `ticket-grid.test.ts` proves the parse
   * fallback in isolation; what only the live stack proves is that a filter
   * click actually lands in the address bar, a pasted link with an
   * unrecognised value still opens the grid instead of erroring, and the
   * browser's back button undoes a filter switch rather than skipping it.
   */
  test('deep-links the tickets view filter and follows the browser back button', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/inbox');

    // Ensure at least one ticket exists, same setup as the other tests.
    await agentPage
      .getByRole('region', { name: 'Conversations' })
      .getByRole('button')
      .first()
      .click();
    await agentPage.getByRole('button', { name: 'Create ticket', exact: true }).click();
    await agentPage.getByRole('button', { name: 'Create', exact: true }).click();
    await agentPage
      .getByRole('button', { name: 'Tickets', exact: true })
      .or(agentPage.getByRole('button', { name: 'Open it' }))
      .first()
      .waitFor();

    // Open the grid from the nav; a click writes the filter into the URL.
    await agentPage.getByRole('button', { name: 'All tickets' }).click();
    await expect(agentPage).toHaveURL(/ticket_view=all/);
    await expect(agentPage.getByRole('button', { name: 'All tickets' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Switching the filter writes the new value and pushes a history entry
    // (unlike the sort's header clicks, which replace).
    await agentPage.getByRole('button', { name: 'My open' }).click();
    await expect(agentPage).toHaveURL(/ticket_view=my_open/);
    await expect(agentPage.getByRole('button', { name: 'My open' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // The back button undoes the filter switch rather than skipping over it.
    await agentPage.goBack();
    await expect(agentPage).toHaveURL(/ticket_view=all/);
    await expect(agentPage.getByRole('button', { name: 'All tickets' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // A pasted link with an unrecognised value falls back to the default
    // rather than being refused — the server 400s an unknown `view`.
    await agentPage.goto('/app/inbox?ticket_view=nonsense');
    await expect(agentPage.getByRole('table', { name: 'Tickets' })).toBeVisible();
    await expect(agentPage.getByRole('button', { name: 'All tickets' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

/**
 * The consuming half of ticket e-mail templates (FR-MOD-08.7.5).
 *
 * The integration suite proves the rendering, the refusals and the tenant
 * boundary against an injected mailer. What only the live stack proves is that
 * the loop closes at all: a template an admin authored through the product, a
 * status change an agent made in a browser, and a message on the spool whose
 * body came from that template with this ticket's values in it.
 *
 * The spool is the `file` mailer's directory (`MAIL_DIR`, PLAN assumption A4 —
 * no real SMTP in this build). Reading it back is the honest evidence: the claim
 * is not "mail was delivered" but "what left carried the template".
 */
test.describe('ticket e-mail template — a status change mails the customer (FR-MOD-08.7.5)', () => {
  test.use({ viewport: { width: 1680, height: 1050 } });

  const TEMPLATE_NAME = 'E2E status notice';
  const MARKER = 'nexa-e2e-template-marker';
  const SUBJECT = `${MARKER} {{ticket.id}} is {{ticket.status}}`;
  const BODY = `Hello {{customer.name}}, "{{ticket.subject}}" is now {{ticket.status}}. ${MARKER}`;

  /** Where the `file` provider spools, relative to the API package that runs it. */
  const MAIL_DIR = fileURLToPath(new URL('../../api/.data/mail', import.meta.url));

  /** Messages carrying our marker, so a shared spool from other suites cannot fool us. */
  async function markedMessages(): Promise<Array<{ to: string; subject: string; body: string }>> {
    let names: string[];
    try {
      names = await readdir(MAIL_DIR);
    } catch {
      return [];
    }
    const messages = await Promise.all(
      names
        .filter((name) => name.includes('-ticket_notice-') && name.endsWith('.json'))
        .map(async (name) => JSON.parse(await readFile(join(MAIL_DIR, name), 'utf8'))),
    );
    return messages.filter((message) => String(message.subject).includes(MARKER));
  }

  test('renders the authored template into the message that goes out', async ({
    agentPage,
    request: apiRequest,
  }) => {
    const token = await ownerAccessToken(apiRequest);
    const authorised = { headers: { authorization: `Bearer ${token}` } };

    // Author the template through the product's own endpoint — the same one the
    // Settings screen posts to, and the one that enforces the placeholder rule.
    // Idempotent: the seed is re-run without truncating, so a re-run reuses it.
    const existing = await apiRequest.get(
      `${API_BASE}/settings/ticket-email-templates`,
      authorised,
    );
    expect(existing.ok()).toBe(true);
    const items = ((await existing.json()) as { items: Array<{ id: string; name: string }> }).items;
    if (!items.some((item) => item.name === TEMPLATE_NAME)) {
      const created = await apiRequest.post(`${API_BASE}/settings/ticket-email-templates`, {
        ...authorised,
        data: { name: TEMPLATE_NAME, subject: SUBJECT, body: BODY, enabled: true },
      });
      expect(created.ok(), `template failed: ${created.status()}`).toBe(true);
    }

    const before = (await markedMessages()).length;

    // A ticket off a seeded conversation, whose customer has an address.
    await agentPage.goto('/app/inbox');
    await agentPage
      .getByRole('region', { name: 'Conversations' })
      .getByRole('button')
      .first()
      .click();
    await agentPage.getByRole('button', { name: 'Create ticket', exact: true }).click();
    await agentPage.getByRole('button', { name: 'Create', exact: true }).click();

    const openExisting = agentPage.getByRole('button', { name: 'Open it' });
    const status = agentPage.getByLabel('Status');
    await status.or(openExisting).first().waitFor();
    if (await openExisting.isVisible()) await openExisting.click();
    await expect(status).toBeVisible();

    // The picker only exists because the ticket has a customer to write to and
    // the workspace has an enabled template — both of which are now true.
    const notice = agentPage.getByLabel('Notify the customer');
    await expect(notice).toBeVisible();
    await notice.selectOption({ label: TEMPLATE_NAME });

    // A real transition, since a notice is refused without one. `pending` and
    // `solved` alternate so a re-run always has somewhere to move to.
    const next = (await status.inputValue()) === 'pending' ? 'solved' : 'pending';
    await status.selectOption(next);
    await expect(status).toHaveValue(next);

    // The message on the spool, with this ticket's values substituted in.
    await expect
      .poll(async () => (await markedMessages()).length, { timeout: 10_000 })
      .toBeGreaterThan(before);

    const sent = (await markedMessages()).at(-1)!;
    expect(sent.to).toContain('@');
    expect(sent.subject).toContain(`is ${next}`);
    expect(sent.body).toContain(`is now ${next}.`);
    // The property the whole feature turns on: nothing placeholder-shaped
    // survived into the message.
    expect(sent.subject + sent.body).not.toContain('{{');
    expect(sent.subject + sent.body).not.toContain('}}');

    // And the picker resets, so the next transition is its own decision.
    await expect(notice).toHaveValue('');

    await agentPage.screenshot({
      path: 'kanit/08.7.5-ticket-email-template.png',
      fullPage: true,
    });
  });
});

/**
 * Bulk actions over a ticket selection (PRD §5.2 "Ticketing (gelişmiş)" ·
 * FR-13-EK.3 · FR-MOD-02.7.1).
 *
 * The unit suite proves the selection model and the bar's arithmetic against a
 * fake; the integration suite proves the endpoint's isolation and its per-row
 * report against a real database. What only the live stack proves is that the
 * three meet: boxes ticked in a browser become one request, one request becomes
 * a report the agent can read, and the report is true of the database
 * afterwards — asserted here through the API rather than by trusting the same
 * screen that printed it.
 *
 * Idempotent against the shared seed, which is reseeded without truncating: the
 * two tickets are found by subject or created, and put back to `open` before
 * the sweep so a re-run has somewhere to move them to. The subjects sort to the
 * top of the grid under `?ticket_sort=subject&ticket_order=asc`, which is what
 * keeps the two rows inside the virtualiser's window however many tickets
 * earlier runs have left behind.
 */
test.describe('bulk actions over a ticket selection (FR-13-EK.3)', () => {
  test.use({ viewport: { width: 1680, height: 1050 } });

  const SUBJECTS = ['AAA bulk sweep one', 'AAA bulk sweep two'];

  test('solves a multi-row selection in one gesture and reports it', async ({
    agentPage,
    request: apiRequest,
  }) => {
    const token = await ownerAccessToken(apiRequest);
    const authorised = { headers: { authorization: `Bearer ${token}` } };

    // A customer to hang the tickets off — `POST /tickets` needs one or a chat.
    const customers = await apiRequest.get(`${API_BASE}/customers?segment=all&limit=1`, authorised);
    expect(customers.ok()).toBe(true);
    const customerId = ((await customers.json()) as { items: Array<{ id: string }> }).items[0]?.id;
    expect(customerId, 'the seed has no customer to file a ticket against').toBeTruthy();

    // Find or create, then force back to `open`: a re-run must start from a
    // state the sweep can actually change, or "2 updated" proves nothing.
    const listed = await apiRequest.get(`${API_BASE}/tickets?view=all&limit=100`, authorised);
    expect(listed.ok()).toBe(true);
    const existing = ((await listed.json()) as { items: Array<{ id: string; subject: string }> })
      .items;

    const ids: string[] = [];
    for (const subject of SUBJECTS) {
      const found = existing.find((ticket) => ticket.subject === subject);
      if (found) {
        const reopened = await apiRequest.patch(`${API_BASE}/tickets/${found.id}`, {
          ...authorised,
          data: { status: 'open' },
        });
        expect(reopened.ok(), `reopen failed: ${reopened.status()}`).toBe(true);
        ids.push(found.id);
      } else {
        const created = await apiRequest.post(`${API_BASE}/tickets`, {
          ...authorised,
          data: { subject, customer_id: customerId },
        });
        expect(created.ok(), `create failed: ${created.status()}`).toBe(true);
        ids.push(((await created.json()) as { id: string }).id);
      }
    }

    // `all` rather than a filtered view, so solving does not move the rows out
    // from under the selection while the report is being read.
    await agentPage.goto('/app/inbox?ticket_view=all&ticket_sort=subject&ticket_order=asc');
    const grid = agentPage.getByRole('table', { name: 'Tickets' });
    await expect(grid).toBeVisible();

    // Nothing ticked, nothing offered: the bar is not furniture above the grid.
    const bar = agentPage.getByRole('group', { name: 'Bulk actions' });
    await expect(bar).toBeHidden();

    for (const subject of SUBJECTS) {
      await grid.getByRole('checkbox', { name: `Select ticket: ${subject}` }).check();
    }
    await expect(bar).toBeVisible();
    await expect(bar.getByText('2 tickets selected')).toBeVisible();

    // Two gestures, not one: the picker alone must not move anything.
    await bar.getByLabel('Action').selectOption('status:solved');
    for (const id of ids) {
      const stillOpen = await apiRequest.get(`${API_BASE}/tickets/${id}`, authorised);
      expect(((await stillOpen.json()) as { status: string }).status).toBe('open');
    }

    await bar.getByRole('button', { name: 'Apply' }).click();

    // The report, read as the agent reads it — both numbers, so a partial
    // outcome could not have been painted as success.
    await expect(bar.getByRole('status')).toHaveText(/2 updated, 0 skipped/);

    // …and the same claim checked against the server rather than the screen.
    for (const id of ids) {
      const detail = await apiRequest.get(`${API_BASE}/tickets/${id}`, authorised);
      expect(detail.ok()).toBe(true);
      expect(((await detail.json()) as { status: string }).status).toBe('solved');
    }

    // The grid behind the bar agrees, which is what the invalidation is for.
    await expect(
      grid.getByRole('row').filter({ hasText: SUBJECTS[0]! }).getByText('Solved'),
    ).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/02.7.1-ticket-bulk-actions.png', fullPage: true });
  });
});
