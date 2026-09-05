/**
 * The Team invite modal, and the dirty guard that protects half-typed work.
 *
 * A modal full of addresses is real effort. Before this, Cancel — or a stray
 * click — threw it away silently; no modal in the app asked. FR-EK-A.2 makes
 * closing a *dirty* form confirm first, while an untouched one still closes
 * without nagging. Both halves matter: a guard that always asks is as annoying
 * as one that never does.
 */
import type { APIRequestContext } from '@playwright/test';
import {
  API_BASE,
  DEMO,
  expect,
  openWidget,
  ownerAccessToken,
  test,
  visitorSends,
} from './fixtures.js';

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

test.describe('quick create from the shell (FR-MOD-01.1.5 · FR-MOD-04.1)', () => {
  test("the rail's quick-create menu opens the invite modal from a screen that is not Team", async ({
    agentPage,
  }) => {
    // The seeded owner starts on the Inbox (fixtures.ts) — deliberately not
    // Team, since the point of the requirement is that the door does not
    // require navigating there first.
    await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();

    const rail = agentPage.getByRole('navigation', { name: 'Modules' });
    await rail.getByRole('button', { name: 'Quick create' }).click();
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

  test("the rail's quick-create menu opens the same New team dialog Teams.tsx uses", async ({
    agentPage,
  }) => {
    await expect(agentPage.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible();

    const rail = agentPage.getByRole('navigation', { name: 'Modules' });
    await rail.getByRole('button', { name: 'Quick create' }).click();
    await rail.getByRole('button', { name: 'New team' }).click();

    const dialog = agentPage.getByRole('dialog', { name: 'New team' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe('Team — module navigation (FR-MOD-04.1)', () => {
  test('each tab is a deep-linkable route, and the AI agents / Teams tabs carry their own sections', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/team/ai-agents');
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('link', { name: 'AI agents' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(agentPage.getByRole('heading', { name: 'Chatbots' })).toBeVisible();
    await expect(agentPage.getByRole('heading', { name: 'AI agent performance' })).toBeVisible();
    await expect(agentPage.getByRole('heading', { name: 'Copilot knowledge' })).toBeVisible();

    await agentPage.goto('/app/team/teams');
    await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
    await expect(agentPage.getByRole('link', { name: 'Teams' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(agentPage.getByRole('button', { name: 'New team' })).toBeVisible();

    // And back to the Teammates tab via the tab bar itself, not a `goto`.
    await agentPage.getByRole('link', { name: 'Teammates' }).click();
    await expect(agentPage).toHaveURL(/\/app\/team$/);
    await expect(agentPage.getByRole('table', { name: 'Agents on this licence' })).toBeVisible();
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

/** The plain-agent teammate — role `agent`, no admin power (seed.ts). */
const TEAM_AGENT = { email: 'agent2@acme.localhost', name: 'Priya Nair' } as const;

interface ChatSummary {
  id: string;
  active: boolean;
  assignee_id: string | null;
  last_event: { text?: string } | null;
}

/** Every conversation in the workspace — the list endpoint caps a page at 100. */
async function allChats(
  request: APIRequestContext,
  auth: Record<string, string>,
): Promise<ChatSummary[]> {
  const collected: ChatSummary[] = [];
  let pageId: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const query = `view=all&limit=100${pageId ? `&page_id=${encodeURIComponent(pageId)}` : ''}`;
    const res = await request.get(`${API_BASE}/chats?${query}`, { headers: auth });
    expect(res.ok(), `list chats failed: ${res.status()} ${await res.text()}`).toBe(true);
    const body = (await res.json()) as { items: ChatSummary[]; next_page_id?: string };
    collected.push(...body.items);
    if (!body.next_page_id) break;
    pageId = body.next_page_id;
  }
  return collected;
}

/**
 * Leave the target agent a slot to be routed into (the same precondition
 * `skills-routing.spec.ts` needs and measured — this shared tenant's
 * conversations run long enough that a fixed agent can be at their
 * `concurrent_chats_limit` by the time an unrelated file's rule edit lands).
 */
async function freeARoutingSlot(
  request: APIRequestContext,
  auth: Record<string, string>,
  agentId: string,
  limit: number,
): Promise<void> {
  const held = (await allChats(request, auth)).filter(
    (chat) => chat.active && chat.assignee_id === agentId,
  );
  const surplus = held.length - (limit - 1);
  if (surplus <= 0) return;
  for (const chat of held.slice(-surplus)) {
    const archived = await request.post(`${API_BASE}/chats/${chat.id}/deactivate`, {
      headers: auth,
    });
    expect(
      archived.ok(),
      `could not archive ${chat.id} to make room: ${archived.status()} ${await archived.text()}`,
    ).toBe(true);
  }
}

/** The chat whose most recent message is `text`, straight from the list API. */
async function chatByText(
  request: APIRequestContext,
  auth: Record<string, string>,
  text: string,
): Promise<ChatSummary | undefined> {
  const res = await request.get(`${API_BASE}/chats?view=all&limit=50`, { headers: auth });
  if (!res.ok()) return undefined;
  const { items } = (await res.json()) as { items: ChatSummary[] };
  return items.find((c) => c.last_event?.text?.includes(text));
}

test.describe('Team — the console screen (FR-MOD-04.5)', () => {
  /**
   * The kalem's own acceptance criterion, end to end: a team created from the
   * console, with a teammate added to it through the same screen's priority
   * dropdown, is a real routing target the moment it exists — not just a row
   * `GET /groups` can read back. The fallback rule is the only routing rule
   * every seeded tenant carries, so pointing it at the fresh team (API-only;
   * there is no rule-editor screen, `skills-routing.spec.ts`'s own note) is
   * the least invasive way to make it the one path a new conversation can take.
   */
  test('a team created and staffed from Team routes a fresh conversation to its member', async ({
    agentPage,
    browser,
    request,
    organizationId,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const teamName = `E2E Routing ${stamp}`;
    const question = `Does this route to the new team? ${stamp}`;

    const token = await ownerAccessToken(request);
    const auth = { authorization: `Bearer ${token}` };

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();

    let groupId: number | undefined;
    let ruleId: string | undefined;
    let originalTargetGroupId: number | null = null;
    let chatId: string | undefined;

    try {
      // --- 1. Team → Teams tab → create the team through the console -------
      await agentPage.goto('/app/team/teams');
      await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();

      await agentPage.getByRole('button', { name: 'New team' }).click();
      const editor = agentPage.getByRole('dialog', { name: 'New team' });
      await expect(editor).toBeVisible();
      await editor.getByLabel('Name').fill(teamName);
      const created = agentPage.waitForResponse(
        (r) => r.url().endsWith('/groups') && r.request().method() === 'POST',
      );
      await editor.getByRole('button', { name: 'Create team' }).click();
      expect((await created).ok()).toBe(true);
      await expect(editor).toBeHidden();
      await expect(agentPage.getByText(teamName)).toBeVisible();

      const groupsRes = await request.get(`${API_BASE}/groups`, { headers: auth });
      expect(groupsRes.ok()).toBe(true);
      const groups = ((await groupsRes.json()) as { items: { id: number; name: string }[] }).items;
      groupId = groups.find((g) => g.name === teamName)?.id;
      expect(groupId, 'the team just created was not found via API').toBeTruthy();

      const roster = await request.get(`${API_BASE}/agents`, { headers: auth });
      expect(roster.ok()).toBe(true);
      const agentsList = (
        (await roster.json()) as {
          items: { id: string; email: string; concurrent_chats_limit: number }[];
        }
      ).items;
      const target = agentsList.find((a) => a.email === TEAM_AGENT.email);
      expect(target, 'target teammate not found').toBeTruthy();

      // --- 2. Same screen → add the teammate with the priority dropdown ----
      await agentPage.getByRole('button', { name: `Manage members — ${teamName}` }).click();
      const members = agentPage.getByRole('dialog', { name: `Members — ${teamName}` });
      await expect(members).toBeVisible();
      await members.getByLabel('Teammate to add').selectOption({ label: TEAM_AGENT.name });
      await members.getByLabel('Priority for the new member').selectOption('primary');
      const added = agentPage.waitForResponse(
        (r) =>
          r.url().includes(`/groups/${groupId}/agents/${target!.id}`) &&
          r.request().method() === 'PUT',
      );
      await members.getByRole('button', { name: 'Add' }).click();
      expect((await added).ok()).toBe(true);
      await expect(members.getByText(TEAM_AGENT.name)).toBeVisible();
      await agentPage.screenshot({ path: 'kanit/04.5-teams.png', fullPage: true });
      await members.getByRole('button', { name: 'Close' }).click();

      // --- 3. Point the fallback rule at the fresh team (API-only) ---------
      const rulesRes = await request.get(`${API_BASE}/settings/routing-rules`, { headers: auth });
      expect(rulesRes.ok()).toBe(true);
      const fallback = (
        (await rulesRes.json()) as {
          items: { id: string; is_fallback: boolean; target_group_id: number | null }[];
        }
      ).items.find((r) => r.is_fallback);
      expect(fallback, 'fallback rule not found').toBeTruthy();
      ruleId = fallback!.id;
      originalTargetGroupId = fallback!.target_group_id;
      const patched = await request.patch(`${API_BASE}/settings/routing-rules/${ruleId}`, {
        headers: auth,
        data: { target_group_id: groupId },
      });
      expect(patched.ok(), `rule patch failed: ${patched.status()} ${await patched.text()}`).toBe(
        true,
      );

      // --- 4. A visitor writes in; routing must land it on the new member --
      await freeARoutingSlot(request, auth, target!.id, target!.concurrent_chats_limit);

      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);

      await expect
        .poll(async () => (await chatByText(request, auth, question))?.id, {
          timeout: 20_000,
          message: 'the widget conversation never reached the API',
        })
        .toBeTruthy();
      chatId = (await chatByText(request, auth, question))!.id;

      await expect
        .poll(async () => (await chatByText(request, auth, question))?.assignee_id, {
          timeout: 20_000,
          message: 'the chat never routed to the new team’s member',
        })
        .toBe(target!.id);
    } finally {
      if (ruleId) {
        await request
          .patch(`${API_BASE}/settings/routing-rules/${ruleId}`, {
            headers: auth,
            data: { target_group_id: originalTargetGroupId },
          })
          .catch(() => {});
      }
      if (chatId) {
        await request
          .post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth })
          .catch(() => {});
      }
      if (groupId) {
        await request.delete(`${API_BASE}/groups/${groupId}`, { headers: auth }).catch(() => {});
      }
      await visitorContext.close();
    }
  });
});
