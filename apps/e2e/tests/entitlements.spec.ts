/**
 * What a plan is allowed to do, proven in a browser (FR-MOD-11.5 · 11.5-h).
 *
 * `11.5-b` gated the writes, `11.5-c` stopped honouring the visitor's own URL,
 * `11.5-d`/`-e` measured the promise, `11.5-f`/`-g` cut the sandbox loose. Each
 * of those is already tested against the API. What none of those suites can say
 * is whether the *product* behaves — whether the footer a paying customer is
 * looking at actually disappears, comes back when they stop paying, and cannot
 * be argued away by editing a URL; whether the second workspace really is empty
 * when you sign in to it; whether a missed promise reaches the report an admin
 * reads.
 *
 * Three claims, one per describe, and each one is a sequence rather than a
 * state: the interesting half of an entitlement is what happens on the way
 * *down*. Seeding the end state would prove the read path and skip the part
 * that has historically been wrong.
 *
 * **Everything is put back.** Two of these specs move the demo tenant between
 * plans and change workspace-wide settings, and the whole suite shares one
 * seeded database (`global-setup.ts`). A run that left Acme on `growth` would
 * fail `sso.spec.ts`, `siem.spec.ts` and `compliance.spec.ts` several files
 * later with three refusals that have nothing to do with those features — so
 * the restore is in a `finally`, not at the end of the happy path.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import {
  expect,
  test,
  ACME_OWNER,
  API_BASE,
  HOST_PAGE,
  WIDGET_ORIGIN,
  openWidget,
  ownerAccessToken,
  ownerAccessTokenFor,
  signIn,
  visitorSends,
  widgetFrame,
  type TenantOwner,
} from './fixtures.js';

/** A six-digit run token. Long enough to be unique here, short enough to stay
 *  clear of the 13-digit window card masking rewrites (FR-MOD-08.9.5) — the
 *  same reason `demo-flow.spec.ts` slices its timestamps. */
