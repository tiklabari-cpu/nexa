/**
 * An invited teammate reaches the bill — the whole way round (FR-MOD-04.4).
 *
 * The integration suite proves the rule (`invite-seats.test.ts`); this proves the
 * sentence, which spans three screens and two people: an administrator is told
 * in the invite modal what a seat costs, a stranger accepts the link in a
 * browser of their own, and the number on Billing has moved when the
 * administrator looks again. Nothing below reads the database.
 *
 * **In a workspace of its own, created by this test.** Joining is permanent —
 * there is no endpoint that un-joins somebody — so doing this in the seeded demo
 * tenant would leave an extra teammate behind for every spec that counts the
 * roster, and a raised seat count for `billing.spec.ts`. A signup costs one page
 * load and owes nobody a cleanup.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

const PASSWORD = 'a-quite-long-passphrase';

interface FreshOwner {
  email: string;
  password: string;
  workspace: string;
}

/**
 * Sign up through the public form and leave the first-run wizard behind.
 *
 * Skipping is the product's own exit (`POST /onboarding/complete`); until it is
 * taken, `App.tsx` sends every path to the wizard and neither Team nor Billing
 * can be reached. Same shape as `two-factor.spec.ts`'s helper, which needs a
 * workspace of its own for the same reason.
 */
async function signUpAndEnterTheApp(page: Page): Promise<FreshOwner> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const owner: FreshOwner = {
    email: `owner-${unique}@invite-seats.test`,
    password: PASSWORD,
    workspace: `Invite Seats ${unique}`,
  };

  await page.goto('/signup');
  await page.getByLabel('Workspace name').fill(owner.workspace);
  await page.getByLabel('Your name').fill('Robin Owner');
  await page.getByLabel('Email').fill(owner.email);
  await page.getByLabel('Password').fill(owner.password);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip setup' }).click();
  await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();

  return owner;
}

test.describe('an invited teammate reaches the bill (FR-MOD-04.4)', () => {
  test('the modal prices the invite, and Billing shows the seat once the invitee joins', async ({
    page,
    browser,
  }) => {
    await signUpAndEnterTheApp(page);
    const invitee = `newcomer-${Date.now()}@invite-seats.test`;

    // --- Buy exactly the seats this workspace uses --------------------------
    //
    // A new workspace is on a trial with no subscription row, and Billing then
    // reports live headcount rather than a purchased figure — a number that
    // would move on its own and prove nothing. One click up and one back down
    // leaves a real row pinned at the floor (`min_seats` = active users,
    // FR-MOD-10.1.3), which is the state where a new joiner has to move it.
    await page.goto('/app/billing');
    const manage = page.getByRole('region', { name: 'Manage plan' });
    const seatCount = manage.getByTestId('seat-count');
    await expect(seatCount).toHaveText('1');
    await manage.getByRole('button', { name: 'Add a seat' }).click();
    await expect(seatCount).toHaveText('2');
    await manage.getByRole('button', { name: 'Remove a seat' }).click();
    await expect(seatCount).toHaveText('1');

    // --- The half the administrator sees before clicking --------------------
    await page.goto('/app/team');
    await expect(page.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Invite teammates' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite teammates' });
    await expect(dialog).toBeVisible();

    await expect(dialog.getByText('1 of 1 seats in use.')).toBeVisible();
    await expect(
      dialog.getByText('Each teammate who accepts takes a seat, at $99.00 per user per month.'),
    ).toBeVisible();

    await dialog.getByLabel('Email addresses').fill(invitee);
    // Conditional on purpose: the seat lands when they accept, not now.
    await expect(
      dialog.getByText('Inviting 1 person takes this workspace to 2 seats once they accept.'),
    ).toBeVisible();
    await page.screenshot({ path: 'kanit/04.4-invite-seat-cost.png', fullPage: true });

    const sent = page.waitForResponse(
      (response) =>
        response.url().endsWith('/invitations') && response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: /^Invite/ }).click();
    const sentResponse = await sent;
    expect(sentResponse.ok(), `invite failed: ${sentResponse.status()}`).toBe(true);
    const { items } = (await sentResponse.json()) as { items: Array<{ accept_url: string }> };
    const acceptUrl = items[0]!.accept_url;

    // Sending the invitation is not buying a seat.
    await page.goto('/app/billing');
    await expect(page.getByTestId('seat-count')).toHaveText('1');

    // --- The other person, in a browser of their own ------------------------
    const inviteeContext = await browser.newContext();
    try {
      const inviteePage = await inviteeContext.newPage();
      await inviteePage.goto(acceptUrl);
      await expect(inviteePage.getByRole('heading', { name: /^Join / })).toBeVisible();
      await inviteePage.getByLabel('Your name').fill('Sam Newcomer');
      await inviteePage.getByLabel('Choose a password').fill(PASSWORD);
      await inviteePage.getByRole('button', { name: 'Join workspace' }).click();
      // Signed straight in to the workspace they just joined.
      await expect(inviteePage.getByRole('link', { name: 'Inbox' })).toBeVisible();
    } finally {
      await inviteeContext.close();
    }

    // --- The number the administrator comes back to -------------------------
    await page.goto('/app/billing');
    await expect(page.getByTestId('seat-count')).toHaveText('2');
    await page.screenshot({ path: 'kanit/04.4-seat-on-the-bill.png', fullPage: true });
  });
});
