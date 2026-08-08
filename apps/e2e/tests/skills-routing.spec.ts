/**
 * Skill-based routing + supervisor takeover, end to end (FR-MOD-08.6.3).
 *
 * The integration suite (`routing.test.ts`, `chats.test.ts`) proves the routing
 * engine's skill filter and the takeover's role gate against the API. What only
 * a real browser proves is the screens that drive them talking to that API: a
 * skill created in Settings, assigned to an agent in Team, required by a routing
 * rule — and then a live widget conversation landing on exactly that agent,
 * after which a supervisor takes it over and the assignee genuinely changes.
 *
 * The seeded Acme tenant is shared and its seed is idempotent (`db:seed` skips a
 * tenant it already made), so every artefact created here — the skill, the rule
 * edit, the conversations — is torn down in `finally`, or the next run starts
 * dirty. Only the API can create or edit a routing rule (there is no create-rule
 * screen), so the rule step goes through an owner token, the same one the audit
 * e2e already uses.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import {
  API_BASE,
  DEMO,
  expect,
  openWidget,
  ownerAccessToken,
  test,
  visitorSends,
} from './fixtures.js';

/** The plain-agent teammate — role `agent`, no admin power, 0 seeded chats (seed.ts). */
const SKILLED_AGENT = { email: 'agent2@acme.localhost', name: 'Priya Nair' } as const;

interface ChatSummary {
  id: string;
  assignee_id: string | null;
  last_event: { text?: string } | null;
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

/**
 * The current assignee of a chat, read by id — the stable way to assert routing
 * and takeover. Matching on the last message breaks the moment takeover writes a
 * `chat_taken_over` system event, which becomes the new last event.
 */
async function assigneeOf(
  request: APIRequestContext,
  auth: Record<string, string>,
  chatId: string,
): Promise<string | null | undefined> {
  const res = await request.get(`${API_BASE}/chats/${chatId}`, { headers: auth });
  if (!res.ok()) return undefined;
  return ((await res.json()) as { thread: { assignee_id: string | null } | null }).thread
    ?.assignee_id ?? null;
}

/** Sign in as an arbitrary seeded account — `agentPage` only covers the owner. */
async function signInAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();
}

