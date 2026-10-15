/**
 * Invitation and password-reset e-mail, end to end over the real carrier
 * (FR-MOD-04.4 · FR-MOD-00.3 · tm 255.4).
 *
 * The API in this stack runs `MAIL_PROVIDER=smtp`: every message below crosses a
 * real SMTP session — STARTTLS, the certificate verified, AUTH — to the stand-in
 * server, and the test reads it back out of that mailbox (`mailbox.ts`). So the
 * links a person follows here are the links a person would have been sent, not
 * ones lifted from an API response.
 *
 * The integration suite owns the failure cases (`auth-mail-delivery.test.ts`):
 * a refused or silent carrier, an answer that must not change with it. What only
 * a browser proves is the journey those guarantees protect — an invitation mail
 * becomes a teammate, a reset mail becomes a new password.
 *
 * Each test signs up a workspace of its own, so nothing here touches the seeded
 * tenants the rest of the suite shares. Everything goes through the browser at
 * `baseURL` and through the mailbox — never a fixed API address.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';
import { linkIn, mailbox, waitForMail } from './mailbox.js';

const PASSWORD = 'auth-mail-e2e-password';

function unique(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** A fresh workspace through the public signup form, owned by `email`. */
async function signUp(page: Page, email: string, workspace: string): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('Workspace name').fill(workspace);
  await page.getByLabel('Your name').fill('Robin Owner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
}

