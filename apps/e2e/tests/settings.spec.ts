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
