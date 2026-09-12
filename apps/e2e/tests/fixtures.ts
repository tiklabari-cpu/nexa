/**
 * Shared fixtures.
 *
 * Everything here goes through the public API rather than the database. A test
 * helper that reaches into Postgres can pass while the API that real clients
 * use is broken — which is the entire failure mode this suite exists to catch.
 */
import { createHash, randomBytes } from 'node:crypto';
import { expect, request, test as base, type APIRequestContext, type Page } from '@playwright/test';

export const API_BASE = 'http://localhost:4000/api/v1';
export const HOST_PAGE = 'http://acme-bikes.localhost:5174';
export const WIDGET_ORIGIN = 'http://localhost:5174';
/**
 * A third site the visitor can arrive *from*, for `visits.came_from`
 * (FR-MOD-13.2). Same Vite server, a third origin — a referrer only exists when
 * the previous page is a real navigation away from somewhere else, and a
 * cross-origin one is trimmed by the browser to exactly this origin.
 */
export const REFERRING_SITE = 'http://searchy.localhost:5174';

export const DEMO = {
  email: 'owner@acme.localhost',
  password: 'nexa-demo-password',
  agentName: 'Dana Okonkwo',
} as const;

interface Fixtures {
  /** An agent already signed in, sitting on the inbox. */
  agentPage: Page;
}

interface WorkerFixtures {
  /** Organization id of the seeded Acme tenant, resolved via the API. */
  organizationId: string;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  /**
   * Worker-scoped on purpose.
   *
   * Per-test this cost one `/auth/login` per test, and combined with the
   * sign-ins that is enough to trip the anonymous rate limit inside a single
   * run — the suite then fails with 429s that look like product bugs and are
   * not. The tenant does not change during a run, so resolving it once is both
   * cheaper and more honest.
   */
  organizationId: [
    // The empty pattern is required, not sloppy: Playwright parses this
    // parameter's source to discover which fixtures to inject, and rejects
    // anything that is not a destructuring pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      const context = await request.newContext({
        baseURL: API_BASE,
        extraHTTPHeaders: { 'user-agent': `nexa-e2e-worker-${workerInfo.workerIndex}` },
      });
      try {
        await use(await resolveOrganizationId(context));
      } finally {
        await context.dispose();
      }
    },
    { scope: 'worker' },
  ],

  agentPage: async ({ page }, use) => {
    await signIn(page);
    await use(page);
  },
});

export { expect };

/**
 * The seeded organization id changes on every reseed, so it has to be looked up
 * rather than hard-coded. `/auth/login` returns the caller's memberships, which
 * is the only place a client can learn it before holding a token.
 */
