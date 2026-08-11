/**
 * Panel theme switching, in a real browser (NFR-I18N2).
 *
 * The jsdom half (`apps/web/src/theme.smoke.test.tsx`) proves the switcher is
 * mounted and moves the attribute. Two things only a browser can answer are
 * proved here: that the choice actually survives a reload — it is applied by an
 * inline boot script in `index.html`, which jsdom never executes — and that
 * flipping the attribute genuinely repaints, i.e. that `tokens.css`'s light ramp
 * is reachable rather than merely present.
 *
 * The dark default is asserted first in both tests, deliberately. Every
 * screenshot in `apps/e2e/kanit/` was taken dark, and a default that drifted to
 * the OS preference would rewrite the whole evidence set on the next machine
 * that ran the suite.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/** `<html data-theme>` — the one selector `tokens.css` and every `dark:` variant key off. */
const themeAttribute = (page: Page): Locator => page.locator('html');

test('the agent switches the panel to light and the choice survives a reload', async ({
  agentPage,
}) => {
  await agentPage.goto('/app/inbox');
  await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
  await expect(themeAttribute(agentPage)).toHaveAttribute('data-theme', 'dark');

  await agentPage.getByRole('button', { name: 'Account' }).click();
  await agentPage.getByLabel('Theme').selectOption('light');

  await expect(themeAttribute(agentPage)).toHaveAttribute('data-theme', 'light');

  // The reload is the point: the attribute is written by the pre-paint boot
  // script, so a preference that is remembered but never re-applied would pass
  // the assertion above and fail here.
  await agentPage.reload();
  await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
  await expect(themeAttribute(agentPage)).toHaveAttribute('data-theme', 'light');

  // And it is a real choice, not a one-way door.
  await agentPage.getByRole('button', { name: 'Account' }).click();
  await agentPage.getByLabel('Theme').selectOption('dark');
  await agentPage.reload();
  await expect(themeAttribute(agentPage)).toHaveAttribute('data-theme', 'dark');
});

test('the light theme actually repaints the panel', async ({ agentPage }) => {
  await agentPage.goto('/app/inbox');
  await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();

  const canvasColour = () =>
    agentPage.evaluate(() => getComputedStyle(document.body).backgroundColor);

  const dark = await canvasColour();
  // `--bg-canvas` dark is #0b1020.
  expect(dark).toBe('rgb(11, 16, 32)');

  await agentPage.getByRole('button', { name: 'Account' }).click();
  await agentPage.getByLabel('Theme').selectOption('light');
  await expect(themeAttribute(agentPage)).toHaveAttribute('data-theme', 'light');

  // …and light is #f7f8fa, the `:root` value that was unreachable before this
  // task: the attribute was hard-coded in `index.html` and nothing ever rewrote it.
  await expect.poll(canvasColour).toBe('rgb(247, 248, 250)');
});