test.describe('invitation e-mail over SMTP — the link in the mail makes a teammate (FR-MOD-04.4)', () => {
  test('an invitee joins from the link they were mailed', async ({ page, browser, request }) => {
    // Two mails and two browsers since tm 282: the invitation, then the
    // verification that is the join. Measured 51 s on a cold stack.
    test.slow();
    const id = unique();
    const invitee = `newcomer-${id}@auth-mail.test`;
    await signUp(page, `owner-${id}@auth-mail.test`, `Auth Mail Co ${id}`);
    await page.getByRole('button', { name: 'Skip setup' }).click();
    await expect(page).toHaveURL(/\/app\/inbox/);

    await page.goto('/app/team');
    await page.getByRole('button', { name: 'Invite teammates' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite teammates' });
    await dialog.getByLabel('Email addresses').fill(invitee);
    await dialog.getByLabel('Role').selectOption('agent');
    await dialog.getByRole('button', { name: /^Invite 1/ }).click();
    // The ordinary notice — which the modal only shows when the server reports
    // no undelivered address, i.e. the carrier accepted the message.
    await expect(dialog.getByText(/Invitations sent/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();

    // The invitation names who asks and to what (tm 265).
    const mail = await waitForMail(
      request,
      invitee,
      `Robin Owner invited you to join Auth Mail Co ${id} on SiyahTuş`,
    );
    expect(mail.html, 'the invitation carries the HTML half').toContain('Accept invitation');
    const link = linkIn(mail, '/join');

    // The invitee is somebody else, in a browser with no session of the owner's.
    const context = await browser.newContext();
    try {
      const joining = await context.newPage();
      await joining.goto(link);
      await expect(joining.getByRole('heading', { name: `Join Auth Mail Co ${id}` })).toBeVisible();
      await joining.getByLabel('Your name').fill('Nia Newcomer');
      await joining.getByLabel('Choose a password').fill(PASSWORD);
      await joining.screenshot({ path: 'kanit/255.4-invite-mail-join.png', fullPage: true });
      await joining.getByRole('button', { name: 'Join workspace' }).click();
      // Holding the link proves only an invitation (tm 282 · GV-03): the
      // address is proven by a second mail, opened with the same password.
      await expect(
        joining.getByRole('heading', { name: 'Confirm your email to join' }),
      ).toBeVisible();
      const confirm = await waitForMail(
        request,
        invitee,
        `Confirm your email address to join Auth Mail Co ${id}`,
      );
      await joining.goto(linkIn(confirm, '/verify-email'));
      await joining.getByLabel('Password').fill(PASSWORD);
      await joining.getByRole('button', { name: 'Confirm and sign in' }).click();
      await expect(joining).toHaveURL(/\/app\//);
    } finally {
      await context.close();
    }

    // The same link does not work twice — opened signed out, as whoever the
    // mail was forwarded to would open it (a signed-in browser never reaches
    // the join page at all).
    const forwarded = await browser.newContext();
    try {
      const reused = await forwarded.newPage();
      await reused.goto(link);
      await expect(
        reused.getByRole('heading', { name: 'This invitation is not valid' }),
      ).toBeVisible();
    } finally {
      await forwarded.close();
    }

    // And the owner's team now has them.
    await page.goto('/app/team');
    await expect(page.getByRole('button', { name: 'Profile — Nia Newcomer' })).toBeVisible();
  });
});

test.describe('a copied invite link proves nothing about the mailbox (tm 282 · GV-03)', () => {
  test('an admin who sets a password through the link cannot sign in; the invitee joins from the mail', async ({
    page,
    browser,
    request,
  }) => {
    test.slow();
    const id = unique();
    const invitee = `copied-${id}@auth-mail.test`;
    const adminPassword = 'chosen-by-the-admin';
    await signUp(page, `owner-${id}@auth-mail.test`, `Copied Link Co ${id}`);
    await page.getByRole('button', { name: 'Skip setup' }).click();
    await expect(page).toHaveURL(/\/app\/inbox/);

    // "Copy invite link": the same link the invitee is mailed, in the admin's hands.
    await page.goto('/app/team');
    await page.getByRole('button', { name: 'Invite teammates' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite teammates' });
    await dialog.getByLabel('Email addresses').fill(invitee);
    const sent = page.waitForResponse(
      (response) =>
        response.url().endsWith('/invitations') && response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: /^Invite 1/ }).click();
    const { items } = (await (await sent).json()) as { items: Array<{ accept_url: string }> };
    const copied = items[0]!.accept_url;

    const admin = await browser.newContext();
    try {
      const holder = await admin.newPage();
      await holder.goto(copied);
      await holder.getByLabel('Your name').fill('Impostor');
      await holder.getByLabel('Choose a password').fill(adminPassword);
      await holder.getByRole('button', { name: 'Join workspace' }).click();
      await expect(
        holder.getByRole('heading', { name: 'Confirm your email to join' }),
      ).toBeVisible();
      await holder.screenshot({ path: 'kanit/gv-03-join-confirm-email.png', fullPage: true });

      // The password it chose opens nothing: the sign-in form says the
      // address is not confirmed and offers no workspace.
      await holder.goto('/signin');
      await holder.getByLabel('Email').fill(invitee);
      await holder.getByLabel('Password').fill(adminPassword);
      await holder.getByRole('button', { name: 'Sign in' }).click();
      await expect(holder.getByRole('region', { name: 'Confirm your email first' })).toBeVisible();
      await expect(holder).not.toHaveURL(/\/app\//);
    } finally {
      await admin.close();
    }

    // The real invitee opens the invitation mail, chooses their own password —
    // replacing the admin's — and confirms from the second mail.
    const invitation = await waitForMail(
      request,
      invitee,
      `invited you to join Copied Link Co ${id}`,
    );
    const context = await browser.newContext();
    try {
      const joining = await context.newPage();
      await joining.goto(linkIn(invitation, '/join'));
      await joining.getByLabel('Your name').fill('Real Invitee');
      await joining.getByLabel('Choose a password').fill(PASSWORD);
      await joining.getByRole('button', { name: 'Join workspace' }).click();
      await expect(
        joining.getByRole('heading', { name: 'Confirm your email to join' }),
      ).toBeVisible();
      let confirm = (await mailbox(request, invitee)).filter((mail) =>
        mail.subject.includes('Confirm your email address to join'),
      );
      await expect
        .poll(async () => {
          confirm = (await mailbox(request, invitee)).filter((mail) =>
            mail.subject.includes('Confirm your email address to join'),
          );
          return confirm.length;
        })
        .toBe(2);
      // The newest link: the first was spent when the password changed.
      const newest = confirm.sort((a, b) => b.received - a.received)[0]!;
      await joining.goto(linkIn(newest, '/verify-email'));
      await joining.getByLabel('Password').fill(PASSWORD);
      await joining.getByRole('button', { name: 'Confirm and sign in' }).click();
      await expect(joining).toHaveURL(/\/app\//);
    } finally {
      await context.close();
    }

    await page.goto('/app/team');
    await expect(page.getByRole('button', { name: 'Profile — Real Invitee' })).toBeVisible();
  });
});

test.describe('password reset e-mail over SMTP — the link in the mail sets a new password (FR-MOD-00.3)', () => {
  test('the mailed link changes the password, and nobody else is mailed', async ({
    page,
    browser,
    request,
  }) => {
    const id = unique();
    const owner = `reset-${id}@auth-mail.test`;
    const stranger = `nobody-${id}@auth-mail.test`;
    const newPassword = 'a-brand-new-passphrase';
    await signUp(page, owner, `Reset Mail Co ${id}`);

    const context = await browser.newContext();
    try {
      const forgot = await context.newPage();

      // An address with no account first: the same answer, and no mail.
      await forgot.goto('/forgot-password');
      await forgot.getByLabel('Email').fill(stranger);
      await forgot.getByRole('button', { name: 'Send link' }).click();
      const neutral = await forgot.getByRole('status').textContent();

      await forgot.goto('/forgot-password');
      await forgot.getByLabel('Email').fill(owner);
      await forgot.getByRole('button', { name: 'Send link' }).click();
      await expect(forgot.getByRole('status')).toHaveText(neutral ?? '');

      const mail = await waitForMail(request, owner, 'Reset your SiyahTuş password');
      expect(mail.body).toContain('expires in one hour and works once');
      await forgot.goto(linkIn(mail, '/reset-password'));
      await forgot.getByLabel('New password').fill(newPassword);
      await forgot.getByRole('button', { name: 'Set password' }).click();
      await expect(forgot.getByRole('status')).toBeVisible();
      await forgot.screenshot({ path: 'kanit/255.4-reset-mail-done.png', fullPage: true });

      // The old password is gone and the new one works, at the sign-in form.
      await forgot.goto('/signin');
      await forgot.getByLabel('Email').fill(owner);
      await forgot.getByLabel('Password').fill(PASSWORD);
      await forgot.getByRole('button', { name: 'Sign in' }).click();
      await expect(forgot.getByRole('alert')).toHaveText('Invalid email or password.');

      await forgot.getByLabel('Password').fill(newPassword);
      await forgot.getByRole('button', { name: 'Sign in' }).click();
      await expect(forgot).toHaveURL(/\/app\//);
    } finally {
      await context.close();
    }

    // The stranger's request went nowhere — checked last, after the owner's
    // mail proved the carrier was delivering the whole time.
    expect(await mailbox(request, stranger)).toEqual([]);
  });
});