export async function resolveOrganizationId(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${API_BASE}/auth/login`, {
    data: { email: DEMO.email, password: DEMO.password },
  });
  expect(response.ok(), `login failed: ${response.status()} ${await response.text()}`).toBe(true);

  const body = (await response.json()) as {
    memberships: Array<{ organization_id: string; organization_name: string }>;
  };
  const acme = body.memberships.find((m) => m.organization_name.startsWith('Acme'));
  expect(acme, 'seeded Acme tenant not found').toBeDefined();
  return acme!.organization_id;
}

/** The credentials + tenant of a seeded owner, for `ownerAccessTokenFor`. */
export interface TenantOwner {
  email: string;
  password: string;
  /** The seeded organization's name starts with this — memberships are matched on it. */
  orgPrefix: string;
}

/** The primary demo tenant (owner@acme.localhost). */
export const ACME_OWNER: TenantOwner = {
  email: DEMO.email,
  password: DEMO.password,
  orgPrefix: 'Acme',
};

/**
 * The seeded workspace that is bigger than one page of anything (NFR-P5 ·
 * P5-PAGE): sixty conversations against the inbox's 50-row page, and one
 * conversation of 250 events against the transcript's 200-event page.
 *
 * Its own tenant rather than sixty more rows in Acme — see `seedPagingWorkspace`
 * for why. The consequence here is that `paging.spec.ts` signs in as this owner
 * instead of using the `agentPage` fixture, which is Acme's.
 */
export const PAGING_OWNER: TenantOwner = {
  email: 'owner@paging.localhost',
  password: DEMO.password,
  orgPrefix: 'Paging',
};

/** The second seeded tenant — the "other tenant" side of cross-tenant proofs. */
export const NORTHWIND_OWNER: TenantOwner = {
  email: 'owner@northwind.localhost',
  password: DEMO.password,
  orgPrefix: 'Northwind',
};

/**
 * The seeded workspace that lives in `us` (NFR-C4 · C4-b) — the subject of the
 * residency refusals in `compliance.spec.ts`.
 *
 * It exists only in the seed because the product will not create one here any
 * more: since C4-h this European deployment refuses a `us` signup outright
 * rather than writing the workspace and then locking its founder out of it. The
 * doors still have to refuse a misplaced row, so the seed writes one.
 */
export const STATESIDE_OWNER: TenantOwner = {
  email: 'owner@stateside.localhost',
  password: DEMO.password,
  orgPrefix: 'Stateside',
};

/**
 * The seeded workspace whose trial ended before this run started
 * (`FR-MOD-10.2` — `trial-expired.spec.ts`).
 *
 * Seeded rather than signed up here for the same reason `PAGING_OWNER` is:
 * nothing public ages a trial, so a workspace already read-only for that
 * reason can only exist if the seed writes it that way (`seedOverdueTrialWorkspace`,
 * `apps/api/prisma/seed.ts`).
 */
export const OVERDUE_OWNER: TenantOwner = {
  email: 'owner@overdue.localhost',
  password: DEMO.password,
  orgPrefix: 'Overdue',
};

/**
 * An owner Bearer token for a given seeded tenant, via the same OAuth 2.1 + PKCE
 * flow the web app runs (`auth-store.ts`). A handful of e2e steps have to drive
 * the API directly — registering a webhook to prove its audit entry reaches the
 * screen (NFR-S12), or standing up a second tenant's public KB (PUBKB-i) — and
 * the browser session keeps its token in memory, out of reach of the test.
 * Owners hold the admin scope set (ADMIN_SCOPES) by default, so this token can
 * both write and read the surfaces those steps exercise.
 */
export async function ownerAccessTokenFor(
  context: APIRequestContext,
  owner: TenantOwner,
): Promise<string> {
  const login = await context.post(`${API_BASE}/auth/login`, {
    data: { email: owner.email, password: owner.password },
  });
  expect(login.ok(), `login failed: ${login.status()} ${await login.text()}`).toBe(true);
  const { memberships } = (await login.json()) as {
    memberships: Array<{ client_id?: string; organization_name: string; license_id: string }>;
  };
  const tenant = memberships.find((m) => m.organization_name.startsWith(owner.orgPrefix));
  expect(tenant?.client_id, `seeded ${owner.orgPrefix} tenant not found`).toBeTruthy();

  // A fresh PKCE pair; the challenge is base64url(sha256(verifier)), S256.
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = 'http://localhost:5173/auth/callback';

  const authorized = await context.post(`${API_BASE}/auth/authorize`, {
    data: {
      client_id: tenant!.client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      email: owner.email,
      password: owner.password,
      license_id: tenant!.license_id,
    },
  });
  expect(
    authorized.ok(),
    `authorize failed: ${authorized.status()} ${await authorized.text()}`,
  ).toBe(true);
  const { code } = (await authorized.json()) as { code: string };

  const granted = await context.post(`${API_BASE}/auth/token`, {
    data: {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: tenant!.client_id,
      redirect_uri: redirectUri,
    },
  });
  expect(granted.ok(), `token failed: ${granted.status()} ${await granted.text()}`).toBe(true);
  return ((await granted.json()) as { access_token: string }).access_token;
}

/** An owner Bearer token for the primary Acme tenant (the common case). */
export async function ownerAccessToken(context: APIRequestContext): Promise<string> {
  return ownerAccessTokenFor(context, ACME_OWNER);
}

/**
 * Deliver a provider webhook the way the provider itself would (FR-MOD-08.5.4-.7):
 * unauthenticated, at the public `/channels/:type/webhook` endpoint, with the
 * channel address in the body as the only thing that routes it to a workspace.
 *
 * Deliberately not a database insert and not an authenticated call. The inbound
 * path's whole claim is that an anonymous POST carrying a connected address
 * becomes a chat in that workspace and nowhere else; a helper holding a token
 * would prove something the real provider never does.
 */
export async function channelWebhook(
  context: APIRequestContext,
  type: string,
  body: Record<string, unknown>,
): Promise<{ chat_id: string; customer_id: string }> {
  const response = await context.post(`${API_BASE}/channels/${type}/webhook`, { data: body });
  expect(
    response.ok(),
    `${type} webhook failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);
  return (await response.json()) as { chat_id: string; customer_id: string };
}

export async function signIn(page: Page): Promise<void> {
  await signInAs(page, DEMO.email, DEMO.password);
}

/**
 * The sign-in form, driven for any seeded owner.
 *
 * Each seeded owner belongs to exactly one workspace, and `SignInPage` skips
 * the workspace picker for a single membership — so this lands on the inbox of
 * whichever tenant the address belongs to.
 */
export async function signInAs(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // The inbox rail only exists once the session is real.
  await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();
}

const ONBOARDING_PASSWORD = 'onboarding-e2e-password';

/**
 * A fresh workspace through the public signup form; lands on the wizard.
 *
 * Shared between `onboarding.spec.ts` (drives the flow) and `a11y.spec.ts`
 * (scans it): a signup creates a brand-new workspace every time (unique
 * email), so this never collides with the seeded demo tenant, which ships
 * pre-onboarded and must never see the wizard.
 */
