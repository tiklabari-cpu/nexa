/**
 * Handing the workspace over, end to end (RL-05 · tm 328.2).
 *
 * The owner opens Settings › Company › "Danger zone", offers the workspace to a
 * teammate (password, and the workspace's name typed out), the teammate opens
 * the link in the e-mail they were sent — signed in, in a browser of their own —
 * and accepts it, and the two swap roles: the teammate sees the Danger zone, the
 * previous owner no longer does. The 72-hour clock, the token and the refusals
 * are the integration suite's (`ownership-transfer.test.ts`); what only a
 * browser proves is this journey, the mail's link landing on a page that works,
 * and that the screens pass axe in both themes.
 *
 * The workspace is a signup of its own, so the shared seeded tenants never see
 * their owner change.
 */
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { assertNoBlockingViolations, scanScreen } from './a11y.js';
import { linkIn, waitForMail } from './mailbox.js';

const PASSWORD = 'ownership-e2e-password';

function unique(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

async function scanBothThemes(page: Page, screen: string, testInfo: TestInfo): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    assertNoBlockingViolations(await scanScreen(page, `${screen} (${theme})`, testInfo));
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'light';
  });
}

test.describe('ownership transfer — the offer, the mailed link, the swap (RL-05)', () => {
  test('the owner offers the workspace, the teammate accepts from the mail, the roles swap', async ({
    page,
    browser,
    request,
  }, testInfo) => {
    // Two browsers, an invitation, a verification and an offer mail.
    test.slow();
    const id = unique();
    const workspace = `Handover Co ${id}`;
    const teammate = `successor-${id}@ownership.test`;

    await page.goto('/signup');
    await page.getByLabel('Workspace name').fill(workspace);
    await page.getByLabel('Your name').fill('Robin Owner');
    await page.getByLabel('Email').fill(`owner-${id}@ownership.test`);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip setup' }).click();
    await expect(page).toHaveURL(/\/app\/inbox/);

    // A teammate to hand it to.
    await page.goto('/app/team');
    await page.getByRole('button', { name: 'Invite teammates' }).click();
    const invite = page.getByRole('dialog', { name: 'Invite teammates' });
    await invite.getByLabel('Email addresses').fill(teammate);
    await invite.getByLabel('Role').selectOption('admin');
    await invite.getByRole('button', { name: /^Invite 1/ }).click();
    await expect(invite.getByText(/Invitations sent/)).toBeVisible();
    await invite.getByRole('button', { name: 'Done' }).click();

    const context = await browser.newContext();
    try {
      const successor = await context.newPage();
      const invitation = await waitForMail(request, teammate, `to join ${workspace}`);
      await successor.goto(linkIn(invitation, '/join'));
      await successor.getByLabel('Your name').fill('Sam Successor');
      await successor.getByLabel('Choose a password').fill(PASSWORD);
      await successor.getByRole('button', { name: 'Join workspace' }).click();
      await expect(
        successor.getByRole('heading', { name: 'Confirm your email to join' }),
      ).toBeVisible();
      const confirm = await waitForMail(
        request,
        teammate,
        `Confirm your email address to join ${workspace}`,
      );
      await successor.goto(linkIn(confirm, '/verify-email'));
      await successor.getByLabel('Password').fill(PASSWORD);
      await successor.getByRole('button', { name: 'Confirm and sign in' }).click();
      await expect(successor).toHaveURL(/\/app\//);

      // Only the owner has a Danger zone.
      await successor.goto('/app/settings/company');
      await expect(
        successor.getByRole('heading', { name: 'Company details', level: 2 }),
      ).toBeVisible();
      await expect(successor.getByRole('heading', { name: 'Danger zone' })).toHaveCount(0);

      // The owner makes the offer.
      await page.goto('/app/settings/company');
      await expect(page.getByRole('heading', { name: 'Danger zone' })).toBeVisible();
      await scanBothThemes(page, 'Settings › Company › Danger zone', testInfo);
      await page.getByRole('button', { name: 'Transfer ownership…' }).click();
      const offer = page.getByRole('dialog', { name: 'Transfer ownership' });
      await offer.getByLabel('New owner').selectOption({ label: `Sam Successor (${teammate})` });
      await offer.getByLabel('Your password').fill(PASSWORD);
      await offer.getByLabel('Workspace name').fill('not the name');
      await expect(offer.getByRole('button', { name: 'Offer ownership' })).toBeDisabled();
      await offer.getByLabel('Workspace name').fill(workspace);
      await scanBothThemes(page, 'Transfer ownership dialog', testInfo);
      await offer.getByRole('button', { name: 'Offer ownership' }).click();
      await expect(page.getByText('Ownership offered to Sam Successor')).toBeVisible();
      await expect(page.getByTestId('ownership-transfer-banner')).toContainText(
        'You offered ownership of this workspace to Sam Successor',
      );
      await scanBothThemes(page, 'Danger zone with a pending offer', testInfo);

      // The teammate follows the link in the e-mail they were sent.
      const mail = await waitForMail(
        request,
        teammate,
        `wants to make you the owner of ${workspace}`,
      );
      await successor.goto(linkIn(mail, '/app/ownership-transfer'));
      await expect(successor.getByText('Robin Owner', { exact: false }).first()).toBeVisible();
      await expect(successor.getByRole('button', { name: 'Accept ownership' })).toBeVisible();
      await scanBothThemes(successor, 'Accept ownership page', testInfo);
      await successor.getByRole('button', { name: 'Accept ownership' }).click();
      await expect(successor.getByText('You are now the owner of this workspace.')).toBeVisible();
      await expect(successor.getByText('Robin Owner is an administrator now.')).toBeVisible();

      // The new owner has the Danger zone, with this tab's very session.
      await successor.goto('/app/settings/company');
      await expect(successor.getByRole('heading', { name: 'Danger zone' })).toBeVisible();
      await expect(successor.getByTestId('ownership-transfer-banner')).toHaveCount(0);

      // And the previous owner does not.
      await page.goto('/app/settings/company');
      await expect(page.getByRole('heading', { name: 'Company details', level: 2 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Danger zone' })).toHaveCount(0);
      await expect(page.getByTestId('ownership-transfer-banner')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
