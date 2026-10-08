/**
 * Where keyboard focus goes (tm 259.21 · O16 + D2).
 *
 * A keyboard user who closes a dialog or an inline editor is put back where they
 * were, or they are lost: focus fell to `<body>` and Tab started again from the
 * top of the page. jsdom proves the pieces (`Modal.test.tsx`, `Tags.test.tsx`);
 * what only a browser shows is `document.activeElement` after a real Escape,
 * whether the focus ring is painted inside the box that clips it, and the size
 * of a link's target.
 */
import type { Locator, Page } from '@playwright/test';
import { assertNoBlockingViolations, measureFocusRing, scanScreen } from './a11y.js';
import {
  API_BASE,
  confirmDialog,
  continuePastNarrowNotice,
  expect,
  ownerAccessToken,
  test,
} from './fixtures.js';

/** Open `trigger` with the keyboard, as the people this is about do. */
async function openWithKeyboard(page: Page, trigger: Locator): Promise<void> {
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter');
}

test.describe('closing a dialog returns focus to the button that opened it', () => {
  const DIALOGS = [
    { path: '/app/team/teams', button: 'New team', dialog: 'New team' },
    { path: '/app/customers/goals', button: 'New goal', dialog: 'New goal' },
    { path: '/app/team', button: 'Invite teammates', dialog: 'Invite teammates' },
    { path: '/app/customers/campaigns', button: 'New campaign', dialog: 'New campaign' },
  ] as const;

  for (const { path, button, dialog } of DIALOGS) {
    test(`${button} → Escape`, async ({ agentPage }) => {
      await agentPage.goto(path);
      const trigger = agentPage.getByRole('button', { name: button, exact: true }).first();
      await expect(trigger).toBeVisible();

      await openWithKeyboard(agentPage, trigger);
      await expect(agentPage.getByRole('dialog', { name: dialog })).toBeVisible();

      await agentPage.keyboard.press('Escape');
      await expect(agentPage.getByRole('dialog', { name: dialog })).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(await agentPage.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY');
    });
  }
});

test.describe('inline editors and the delete confirmation', () => {
  test('Tags: "Edit teams" moves focus in and Cancel hands it back; Delete → Cancel returns', async ({
    agentPage,
    request,
  }) => {
    const token = await ownerAccessToken(request);
    const auth = { authorization: `Bearer ${token}` };
    const name = `focus-${Date.now().toString().slice(-6)}`;
    const created = await request.post(`${API_BASE}/settings/tags`, {
      headers: auth,
      data: { name, group_ids: [] },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { id } = (await created.json()) as { id: string };

    try {
      await agentPage.goto('/app/settings/tags');
      const row = agentPage.getByRole('region', { name: 'Tags' }).locator('li').filter({
        hasText: name,
      });
      await expect(row).toBeVisible();

      const edit = row.getByRole('button', { name: `Edit teams for tag ${name}` });
      await openWithKeyboard(agentPage, edit);
      const group = row.getByRole('group', { name: `Edit teams for tag ${name}` });
      await expect(group).toBeVisible();
      await expect(group.getByRole('checkbox').first()).toBeFocused();

      await group.getByRole('button', { name: 'Cancel' }).focus();
      await agentPage.keyboard.press('Enter');
      await expect(group).toHaveCount(0);
      await expect(edit).toBeFocused();

      // ConfirmDialog: Cancel leaves focus on the button that asked.
      const remove = row.getByRole('button', { name: `Delete tag ${name}` });
      await openWithKeyboard(agentPage, remove);
      await expect(agentPage.getByRole('dialog')).toBeVisible();
      await agentPage.getByRole('dialog').getByRole('button', { name: 'Cancel' }).press('Enter');
      await expect(agentPage.getByRole('dialog')).toHaveCount(0);
      await expect(remove).toBeFocused();

      await remove.click();
      await confirmDialog(agentPage, 'Delete');
      await expect(row).toHaveCount(0);
    } finally {
      await request.delete(`${API_BASE}/settings/tags/${id}`, { headers: auth }).catch(() => {});
    }
  });

  test('Saved replies: "Edit team" moves focus in and Cancel hands it back', async ({
    agentPage,
    request,
  }) => {
    const token = await ownerAccessToken(request);
    const auth = { authorization: `Bearer ${token}` };
    const shortcut = `focus${Date.now().toString().slice(-6)}`;
    const created = await request.post(`${API_BASE}/settings/canned-responses`, {
      headers: auth,
      data: { shortcut, text: 'Focus check.', visibility: 'all', group_id: null },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const { id } = (await created.json()) as { id: string };

    try {
      await agentPage.goto('/app/settings/canned-responses');
      const row = agentPage
        .getByRole('region', { name: 'Saved replies' })
        .locator('li')
        .filter({ hasText: `#${shortcut}` });
      await expect(row).toBeVisible();

      const edit = row.getByRole('button', { name: `Edit team for #${shortcut}` });
      await openWithKeyboard(agentPage, edit);
      await expect(row.getByRole('combobox', { name: `Team for #${shortcut}` })).toBeFocused();

      await row.getByRole('button', { name: 'Cancel' }).focus();
      await agentPage.keyboard.press('Enter');
      await expect(row.getByRole('combobox', { name: `Team for #${shortcut}` })).toHaveCount(0);
      await expect(edit).toBeFocused();
    } finally {
      await request
        .delete(`${API_BASE}/settings/canned-responses/${id}`, { headers: auth })
        .catch(() => {});
    }
  });
});

test.describe('scrolling regions are reachable and their focus ring is visible', () => {
  test('audit log: the scroller is a named tab stop and its ring is drawn inside the card', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/settings/audit-log');
    await expect(agentPage.getByRole('table', { name: 'Audit log' })).toBeVisible();

    const scroller = agentPage.getByRole('region', { name: 'Audit log' });
    await expect(scroller).toHaveAttribute('tabindex', '0');
    // Keyboard modality first, or Chromium does not match :focus-visible.
    await agentPage.keyboard.press('Shift');
    await scroller.focus();
    const ring = await measureFocusRing('Audit log', 'the table scroller', scroller);
    expect(ring.focusVisible).toBe(true);
    expect(ring.style).not.toBe('none');
    expect(ring.width).toBeGreaterThan(0);
    // Negative: the ring sits inside the border box, where the card's
    // `overflow-hidden` cannot cut it.
    expect(ring.offset).toBeLessThan(0);

    const card = scroller.locator('xpath=ancestor::div[contains(@class,"overflow-hidden")][1]');
    const scrollerBox = (await scroller.boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    // A negative offset draws the ring inside the border box: no reach outside it.
    const reach = Math.max(0, ring.offset + ring.width);
    expect(scrollerBox.x - reach).toBeGreaterThanOrEqual(cardBox.x);
    expect(scrollerBox.y - reach).toBeGreaterThanOrEqual(cardBox.y);
    expect(scrollerBox.x + scrollerBox.width + reach).toBeLessThanOrEqual(
      cardBox.x + cardBox.width,
    );
    expect(scrollerBox.y + scrollerBox.height + reach).toBeLessThanOrEqual(
      cardBox.y + cardBox.height,
    );
    await agentPage.screenshot({ path: 'kanit/259.21-audit-log-focus-ring.png' });
  });

  test('audit log: a row control keeps its whole ring inside the scrolling box', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/settings/audit-log');
    const scroller = agentPage.getByRole('region', { name: 'Audit log' });
    await expect(scroller).toBeVisible();

    await agentPage.keyboard.press('Tab'); // keyboard modality
    const toggle = agentPage.getByRole('button', { name: /^Detail for / }).first();
    await toggle.focus();
    const ring = await measureFocusRing('Audit log', 'a row toggle', toggle);
    expect(ring.focusVisible).toBe(true);

    const clip = (await scroller.boundingBox())!;
    const box = (await toggle.boundingBox())!;
    // A negative offset draws the ring inside the border box: no reach outside it.
    const reach = Math.max(0, ring.offset + ring.width);
    expect(box.x - reach).toBeGreaterThanOrEqual(clip.x);
    expect(box.y - reach).toBeGreaterThanOrEqual(clip.y);
    expect(box.x + box.width + reach).toBeLessThanOrEqual(clip.x + clip.width);
  });

  test('compliance on a phone has no scrollable region a keyboard cannot reach', async ({
    agentPage,
  }, testInfo) => {
    await agentPage.setViewportSize({ width: 390, height: 844 });
    await agentPage.goto('/app/settings/compliance');
    await continuePastNarrowNotice(agentPage);
    await expect(
      agentPage.getByRole('heading', { name: 'Data region and compliance', level: 2 }),
    ).toBeVisible();

    const scan = await scanScreen(agentPage, 'Compliance (390 px)', testInfo);
    expect(
      [...scan.blocking, ...scan.advisory].filter((v) => v.id === 'scrollable-region-focusable'),
    ).toEqual([]);
    assertNoBlockingViolations(scan);
  });

  // Found by tm 259.26's pilot re-measurement: on a phone the open conversation
  // outgrows its pane, and the transcript is a box of bubbles nothing in which
  // takes focus — a keyboard user could not scroll back through it.
  test('the inbox transcript on a phone can be scrolled from the keyboard', async ({
    agentPage,
  }, testInfo) => {
    await agentPage.setViewportSize({ width: 390, height: 844 });
    await agentPage.goto('/app/inbox');
    await continuePastNarrowNotice(agentPage);
    const log = agentPage.getByRole('log', { name: 'Conversation transcript' });
    await expect(log).toBeVisible();

    // The precondition this is about: the transcript really scrolls here.
    await expect
      .poll(() => log.evaluate((node) => node.scrollHeight > node.clientHeight + 1))
      .toBe(true);
    await expect(log).toHaveAttribute('tabindex', '0');

    // Reached and scrolled with the keyboard alone.
    await log.focus();
    await expect(log).toBeFocused();
    const before = await log.evaluate((node) => node.scrollTop);
    await agentPage.keyboard.press('Home');
    await expect.poll(() => log.evaluate((node) => node.scrollTop)).toBeLessThan(before);

    const scan = await scanScreen(agentPage, 'Inbox (390 px)', testInfo);
    expect(
      [...scan.blocking, ...scan.advisory].filter((v) => v.id === 'scrollable-region-focusable'),
    ).toEqual([]);
  });
});

test.describe('the trial banner link', () => {
  test('is at least 24 × 24 px (WCAG 2.5.8)', async ({ agentPage }) => {
    // The seeded workspace's subscription state moves with `billing.spec.ts`
    // (a checkout ends the trial), so the bar is pinned to a trial here.
    await agentPage.route('**/api/v1/billing/subscription', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access: 'trialing', trial: { days_remaining: 9 } }),
      }),
    );
    await agentPage.goto('/app/inbox');
    const badge = agentPage.getByTestId('trial-badge');
    await expect(badge).toBeVisible();

    const link = badge.getByRole('link', { name: 'Subscribe' });
    const box = (await link.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    await badge.screenshot({ path: 'kanit/259.21-trial-banner-link.png' });
  });
});
