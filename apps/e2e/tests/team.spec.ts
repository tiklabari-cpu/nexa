/**
 * The Team invite modal, and the dirty guard that protects half-typed work.
 *
 * A modal full of addresses is real effort. Before this, Cancel — or a stray
 * click — threw it away silently; no modal in the app asked. FR-EK-A.2 makes
 * closing a *dirty* form confirm first, while an untouched one still closes
 * without nagging. Both halves matter: a guard that always asks is as annoying
 * as one that never does.
 */
import { API_BASE, DEMO, expect, ownerAccessToken, test } from './fixtures.js';

test.describe('invite teammates — dirty guard (FR-EK-A.2)', () => {
  test('a dirty modal asks before discarding, and keeps the work if you decline', async ({
    agentPage,
  }) => {
    await agentPage.getByRole('link', { name: 'Team' }).click();
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();

    await agentPage.getByRole('button', { name: 'Invite teammates' }).click();
    const dialog = agentPage.getByRole('dialog', { name: 'Invite teammates' });
    await expect(dialog).toBeVisible();

    // Half-typed work: one good address entered but not yet sent.
    await dialog.getByLabel('Email addresses').fill('sam@example.com');

    // Decline the discard: the browser confirm fires with our wording, we say
    // no, and the modal must still be there with the address intact.
    let asked: string | null = null;
    agentPage.once('dialog', (d) => {
      asked = d.message();
      return d.dismiss();
    });
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect.poll(() => asked).toBe('Discard the addresses you have typed?');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Email addresses')).toHaveValue('sam@example.com');

    // Accept the discard: now it closes.
    agentPage.once('dialog', (d) => d.accept());
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('an untouched modal closes without asking', async ({ agentPage }) => {
    await agentPage.getByRole('link', { name: 'Team' }).click();
    await agentPage.getByRole('button', { name: 'Invite teammates' }).click();
    const dialog = agentPage.getByRole('dialog', { name: 'Invite teammates' });
    await expect(dialog).toBeVisible();

    // Any confirm here is a failure: a clean form has nothing to discard.
    let nagged = false;
    agentPage.on('dialog', (d) => {
      nagged = true;
      return d.dismiss();
    });
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog).toBeHidden();
    expect(nagged).toBe(false);
  });
});

test.describe('invite from the shell (FR-MOD-01.1.5)', () => {
  test("the rail's Invite button opens the same modal from a screen that is not Team", async ({
    agentPage,
  }) => {
    // The seeded owner starts on the Inbox (fixtures.ts) — deliberately not
    // Team, since the point of the requirement is that the door does not
    // require navigating there first.
    await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();

    const rail = agentPage.getByRole('navigation', { name: 'Modules' });
    await rail.getByRole('button', { name: /^Invite/ }).click();

    const dialog = agentPage.getByRole('dialog', { name: 'Invite teammates' });
    await expect(dialog).toBeVisible();

    // Untouched form: Cancel closes it without the dirty-guard confirm.
    let nagged = false;
    agentPage.on('dialog', (d) => {
      nagged = true;
      return d.dismiss();
    });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    expect(nagged).toBe(false);
  });
});

test.describe('Team — per-agent skill assignment (FR-MOD-08.6.3)', () => {
  test('the skill catalogue opens from the agent row with the current skills checked', async ({
    agentPage,
  }) => {
    await agentPage.getByRole('link', { name: 'Team' }).click();
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();

    // Seeded owner (Dana Okonkwo) holds the "Billing" area — the seed's fixed
    // catalogue also has "Technical support" and "Onboarding" (seed.ts).
    await agentPage.getByRole('button', { name: `Manage skills for ${DEMO.agentName}` }).click();
    const dialog = agentPage.getByRole('dialog', { name: `Skills — ${DEMO.agentName}` });
    await expect(dialog).toBeVisible();

    await expect(dialog.getByRole('checkbox', { name: 'Billing' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Technical support' })).not.toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Onboarding' })).not.toBeChecked();

    // Cancel rather than Save: this is a visibility check, not a mutation —
    // the seeded tenant is shared across the whole suite.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe('Team — changing a teammate’s role (NFR-S12)', () => {
  /**
   * The endpoint has existed since the role model landed and no screen ever
   * called it (GL-9 §F.1/7): the roster showed a role it gave nobody a way to
   * change. This walks the seam the console was missing — picker → `PUT` →
   * roster → audit trail — and puts the seed back the way it found it, because
   * the whole suite shares one tenant and the seeded admin's scopes are what
   * several other files sign in for.
   */
  test('the owner demotes an admin, and the change reaches the roster and the audit trail', async ({
    agentPage,
    request,
  }) => {
    const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };
    const roster = await request.get(`${API_BASE}/agents`, { headers: auth });
    expect(roster.ok(), `roster read failed: ${roster.status()}`).toBe(true);
    const { items } = (await roster.json()) as {
      items: Array<{ id: string; name: string; role: string }>;
    };
    const sam = items.find((agent) => agent.name === 'Sam Rivera');
    expect(sam, 'seeded admin Sam Rivera not found').toBeTruthy();
    expect(sam!.role, 'this test assumes the seeded starting role').toBe('admin');

    try {
      await agentPage.goto('/app/team');
      await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();

      await agentPage.getByRole('button', { name: 'Change role for Sam Rivera' }).click();
      const dialog = agentPage.getByRole('dialog', { name: 'Change role — Sam Rivera' });
      await expect(dialog).toBeVisible();

      // Owner is never offered: handing over the workspace is a separate,
      // heavier operation the endpoint refuses outright.
      await expect(dialog.getByRole('option')).toHaveText(['Vice owner', 'Admin', 'Agent']);

      await dialog.getByLabel('Role').selectOption('agent');
      const saved = agentPage.waitForResponse(
        (response) =>
          response.url().endsWith(`/agents/${sam!.id}/role`) &&
          response.request().method() === 'PUT',
      );
      await dialog.getByRole('button', { name: 'Save' }).click();
      expect((await saved).status()).toBe(200);
      await expect(dialog).toBeHidden();

      // Reload rather than trusting the redraw: the round trip is the claim.
      await agentPage.reload();
      const row = agentPage.getByRole('row').filter({ hasText: 'Sam Rivera' });
      await expect(row.getByRole('cell', { name: 'Agent', exact: true })).toBeVisible();
      await agentPage.screenshot({ path: 'kanit/136.2-rol-degistirildi.png', fullPage: true });

      // The other half of NFR-S12: the change is not just applied, it is
      // recorded. The action filter runs server-side, so the row is found
      // however much other activity this shared tenant has piled up.
      await agentPage.goto('/app/settings/audit-log');
      await expect(agentPage.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
      await agentPage.getByLabel('Filter by action').selectOption('member.role_changed');
      await expect(
        agentPage
          .getByRole('table', { name: 'Audit log' })
          .getByText('member.role_changed')
          .first(),
      ).toBeVisible();
    } finally {
      const restored = await request.put(`${API_BASE}/agents/${sam!.id}/role`, {
        headers: auth,
        data: { role: 'admin' },
      });
      expect(restored.ok(), `could not restore Sam Rivera's role: ${restored.status()}`).toBe(true);
    }
  });
});
