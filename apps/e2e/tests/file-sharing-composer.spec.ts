/**
 * The composer's attach button against the licence's file-sharing switch
 * (FR-MOD-08.9.4).
 *
 * `Composer.fileSharing.test.tsx` and `uploads.test.ts` already prove the
 * pieces in isolation — the component hides the button on `GET
 * /uploads-policy`'s answer, and the route reads the same row `POST
 * /uploads` enforces against. What only a real browser proves is that an
 * admin's own PATCH to `/settings/security` — the exact write the Settings
 * screen makes — reaches an already-open inbox tab within a reload, the way
 * every other admin-owned setting in this suite is proven to (`settings.spec.ts`'s
 * `WebsiteWidgets.tsx` polling precedent, `company details` restore pattern).
 *
 * `file_sharing_enabled` is an account-scoped preference in the same sense
 * `settings-nav-pinned` was for tm 250 — restored in `finally` so a red here,
 * or the run stopping mid-test, cannot leave the licence's attachments off for
 * every test that runs after it.
 */
import type { APIRequestContext } from '@playwright/test';
import { API_BASE, expect, ownerAccessToken, test } from './fixtures.js';

/**
 * An active (not archived) chat, so the composer is actually on screen rather
 * than the "This conversation is archived" notice — `chatOfAReachableCustomer`
 * (used elsewhere in this suite for its customer's e-mail address) makes no
 * such guarantee. `POST /chats` hands back the customer's existing active chat
 * with a 200 rather than failing, so a re-run neither accumulates chats nor
 * races a spec that opened its own (same idempotence `a11y.spec.ts`'s
 * `ensureActiveChat` relies on).
 */
async function ensureActiveChat(
  api: APIRequestContext,
  auth: { authorization: string },
): Promise<string> {
  const customers = await api.get(`${API_BASE}/customers?segment=all&limit=1`, {
    headers: auth,
  });
  expect(customers.ok(), `list customers failed: ${customers.status()}`).toBe(true);
  const { items } = (await customers.json()) as { items: Array<{ id: string }> };
  expect(items[0], 'seeded tenant has no customers to open a chat with').toBeDefined();

  const started = await api.post(`${API_BASE}/chats`, {
    headers: auth,
    data: { customer_id: items[0]!.id, assign_to_me: true },
  });
  expect(started.ok(), `start chat failed: ${started.status()} ${await started.text()}`).toBe(true);
  const chat = (await started.json()) as { id: string; active: boolean };
  expect(chat.active, 'the chat the composer needs must be active').toBe(true);
  return chat.id;
}

test.describe('file sharing — composer attach button', () => {
  test('hides once the licence switches file sharing off, and returns once it is back on (FR-MOD-08.9.4)', async ({
    agentPage,
    request,
  }) => {
    const token = await ownerAccessToken(request);
    const auth = { authorization: `Bearer ${token}` };
    const chatId = await ensureActiveChat(request, auth);

    const attach = agentPage.getByRole('button', { name: 'Attach a file' });

    await agentPage.goto(`/app/inbox?chat=${chatId}`);
    await expect(agentPage.getByRole('radio', { name: 'Reply' })).toBeVisible();
    // The seeded licence ships with file sharing on — the button is the
    // default state this test then narrows and restores.
    await expect(attach).toBeVisible();

    try {
      const off = await request.patch(`${API_BASE}/settings/security`, {
        headers: auth,
        data: { file_sharing_enabled: false },
      });
      expect(off.ok(), `could not switch file sharing off: ${off.status()}`).toBe(true);

      await agentPage.reload();
      await expect(agentPage.getByRole('radio', { name: 'Reply' })).toBeVisible();
      await expect(attach).toBeHidden();
      await agentPage.screenshot({ path: 'kanit/08.9.4-file-sharing-off.png' });
    } finally {
      const restored = await request.patch(`${API_BASE}/settings/security`, {
        headers: auth,
        data: { file_sharing_enabled: true },
      });
      expect(restored.ok(), `could not restore file sharing: ${restored.status()}`).toBe(true);
    }

    await agentPage.reload();
    await expect(attach).toBeVisible();
  });
});
