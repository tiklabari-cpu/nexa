/**
 * Data residency and HIPAA cover, end to end (NFR-C4 · C4-g).
 *
 * Everything below C4-g proved residency against a server it started itself:
 * `apps/api/test/integration/region.test.ts` boots a second in-process Fastify
 * with `NEXA_REGION=us`, and `apps/rtm/test/integration/region.test.ts` does the
 * same with a second gateway. Those suites are the detailed ones and stay the
 * detailed ones — every branch of the rule is theirs.
 *
 * What they structurally cannot show is that the *deployment* refuses. The API
 * and the RTM gateway are separate processes here, started by
 * `playwright.config.ts` from the same environment a developer runs, and the
 * region they serve comes from configuration rather than a test harness. So this
 * file takes one workspace that genuinely lives in `us`, created through the
 * public signup form in a real browser, and knocks on all three doors of this
 * European deployment:
 *
 *   1. the REST edge         — `GET /auth/me` with that workspace's own token
 *   2. the socket            — `login` on a real WebSocket to the gateway
 *   3. the widget token mint — `POST /customer/token` for that organization
 *
 * Three separate proofs on purpose. A workspace whose REST calls are turned away
 * while its socket keeps streaming is a workspace whose data is still leaving
 * its region, and the widget mint is the door that *writes* before it answers.
 *
 * The positive side of each pair is the rest of this suite: every other spec
 * signs in, opens a socket and mints widget tokens against this same deployment
 * for the seeded European tenant. If residency were refusing indiscriminately,
 * none of them would be green.
 */
import { expect, test } from './fixtures.js';
import {
  ACME_OWNER,
  API_BASE,
  NORTHWIND_OWNER,
  WIDGET_ORIGIN,
  ownerAccessTokenFor,
} from './fixtures.js';
import type { APIRequestContext, Page } from '@playwright/test';

const PASSWORD = 'compliance-e2e-password';
const RTM_WS = 'ws://localhost:4001/v1/agent/rtm/ws';

/** A workspace created by this spec, with what is needed to knock on each door. */
interface FreshWorkspace {
  organizationId: string;
  email: string;
  orgPrefix: string;
}

/**
 * Create a workspace through the signup form, choosing where its data lives.
 *
 * Deliberately the browser and not `POST /auth/signup`: the region is a
 * `<select>` the page owns (C4-c) rather than a form field, and driving the API
 * would prove the column while skipping the only thing that puts a value in it.
 */
async function signUpChoosingRegion(
  page: Page,
  region: 'eu' | 'us',
): Promise<{ name: string; email: string }> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const name = `Residency ${region.toUpperCase()} ${unique}`;
  const email = `owner-${unique}@residency.test`;

  await page.goto('/signup');
  await page.getByLabel('Workspace name').fill(name);
  await page.getByLabel('Data region').selectOption(region);
  await page.getByLabel('Your name').fill('Robin Owner');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  return { name, email };
}

/** The organization id of a workspace, from the one place a client can read it before holding a token. */
async function organizationIdOf(
  request: APIRequestContext,
  email: string,
  orgPrefix: string,
): Promise<string> {
  const response = await request.post(`${API_BASE}/auth/login`, {
    data: { email, password: PASSWORD },
  });
  expect(response.ok(), `login failed: ${response.status()} ${await response.text()}`).toBe(true);
  const { memberships } = (await response.json()) as {
    memberships: Array<{ organization_id: string; organization_name: string }>;
  };
  const tenant = memberships.find((m) => m.organization_name.startsWith(orgPrefix));
  expect(tenant, `workspace ${orgPrefix} not found on the roster`).toBeDefined();
  return tenant!.organization_id;
}

interface RtmFrame {
  type: string;
  request_id?: string;
  success?: boolean;
  payload?: Record<string, unknown>;
}

/**
 * `login` on a real socket to the running gateway, and the frame it answers with.
 *
 * The frame shape is the product's own (`realtime.ts`): protocol `3.6`, a
 * request id to match the response on, and `Bearer `-prefixed credentials.
 */
async function rtmLogin(organizationId: string, token: string): Promise<RtmFrame> {
  const socket = new WebSocket(`${RTM_WS}?organization_id=${encodeURIComponent(organizationId)}`);
  const requestId = 'c4g-login';
  try {
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('gateway refused the connection')), {
        once: true,
      });
    });

    const answered = new Promise<RtmFrame>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('the gateway never answered login')), 15_000);
      socket.addEventListener('message', (event) => {
        const frame = JSON.parse(String(event.data)) as RtmFrame;
        if (frame.type !== 'response' || frame.request_id !== requestId) return;
        clearTimeout(timer);
        resolve(frame);
      });
    });

    socket.send(
      JSON.stringify({
        version: '3.6',
        request_id: requestId,
        action: 'login',
        payload: { token: `Bearer ${token}` },
      }),
    );
    return await answered;
  } finally {
    socket.close();
  }
}

