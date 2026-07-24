/**
 * Settings, and the composer shortcut it feeds.
 *
 * Saved replies existed in the schema and the seed, and nothing read or wrote
 * them — no management screen, and no `#` picker in the composer. The last test
 * here is the one that proves the loop is closed: a reply created in Settings
 * has to reach a customer through the composer without anyone reloading.
 */
import { expect, test, openWidget, visitorSends, widgetFrame } from './fixtures.js';

test.describe('settings', () => {
  test('shows the trusted domain the widget actually depends on', async ({ agentPage }) => {
    await agentPage.getByRole('link', { name: 'Settings' }).click();
    await expect(agentPage.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(agentPage.getByText('acme-bikes.localhost')).toBeVisible();
  });

  test('adds and removes a trusted domain', async ({ agentPage }) => {
    await agentPage.goto('/app/settings');

    const domain = `shop-${Date.now()}.example`;
    await agentPage.getByLabel('Domain', { exact: true }).fill(domain);
    await agentPage.getByRole('button', { name: 'Add domain' }).click();
    await expect(agentPage.getByText(domain)).toBeVisible();

    // Survives a reload — it was persisted, not just added to the list on screen.
    await agentPage.reload();
    await expect(agentPage.getByText(domain)).toBeVisible();

    await agentPage
      .locator('li')
      .filter({ hasText: domain })
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(agentPage.getByText(domain)).toHaveCount(0);
  });

  test('normalises a pasted URL to the hostname the Origin check uses', async ({ agentPage }) => {
    // Storing anything else leaves an admin looking at a correct allowlist while
    // their widget is refused on that very site.
    await agentPage.goto('/app/settings');

    const host = `pasted-${Date.now()}.example`;
    await agentPage
      .getByLabel('Domain', { exact: true })
      .fill(`https://${host.toUpperCase()}/pricing?utm=ads`);
    await agentPage.getByRole('button', { name: 'Add domain' }).click();

    await expect(agentPage.getByText(host, { exact: true })).toBeVisible();
  });

  test('refuses to disable the fallback routing rule', async ({ agentPage }) => {
    // Disabling it would leave conversations matching nothing with nowhere to
    // go, while the configuration still looked healthy.
    await agentPage.goto('/app/settings');

    const fallback = agentPage.locator('li').filter({ hasText: 'fallback' });
    await expect(fallback).toBeVisible();
    await expect(fallback.getByRole('button', { name: /Disable/ })).toBeDisabled();
  });

  test('toggles a conditional routing rule', async ({ agentPage }) => {
    await agentPage.goto('/app/settings');

    const rule = agentPage.locator('li').filter({ hasText: 'Pricing pages go to Sales' });
    await rule.getByRole('button', { name: 'Disable' }).click();
    await expect(rule.getByRole('button', { name: 'Enable' })).toBeVisible();

    await rule.getByRole('button', { name: 'Enable' }).click();
    await expect(rule.getByRole('button', { name: 'Disable' })).toBeVisible();
  });

  /**
   * `security_settings` carried the file-sharing columns from the start and
   * nothing read them: no contract path, no route, no screen. The columns were
   * dead. This test is what stops them going back to being dead — it edits the
   * rules through the UI and reloads, so a screen that renders but never
   * persists fails here.
   */
  test('surfaces the file sharing rules and saves an edit', async ({ agentPage }) => {
    await agentPage.goto('/app/settings');

    // Re-resolved after every reload rather than held: the old handle points at
    // a detached node once the page navigates.
    const section = (): ReturnType<typeof agentPage.getByRole> =>
      agentPage.getByRole('region', { name: 'File sharing' });

    await expect(section().getByRole('heading', { name: 'File sharing', level: 2 })).toBeVisible();

    async function save(types: string, megabytes: string): Promise<void> {
      await section().getByLabel('Allowed types').fill(types);
      await section().getByLabel('Max size (MB)').fill(megabytes);

      // Clicking Save only *starts* the PATCH. Reloading straight after races
      // it — sometimes the navigation wins and reads the previous values back,
      // which made this test pass and fail on alternating runs. Wait for the
      // response, not for the button.
      const saved = agentPage.waitForResponse(
        (response) =>
          response.url().endsWith('/settings/security') &&
          response.request().method() === 'PATCH',
      );
      await section().getByRole('button', { name: 'Save' }).click();
      expect((await saved).status()).toBe(200);

      // Reload rather than trusting the optimistic cache: the round trip is the
      // claim, not the redraw.
      await agentPage.reload();
      await expect(section().getByLabel('Allowed types')).toHaveValue(types);
      await expect(section().getByLabel('Max size (MB)')).toHaveValue(megabytes);
    }

    // The section, not the page: Trusted domains sits above it and grows by a
    // row on every run, so a page shot pushes the thing being proved off the
    // bottom. Evidence nobody can read is not evidence.
    await save('image/png, text/csv', '5');
    await section().screenshot({ path: 'kanit/1-dosya-paylasimi-kaydedildi.png' });

    // Put the schema defaults back. `db:seed` skips a tenant it already created,
    // so a test that leaves the row narrowed fails on its own next run — this
    // one did, before the restore was added.
    await save('image/png, image/jpeg, application/pdf', '10');
    await section().screenshot({ path: 'kanit/1-dosya-paylasimi.png' });
  });
});

test.describe('composer shortcuts', () => {
  test('a reply saved in Settings reaches a customer through #', async ({
    browser,
    agentPage,
    organizationId,
  }) => {
    const shortcut = `promo${Date.now().toString().slice(-6)}`;
    const replyText = `Free shipping this week — ${Date.now()}`;

    // 1. An admin saves it.
    await agentPage.goto('/app/settings');
    await agentPage.getByLabel('Shortcut').fill(shortcut);
    await agentPage.getByLabel('Reply').fill(replyText);
    await agentPage.getByRole('button', { name: 'Save reply' }).click();
    await expect(agentPage.getByText(`#${shortcut}`)).toBeVisible();

    // 2. A visitor opens a conversation.
    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();

    try {
      await agentPage.goto('/app/inbox');
      await agentPage.getByLabel('Availability').selectOption('accepting_chats');

      const question = `Do you ship free? ${Date.now()}`;
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);

      const list = agentPage.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      await list.getByRole('button').first().click();

      // 3. The agent types the shortcut. No reload anywhere — the composer's
      //    cache was invalidated when Settings saved.
      const composer = agentPage.getByPlaceholder('Type your reply…');
      await composer.fill(`#${shortcut}`);

      const picker = agentPage.getByRole('listbox', { name: 'Saved replies' });
      await expect(picker).toBeVisible();
      await expect(picker).toContainText(replyText);

      // Enter belongs to the picker while it is open — sending the raw
      // "#promo123" the agent was still choosing would be the worse outcome.
      await composer.press('Enter');
      await expect(picker).toHaveCount(0);
      await expect(composer).toHaveValue(`${replyText} `);

      // 4. And now Enter sends.
      await composer.press('Enter');
      await expect(widgetFrame(visitor).getByRole('log', { name: 'Conversation' })).toContainText(
        replyText,
        { timeout: 20_000 },
      );
    } finally {
      await visitorContext.close();
    }
  });

  test('does not open the picker for a # inside a word', async ({ agentPage }) => {
    // A hex colour or a URL fragment is not a shortcut, and interrupting
    // someone mid-sentence to say so is worse than not offering the feature.
    await agentPage.goto('/app/inbox');
    await agentPage
      .getByRole('region', { name: 'Conversations' })
      .getByRole('button')
      .first()
      .click();

    const composer = agentPage.getByPlaceholder('Type your reply…');
    await composer.fill('see example.com/page#anchor');
    await expect(agentPage.getByRole('listbox', { name: 'Saved replies' })).toHaveCount(0);

    await composer.fill('#hel');
    await expect(agentPage.getByRole('listbox', { name: 'Saved replies' })).toBeVisible();
  });
});
