/**
 * The composer's `#` picker as a search (IN-06 · tm 363).
 *
 * The unit suites pin the folding, the order and the filling against mocks.
 * What only the real stack proves together: replies saved through the API come
 * back to the composer in full (ten, not six, and the list scrolls), "cekim"
 * finds "Çekim", a personal reply saved in Settings shows its badge, and a
 * `{{customer.name}}` reply arrives with the name the player gave the pre-chat
 * form. The fallback phrase is not reachable here — the default pre-chat form
 * requires every field — so it is pinned by `Composer.cannedSearch.test.tsx`.
 */
import {
  API_BASE,
  PRECHAT_VISITOR,
  expect,
  openWidget,
  ownerAccessToken,
  test,
  visitorSends,
} from './fixtures.js';

test.describe('saved-reply search in the composer', () => {
  test('finds every reply by its text, folds Turkish, badges a personal one and fills variables (FR-MOD-08.7.2)', async ({
    agentPage,
    browser,
    organizationId,
    request,
  }) => {
    const token = await ownerAccessToken(request);
    const auth = { authorization: `Bearer ${token}` };
    const stamp = Date.now().toString().slice(-6);
    const word = `papara${stamp}`;
    const created: string[] = [];

    const save = async (body: Record<string, unknown>): Promise<void> => {
      const res = await request.post(`${API_BASE}/settings/canned-responses`, {
        headers: auth,
        data: body,
      });
      expect(res.status()).toBe(201);
      created.push(((await res.json()) as { id: string }).id);
    };

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    try {
      // Ten replies that mention the word in their text; none of their
      // shortcuts starts with it, which is the case the old picker could not see.
      for (let i = 0; i < 10; i += 1) {
        await save({ shortcut: `dep${stamp}${i}`, text: `${word} yatırımı ${i} dakikada geçer.` });
      }
      await save({ shortcut: `wd${stamp}`, text: `Çekim${stamp} talebiniz alındı.` });
      await save({
        shortcut: `mrhb${stamp}`,
        text: 'Merhaba {{customer.name}}, nasıl yardımcı olabilirim?',
      });

      // A personal reply, saved the way an agent would: in Settings, "Only me".
      await agentPage.goto('/app/settings/canned-responses');
      const section = agentPage.getByRole('region', { name: 'Saved replies' });
      await section.getByLabel('Shortcut').fill(`ozel${stamp}`);
      await section.getByLabel('Reply', { exact: true }).fill('Kendi imzam');
      await section.getByLabel('Who sees it', { exact: true }).selectOption({ label: 'Only me' });
      const personalSaved = agentPage.waitForResponse(
        (r) => r.url().includes('/settings/canned-responses') && r.request().method() === 'POST',
      );
      await section.getByRole('button', { name: 'Save reply' }).click();
      const personal = (await (await personalSaved).json()) as { id: string; visibility: string };
      expect(personal.visibility).toBe('private');
      created.push(personal.id);

      // A conversation from a player who introduced themselves.
      await agentPage.goto('/app/inbox');
      await agentPage.getByLabel('Availability').selectOption('accepting_chats');
      const question = `Yatırımım nerede? ${stamp}`;
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);
      const list = agentPage.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      await list.getByRole('button').filter({ hasText: question }).click();

      const composer = agentPage.getByPlaceholder('Type your reply');
      const picker = agentPage.getByRole('listbox', { name: 'Saved replies' });

      // Every match, and the list scrolls rather than stopping at six.
      await composer.fill(`#${word}`);
      await expect(picker.getByRole('option')).toHaveCount(10);
      const overflow = await picker.evaluate((el) => el.scrollHeight > el.clientHeight);
      expect(overflow).toBe(true);

      // Without the Turkish letter, and with it.
      await composer.fill(`#cekim${stamp}`);
      await expect(picker.getByRole('option')).toHaveCount(1);
      await expect(picker).toContainText(`Çekim${stamp}`);
      await composer.fill(`#çekim${stamp}`);
      await expect(picker.getByRole('option')).toHaveCount(1);

      // The personal reply carries its badge.
      await composer.fill(`#ozel${stamp}`);
      await expect(picker.getByRole('option')).toHaveCount(1);
      await expect(picker.getByRole('option')).toContainText('Personal');

      // The variable: the name the player gave, and the caret after the reply.
      await composer.fill(`#mrhb${stamp}`);
      await expect(picker.getByRole('option')).toHaveCount(1);
      await composer.press('Enter');
      await expect(picker).toHaveCount(0);
      const filled = `Merhaba ${PRECHAT_VISITOR.name}, nasıl yardımcı olabilirim? `;
      await expect(composer).toHaveValue(filled);
      const caret = await composer.evaluate((el) => {
        const input = el as HTMLTextAreaElement;
        return [input.selectionStart, input.selectionEnd];
      });
      expect(caret).toEqual([filled.length, filled.length]);
    } finally {
      await visitorContext.close();
      for (const id of created) {
        await request.delete(`${API_BASE}/settings/canned-responses/${id}`, { headers: auth });
      }
    }
  });
});