export async function signUpFreshOwner(page: Page): Promise<void> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  await page.goto('/signup');
  await page.getByLabel('Workspace name').fill(`Onboarding Co ${unique}`);
  await page.getByLabel('Your name').fill('Robin Owner');
  await page.getByLabel('Email').fill(`owner-${unique}@onboarding.test`);
  await page.getByLabel('Password').fill(ONBOARDING_PASSWORD);
  await page.getByRole('button', { name: 'Create workspace' }).click();

  // Auto-signed-in, and because the workspace is empty the shell sends the new
  // owner to the wizard rather than the inbox.
  await expect(page.getByRole('heading', { name: 'Set up your workspace' })).toBeVisible();
  await expect(page).toHaveURL(/\/app\/onboarding/);
}

/** The widget lives in a cross-origin iframe; everything inside is addressed through it. */
export function widgetFrame(page: Page) {
  return page.frameLocator('#nexa-widget-frame');
}

/**
 * A host origin of this run's own, under the seeded tenant's trusted domain.
 *
 * `acme-bikes.localhost` is registered with `include_subdomains`, so any label
 * in front of it mints a widget token exactly as the demo page does — and the
 * page URL the widget reports then carries a string no other spec's visitor can
 * be on. That is what makes a goal trigger (FR-MOD-13.3) addressable: a goal on
 * `/demo.html` would convert every visitor the suite creates.
 *
 * Lowercase letters, digits and hyphens only — `originHost` rejects anything
 * else before the allowlist is ever consulted.
 */
export function tenantSubdomain(label: string): { origin: string; hostname: string } {
  const hostname = `${label}.acme-bikes.localhost`;
  return { hostname, origin: `http://${hostname}:5174` };
}

export async function openWidget(
  page: Page,
  organizationId: string,
  options: { from?: string; host?: string } = {},
): Promise<void> {
  const target = `${options.host ?? HOST_PAGE}/demo.html?organization_id=${organizationId}`;

  if (options.from) {
    // Arrive by clicking a link on another site, because that is the only thing
    // that gives the host page a `document.referrer` — `page.goto` leaves it
    // empty however the URL is dressed up, and the loader reads that property.
    // The other site is the same demo page with no organization configured, so
    // its loader stays inert and no stray visitor is created.
    await page.goto(`${options.from}/demo.html`);
    await page.evaluate((href) => {
      const link = document.createElement('a');
      link.id = 'e2e-continue';
      link.href = href;
      link.textContent = 'Continue';
      document.body.append(link);
    }, target);
    await page.click('#e2e-continue');
    await page.waitForURL(target);
  } else {
    await page.goto(target);
  }

  const frame = widgetFrame(page);
  await frame.getByRole('button', { name: 'Open chat' }).click();
  // The composer only appears once the token exchange has succeeded.
  await expect(frame.getByRole('textbox', { name: 'Message' })).toBeVisible();
}

/** Send a message as the visitor and wait for it to appear in their transcript. */
export async function visitorSends(page: Page, text: string): Promise<void> {
  const frame = widgetFrame(page);
  await frame.getByRole('textbox', { name: 'Message' }).fill(text);
  await frame.getByRole('button', { name: 'Send' }).click();
  await expect(frame.getByRole('log', { name: 'Conversation' })).toContainText(text);
}

/**
 * One row of `GET /chats` — the fields the routing fixtures below read.
 *
 * `queue_position` matters as much as `assignee_id` here: a conversation with
 * a position is waiting in the *human* queue and is drainable, while one with
 * neither is being handled by the AI agent and never is.
 */
export interface ChatSummary {
  id: string;
  active: boolean;
  assignee_id: string | null;
  queue_position: number | null;
  last_event: { text?: string } | null;
}

