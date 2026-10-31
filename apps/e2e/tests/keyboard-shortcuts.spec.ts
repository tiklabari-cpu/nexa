/**
 * Keyboard shortcuts (IN-08 · tm 365.1): "?" lists them, Alt+↑ / Alt+↓ walk the
 * chat list with the cursor landing in the opened chat's composer.
 *
 * The unit suites pin the register's rules (no double binding, AltGr, text
 * fields, dialogs) against synthetic events. What only a real browser proves is
 * that the shell's one listener hears a real key press over a live session, that
 * Chromium does not keep Alt+↓ for itself, that the focus really ends up in the
 * composer of the chat the key opened, and that a dialog on top silences the
 * keys behind it.
 */
import type { Browser, Page } from '@playwright/test';
import { expect, introduceVisitor, openWidget, test, widgetFrame } from './fixtures.js';

async function startChat(
  browser: Browser,
  organizationId: string,
  text: string,
  who: { name: string; username: string; email: string },
): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openWidget(page, organizationId);
  await introduceVisitor(widgetFrame(page), text, who);
  await expect(widgetFrame(page).getByRole('log', { name: 'Conversation' })).toContainText(text);
  return page;
}

test.describe('keyboard shortcuts', () => {
  test('"?" opens the list and Esc closes it; Alt+↓ / Alt+↑ move between chats and leave the cursor in the composer', async ({
    agentPage,
    browser,
    organizationId,
  }) => {
    test.slow();
    const stamp = Date.now().toString().slice(-6);
    const first = `Shortcut one ${stamp}`;
    const second = `Shortcut two ${stamp}`;
    await agentPage.goto('/app/inbox');

    const visitors: Page[] = [];
    try {
      visitors.push(
        await startChat(browser, organizationId, first, {
          name: 'Shortcut One',
          username: `short_one_${stamp}`,
          email: `short-one-${stamp}@example.test`,
        }),
      );
      visitors.push(
        await startChat(browser, organizationId, second, {
          name: 'Shortcut Two',
          username: `short_two_${stamp}`,
          email: `short-two-${stamp}@example.test`,
        }),
      );

      const list = agentPage.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(first, { timeout: 20_000 });
      await expect(list).toContainText(second, { timeout: 20_000 });

      // --- "?" opens the list, Esc closes it ---------------------------------
      await agentPage.locator('main').click({ position: { x: 5, y: 5 } });
      await agentPage.keyboard.press('Shift+?');
      const help = agentPage.getByRole('dialog', { name: 'Keyboard shortcuts' });
      await expect(help).toBeVisible();
      await expect(help.locator('[data-shortcut="inbox.next-chat"]')).toContainText('↓');

      // Behind the dialog the chat keys are silent.
      const rows = list.locator('button[data-chat-row]');
      await expect(rows.first()).toBeVisible();
      const current = list.locator('button[aria-current="true"]');
      // The row's name only: the rest of its text (the waiting timer) moves on its own.
      const nameOf = async () =>
        (await current.locator('.font-medium').first().textContent()) ?? '';
      const openedBefore = await nameOf();
      await agentPage.keyboard.press('Alt+ArrowDown');
      expect(await nameOf()).toBe(openedBefore);

      await agentPage.keyboard.press('Escape');
      await expect(help).toHaveCount(0);

      // --- Alt+↓ / Alt+↑ ------------------------------------------------------
      await rows.first().click();
      const top = await nameOf();
      await agentPage.keyboard.press('Alt+ArrowDown');
      await expect.poll(nameOf).not.toBe(top);
      const movedTo = await nameOf();
      await expect(agentPage.getByPlaceholder('Type your reply')).toBeFocused();

      // From inside the reply field the keys still work, and Alt+↑ returns.
      await agentPage.keyboard.press('Alt+ArrowUp');
      await expect.poll(nameOf).toBe(top);
      expect(movedTo).not.toBe(top);
      await expect(agentPage.getByPlaceholder('Type your reply')).toBeFocused();

      // Typing in the composer is untouched: no shortcut eats a letter or "?".
      await agentPage.keyboard.type('why?');
      await expect(agentPage.getByPlaceholder('Type your reply')).toHaveValue('why?');
      await expect(agentPage.getByRole('dialog')).toHaveCount(0);
    } finally {
      await Promise.all(visitors.map((page) => page.context().close()));
    }
  });
});