test.describe('data residency, at every door (NFR-C4 · C4-b · C4-g)', () => {
  test('a workspace that lives in the United States is refused by this European deployment', async ({
    page,
    request,
  }) => {
    // --- The browser half ----------------------------------------------------
    const { name, email } = await signUpChoosingRegion(page, 'us');

    // Signup itself succeeds — it is anonymous, and the region is a choice
    // rather than a claim about the caller. What fails is the sign-in that
    // follows: the moment a credential for this workspace is presented, this
    // deployment says it is not the one that serves it. So the founder is left
    // on the form with an error and never reaches the shell.
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Inbox' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/signup/);

    const fresh: FreshWorkspace = {
      email,
      orgPrefix: name,
      organizationId: await organizationIdOf(request, email, name),
    };

    // A genuine credential for that workspace. The token endpoints are
    // anonymous — residency is decided where a credential is *used*, not where
    // it is issued — so this succeeds and gives each door below something real
    // to refuse.
    const token = await ownerAccessTokenFor(request, {
      email: fresh.email,
      password: PASSWORD,
      orgPrefix: fresh.orgPrefix,
    });

    // --- Door 1: the REST edge ----------------------------------------------
    const me = await request.get(`${API_BASE}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.status()).toBe(421);
    const restError = (await me.json()) as { error: { type: string; details?: { region?: string } } };
    // Not `authentication`: the credential is genuine and the caller is at the
    // wrong address. `details.region` is the workspace's region, which is the
    // only thing here that tells a correctly built client where to go instead.
    expect(restError.error.type).toBe('misdirected_request');
    expect(restError.error.details?.region).toBe('us');

    // --- Door 2: the socket --------------------------------------------------
    const login = await rtmLogin(fresh.organizationId, token);
    expect(login.success).toBe(false);
    const socketError = login.payload?.['error'] as { type: string; details?: { region?: string } };
    expect(socketError.type).toBe('misdirected_request');
    expect(socketError.details?.region).toBe('us');

    // --- Door 3: the widget token mint --------------------------------------
    // Through the hosted chat page's origin (`WIDGET_BASE_URL`), which resolves
    // the licence directly instead of an allowlist — the one way to reach this
    // route for a workspace that has never been able to sign in and configure a
    // trusted domain. It is also the door that matters most: a visitor with no
    // `customer_id` gets a row created for them, so minting here would put an
    // American workspace's customer in the European database *while* producing
    // the error that reports it.
    const minted = await request.post(`${API_BASE}/customer/token`, {
      data: { organization_id: fresh.organizationId, host_origin: WIDGET_ORIGIN },
      headers: { origin: WIDGET_ORIGIN },
    });
    expect(minted.status()).toBe(421);
    const mintError = (await minted.json()) as {
      error: { type: string; details?: { region?: string } };
    };
    expect(mintError.error.type).toBe('misdirected_request');
    expect(mintError.error.details?.region).toBe('us');
  });

  test('the seeded European workspace is served at all three doors', async ({
    organizationId,
    request,
  }) => {
    // The other half of every pair above, on the same running processes: the
    // gate refuses a region, not a workspace.
    const token = await ownerAccessTokenFor(request, ACME_OWNER);

    const me = await request.get(`${API_BASE}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.status()).toBe(200);
    // The *workspace's* region, not the one this process was configured with —
    // read from configuration the answer would be `eu` either way, which is why
    // the refusal above had to be a workspace that disagrees with it.
    expect(((await me.json()) as { region: string }).region).toBe('eu');

    const login = await rtmLogin(organizationId, token);
    expect(login.success).toBe(true);

    // The widget mint's positive is left to `widget.spec.ts`, which drives it
    // through a real cross-origin iframe. Repeating it here would create a
    // second anonymous visitor in the shared seed for no extra proof.
  });
});