test.describe('skill-based routing + supervisor takeover (FR-MOD-08.6.3)', () => {
  test('a skill required by a rule routes a chat to the agent who holds it, then a supervisor takes it over', async ({
    agentPage,
    browser,
    request,
    organizationId,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const skillName = `E2E Rescue ${stamp}`;
    // A short numeric token, like demo-flow: a 13-digit run can trip card
    // masking (FR-MOD-08.9.5) and change the transcript text matched below.
    const question = `My tandem's gears are jammed — ${stamp}`;

    const token = await ownerAccessToken(request);
    const auth = { authorization: `Bearer ${token}` };

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();

    let skillId: number | undefined;
    let ruleId: string | undefined;
    let ruleConditions: unknown;
    let chatId: string | undefined;

    try {
      // --- 1. Settings → create the skill through the UI --------------------
      await agentPage.goto('/app/settings');
      const skills = agentPage.getByRole('region', { name: 'Skills' });
      await expect(skills.getByRole('heading', { name: 'Skills', level: 2 })).toBeVisible();
      // The new-skill box by role, exactly. `getByLabel('Skill')` matches
      // accessible names as a case-insensitive substring, so it also picks up
      // every `Delete skill <name>` button the seeded catalogue renders — three
      // of them on a freshly seeded database (seed.ts: Billing, Technical
      // support, Onboarding). That made the step race the list query: it passed
      // only while the list was still pending and the buttons had not rendered.
      await skills.getByRole('textbox', { name: 'Skill', exact: true }).fill(skillName);
      await skills.getByRole('button', { name: 'Add skill' }).click();
      await expect(skills.locator('li').filter({ hasText: skillName })).toBeVisible();

      // Resolve the ids the assertions and teardown need, via the same APIs the
      // screens read.
      const catalogue = await request.get(`${API_BASE}/settings/expertise`, { headers: auth });
      expect(catalogue.ok()).toBe(true);
      skillId = ((await catalogue.json()) as { items: { id: number; name: string }[] }).items.find(
        (s) => s.name === skillName,
      )?.id;
      expect(skillId, 'created skill not found via API').toBeTruthy();

      const roster = await request.get(`${API_BASE}/agents`, { headers: auth });
      expect(roster.ok()).toBe(true);
      const agentsList = ((await roster.json()) as { items: { id: string; email: string }[] }).items;
      const skilledId = agentsList.find((a) => a.email === SKILLED_AGENT.email)?.id;
      const supervisorId = agentsList.find((a) => a.email === DEMO.email)?.id;
      expect(skilledId, 'skilled agent not found').toBeTruthy();
      expect(supervisorId, 'supervisor not found').toBeTruthy();
      expect(supervisorId).not.toBe(skilledId);

      // --- 2. Team → assign the skill to the plain-agent teammate -----------
      await agentPage.getByRole('link', { name: 'Team' }).click();
      await expect(agentPage.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
      await agentPage
        .getByRole('button', { name: `Manage skills for ${SKILLED_AGENT.name}` })
        .click();
      const skillsDialog = agentPage.getByRole('dialog', { name: `Skills — ${SKILLED_AGENT.name}` });
      await expect(skillsDialog).toBeVisible();
      const box = skillsDialog.getByRole('checkbox', { name: skillName });
      await expect(box).not.toBeChecked();
      await box.check();
      const saved = agentPage.waitForResponse(
        (r) => r.url().includes(`/agents/${skilledId}/expertise`) && r.request().method() === 'PUT',
      );
      await skillsDialog.getByRole('button', { name: 'Save' }).click();
      expect((await saved).ok()).toBe(true);
      await expect(skillsDialog).toBeHidden();

      // --- 3. Require the skill on the routing rule -------------------------
      // Only the API edits a rule; the fallback already targets the team every
      // agent belongs to, so the skill filter alone decides the assignee.
      const rulesRes = await request.get(`${API_BASE}/settings/routing-rules`, { headers: auth });
      expect(rulesRes.ok()).toBe(true);
      const fallback = ((await rulesRes.json()) as {
        items: { id: string; is_fallback: boolean; conditions: unknown }[];
      }).items.find((r) => r.is_fallback);
      expect(fallback, 'fallback rule not found').toBeTruthy();
      ruleId = fallback!.id;
      ruleConditions = fallback!.conditions;
      const patched = await request.patch(`${API_BASE}/settings/routing-rules/${ruleId}`, {
        headers: auth,
        data: { conditions: { expertise_ids: [skillId] } },
      });
      expect(patched.ok(), `rule patch failed: ${patched.status()} ${await patched.text()}`).toBe(
        true,
      );

      // --- 4. A visitor writes in; routing must land it on the skilled agent -
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);

      // Discover the chat by its opening message once, then track it by id — the
      // id is stable across the takeover that rewrites the last event below.
      await expect
        .poll(async () => (await chatByText(request, auth, question))?.id, {
          timeout: 20_000,
          message: 'the widget conversation never reached the API',
        })
        .toBeTruthy();
      chatId = (await chatByText(request, auth, question))!.id;

      await expect
        .poll(() => assigneeOf(request, auth, chatId!), {
          timeout: 20_000,
          message: 'the chat never routed to the skilled agent',
        })
        .toBe(skilledId);

      // --- 5. A supervisor takes it over in the browser --------------------
      await agentPage.goto('/app/inbox');
      const list = agentPage.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      await list.getByRole('button').filter({ hasText: question }).click();

      const details = agentPage.getByRole('complementary', { name: 'Conversation details' });
      await expect(details).toBeVisible();
      await details.getByRole('button', { name: 'Take over' }).click();

      const confirm = agentPage.getByRole('dialog', { name: 'Take over this chat?' });
      await expect(confirm).toBeVisible();
      const tookOver = agentPage.waitForResponse(
        (r) => r.url().includes(`/chats/${chatId}/takeover`) && r.request().method() === 'POST',
      );
      // The dialog's own confirm button, scoped to the dialog — the details
      // panel's trigger carries the same label but sits behind the modal.
      await confirm.getByRole('button', { name: 'Take over' }).click();
      expect((await tookOver).ok()).toBe(true);
      await expect(confirm).toBeHidden();

      // The reassignment is the claim: the chat now belongs to the supervisor,
      // not the agent routing chose.
      await expect
        .poll(() => assigneeOf(request, auth, chatId!), {
          timeout: 15_000,
          message: 'the assignee did not change after takeover',
        })
        .toBe(supervisorId);

      await agentPage.screenshot({ path: 'kanit/66.9-skill-routing-takeover.png', fullPage: true });

      // Archive it so the shared tenant does not keep an extra active chat.
      await agentPage.getByRole('button', { name: /Archive conversation/i }).click();
    } finally {
      // Restore the rule first, then remove the skill (its delete cascades the
      // agent assignment away, 66.1) and close the conversation — the seed's
      // idempotent skip means anything left behind pollutes the next run.
      if (ruleId) {
        await request
          .patch(`${API_BASE}/settings/routing-rules/${ruleId}`, {
            headers: auth,
            data: { conditions: ruleConditions ?? {} },
          })
          .catch(() => {});
      }
      if (chatId) {
        await request.post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth }).catch(() => {});
      }
      if (skillId) {
        await request.delete(`${API_BASE}/settings/expertise/${skillId}`, { headers: auth }).catch(() => {});
      }
      await visitorContext.close();
    }
  });

  test('an agent-role teammate is never offered the Take over control', async ({
    browser,
    request,
    organizationId,
  }) => {
    const stamp = Date.now().toString().slice(-6);
    const question = `Is anyone free to jump in? ${stamp}`;
    const token = await ownerAccessToken(request);
    const auth = { authorization: `Bearer ${token}` };

    const visitorContext = await browser.newContext();
    const agentContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    const agent = await agentContext.newPage();
    let chatId: string | undefined;

    try {
      // A fresh conversation, so a guaranteed-active chat exists to open.
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);

      // The plain-agent teammate opens it. Takeover is admin-gated, so the
      // control the owner sees (proven above) must be absent here.
      await signInAs(agent, SKILLED_AGENT.email, DEMO.password);
      await agent.goto('/app/inbox');
      const list = agent.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      await list.getByRole('button').filter({ hasText: question }).click();

      const details = agent.getByRole('complementary', { name: 'Conversation details' });
      await expect(details).toBeVisible();
      // The Assignee row still renders — the control is what is withheld.
      await expect(details.getByText('Assignee')).toBeVisible();
      await expect(details.getByRole('button', { name: 'Take over' })).toHaveCount(0);

      chatId = (await chatByText(request, auth, question))?.id;
    } finally {
      if (chatId) {
        await request.post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth }).catch(() => {});
      }
      await visitorContext.close();
      await agentContext.close();
    }
  });
});
