/**
 * A ticket rule's moment (AU-03 · tm 374), in a real browser against the real
 * stack: an admin saves "when the status becomes solved, tag it" on the rules
 * screen, a ticket is solved, and the tag lands once — not again on the next
 * edit of the solved ticket.
 *
 * The rule is scoped by a subject marker unique to the run and removed when
 * the test ends: the e2e workspace is shared, and a rule on every solved
 * ticket would tag the other suites' tickets.
 */
import { API_BASE, expect, ownerAccessToken, test } from './fixtures.js';

test.describe('ticket rules at a later moment (FR-MOD-08.6.2)', () => {
  test.use({ viewport: { width: 1680, height: 1050 } });

  test('a status-changed rule saved on the screen tags the ticket as it is solved, once', async ({
    agentPage,
    organizationId,
    request,
  }) => {
    // Base 36: a 13-digit timestamp can pass the Luhn check and be masked as a card.
    const stamp = Date.now().toString(36);
    const marker = `solved-${stamp}`;
    const tag = `kapandi-${stamp}`;
    const token = await ownerAccessToken(request);
    const authorised = { headers: { authorization: `Bearer ${token}` } };
    let ruleId: string | null = null;

    try {
      await agentPage.goto('/app/settings/ticket-rules');
      // By id: a label wrapping a select carries the options' text in its name.
      await agentPage.locator('#rule-name').fill(`E2E solved ${stamp}`);
      await agentPage.locator('#rule-on').selectOption('status_changed');
      await agentPage.locator('#rule-subject').fill(marker);
      await agentPage.locator('#rule-status-to').selectOption('solved');
      await agentPage.locator('#rule-action').selectOption('tag');
      await agentPage.locator('#rule-value').fill(tag);
      await agentPage.getByRole('button', { name: 'Add rule' }).click();
      await expect(
        agentPage.getByText(
          `Status changed: status becomes Solved and subject contains “${marker}” → add tag “${tag}”`,
        ),
      ).toBeVisible();
      await agentPage.screenshot({ path: 'kanit/08.6.2-ticket-rule-moments.png', fullPage: true });

      const rules = await request.get(`${API_BASE}/settings/ticket-rules`, authorised);
      const saved = ((await rules.json()) as { items: Array<{ id: string; name: string }> }).items;
      ruleId = saved.find((rule) => rule.name === `E2E solved ${stamp}`)?.id ?? null;
      expect(ruleId).not.toBeNull();

      // A player's mail opens the ticket — a ticket needs a player.
      const inbound = await request.post(`${API_BASE}/channels/email/inbound`, {
        data: {
          to: `${organizationId}@inbound.siyahtus.localhost`,
          from: `Deniz Oyuncu <deniz.${stamp}@oyuncu.example>`,
          subject: `Çekim ${marker}`,
          text: `Çekimim bekliyor ${stamp}`,
          message_id: `<e2e.solved.${stamp}@mail.oyuncu.example>`,
        },
      });
      expect(inbound.ok(), await inbound.text()).toBe(true);
      const ticket = { id: ((await inbound.json()) as { ticket_id: string }).ticket_id };
      const before = await request.get(`${API_BASE}/tickets/${ticket.id}`, authorised);
      expect(((await before.json()) as { tags: string[] }).tags).toEqual([]);

      const solved = await request.patch(`${API_BASE}/tickets/${ticket.id}`, {
        ...authorised,
        data: { status: 'solved' },
      });
      expect(((await solved.json()) as { tags: string[] }).tags).toEqual([tag]);

      // The next edit of a solved ticket is no transition to solved.
      const edited = await request.patch(`${API_BASE}/tickets/${ticket.id}`, {
        ...authorised,
        data: { priority: 3 },
      });
      expect(((await edited.json()) as { tags: string[] }).tags).toEqual([tag]);
    } finally {
      if (ruleId) {
        await request.delete(`${API_BASE}/settings/ticket-rules/${ruleId}`, authorised);
      }
    }
  });
});