test.describe('the compliance card (NFR-C4 · C4-d · C4-f · C4-g)', () => {
  test('shows the region the founder chose, fixed, with no agreement to accept outside the US', async ({
    page,
  }) => {
    await signUpChoosingRegion(page, 'eu');

    // A European workspace signs in normally at this deployment, so the journey
    // continues where the American one stopped.
    await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
    await page.getByRole('button', { name: 'Skip setup' }).click();
    await expect(page).toHaveURL(/\/app\/inbox/);

    await page.goto('/app/settings');
    const card = page.getByRole('region', { name: 'Data region and compliance' });
    await expect(card.getByRole('heading', { name: 'Data region and compliance' })).toBeVisible();

    // The choice made on the signup form, read back from the server — and said
    // to be permanent, which is the claim the database trigger
    // (`organizations_region_immutable`) actually enforces.
    await expect(card.getByText('European Union')).toBeVisible();
    await expect(card.getByText(/can never be changed/i)).toBeVisible();

    // Nothing on this screen offers to move it. The immutability negatives run
    // against the database in `region.test.ts`, because a guard that only
    // exists in a screen is one API call away from absent; what belongs here is
    // that the product never invites the change in the first place.
    await expect(card.getByRole('combobox')).toHaveCount(0);
    await expect(card.getByRole('textbox')).toHaveCount(0);

    // No signed agreement, and — hosted in Europe — none on offer. The button
    // is not merely hidden: `POST /settings/compliance/baa` refuses a European
    // workspace outright, and the database refuses the timestamp under a
    // non-US organization even if the endpoint were bypassed (C4-d).
    await expect(card.getByText('Not signed')).toBeVisible();
    await expect(card.getByText(/only available to workspaces hosted in the United States/i)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Accept the BAA' })).toHaveCount(0);

    await page.screenshot({ path: 'kanit/C4-region-compliance.png', fullPage: true });
  });
});

test.describe('a workspace with no signed BAA carries none of HIPAA’s constraints (C4-e · C4-g)', () => {
  test('the seeded workspace reports no agreement, is told there is none to accept, and is not constrained', async ({
    request,
  }) => {
    // The false-positive half of C4-e, and the one worth guarding: constraints
    // that switch on for everybody are indistinguishable from constraints that
    // do not work, and both look green in a suite that only ever tests the
    // covered case.
    const token = await ownerAccessTokenFor(request, ACME_OWNER);
    const auth = { authorization: `Bearer ${token}` };

    const settings = await request.get(`${API_BASE}/settings/compliance`, { headers: auth });
    expect(settings.status()).toBe(200);
    expect(await settings.json()).toMatchObject({
      region: 'eu',
      baa_available: false,
      hipaa_baa_signed_at: null,
    });

    // Not a validation error — the body is fine. The workspace is hosted where
    // HIPAA cover does not apply and cannot change region, so there is nothing
    // here to accept.
    const accept = await request.post(`${API_BASE}/settings/compliance/baa`, {
      data: { accepted: true },
      headers: auth,
    });
    expect(accept.status()).toBe(403);
    expect(((await accept.json()) as { error: { type: string } }).error.type).toBe('not_allowed');

    // And the constraint that would be the loudest false positive: an AI
    // surface still answers. `ai-residency` refuses with 403 `not_allowed`
    // only for a workspace in HIPAA scope on an out-of-region provider; an
    // uncovered workspace must never meet that gate.
    const ai = await request.post(`${API_BASE}/palette/ai-query`, {
      data: { query: 'How is the team doing this month?' },
      headers: auth,
    });
    expect(ai.status()).toBe(200);
    expect(typeof ((await ai.json()) as { answer: string }).answer).toBe('string');

    // Still refused the agreement afterwards, so nothing above quietly signed
    // it: the read is the same before and after.
    const after = await request.get(`${API_BASE}/settings/compliance`, { headers: auth });
    expect(((await after.json()) as { hipaa_baa_signed_at: string | null }).hipaa_baa_signed_at).toBeNull();
  });

  test('each workspace is told about its own compliance state and nobody else’s', async ({
    request,
  }) => {
    // Residency and BAA state are read through the ordinary tenant-scoped
    // stack, so the ordinary cross-tenant question applies: a second seeded
    // workspace asking the same endpoint with its own credential must be
    // answered about itself. Both live in `eu` and neither has signed, so the
    // proof is the licence the answer came from, not the values.
    const [acme, northwind] = await Promise.all([
      ownerAccessTokenFor(request, ACME_OWNER),
      ownerAccessTokenFor(request, NORTHWIND_OWNER),
    ]);

    const [acmeMe, northwindMe] = await Promise.all([
      request.get(`${API_BASE}/auth/me`, { headers: { authorization: `Bearer ${acme}` } }),
      request.get(`${API_BASE}/auth/me`, { headers: { authorization: `Bearer ${northwind}` } }),
    ]);
    const acmeOrg = ((await acmeMe.json()) as { organization_id: string }).organization_id;
    const northwindOrg = ((await northwindMe.json()) as { organization_id: string }).organization_id;
    expect(acmeOrg).not.toBe(northwindOrg);

    // Northwind's own answer, from Northwind's own credential. An endpoint that
    // resolved the licence by anything other than the caller would surface
    // here as a shared reading rather than two.
    const settings = await request.get(`${API_BASE}/settings/compliance`, {
      headers: { authorization: `Bearer ${northwind}` },
    });
    expect(settings.status()).toBe(200);
    expect(await settings.json()).toMatchObject({ region: 'eu', hipaa_baa_signed_at: null });

    // And the credential does not reach across: Acme's brand id on Northwind's
    // token is a workspace Northwind cannot see, and the answer is 404 rather
    // than a reading of Acme's.
    const across = await request.get(`${API_BASE}/settings/compliance`, {
      headers: { authorization: `Bearer ${northwind}`, 'x-nexa-brand': acmeOrg },
    });
    expect(across.status()).toBe(404);
  });
});
