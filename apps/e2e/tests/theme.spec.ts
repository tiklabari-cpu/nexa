/**
 * Panel theme switching, in a real browser (NFR-I18N2).
 *
 * The jsdom half (`apps/web/src/theme.smoke.test.tsx`) proves the switcher is
 * mounted and moves the attribute. Two things only a browser can answer are
 * proved here: that the choice actually survives a reload — it is applied by an
 * inline boot script in `index.html`, which jsdom never executes — and that
 * flipping the attribute genuinely repaints, i.e. that `tokens.css`'s dark ramp
 * is reachable rather than merely present.
 *
 * The light default is asserted first in both tests, deliberately (light since
 * the owner's 2026-10-12 decision; dark before that). A default that drifted to
 * the OS preference would rewrite the whole evidence set in `apps/e2e/kanit/`
 * on the next machine that ran the suite.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

/** `<html data-theme>` — the one selector `tokens.css` and every `dark:` variant key off. */
const themeAttribute = (page: Page): Locator => page.locator('html');

test('the agent switches the panel to dark and the choice survives a reload', async ({
  agentPage,
}) => {
  await agentPage.goto('/app/inbox');
  await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
  await expect(themeAttribute(agentPage)).toHaveAttribute('data-theme', 'light');

  await agentPage.getByRole('button', { name: 'Account' }).click();
  await agentPage.getByLabel('Theme').selectOption('dark');

  await expect(themeAttribute(agentPage)).toHaveAttribute('data-theme', 'dark');

  // The reload is the point: the attribute is written by the pre-paint boot
  // script, so a preference that is remembered but never re-applied would pass
  // the assertion above and fail here.
  await agentPage.reload();
  await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();
  await expect(themeAttribute(agentPage)).toHaveAttribute('data-theme', 'dark');

  // And it is a real choice, not a one-way door.
  await agentPage.getByRole('button', { name: 'Account' }).click();
  await agentPage.getByLabel('Theme').selectOption('light');
  await agentPage.reload();
  await expect(themeAttribute(agentPage)).toHaveAttribute('data-theme', 'light');
});

test('the dark theme actually repaints the panel', async ({ agentPage }) => {
  await agentPage.goto('/app/inbox');
  await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();

  const canvasColour = () =>
    agentPage.evaluate(() => getComputedStyle(document.body).backgroundColor);

  const light = await canvasColour();
  // `--bg-canvas` light is #f6f6f8.
  expect(light).toBe('rgb(246, 246, 248)');

  await agentPage.getByRole('button', { name: 'Account' }).click();
  await agentPage.getByLabel('Theme').selectOption('dark');
  await expect(themeAttribute(agentPage)).toHaveAttribute('data-theme', 'dark');

  // …and dark is #09090c, the graphite `[data-theme='dark']` value.
  await expect.poll(canvasColour).toBe('rgb(9, 9, 12)');
});