function stamp(): string {
  return Date.now().toString().slice(-6);
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/**
 * Move a workspace between commercial tiers, the way the product does it.
 *
 * `PATCH /billing/subscription` rather than a database write: the downgrade
 * guard, the seat floor and the audit entry all live on that path, and a test
 * that edited the row directly would be proving the read side against a state
 * the product cannot actually produce.
 */
async function setPlan(
  request: APIRequestContext,
  token: string,
  plan: 'growth' | 'enterprise',
): Promise<void> {
  const response = await request.patch(`${API_BASE}/billing/subscription`, {
    headers: auth(token),
    data: { plan },
  });
  expect(
    response.ok(),
    `moving to ${plan} failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
}

/** The stored branding intent, set straight through the API — used only to put
 *  the demo tenant back the way the seed left it. */
async function setStoredBranding(
  request: APIRequestContext,
  token: string,
  poweredBy: boolean,
): Promise<void> {
  await request.put(`${API_BASE}/settings/widget`, {
    headers: auth(token),
    data: { powered_by: poweredBy },
  });
}

/** The credit in the widget footer, addressed inside the cross-origin iframe. */
function widgetCredit(page: Page) {
  return widgetFrame(page).locator('.nx-powered');
}

// ===========================================================================
// white_label — the footer a customer pays to remove
// ===========================================================================

test.describe('white-label widget (11.5-b · 11.5-c)', () => {
  test('the credit goes on Enterprise, comes back on the tier below, and cannot be re-hidden there', async ({
    browser,
    page,
    request,
    organizationId,
  }) => {
    const token = await ownerAccessToken(request);
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();

    try {
      await signIn(admin);
      await admin.goto('/app/settings#widget-customization');
      const appearance = admin.getByRole('region', { name: /Widget appearance/ });
      const branding = appearance.getByLabel(/Powered by Nexa/);
      const save = appearance.getByRole('button', { name: 'Save appearance' });

      // --- Enterprise: an admin turns it off, from the screen ---------------
      await expect(branding).toBeChecked();
      await branding.uncheck();
      await save.click();
      // The save landed: the form is no longer dirty, which is the only signal
      // the screen gives that the server accepted it.
      await expect(save).toBeDisabled();

      // --- A real visitor's widget is unbranded -----------------------------
      // Across the iframe boundary and out of the token mint, not out of the
      // settings endpoint that was just written — those are two different read
      // paths and only this one is what a customer sees.
      await openWidget(page, organizationId);
      await expect(widgetCredit(page)).toBeHidden();
      await page.screenshot({ path: 'kanit/11.5-white-label-enterprise.png', fullPage: true });

      // --- Downgrade --------------------------------------------------------
      await setPlan(request, token, 'growth');

      // The row still says "hide it" — nothing swept it, and a re-upgrade will
      // find it (§C-A26). What changed is what the stored value is allowed to
      // mean, and the visitor's widget is where that has to show.
      await openWidget(page, organizationId);
      await expect(widgetCredit(page)).toBeVisible();
      await expect(widgetCredit(page)).toContainText('Powered by Nexa');
      await page.screenshot({ path: 'kanit/11.5-white-label.png', fullPage: true });

      // --- And the screen agrees, then refuses to change it -----------------
      // A full reload, not a `goto` to the URL the tab is already on: the plan
      // changed out from under this session, and nothing pushed that to it. The
      // claim being tested is what the *server* serves, so the client cache has
      // to be out of the way — a stale SPA view is not the gate failing.
      await admin.reload();
      // Reads back as branded: the settings screen serves the effective value,
      // not the stored one, so an admin is never told the footer is off while
      // their customers are looking at it.
      await expect(branding).toBeChecked();

      await branding.uncheck();
      await save.click();
      // The refusal reaches the person who asked, naming the plan — which is
      // what lets this be an upsell rather than an unexplained failure.
      await expect(appearance.getByRole('alert')).toContainText(/not included in the growth plan/i);

      // Nothing was half-applied: the visitor's widget is still branded.
      await openWidget(page, organizationId);
      await expect(widgetCredit(page)).toBeVisible();
    } finally {
      // Back to the seeded fixture, in this order: the tier first, because
      // putting the branding back is itself a gated write.
      await setPlan(request, token, 'enterprise');
      await setStoredBranding(request, token, true);
      await adminContext.close();
    }
  });

  test('a visitor cannot strip the credit with the URL their own browser holds', async ({
    page,
    organizationId,
  }) => {
    // `loader.ts` puts `powered_by=0` in the iframe URL when the embed snippet
    // asks for it — and that URL is in the visitor's browser, editable by
    // anyone who opens dev tools. Acme is entitled here and has the credit on,
    // so if the parameter were honoured at all the footer would vanish, and the
    // gate would be decoration. The widget document is addressed directly
    // because that is exactly what a tampered loader produces.
    const target = new URL('/widget.html', WIDGET_ORIGIN);
    target.searchParams.set('organization_id', organizationId);
    target.searchParams.set('host_origin', HOST_PAGE);
    target.searchParams.set('powered_by', '0');
    await page.goto(target.toString());

    await page.getByRole('button', { name: 'Open chat' }).click();
    // The composer only appears once the token exchange succeeded — so the
    // appearance below is the server's answer, not the mount-time default.
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    await expect(page.locator('.nx-powered')).toBeVisible();
    await expect(page.locator('.nx-powered')).toContainText('Powered by Nexa');
  });
});

// ===========================================================================
// sandbox — a second workspace, and nothing crossing into it
// ===========================================================================

test.describe('sandbox workspace (11.5-f · 11.5-g)', () => {
  test('is a workspace of its own, with none of production in it', async ({
    browser,
    page,
    request,
  }) => {
    // A signup, a plan change, a wizard and two sign-ins.
    test.setTimeout(120_000);

    const run = stamp();
    // Deliberately *not* the demo tenant. Creating a sandbox gives its owner a
    // second membership, and `signIn` — which every other spec in this suite
    // leans on — expects the demo owner's sign-in to land on the inbox rather
    // than on a workspace picker. A sandbox on Acme would break forty tests in
    // files this one never touches, and nothing here can delete it afterwards.
    const owner: TenantOwner = {
      email: `owner-${run}@sandbox.test`,
      password: 'entitlements-e2e-password',
      orgPrefix: `Sandbox Co ${run}`,
    };

    // --- A workspace of our own, with something in it ----------------------
    await page.goto('/signup');
    await page.getByLabel('Workspace name').fill(owner.orgPrefix);
    await page.getByLabel('Your name').fill('Robin Sandbox');
    await page.getByLabel('Email').fill(owner.email);
    await page.getByLabel('Password').fill(owner.password);
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();

    // Welcome → Website → Team → Sample data. The middle two are skipped by
    // continuing past them; the last one is the point — it lays down a contact
    // and a conversation, so "the sandbox is empty" is a claim about isolation
    // rather than about a workspace that never had anything.
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Add sample data' })).toBeVisible();
    await page.getByRole('button', { name: 'Add sample data' }).click();
    await expect(page.getByRole('status')).toContainText(/sample conversation\.$/);
    await page.getByRole('button', { name: 'Finish setup' }).click();
    await expect(page).toHaveURL(/\/app\/inbox/);

    // Resolved before the sandbox exists, on purpose: afterwards two
    // memberships match this prefix ("… " and "… (Sandbox)") and which one a
    // prefix search returns is not something this test should depend on.
    const token = await ownerAccessTokenFor(request, owner);
    await setPlan(request, token, 'enterprise');

    // The contact the sandbox must never see, confirmed present in production
    // first — an absence proves nothing unless the thing is somewhere.
    await page.goto('/app/customers');
    const productionDirectory = page.getByRole('table', { name: 'Customers' });
    await expect(
      productionDirectory.getByRole('row').filter({ hasText: 'Sample visitor' }),
    ).toBeVisible();

    // --- Mint the sandbox from the screen ----------------------------------
    await page.goto('/app/settings#section-sandbox');
    const section = page.getByRole('region', { name: 'Sandbox' });
    await section.getByRole('button', { name: 'Create sandbox' }).click();
    await expect(section).toContainText('Sandbox created');

    // Production does not wear the badge, and cannot reset from here: the
    // credential that wipes a workspace has to be a credential *for* it.
    await expect(page.getByTestId('sandbox-badge')).toHaveCount(0);
    await expect(section).toContainText(/signing in to the sandbox itself/i);

    // --- Sign in to the sandbox itself -------------------------------------
    const sandboxContext = await browser.newContext();
    const sandbox = await sandboxContext.newPage();
    try {
      await sandbox.goto('/');
      await sandbox.getByLabel('Email').fill(owner.email);
      await sandbox.getByLabel('Password').fill(owner.password);
      await sandbox.getByRole('button', { name: 'Sign in' }).click();

      // Two workspaces now, so the picker appears — the outward sign that a
      // sandbox is a tenant and not a mode.
      const picker = sandbox.getByRole('region', { name: 'Choose a workspace' });
      await expect(picker).toBeVisible();
      await picker.getByRole('button', { name: `${owner.orgPrefix} (Sandbox)` }).click();

      // It opens on the first-run wizard, which is the honest answer: a sandbox
      // is a brand-new workspace with nothing in it, and that is the same gate
      // every empty workspace passes through (FR-MOD-00.4). Skip out of it.
      await expect(sandbox.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
      await sandbox.getByRole('button', { name: 'Skip setup' }).click();
      await expect(sandbox.getByRole('link', { name: 'Inbox' })).toBeVisible();

      // The shell says which workspace this is — from `is_sandbox` in the
      // server's answer to *this* session, never from a client guess (11.5-g).
      await expect(sandbox.getByTestId('sandbox-badge')).toBeVisible();

      // --- The leak negative ------------------------------------------------
      // `customers` carries no licence column and is scoped to the
      // organization, which is the single fact that made a sandbox need a whole
      // organization rather than a sibling licence. Had that gone the other
      // way, everything above would still pass while this page listed every
      // contact in production.
      await sandbox.goto('/app/customers');
      await expect(sandbox.getByRole('heading', { name: 'Customers', level: 1 })).toBeVisible();
      await expect(sandbox.getByText('No customers yet')).toBeVisible();
      await expect(sandbox.getByText('Sample visitor')).toHaveCount(0);
      await sandbox.screenshot({ path: 'kanit/11.5-sandbox-izolasyon.png', fullPage: true });

      // Nor the conversation that contact was having.
      await sandbox.goto('/app/inbox');
      await expect(sandbox.getByRole('link', { name: 'Inbox' })).toBeVisible();
      await expect(sandbox.getByText('Sample visitor')).toHaveCount(0);

      // Inside, reset is offered — the mirror of the refusal on production.
      await sandbox.goto('/app/settings#section-sandbox');
      const inside = sandbox.getByRole('region', { name: 'Sandbox' });
      await expect(inside).toContainText('This is a sandbox');
      await expect(inside.getByRole('button', { name: 'Reset sandbox' })).toBeVisible();
    } finally {
      await sandboxContext.close();
    }
  });
});

// ===========================================================================
// sla — the promise, and what missing it looks like to an admin
// ===========================================================================

/** The SLA breach count as the Overview report answers it. */
async function slaBreaches(request: APIRequestContext, token: string): Promise<number> {
  const response = await request.get(`${API_BASE}/reports/overview`, { headers: auth(token) });
  expect(response.ok(), `overview report failed: ${response.status()}`).toBe(true);
  return ((await response.json()) as { sla: { breaches: number } }).sla.breaches;
}

/**
 * The value cell of a KPI card, from the label span outwards.
 *
 * Same approach as `reports.spec.ts`: filtering divs on their text also matches
 * the grid wrapper, so the card is reached from its label instead. Inside the
 * card the spans are label, value, then delta and hint.
 */
function kpiValue(page: Page, region: string, label: string) {
  return page
    .getByRole('region', { name: region })
    .getByText(label, { exact: true })
    .locator('xpath=..')
    .locator('span')
    .nth(1);
}

/**
 * Wait until a first reply would land *past* a one-minute target.
 *
 * `elapsedMinutes` counts whole minute boundaries crossed and `isBreach` is
 * strictly greater (`business-hours.ts`), so a one-minute promise is missed
 * only once two boundaries have gone by — up to two minutes of real time.
 *
 * There is no cheaper way to buy it, and the alternatives are worse. Every
 * clock this product measures starts when the conversation does, and nothing on
 * the API can backdate one; leaning on a conversation the seed backdated would
 * make this test pass or fail on whether some earlier file happened to answer
 * it first. So the wait is real, and it is the price of the only end-to-end
 * proof that a missed promise reaches the report.
 */
async function waitPastFirstResponseTarget(page: Page, askedAtMs: number): Promise<void> {
  const breachedAt = (Math.floor(askedAtMs / 60_000) + 2) * 60_000 + 2_000;
  const remaining = breachedAt - Date.now();
  if (remaining > 0) await page.waitForTimeout(remaining);
}

test.describe('SLA targets (11.5-d · 11.5-e)', () => {
  test('a first reply past the target is marked and counted on Reports', async ({
    browser,
    page,
    request,
    organizationId,
  }) => {
    // Dominated by the wait above; see its note.
    test.setTimeout(300_000);

    const token = await ownerAccessToken(request);
    const agentContext = await browser.newContext();
    const agent = await agentContext.newPage();

    try {
      await signIn(agent);
      await agent.getByLabel('Availability').selectOption('accepting_chats');

      // --- The promise ------------------------------------------------------
      await agent.goto('/app/settings#section-sla');
      const sla = agent.getByRole('region', { name: 'SLA' });
      await expect(sla).toBeVisible();
      await sla.getByLabel('First response target (minutes)').fill('1');
      const businessHoursOnly = sla.getByLabel(/Count only business hours/);
      if (await businessHoursOnly.isChecked()) await businessHoursOnly.uncheck();
      await sla.getByRole('button', { name: 'Save' }).click();
      // "Active" is entitled *and* configured — one flag, because a screen has
      // to tell "not bought" apart from "not set".
      await expect(sla).toContainText('Active');

      const before = await slaBreaches(request, token);

      // --- A conversation nobody answers in time ----------------------------
      const question = `How long until someone replies? ${stamp()}`;
      await openWidget(page, organizationId);
      await visitorSends(page, question);
      // Recorded after the send is acknowledged, which is at or after the
      // moment the thread was created — so the wait below is never short.
      const askedAt = Date.now();

      await waitPastFirstResponseTarget(agent, askedAt);

      // Back to the inbox — the agent has been sitting on Settings since the
      // targets were saved.
      await agent.goto('/app/inbox');
      const list = agent.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      await list.getByRole('button').filter({ hasText: question }).first().click();
      await agent.getByRole('radio', { name: 'Reply' }).click();
      await agent.getByPlaceholder('Type your reply').fill('Sorry for the wait — checking now.');
      await agent.getByRole('button', { name: 'Send' }).click();

      // --- The mark ---------------------------------------------------------
      // Written inside the same request that stopped the clock, so this is the
      // send having been processed rather than a sweep having caught up.
      await expect.poll(() => slaBreaches(request, token), { timeout: 20_000 }).toBe(before + 1);

      // --- The screen an admin actually reads -------------------------------
      await agent.goto('/app/reports');
      await expect(agent.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
      const card = kpiValue(agent, 'Responsiveness', 'SLA breaches');
      await expect(card).toHaveText(String(before + 1));
      await agent.screenshot({ path: 'kanit/11.5-sla-breach.png', fullPage: true });
    } finally {
      // Clear the targets again. The breach row stays — it is a record of
      // something that happened — but the workspace goes back to promising
      // nothing, which is the state every later file was written against.
      await request.put(`${API_BASE}/settings/sla`, {
        headers: auth(token),
        data: {
          first_response_minutes: null,
          resolution_minutes: null,
          business_hours_only: false,
        },
      });
      await agentContext.close();
    }
  });

  test('the targets are refused on the tier that does not include them', async ({ request }) => {
    // The gate from the outside, on the deployment a customer talks to rather
    // than an in-process server: same refusal, same shape, all the way through
    // the real HTTP stack.
    const token = await ownerAccessTokenFor(request, ACME_OWNER);
    try {
      await setPlan(request, token, 'growth');

      const refused = await request.put(`${API_BASE}/settings/sla`, {
        headers: auth(token),
        data: { first_response_minutes: 15, resolution_minutes: null, business_hours_only: false },
      });
      expect(refused.status()).toBe(403);
      const body = (await refused.json()) as {
        error: { type: string; details?: { entitlement?: string; plan?: string } };
      };
      expect(body.error.type).toBe('not_allowed');
      expect(body.error.details).toMatchObject({ entitlement: 'sla', plan: 'growth' });

      // Reading stays open on every plan — that is where the upsell lives, and
      // a settings page that 403s is a worse product and no more secure.
      const read = await request.get(`${API_BASE}/settings/sla`, { headers: auth(token) });
      expect(read.ok()).toBe(true);
      expect((await read.json()) as { active: boolean }).toMatchObject({ active: false });
    } finally {
      await setPlan(request, token, 'enterprise');
    }
  });
});
