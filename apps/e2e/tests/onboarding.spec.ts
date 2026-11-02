/**
 * First-run setup wizard — FR-MOD-00.4.
 *
 * The one path the unit and integration suites cannot reach: a real signup in a
 * real browser, landing on the wizard rather than an empty inbox, and both ways
 * out of it — skip straight through, or step through and finish — ending in the
 * shell. A signup creates a brand-new workspace every time (unique email), so
 * this never collides with the seeded demo tenant, which ships pre-onboarded and
 * must never see the wizard.
 */
import { expect, introduceVisitor, signUpFreshOwner, test, widgetFrame } from './fixtures.js';

test.describe('onboarding wizard (FR-MOD-00.4)', () => {
  test('a brand-new workspace opens on the wizard, not an empty inbox', async ({ page }) => {
    await signUpFreshOwner(page);
    // The welcome step greets the owner by name.
    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
    await page.screenshot({ path: 'kanit/22-onboarding-wizard.png', fullPage: true });
  });

  test('skipping setup lands in the shell', async ({ page }) => {
    await signUpFreshOwner(page);

    await page.getByRole('button', { name: 'Skip setup' }).click();

    // Out of the wizard and into the module shell.
    await expect(page).toHaveURL(/\/app\/inbox/);
    await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toHaveCount(0);

    // And it stays out — a reload does not send them back through setup.
    await page.reload();
    await expect(page).toHaveURL(/\/app\/inbox/);
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toHaveCount(0);
  });

  test('stepping through all five steps and finishing lands in the shell', async ({ page }) => {
    await signUpFreshOwner(page);

    await expect(page.getByText('Step 1 of 5')).toBeVisible();

    // Welcome → Website.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Connect your first website' })).toBeVisible();
    await page.getByLabel('Website domain').fill(`shop-${Date.now()}.example`);
    await page.getByRole('button', { name: 'Add website' }).click();
    await expect(page.getByText(/^Added /)).toBeVisible();
    // The install code is on the step itself (WG-13), with the guide one click away.
    await expect(page.getByTestId('website-snippet')).toContainText('window.__siyahtus');
    await expect(page.getByTestId('onboarding-connect-status')).toContainText('Waiting for');
    await expect(page.getByRole('link', { name: 'Installation guide' })).toHaveAttribute(
      'href',
      '/help/install-guide.html',
    );

    // Website → Channels — a bridge to Settings, nothing to fill in here.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Reach customers everywhere' })).toBeVisible();

    // Channels → Company size — the two steps this task added (FR-MOD-00.4).
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'How big is your team?' })).toBeVisible();
    await page.getByLabel('Company size').selectOption('11_50');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.screenshot({ path: 'kanit/00.4-onboarding-company-size.png', fullPage: true });

    // Company → Team (skip the invite) + Sample data, on the same last step.
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Invite your team' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add sample data' })).toBeVisible();
    await expect(page.getByText('Step 5 of 5')).toBeVisible();
    await page.getByRole('button', { name: 'Add sample data' }).click();
    await expect(page.getByText(/sample conversation\.$/)).toBeVisible();

    await page.getByRole('button', { name: 'Finish setup' }).click();

    await expect(page).toHaveURL(/\/app\/inbox/);
    await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toHaveCount(0);
  });

  // WG-13 · WG-15: the wizard shows the code, flips to "Connected" by itself
  // when the widget first loads on that domain, and the snippet's <noscript>
  // link opens the hosted Chat page for this very workspace.
  test('shows the install code, turns Connected when the widget loads, and the noscript link opens the hosted chat (FR-MOD-00.4 · FR-MOD-08.5.2)', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000);
    await signUpFreshOwner(page);
    await page.getByRole('button', { name: 'Continue' }).click();
    const domain = `wizard-${Date.now()}.localhost`;
    await page.getByLabel('Website domain').fill(domain);
    await page.getByRole('button', { name: 'Add website' }).click();

    const code = page.getByTestId('website-snippet');
    await expect(code).toContainText('window.__siyahtus');
    const snippet = (await code.textContent()) ?? '';
    const organizationId = /organizationId: "([^"]+)"/.exec(snippet)?.[1] ?? '';
    expect(organizationId).not.toBe('');
    const chatHref = /<noscript><a href="([^"]+)"/.exec(snippet)?.[1] ?? '';
    expect(chatHref).toContain(`/chat.html?organization_id=${organizationId}`);
    await expect(page.getByTestId('onboarding-connect-status')).toContainText('Waiting for');

    const visitorContext = await browser.newContext();
    try {
      const visitor = await visitorContext.newPage();
      // A visitor on the new domain; sending the first message is what completes
      // the token exchange the server marks the site Connected inside.
      await visitor.goto(`http://${domain}:5174/demo.html?organization_id=${organizationId}`);
      const frame = widgetFrame(visitor);
      await frame.getByRole('button', { name: 'Open chat' }).click();
      await introduceVisitor(frame, 'Testing the wizard install');
      await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(
        'Testing the wizard install',
        { timeout: 20_000 },
      );

      // The wizard polls the site; no reload.
      await expect(page.getByTestId('onboarding-connect-status')).toContainText('Connected', {
        timeout: 30_000,
      });
    } finally {
      await visitorContext.close();
    }

    // And the <noscript> fallback leads to the hosted page of this workspace — in
    // a fresh browser, so it is the page and the link, not the first visitor's
    // stored identity, that brings up the pre-chat form.
    const fallbackContext = await browser.newContext();
    try {
      const fallback = await fallbackContext.newPage();
      await fallback.goto(chatHref);
      await expect(fallback.getByRole('button', { name: 'Start chat' })).toBeVisible();
    } finally {
      await fallbackContext.close();
    }
  });

  test('reloading after seeding sample data resumes on the last step (GET /onboarding/state)', async ({
    page,
  }) => {
    await signUpFreshOwner(page);

    // Welcome → Website → Channels → Company → Team, skipping each step's
    // own form, then lay down the sample data on the last step.
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Add sample data' })).toBeVisible();
    await page.getByRole('button', { name: 'Add sample data' }).click();
    await expect(page.getByText(/sample conversation\.$/)).toBeVisible();

    // Reload before choosing "Finish setup" — the wizard re-reads
    // GET /onboarding/state and, since the demo is already down, opens
    // straight on the last step instead of back at welcome.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Invite your team' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add sample data' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sample data added' })).toBeDisabled();
    await expect(page.getByText('Sample data is already in your workspace.')).toBeVisible();

    await page.getByRole('button', { name: 'Finish setup' }).click();
    await expect(page).toHaveURL(/\/app\/inbox/);
  });
});

test.describe('signup asks for no data region (C4-c off · PLAN §D213)', () => {
  test('offers no region picker and no permanence warning — the server files the workspace where it runs', async ({
    page,
  }) => {
    await page.goto('/signup');
    // Anchored on the form being there, so the absence below is not read off a
    // page that has not rendered yet.
    await expect(page.getByLabel('Workspace name')).toBeVisible();
    await expect(page.getByLabel('Data region')).toHaveCount(0);
    await expect(page.getByText(/cannot be changed after your workspace is created/i)).toHaveCount(
      0,
    );
  });
});