/** Every conversation in the workspace — the list endpoint caps a page at 100. */
export async function allChats(
  request: APIRequestContext,
  auth: Record<string, string>,
): Promise<ChatSummary[]> {
  const collected: ChatSummary[] = [];
  let pageId: string | undefined;

  // Bounded rather than `while (true)`: a cursor the server never stops handing
  // back would otherwise hang the spec instead of failing it.
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

/** Archive one conversation through the same endpoint an agent's button calls. */
async function archiveChat(
  request: APIRequestContext,
  auth: Record<string, string>,
  chatId: string,
): Promise<void> {
  const archived = await request.post(`${API_BASE}/chats/${chatId}/deactivate`, { headers: auth });
  expect(
    archived.ok(),
    `could not archive ${chatId} to make room: ${archived.status()} ${await archived.text()}`,
  ).toBe(true);
}

/**
 * Leave one named agent a slot the router can actually route into (tm 147, tm 233).
 *
 * Two specs need a *specific* agent to be assignable — `skills-routing.spec.ts`
 * and `team.spec.ts` — and it is the one thing the seed cannot promise them:
 * the router refuses an agent whose active threads have reached
 * `concurrent_chats_limit` (`routing-service.ts` — `HAVING COUNT(t.id) <
 * m.concurrent_chats_limit`), and this shared workspace collects conversations
 * all run long.
 *
 * **Archiving alone is not enough, and that is why this lives here.** Closing a
 * conversation drains the human queue in the same transaction
 * (`chat-service.ts` — `#closeConversation` → `routing.drainQueue`, "so the slot
 * this frees is filled now rather than on the next arrival"). By the time these
 * two files run in a full-suite pass, every seeded agent is at capacity and
 * conversations are genuinely waiting, so each archive handed the slot it had
 * just freed straight to the next chat in line and the agent came back full.
 * The two specs then read `Received: null` — a routing defect that does not
 * exist. Measured on the GL-13 and GL-14 full runs (tm 208 · tm 209): the same
 * two tests failed both times and were green both times when run alone, where
 * the queue is empty and the drain has nothing to hand over.
 *
 * So the queue is emptied *first*, and only then is the agent trimmed. Both
 * steps go through the same `deactivate` an agent clicks when they are
 * finished; nothing is deleted, the transcripts stay readable, and nothing
 * after these files has a claim on conversations they did not open — they are
 * leftovers, not fixtures.
 *
 * Costs nothing when there is nothing to do: an agent already under their limit
 * returns before any write, which is every solo run of either spec.
 */
export async function freeARoutingSlot(
  request: APIRequestContext,
  auth: Record<string, string>,
  agentId: string,
  limit: number,
): Promise<void> {
  const heldBy = (chats: ChatSummary[]): ChatSummary[] =>
    chats.filter((chat) => chat.active && chat.assignee_id === agentId);

  if (heldBy(await allChats(request, auth)).length < limit) return;

  // The waiting room, oldest position first. Draining is what makes closing a
  // chat refill the agent it just freed, so it has to be empty before the trim
  // below — not after, and not at the same time.
  const queued = (await allChats(request, auth))
    .filter((chat) => chat.active && chat.queue_position !== null)
    .sort((a, b) => (a.queue_position ?? 0) - (b.queue_position ?? 0));
  for (const chat of queued) await archiveChat(request, auth, chat.id);

  // Re-read rather than reuse the first list: emptying the queue above can move
  // waiting conversations onto agents who still had room, this one included.
  const held = heldBy(await allChats(request, auth));
  const surplus = held.length - (limit - 1);
  if (surplus <= 0) return;

  // `view=all` sorts newest first, so the tail is the oldest.
  for (const chat of held.slice(-surplus)) await archiveChat(request, auth, chat.id);
}

/**
 * A conversation whose customer can actually be written to, resolved through
 * the API (tm 247).
 *
 * Specs that need one used to take "whatever is first in the conversation
 * list", which is a statement about the whole suite's history rather than about
 * the fixture: the list is ordered by last activity, and every widget, channel
 * and campaign spec files another anonymous visitor on its way past. Measured
 * (tm 247, §D163): `telegram.spec.ts` on its own is enough to put
 * `bisiklet_fan_316884` — a handle with no e-mail address — at the top, and the
 * ticket pane then renders no "Notify the customer" picker at all, because
 * there is nowhere for a notice to go. Two files reproduced exactly the failure
 * the full suite gave twice.
 *
 * Returned as a chat id for `/app/inbox?chat=<id>` rather than as a row to
 * click: the transcript is fetched by id (`useChat`), so the deep link does not
 * care which page of the list the conversation ended up on either.
 */
export async function chatOfAReachableCustomer(request: APIRequestContext): Promise<string> {
  const auth = { authorization: `Bearer ${await ownerAccessToken(request)}` };

  const directory = await request.get(`${API_BASE}/customers?segment=all&limit=100`, {
    headers: auth,
  });
  expect(directory.ok(), `customer directory failed: ${directory.status()}`).toBe(true);
  const people = (
    (await directory.json()) as { items: Array<{ id: string; name: string; email: string | null }> }
  ).items.filter((person) => person.email);
  expect(people.length, 'no customer in the directory carries an e-mail address').toBeGreaterThan(
    0,
  );

  for (const person of people) {
    const theirs = await request.get(
      `${API_BASE}/chats?view=all&customer_id=${person.id}&limit=1`,
      { headers: auth },
    );
    expect(theirs.ok(), `list chats failed: ${theirs.status()}`).toBe(true);
    const chat = ((await theirs.json()) as { items: Array<{ id: string }> }).items[0];
    if (chat) return chat.id;
  }

  throw new Error(
    `none of the ${people.length} customers with an e-mail address has a conversation`,
  );
}
