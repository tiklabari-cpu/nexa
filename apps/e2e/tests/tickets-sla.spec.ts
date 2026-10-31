/**
 * The ticket first-response SLA (tm 360 · HD-05) in a real browser against the
 * real stack: an admin gives Low-priority tickets their own first-response
 * target on the SLA screen, a Low ticket then shows how long is left in the
 * grid sorted "nearest to SLA" and in its pane, and moving it to a priority
 * with no target takes the clock away.
 *
 * Low is the level used because nothing else in the e2e workspace is Low (the
 * seed has no tickets and no other spec picks it), so the target this test
 * saves never puts a badge on another suite's rows. The policy is restored when
 * the test ends.
 */
import { API_BASE, expect, ownerAccessToken, test } from './fixtures.js';

test.describe('the ticket first-response SLA (HD-05)', () => {
  test.use({ viewport: { width: 1680, height: 1050 } });

  test('shows the time left on a Low ticket, sorts by it, and drops it with the target', async ({
    agentPage,
    request,
  }) => {
    const stamp = Date.now().toString(36);
    const subject = `SLA e2e ${stamp}`;
    const token = await ownerAccessToken(request);
    const authorised = { headers: { authorization: `Bearer ${token}` } };

    const original = await request.get(`${API_BASE}/settings/sla`, authorised);
    expect(original.ok()).toBe(true);
    const saved = (await original.json()) as Record<string, unknown>;

    try {
      // Calendar minutes for this spec: the seeded policy counts business hours
      // only, and once `staffing.spec.ts` has saved a work schedule on the same
      // stack a 150-minute target set on a Saturday reads "51 h left" (tm 363,
      // shard order). The `finally` below puts the saved policy back.
      const calendar = await request.put(`${API_BASE}/settings/sla`, {
        ...authorised,
        data: {
          first_response_minutes: saved['first_response_minutes'] ?? null,
          resolution_minutes: saved['resolution_minutes'] ?? null,
          business_hours_only: false,
          ticket_first_response_minutes: saved['ticket_first_response_minutes'] ?? null,
          ticket_resolution_minutes: saved['ticket_resolution_minutes'] ?? null,
          ticket_targets_by_priority: saved['ticket_targets_by_priority'] ?? null,
        },
      });
      expect(calendar.ok(), await calendar.text()).toBe(true);

      // --- The target, set on the screen ----------------------------------
      await agentPage.goto('/app/settings/sla');
      const sla = agentPage.getByRole('region', { name: 'SLA' });
      await expect(sla).toBeVisible();
      await expect(sla.getByRole('heading', { name: 'Tickets' })).toBeVisible();
      await sla.getByLabel('Low: answer within (minutes)').fill('150');
      await sla.getByRole('button', { name: 'Save' }).click();
      await expect(sla).toContainText('Active');

      // --- A Low ticket -----------------------------------------------------
      const customers = await request.get(`${API_BASE}/customers?segment=all&limit=1`, authorised);
      expect(customers.ok()).toBe(true);
      const { items } = (await customers.json()) as { items: Array<{ id: string }> };
      const created = await request.post(`${API_BASE}/tickets`, {
        ...authorised,
        data: { subject, customer_id: items[0]!.id },
      });
      expect(created.ok(), await created.text()).toBe(true);
      const { id } = (await created.json()) as { id: string };
      const patched = await request.patch(`${API_BASE}/tickets/${id}`, {
        ...authorised,
        data: { priority: -50 },
      });
      expect(patched.ok(), await patched.text()).toBe(true);

      // --- The grid, nearest first ------------------------------------------
      await agentPage.goto('/app/inbox?ticket_view=all&ticket_sort=sla&ticket_order=asc');
      const grid = agentPage.getByRole('table', { name: 'Tickets' });
      await expect(grid).toBeVisible();
      await expect(agentPage.getByRole('columnheader', { name: /First response/ })).toHaveAttribute(
        'aria-sort',
        'ascending',
      );
      const row = grid.getByRole('row').filter({ hasText: subject });
      await expect(row).toContainText(/2 h (2\d|30) min left/);

      // --- The pane, and the target going away -------------------------------
      await row.getByRole('button', { name: subject }).click();
      await expect(agentPage.getByText(/2 h (2\d|30) min left/).first()).toBeVisible();
      const priority = agentPage.getByLabel('Priority');
      await priority.selectOption('0');
      await expect(priority).toHaveValue('0');
      await expect(agentPage.getByText(/min left/)).toHaveCount(0);
    } finally {
      await request.put(`${API_BASE}/settings/sla`, {
        ...authorised,
        data: {
          first_response_minutes: saved['first_response_minutes'] ?? null,
          resolution_minutes: saved['resolution_minutes'] ?? null,
          business_hours_only: saved['business_hours_only'] ?? false,
          ticket_first_response_minutes: saved['ticket_first_response_minutes'] ?? null,
          ticket_resolution_minutes: saved['ticket_resolution_minutes'] ?? null,
          ticket_targets_by_priority: saved['ticket_targets_by_priority'] ?? null,
        },
      });
    }
  });
});
