/**
 * Settings, and the composer shortcut it feeds.
 *
 * Saved replies existed in the schema and the seed, and nothing read or wrote
 * them — no management screen, and no `#` picker in the composer. The last test
 * here is the one that proves the loop is closed: a reply created in Settings
 * has to reach a customer through the composer without anyone reloading.
 */
import {
  API_BASE,
  DEMO,
  expect,
  ownerAccessToken,
  openWidget,
  test,
  visitorSends,
  widgetFrame,
} from './fixtures.js';

test.describe('website widgets', () => {
  // FR-MOD-08.5.2: add a site, install the snippet, and watch the row flip to
  // Connected the moment the widget first handshakes from that domain — proven
  // across the real cross-origin boundary. A unique `*.localhost` host keeps the
  // run from colliding with the seeded `acme-bikes.localhost`.
  test('a site goes Connected on the first handshake, from one add', async ({
    browser,
    agentPage,
    organizationId,
  }) => {
    const domain = `widget-check-${Date.now()}.localhost`;

    await agentPage.goto('/app/settings');
    const section = agentPage.getByRole('region', { name: 'Website widgets' });

    // One add: the website *and* its trusted domain, so the widget works there.
    await section.getByLabel('Website domain').fill(domain);
    await section.getByRole('button', { name: 'Add website' }).click();

    const row = section.locator('li').filter({ hasText: domain });
    await expect(row.getByText('Waiting for first message')).toBeVisible();

    // The snippet is revealed straight away and carries the widget bootstrap.
    await expect(section.getByTestId('website-snippet')).toContainText('window.__nexa');
    await agentPage.screenshot({ path: 'kanit/7-website-pending.png', fullPage: true });

    // No dual source: the same action put the domain on the trusted allowlist.
    const trusted = agentPage.getByRole('region', { name: 'Trusted domains' });
    await expect(trusted.getByText(domain)).toBeVisible();

    const visitorContext = await browser.newContext();
    const visitor = await visitorContext.newPage();
    try {
      // A visitor on that very domain sends a message. Sending is what forces
      // the token exchange to complete — the panel opens before it does — and it
      // is that request the server marks the site Connected inside. Opening alone
      // would race the handshake.
      await visitor.goto(`http://${domain}:5174/demo.html?organization_id=${organizationId}`);
      const vf = widgetFrame(visitor);
      await vf.getByRole('button', { name: 'Open chat' }).click();
      await vf.getByRole('textbox', { name: 'Message' }).fill('Testing the widget install');
      await vf.getByRole('button', { name: 'Send' }).click();
      await expect(vf.getByRole('log', { name: 'Conversation' })).toContainText(
        'Testing the widget install',
        { timeout: 20_000 },
      );

      // Back on Settings the row flips to Connected with the KK2 signal. Reload
      // rather than trust the poll: the server-written transition is the claim,
      // and a reload proves it persisted rather than being a screen artefact.
      await agentPage.reload();
      const reloadedSection = agentPage.getByRole('region', { name: 'Website widgets' });
      const connectedRow = reloadedSection.locator('li').filter({ hasText: domain });
      // Not `exact`: the status glyph is concatenated into the same element, so
      // the text reads "●Connected".
      await expect(connectedRow.getByText('Connected')).toBeVisible({ timeout: 20_000 });
      await expect(connectedRow.getByText('Test message received')).toBeVisible();
      await agentPage.screenshot({ path: 'kanit/7-website-connected.png', fullPage: true });
    } finally {
      await visitorContext.close();
      // Remove both the site and the domain it trusted, so nothing accumulates
      // across runs — this test's whole point is that the two move together.
      await agentPage
        .getByRole('region', { name: 'Website widgets' })
        .locator('li')
        .filter({ hasText: domain })
        .getByRole('button', { name: `Remove ${domain}` })
        .click()
        .catch(() => {});
      await agentPage
        .getByRole('region', { name: 'Trusted domains' })
        .locator('li')
        .filter({ hasText: domain })
        .getByRole('button', { name: 'Remove' })
        .click()
        .catch(() => {});
    }
  });
});

test.describe('channels', () => {
  // FR-MOD-08.5.1: a card grid whose Website status is read from the live
  // /websites data (the seed connects one).
  //
  // Every adapter channel (Messenger/WhatsApp/SMS/Instagram/Telegram) is now a
  // live connect surface — WhatsApp (08.5.6-b) was the last one off the fixed
  // "Coming soon" list, so the grid no longer has an unbuilt card to assert
  // against here. WhatsApp's own connect/disconnect form is covered in
  // `Channels.test.tsx`; a full connect-and-see-it-in-the-inbox flow for all
  // three adapter channels together is tm 135.4's `channels.spec.ts`.
  test('shows a channel grid with a data-driven Website status', async ({ agentPage }) => {
    await agentPage.goto('/app/settings');
    const channels = agentPage.getByRole('region', { name: 'Channels' });
    await expect(channels).toBeVisible();

    // The seed has a connected website, so the card must read Connected — a
    // hard-coded label would still say Connected, so the WhatsApp check below
    // (nothing connected there) is what proves the difference, together with
    // the unit tests.
    const website = channels.getByTestId('channel-website');
    await expect(website.getByText('Connected')).toBeVisible();
    await expect(website.getByRole('link', { name: 'Manage' })).toBeVisible();

    // WhatsApp is not connected in the seed, so its card reads Not connected
    // with a Connect action rather than a fixed label.
    const whatsapp = channels.getByTestId('channel-whatsapp');
    await expect(whatsapp.getByText('Not connected')).toBeVisible();
    await expect(whatsapp.getByRole('button', { name: 'Connect' })).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/8-channels-grid.png', fullPage: true });

    // The Chat page is ready to share (FR-MOD-08.5.9) — Get link reveals the URL.
    const chatPage = channels.getByTestId('channel-chat-page');
    await expect(chatPage.getByText('Ready')).toBeVisible();
    await chatPage.getByRole('button', { name: 'Get link' }).click();
    await expect(chatPage.getByTestId('chat-page-url')).toContainText('/chat.html');
  });

  // FR-MOD-08.5.3: Email is Ready, not "Coming soon" — Get address reveals the
  // per-workspace forwarding address a mail provider forwards support mail to.
  test('offers Email as a ready forwarding address', async ({ agentPage }) => {
    await agentPage.goto('/app/settings');
    const channels = agentPage.getByRole('region', { name: 'Channels' });
    await expect(channels).toBeVisible();

    const email = channels.getByTestId('channel-email');
    await expect(email.getByText('Ready')).toBeVisible();
    await email.getByRole('button', { name: 'Get address' }).click();

    const address = email.getByTestId('email-forwarding-address');
    await expect(address).toBeVisible();
    // The address is `<organization_id>@<inbound-domain>`, the same routing key
    // the inbound webhook reads back.
    await expect(address).toContainText('@inbound.');

    await agentPage.screenshot({ path: 'kanit/10-email-channel.png', fullPage: true });
  });

  // FR-MOD-08.5.3, the other half of the acceptance criterion: a workspace can
  // hold more than one forwarding address, and can find out whether one works
  // without waiting for a customer to write in.
  test('adds a second forwarding address and proves it receives', async ({ agentPage }) => {
    await agentPage.goto('/app/settings');
    const email = agentPage.getByRole('region', { name: 'Channels' }).getByTestId('channel-email');
    await email.getByRole('button', { name: 'Manage addresses' }).click();

    const dialog = agentPage.getByRole('dialog', { name: 'Email forwarding addresses' });
    // The address the workspace has always had is still there and still first.
    await expect(dialog.getByText('Default')).toBeVisible();

    // Unique per run: this drives the seeded database, and the same label twice
    // is exactly the collision the endpoint refuses.
    const label = `e2e-${Date.now()}`;
    await dialog.getByLabel('Address name (for example support)').fill(label);
    await dialog.getByRole('button', { name: 'Add address' }).click();

    const row = dialog.getByRole('listitem').filter({ hasText: `+${label}@` });
    await expect(row).toBeVisible();
    await expect(row.getByText('Nothing received yet.')).toBeVisible();

    // The verification action: a real message through the real pipeline.
    await row.getByRole('button', { name: 'Send test message' }).click();
    await expect(dialog.getByText(/Test message delivered to/)).toBeVisible();
    // …and the address now reports its own traffic, which is the evidence that
    // outlives the toast.
    await expect(row.getByText(/1 received/)).toBeVisible();

    await agentPage.screenshot({ path: 'kanit/08.5.3-email-addresses.png', fullPage: true });

    // Put the seeded workspace back: this suite runs against a shared database,
    // and an address per run would accumulate forever. Removing it is also the
    // only place the delete path is driven through the console.
    agentPage.once('dialog', (d) => d.accept());
    await row.getByRole('button', { name: 'Remove' }).click();
    await expect(row).toHaveCount(0);
  });
});

test.describe('settings', () => {
  test('shows the trusted domain the widget actually depends on', async ({ agentPage }) => {
    await agentPage.getByRole('link', { name: 'Settings' }).click();
    await expect(agentPage.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    // Scoped to the allowlist: the seed's domain also appears as a Website widget
    // row above, so an unscoped match would hit two elements.
    await expect(
      agentPage.getByRole('region', { name: 'Trusted domains' }).getByText('acme-bikes.localhost'),
    ).toBeVisible();
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

  // FR-MOD-08.7.1: the tag library. A label curated here is the vocabulary the
  // inbox suggests as an agent tags a conversation, so the two never drift into
  // separate spellings. Created and removed in one test so the seed-skipped
  // tenant does not accumulate tags across runs.
  test('curates a tag in the library', async ({ agentPage }) => {
    await agentPage.goto('/app/settings');

    const section = (): ReturnType<typeof agentPage.getByRole> =>
      agentPage.getByRole('region', { name: 'Tags' });
    await expect(section().getByRole('heading', { name: 'Tags', level: 2 })).toBeVisible();

    const name = `vip-${Date.now().toString().slice(-6)}`;
    await section().getByLabel('Tag', { exact: true }).fill(name);
    await section().getByRole('button', { name: 'Add tag' }).click();

    const row = section().locator('li').filter({ hasText: name });
    await expect(row).toBeVisible();
    // Unscoped tags are workspace-wide, and start unused.
    await expect(row.getByText('All teams · 0 in use')).toBeVisible();

    // Reload rather than trust the redraw: the round trip is the claim.
    await agentPage.reload();
    await expect(section().locator('li').filter({ hasText: name })).toBeVisible();
    await section().screenshot({ path: 'kanit/17-tags-library.png' });

    await section()
      .locator('li')
      .filter({ hasText: name })
      .getByRole('button', { name: `Delete tag ${name}` })
      .click();
    await expect(section().getByText(name)).toHaveCount(0);
  });

  // FR-MOD-08.7.1, group scope: `routes/settings.ts` has accepted and
  // validated `group_ids` on both create and update from the start, but the
  // library screen only ever printed a count — there was no selector to write
  // it with. This proves the column is not dead on either verb: the create
  // payload carries the checked team, and editing an existing tag's scope
  // round-trips through a real PATCH, not just local state.
  test('scopes a tag to a team, on create and on a later edit', async ({ agentPage, request }) => {
    const token = await ownerAccessToken(request);
    const auth = { authorization: `Bearer ${token}` };
    const teamName = `E2E Tag Scope ${Date.now().toString().slice(-6)}`;
    let groupId: number | undefined;
    let tagId: string | undefined;

    try {
      const createdGroup = await request.post(`${API_BASE}/groups`, {
        headers: auth,
        data: { name: teamName },
      });
      expect(createdGroup.ok()).toBe(true);
      groupId = ((await createdGroup.json()) as { id: number }).id;

      await agentPage.goto('/app/settings');
      const section = (): ReturnType<typeof agentPage.getByRole> =>
        agentPage.getByRole('region', { name: 'Tags' });
      await expect(section().getByRole('heading', { name: 'Tags', level: 2 })).toBeVisible();

      const name = `vip-${Date.now().toString().slice(-6)}`;
      await section().getByLabel('Tag', { exact: true }).fill(name);
      const createTeams = section().getByRole('group', { name: 'Teams' });
      await createTeams.getByLabel(teamName, { exact: true }).check();

      const createResponse = agentPage.waitForResponse(
        (r) => r.url().endsWith('/settings/tags') && r.request().method() === 'POST',
      );
      await section().getByRole('button', { name: 'Add tag' }).click();
      const createBody = (await (await createResponse).json()) as {
        id: string;
        group_ids: number[];
      };
      expect(createBody.group_ids).toEqual([groupId]);
      tagId = createBody.id;

      const row = section().locator('li').filter({ hasText: name });
      await expect(row.getByText('1 team · 0 in use')).toBeVisible();

      // Editing an existing tag's team scope exercises the PATCH half.
      await row.getByRole('button', { name: `Edit teams for tag ${name}` }).click();
      const editTeams = row.getByRole('group', { name: `Edit teams for tag ${name}` });
      await editTeams.getByLabel(teamName, { exact: true }).uncheck();
      const patchResponse = agentPage.waitForResponse(
        (r) => r.url().endsWith(`/settings/tags/${tagId}`) && r.request().method() === 'PATCH',
      );
      await editTeams.getByRole('button', { name: 'Save' }).click();
      const patchBody = (await (await patchResponse).json()) as { group_ids: number[] };
      expect(patchBody.group_ids).toEqual([]);
      await expect(row.getByText('All teams · 0 in use')).toBeVisible();

      await row.getByRole('button', { name: `Delete tag ${name}` }).click();
      await expect(section().getByText(name)).toHaveCount(0);
      tagId = undefined;
    } finally {
      if (tagId) {
        await request
          .delete(`${API_BASE}/settings/tags/${tagId}`, { headers: auth })
          .catch(() => {});
      }
      if (groupId) {
        await request.delete(`${API_BASE}/groups/${groupId}`, { headers: auth }).catch(() => {});
      }
    }
  });

  // FR-MOD-08.7.2: `canned_responses.group_id` and `.visibility` were columns
  // nothing read or wrote. This drives the whole loop through the real stack —
  // the console writes the pair, and a narrowly scoped credential proves the
  // *server* is what hides the reply, not the screen.
  test('scopes a saved reply to a team, and hides it from outside that team', async ({
    agentPage,
    request,
  }) => {
    const token = await ownerAccessToken(request);
    const auth = { authorization: `Bearer ${token}` };
    const stamp = Date.now().toString().slice(-6);
    const teamName = `E2E Reply Scope ${stamp}`;
    const shortcut = `teamonly${stamp}`;
    let groupId: number | undefined;
    let replyId: string | undefined;

    /**
     * What an ordinary agent's session would see. The owner is in no team, so a
     * credential holding only `canned_responses--groups:ro` gets the
     * workspace-wide replies and nothing else — which is exactly the reach the
     * `#` picker has.
     */
    const scopedToken = await request.post(`${API_BASE}/auth/personal-access-tokens`, {
      headers: auth,
      data: { name: `e2e reply scope ${stamp}`, scopes: ['canned_responses--groups:ro'] },
    });
    expect(scopedToken.ok()).toBe(true);
    const { token: narrow, id: narrowId } = (await scopedToken.json()) as {
      token: string;
      id: string;
    };

    const shortcutsAsAgent = async (): Promise<string[]> => {
      const res = await request.get(`${API_BASE}/settings/canned-responses?scope=chat`, {
        headers: { authorization: `Bearer ${narrow}` },
      });
      expect(res.ok()).toBe(true);
      return ((await res.json()) as { items: Array<{ shortcut: string }> }).items.map(
        (i) => i.shortcut,
      );
    };

    try {
      const createdGroup = await request.post(`${API_BASE}/groups`, {
        headers: auth,
        data: { name: teamName },
      });
      expect(createdGroup.ok()).toBe(true);
      groupId = ((await createdGroup.json()) as { id: number }).id;

      await agentPage.goto('/app/settings');
      const section = (): ReturnType<typeof agentPage.getByRole> =>
        agentPage.getByRole('region', { name: 'Saved replies' });
      await expect(
        section().getByRole('heading', { name: 'Saved replies', level: 2 }),
      ).toBeVisible();

      await section().getByLabel('Shortcut').fill(shortcut);
      await section().getByLabel('Reply', { exact: true }).fill('Team-only answer.');
      await section().getByLabel('Team', { exact: true }).selectOption({ label: teamName });

      const createResponse = agentPage.waitForResponse(
        (r) => r.url().includes('/settings/canned-responses') && r.request().method() === 'POST',
      );
      await section().getByRole('button', { name: 'Save reply' }).click();
      const createBody = (await (await createResponse).json()) as {
        id: string;
        visibility: string;
        group_id: number | null;
      };
      // The pair goes out whole — half of it is a 400.
      expect(createBody).toMatchObject({ visibility: 'group', group_id: groupId });
      replyId = createBody.id;

      const row = section()
        .locator('li')
        .filter({ hasText: `#${shortcut}` });
      await expect(row.getByText(`${teamName} only`)).toBeVisible();
      await section().screenshot({ path: 'kanit/08.7.2-canned-team-scope.png' });

      // The load-bearing assertion: the text never reaches a caller outside the
      // team, so no client-side rule is standing between it and them.
      expect(await shortcutsAsAgent()).not.toContain(shortcut);

      // Widening it back exercises the PATCH half; "All teams" clears the team
      // on its own.
      await row.getByRole('button', { name: `Edit team for #${shortcut}` }).click();
      const patchResponse = agentPage.waitForResponse(
        (r) =>
          r.url().endsWith(`/settings/canned-responses/${replyId}`) &&
          r.request().method() === 'PATCH',
      );
      await row.getByLabel(`Team for #${shortcut}`).selectOption({ label: 'All teams' });
      await row.getByRole('button', { name: 'Save', exact: true }).click();
      const patchBody = (await (await patchResponse).json()) as {
        visibility: string;
        group_id: number | null;
      };
      expect(patchBody).toMatchObject({ visibility: 'all', group_id: null });
      await expect(row.getByText('All teams')).toBeVisible();

      expect(await shortcutsAsAgent()).toContain(shortcut);

      await row.getByRole('button', { name: `Delete #${shortcut}` }).click();
      await expect(section().getByText(`#${shortcut}`)).toHaveCount(0);
      replyId = undefined;
    } finally {
      // The reply first: while one is scoped to the team, deleting the team is
      // refused with `group_in_use` — the refusal this feature added.
      if (replyId) {
        await request
          .delete(`${API_BASE}/settings/canned-responses/${replyId}`, { headers: auth })
          .catch(() => {});
      }
      if (groupId) {
        await request.delete(`${API_BASE}/groups/${groupId}`, { headers: auth }).catch(() => {});
      }
      await request
        .delete(`${API_BASE}/auth/personal-access-tokens/${narrowId}`, { headers: auth })
        .catch(() => {});
    }
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
          response.url().endsWith('/settings/security') && response.request().method() === 'PATCH',
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

  /**
   * IP allowlist (FR-MOD-08.9.6). The CRUD an admin drives from Settings, proven
   * end to end: add an entry, see it listed, remove it, and the section falls
   * back to its empty state.
   *
   * Enforcement is left OFF on purpose (08.9.6-i): switching it on from a browser
   * the server cannot re-admit would lock this very session out of its own
   * console — the availability risk the whole feature carries. The entry added is
   * a loopback range so the server's self-lockout guard admits the save: the E2E
   * session reaches the API from 127.0.0.1 (the API binds 0.0.0.0, so the
   * dev-proxied call lands on IPv4 loopback), and the guard refuses any list that
   * would exclude the caller's own address.
   */
  test('adds and removes an IP allowlist entry', async ({ agentPage }) => {
    await agentPage.goto('/app/settings');

    const section = (): ReturnType<typeof agentPage.getByRole> =>
      agentPage.getByRole('region', { name: 'IP allowlist' });
    await expect(section().getByRole('heading', { name: 'IP allowlist', level: 2 })).toBeVisible();

    const range = '127.0.0.0/8';

    await section().getByLabel('Address or CIDR range').fill(range);
    await section().getByLabel('Label (optional)').fill('E2E loopback');

    // Wait for the POST, not the redraw: a reload racing the request would read
    // the previous (empty) list back — the flake the file-sharing test above hit.
    const added = agentPage.waitForResponse(
      (response) =>
        response.url().endsWith('/settings/ip-allowlist') && response.request().method() === 'POST',
    );
    await section().getByRole('button', { name: 'Add entry' }).click();
    expect((await added).status()).toBe(201);

    await expect(section().locator('li').filter({ hasText: range })).toBeVisible();

    // Survives a reload — persisted server-side, not just added to the list on
    // screen.
    await agentPage.reload();
    await expect(section().locator('li').filter({ hasText: range })).toBeVisible();
    await section().screenshot({ path: 'kanit/80.9-ip-allowlist.png' });

    // Remove it, and the section returns to its empty state. This tenant carries
    // no seeded entries and the test leaves nothing behind, so the empty state is
    // the true steady state — the change actually refused a row, it did not just
    // repaint.
    const removed = agentPage.waitForResponse(
      (response) =>
        response.url().includes('/settings/ip-allowlist/') &&
        response.request().method() === 'DELETE',
    );
    await section()
      .locator('li')
      .filter({ hasText: range })
      .getByRole('button', { name: 'Remove' })
      .click();
    expect((await removed).status()).toBe(204);
    await expect(section().getByText('No allowlist entries')).toBeVisible();
  });

  /**
   * Scheduled exports (PRD §5.3-Reports, FR-MOD-07.7) — the screen half of the
   * chain whose backend halves are proved in the API suites.
   *
   * What only a browser can show is that the pieces line up: the report
   * catalogue really fills the picker, the roster really fills the recipients,
   * the definition survives a reload, and cancelling takes it away again. The
   * seed carries one schedule of its own (M-SEED-b, 07.9 — a weekly Overview
   * mailed to the owner), so this proves the round trip against that real
   * steady state rather than an artificial empty one: create a second
   * schedule, prove it independently, cancel only it, and leave the seeded row
   * exactly as it was for the next run.
   */
  test('schedules a report export and cancels it back to the seeded state', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/settings');

    // Re-resolved after each reload: the old handle points at a detached node.
    const section = (): ReturnType<typeof agentPage.getByRole> =>
      agentPage.getByRole('region', { name: 'Scheduled exports' });
    const seededRow = (): ReturnType<typeof agentPage.locator> =>
      section().locator('li').filter({ hasText: 'Overview' });

    await expect(
      section().getByRole('heading', { name: 'Scheduled exports', level: 2 }),
    ).toBeVisible();
    await expect(seededRow()).toBeVisible();

    // Nothing is submittable until both halves of the decision are made — a
    // schedule with no report or no recipient is a timer that mails nothing.
    const submit = section().getByRole('button', { name: 'Schedule export' });
    await expect(submit).toBeDisabled();

    await section().getByLabel('Report').selectOption({ label: 'Leads' });
    await section().getByLabel('Frequency').selectOption('weekly');
    await expect(submit).toBeDisabled();
    await section().locator('input[type="checkbox"]').first().check();
    await expect(submit).toBeEnabled();

    // Wait for the POST rather than the redraw: a reload racing the request
    // would read the previous (empty) list back.
    const created = agentPage.waitForResponse(
      (response) =>
        response.url().endsWith('/reports/scheduled-exports') &&
        response.request().method() === 'POST',
    );
    await submit.click();
    expect((await created).status()).toBe(201);

    const row = (): ReturnType<typeof agentPage.locator> =>
      section().locator('li').filter({ hasText: 'Leads' });
    await expect(row()).toBeVisible();
    // Cadence and fan-out are on the row, and the badge is honest about a
    // schedule the sweep has not reached yet.
    await expect(row()).toContainText('Weekly');
    await expect(row()).toContainText('1 recipient');
    await expect(row().getByText('Never run')).toBeVisible();

    // Survives a reload — persisted server-side, not just added to the list on
    // screen.
    await agentPage.reload();
    await expect(row()).toBeVisible();
    await section().screenshot({ path: 'kanit/94.10-scheduled-exports.png' });

    // Cancelling is two steps on purpose: this deletes the delivery history with
    // the definition, so a mis-click is not recoverable.
    await row().getByRole('button', { name: 'Cancel Leads export' }).click();
    const removed = agentPage.waitForResponse(
      (response) =>
        response.url().includes('/reports/scheduled-exports/') &&
        response.request().method() === 'DELETE',
    );
    await row().getByRole('button', { name: 'Confirm cancel' }).click();
    expect((await removed).status()).toBe(204);

    // Only what this test added is gone; the seed's own schedule survives for
    // the next run.
    await expect(row()).toHaveCount(0);
    await expect(seededRow()).toBeVisible();
  });

  /**
   * The permission half of FR-MOD-07.7's KK ("izin bazlı görünürlük"), proven
   * against a real non-owner session rather than a mocked scope list.
   *
   * An agent does not hold `reports_manage`, and the API gates even the *list* on
   * it — a definition names the mailboxes a workspace's figures go to. So the
   * right outcome is not a read-only list: it is no list and no action at all.
   * Asserting the refusal notice as well as the absent controls is what
   * separates "the server refused" from "the screen forgot to render".
   */
  test('offers an agent no way to schedule or cancel an export', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // `agent2` deliberately, not `agent1`: the seed's first Acme agent is an
      // *admin* (Sam Rivera) and carries ADMIN_SCOPES, so it would prove the
      // opposite of what this test claims. Priya Nair holds the plain agent role.
      await page.goto('/');
      await page.getByLabel('Email').fill('agent2@acme.localhost');
      await page.getByLabel('Password').fill(DEMO.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByRole('link', { name: 'Inbox' })).toBeVisible();

      await page.goto('/app/settings');
      const section = page.getByRole('region', { name: 'Scheduled exports' });
      await expect(
        section.getByRole('heading', { name: 'Scheduled exports', level: 2 }),
      ).toBeVisible();

      await expect(section.getByText('Could not load scheduled exports.')).toBeVisible();
      await expect(section.getByRole('button', { name: 'Schedule export' })).toHaveCount(0);
      await expect(section.getByLabel('Report')).toHaveCount(0);
      await expect(section.getByRole('button', { name: /Cancel .* export/ })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  // FR-MOD-08.8.3-g: the MCP connection screen — the KK is literally "mcp URL +
  // Copy + Claude setup + örnek prompt", so this proves all four render together
  // on the real Settings page, fed by the live manifest (08.8.3-b).
  test('shows the MCP server connection details', async ({ agentPage }) => {
    await agentPage.goto('/app/settings');

    const section = agentPage.getByRole('region', { name: 'MCP server' });
    await expect(section).toBeVisible();

    // mcp URL + Copy
    await expect(section.getByLabel('MCP server URL')).toHaveValue(/\/mcp$/);
    await expect(section.getByRole('button', { name: 'Copy' })).toBeVisible();

    // Claude setup — collapsed by default, opens on click
    const setupToggle = section.getByRole('button', { name: 'Claude setup' });
    await expect(setupToggle).toHaveAttribute('aria-expanded', 'false');
    await setupToggle.click();
    await expect(setupToggle).toHaveAttribute('aria-expanded', 'true');

    // örnek prompt
    await expect(
      section.getByText('Find all tickets where customers ask about bulk orders'),
    ).toBeVisible();

    await section.screenshot({ path: 'kanit/67.7-mcp-connection.png' });
  });

  /**
   * The Sales tracker switch actually governs the report (FR-MOD-13.5, KK
   * "İzleme yapılandırması" ↔ "Reports Ecommerce ile ilişki").
   *
   * The positive direction — an order reported by the tracking code reaching the
   * Ecommerce KPIs — is `reports.spec.ts`'s job. This is the half that proves
   * the figures are *governed* rather than merely present: turned off, the same
   * screen must fall back to the honest "not set up" state with its CTA, not
   * keep quoting numbers nothing is feeding any more, and not show a fabricated
   * zero either.
   *
   * The workspace is left tracking again at the end, through the same form, so
   * the assertion is symmetric and later spec files see the seeded fixture they
   * expect. The `finally` restores it through the API as well, because a failure
   * halfway through would otherwise leave every later file looking at a
   * workspace this test switched off.
   */
  test('turning the sales tracker off returns Reports to the honest empty state (13.5)', async ({
    agentPage,
    request,
  }) => {
    const token = await ownerAccessToken(request);
    const setTracking = (enabled: boolean) =>
      request.put(`${API_BASE}/settings/sales-tracker`, {
        headers: { authorization: `Bearer ${token}` },
        data: { enabled },
      });

    try {
      // Reached through the CTA's own anchor (13.5-e/-f), so this is the link
      // the empty state below points at, not a URL the test invented.
      await agentPage.goto('/app/settings#section-sales-tracker');
      const section = agentPage.getByRole('region', { name: 'Sales tracker' });
      await expect(section).toBeVisible();

      const toggle = section.getByRole('checkbox', { name: /Track sales/ });
      await expect(toggle).toBeChecked();
      await toggle.uncheck();
      await section.getByRole('button', { name: 'Save' }).click();
      await expect(section.getByText(/^Saved\./)).toBeVisible();

      // A real navigation, so the report is fetched again rather than served
      // from the query cache the settings screen never invalidated.
      await agentPage.goto('/app/reports');
      await agentPage.getByRole('tab', { name: 'Reviews' }).click();
      const ecommerce = agentPage.getByRole('region', { name: 'Ecommerce' });
      await expect(ecommerce.getByText('Sales tracking not set up')).toBeVisible();

      // Genuinely the empty state — not the KPI grid left showing zeros, which
      // is the failure mode "honest" is guarding against (FR-EK-B.1).
      await expect(ecommerce.getByText('Tracked sales', { exact: true })).toHaveCount(0);
      const cta = ecommerce.getByRole('link', { name: 'Configure sales platforms' });
      await expect(cta).toHaveAttribute('href', '/app/settings#section-sales-tracker');
      await agentPage.screenshot({ path: 'kanit/13.5-reports-not-configured.png', fullPage: true });

      // --- And back on again, through the same form -------------------------
      await agentPage.goto('/app/settings#section-sales-tracker');
      await agentPage.getByRole('checkbox', { name: /Track sales/ }).check();
      await agentPage
        .getByRole('region', { name: 'Sales tracker' })
        .getByRole('button', { name: 'Save' })
        .click();

      await agentPage.goto('/app/reports');
      await agentPage.getByRole('tab', { name: 'Reviews' }).click();
      // `exact`, because the section's own description ends "…(PRD §7.8,
      // tracked sales §13.5)" and the default substring match is
      // case-insensitive — it would resolve to the paragraph as well as the KPI.
      await expect(
        agentPage
          .getByRole('region', { name: 'Ecommerce' })
          .getByText('Tracked sales', { exact: true }),
      ).toBeVisible();
    } finally {
      const restored = await setTracking(true);
      expect(restored.ok(), `could not restore sales tracking: ${restored.status()}`).toBe(true);
    }
  });

  /**
   * Chat timeout (FR-MOD-08.7.3, M-UI-GAP tm 136.1). The idle-close sweep has
   * run since tm 48; `GET/PUT /settings/chat-timeout` had no caller until this
   * screen. A round trip through the amount+unit picker, not the optimistic
   * cache, is the claim — the seeded workspace never enables this, so the
   * window is restored to off no matter how the test ends.
   */
  test('saves the idle auto-close window through the amount+unit picker and survives a reload (08.7.3)', async ({
    agentPage,
    request,
  }) => {
    const token = await ownerAccessToken(request);
    const setChatTimeout = (seconds: number | null) =>
      request.put(`${API_BASE}/settings/chat-timeout`, {
        headers: { authorization: `Bearer ${token}` },
        data: { chat_timeout_seconds: seconds },
      });

    try {
      await agentPage.goto('/app/settings#section-chat-timeout');
      const section = agentPage.getByRole('region', { name: 'Chat timeout' });
      await expect(section).toBeVisible();

      const toggle = section.getByRole('checkbox', { name: /Automatically close idle chats/ });
      await expect(toggle).not.toBeChecked();
      await toggle.check();
      await section.getByLabel('Idle for').fill('2');
      await section.getByLabel('Unit').selectOption('hours');

      const saved = agentPage.waitForResponse(
        (response) =>
          response.url().endsWith('/settings/chat-timeout') &&
          response.request().method() === 'PUT',
      );
      await section.getByRole('button', { name: 'Save' }).click();
      expect((await saved).status()).toBe(200);

      // Reload rather than trusting the optimistic cache: the round trip is
      // the claim, not the redraw.
      await agentPage.reload();
      const reloaded = agentPage.getByRole('region', { name: 'Chat timeout' });
      await expect(
        reloaded.getByRole('checkbox', { name: /Automatically close idle chats/ }),
      ).toBeChecked();
      await expect(reloaded.getByLabel('Idle for')).toHaveValue('2');
      await expect(reloaded.getByLabel('Unit')).toHaveValue('hours');
      await reloaded.screenshot({ path: 'kanit/136.1-chat-timeout-kaydedildi.png' });
    } finally {
      const restored = await setChatTimeout(null);
      expect(restored.ok(), `could not restore chat timeout: ${restored.status()}`).toBe(true);
    }
  });
});

/**
 * Company details (FR-MOD-08.3 · M-CO-b).
 *
 * The round trip an admin actually performs: change the sector, the address and
 * the workspace clock, and read all three back after a full reload rather than
 * trusting the redraw.
 *
 * The *timezone decision* this section carries — that the company zone seeds an
 * agent's work schedule instead of a hard-coded `UTC` — is proven in
 * `apps/api/test/integration/work-schedule.test.ts` rather than here, and
 * deliberately: it is only observable on an agent who has never saved a week,
 * and this suite shares one seeded tenant with `staffing.spec.ts`, which saves
 * one. An assertion whose truth depends on which spec ran first is not a test.
 *
 * The clock is put back at the end because the tenant is shared — the same
 * courtesy the chat-timeout test above pays.
 */
test.describe('company details', () => {
  test('saves the sector, address and workspace clock, and reads them back', async ({
    agentPage,
  }) => {
    await agentPage.goto('/app/settings');

    const section = (): ReturnType<typeof agentPage.getByRole> =>
      agentPage.getByRole('region', { name: 'Company details' });
    await expect(
      section().getByRole('heading', { name: 'Company details', level: 2 }),
    ).toBeVisible();

    // The name is left alone on purpose: it is the seeded workspace's own, and
    // other specs read it off the widget and the public knowledge base.
    await expect(section().getByLabel('Company name')).toHaveValue('Acme Bikes');

    const address = `1 Market Street, Istanbul · ${Date.now()}`;
    await section().getByLabel('Sector').selectOption('ecommerce_retail');
    await section().getByLabel('Address').fill(address);
    await section().getByLabel('Time zone').selectOption('Europe/Istanbul');

    try {
      // Wait for the PATCH, not the repaint — a reload racing the request would
      // read the previous values back.
      const saved = agentPage.waitForResponse(
        (response) =>
          response.url().endsWith('/settings/company') && response.request().method() === 'PATCH',
      );
      await section().getByRole('button', { name: 'Save' }).click();
      expect((await saved).status()).toBe(200);

      // Saving a zone states what it did *not* do — the schedules already saved
      // keep theirs (see the module doc on `CompanyDetails.tsx`).
      await expect(section().getByText(/keep the zone they were saved with/)).toBeVisible();

      await agentPage.reload();
      await expect(section().getByLabel('Sector')).toHaveValue('ecommerce_retail');
      await expect(section().getByLabel('Address')).toHaveValue(address);
      await expect(section().getByLabel('Time zone')).toHaveValue('Europe/Istanbul');
      await section().screenshot({ path: 'kanit/08.3-company.png' });
    } finally {
      const token = await ownerAccessToken(agentPage.request);
      const restored = await agentPage.request.patch(`${API_BASE}/settings/company`, {
        headers: { authorization: `Bearer ${token}` },
        data: { timezone: 'UTC' },
      });
      expect(restored.ok(), `could not restore the company timezone: ${restored.status()}`).toBe(
        true,
      );
    }
  });
});

test.describe('personal access tokens', () => {
  /**
   * FR-MOD-08.8.2 · M-UI-b — the loop the audit measured as broken at the
   * console end: `routes/auth.ts` could mint, list and revoke a PAT, and
   * `apps/web` never called any of it, so a credential the API documents was
   * unobtainable to the person the API belongs to.
   *
   * The claim is not "a screen renders". It is that a token created *through the
   * console* is a working API credential with exactly the scopes that were
   * ticked, and that revoking it *through the console* kills it — so the
   * request that answered 200 answers 401 afterwards. Both halves are made
   * against the real API with the real plaintext, which the browser shows
   * exactly once.
   */
  test('mints a working token from the console, then revokes it into a 401', async ({
    agentPage,
    request,
  }) => {
    await agentPage.goto('/app/settings');
    const section = agentPage.getByRole('region', { name: 'Personal access tokens' });
    await expect(
      section.getByRole('heading', { name: 'Personal access tokens', level: 2 }),
    ).toBeVisible();

    const name = `e2e-pat-${Date.now().toString().slice(-6)}`;
    await section.getByLabel('Token name').fill(name);

    // The picker offers the session's own scopes and nothing wider — a token
    // cannot be stronger than the session minting it.
    const scopes = section.getByRole('group', { name: 'Scopes' });
    await expect(scopes.getByLabel('reports_read', { exact: true })).toBeVisible();
    await expect(scopes.getByLabel('chats--all:rw', { exact: true })).toBeVisible();
    await scopes.getByLabel('reports_read', { exact: true }).check();

    await section.getByRole('button', { name: 'Create token' }).click();

    // Shown once, and the panel says so.
    const panel = agentPage.getByRole('dialog');
    await expect(panel.getByText('This token will not be shown again.')).toBeVisible();
    const secret = (await panel.getByTestId('pat-token').innerText()).trim();
    expect(secret.length).toBeGreaterThan(20);
    await agentPage.screenshot({ path: 'kanit/08.8.2-pat-shown-once.png', fullPage: true });
    await panel.getByRole('button', { name: 'Done' }).click();
    // Closing discards it: the plaintext is in component state and nowhere else.
    await expect(agentPage.getByTestId('pat-token')).toHaveCount(0);

    const row = section.locator('li').filter({ hasText: name });
    await expect(row).toBeVisible();

    // It is a real credential — and it carries exactly the one scope that was
    // ticked, which is the PRD's "scope oluşturmada sabitlenir".
    const asToken = await request.get(`${API_BASE}/auth/me`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(asToken.status()).toBe(200);
    expect(((await asToken.json()) as { scopes: string[] }).scopes).toEqual(['reports_read']);

    await row.getByRole('button', { name: `Revoke token ${name}` }).click();
    const confirm = agentPage.getByRole('dialog');
    await confirm.getByRole('button', { name: 'Revoke token' }).click();
    await expect(section.locator('li').filter({ hasText: name })).toHaveCount(0);

    // Same request, same token, after the console revoked it.
    const afterRevoke = await request.get(`${API_BASE}/auth/me`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(afterRevoke.status()).toBe(401);
  });
});

test.describe('routing rules', () => {
  /**
   * FR-MOD-08.6.1 · M-UI-c — the "New rule" half. `/settings/routing-rules`
   * served GET and PATCH only, so a workspace could turn its seeded rules on
   * and off and never add or remove one: routing was configurable exactly as
   * far as the seed had already configured it.
   *
   * The claim is the interaction with team deletion, not that a row appears.
   * `DELETE /groups/{id}` refuses (409 `group_in_use`) while any rule targets
   * the team — that refusal is the only thing standing between a delete and
   * silently unroutable chats, and until now the console had no way to lift it.
   * So: create the rule *through the console*, watch the team delete refuse,
   * delete the rule *through the console*, watch the same delete go through.
   */
  test('adds a rule from the console, and deleting it frees the team it pinned', async ({
    agentPage,
    request,
  }) => {
    const token = await ownerAccessToken(request);
    const auth = { authorization: `Bearer ${token}` };
    const teamName = `Routing e2e ${Date.now().toString().slice(-6)}`;
    const ruleName = `Pricing ${Date.now().toString().slice(-6)}`;
    let groupId: number | undefined;

    const created = await request.post(`${API_BASE}/groups`, {
      headers: auth,
      data: { name: teamName },
    });
    expect(created.ok(), `team create failed: ${created.status()} ${await created.text()}`).toBe(
      true,
    );
    groupId = ((await created.json()) as { id: number }).id;

    try {
      await agentPage.goto('/app/settings');
      const section = agentPage.getByRole('region', { name: 'Routing' });
      await expect(section.getByRole('heading', { name: 'Routing', level: 2 })).toBeVisible();

      await section.getByLabel('Rule name').fill(ruleName);
      await section.getByLabel('When the page URL contains').fill('/pricing');
      await section.getByLabel('Send to team').selectOption({ label: teamName });
      await section.getByLabel('Priority').fill('7');
      await section.getByRole('button', { name: 'Add rule' }).click();

      const row = section.locator('li').filter({ hasText: ruleName });
      await expect(row).toBeVisible();
      await expect(row).toContainText(`url contains /pricing → ${teamName}`);
      await agentPage.screenshot({ path: 'kanit/08.6.1-routing-rule-added.png', fullPage: true });

      // The team is now pinned by the rule the console just wrote.
      const refused = await request.delete(`${API_BASE}/groups/${groupId}`, { headers: auth });
      expect(refused.status()).toBe(409);
      expect(((await refused.json()) as { error: { type: string } }).error.type).toBe(
        'group_in_use',
      );

      // The fallback is not deletable from here — deleting it would simply be
      // the way around the refusal to disable it.
      await expect(
        section.getByRole('button', { name: 'Delete rule Everything else' }),
      ).toBeDisabled();

      await row.getByRole('button', { name: `Delete rule ${ruleName}` }).click();
      await expect(section.locator('li').filter({ hasText: ruleName })).toHaveCount(0);

      // Same request, same team, after the console removed the rule.
      const allowed = await request.delete(`${API_BASE}/groups/${groupId}`, { headers: auth });
      expect(allowed.status()).toBe(204);
      groupId = undefined;
    } finally {
      if (groupId) {
        await request.delete(`${API_BASE}/groups/${groupId}`, { headers: auth }).catch(() => {});
      }
    }
  });
});

test.describe('audit log', () => {
  // NFR-S12 / 08.9.7-j: the trail's own most basic entry — signing in — is
  // what proves it is actually being written, end to end. The `agentPage`
  // fixture's sign-in happens moments before this test runs, so it is well
  // inside the default 30-day window and sorts first (newest first).
  test('shows the owner’s own sign-in in the audit trail', async ({ agentPage }) => {
    await agentPage.goto('/app/settings');
    await agentPage.getByRole('link', { name: 'Open audit log' }).click();

    await expect(agentPage.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    const table = agentPage.getByRole('table', { name: 'Audit log' });
    await expect(table.getByText('auth.login').first()).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/92.10-audit-log.png', fullPage: true });
  });

  // NFR-S12 / 08.9.7-k: the trail names four event families — sign-in (above),
  // role change, data deletion and *webhook change*. This proves the last one
  // end to end. Register then remove a webhook through the API (the owner
  // session holds `webhooks--all:rw`), then read it back on the very screen an
  // admin uses. The action filter runs server-side, so the row is found however
  // many other entries a busy run has piled onto this shared tenant.
  test('shows a webhook change in the audit trail', async ({ agentPage, request }) => {
    const token = await ownerAccessToken(request);
    const auth = { authorization: `Bearer ${token}` };

    const created = await request.post(`${API_BASE}/webhooks`, {
      headers: auth,
      data: { url: 'https://hooks.audit-e2e.example/receiver', action: 'chat_started' },
    });
    expect(created.ok(), `webhook create failed: ${created.status()} ${await created.text()}`).toBe(
      true,
    );
    const { id } = (await created.json()) as { id: string };
    // Remove it straight away — that both keeps the tenant tidy and writes the
    // second half of "webhook değişimi" (webhook.deleted) to the trail.
    const removed = await request.delete(`${API_BASE}/webhooks/${id}`, { headers: auth });
    expect(removed.status()).toBe(204);

    await agentPage.goto('/app/settings');
    await agentPage.getByRole('link', { name: 'Open audit log' }).click();
    await expect(agentPage.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();

    const table = agentPage.getByRole('table', { name: 'Audit log' });
    // Filter to the created event — a server-side query, so page size cannot
    // hide the row behind the day's other activity.
    await agentPage.getByLabel('Filter by action').selectOption('webhook.created');
    await expect(table.getByText('webhook.created').first()).toBeVisible();
    await agentPage.screenshot({ path: 'kanit/92.11-audit-webhook.png', fullPage: true });
  });

  /**
   * 08.9.7 · M-UI-e — the entry's `metadata`, which the API has returned since
   * 08.9.7-a and no screen has ever shown.
   *
   * The webhook registration is the clearest case to prove it on, because the
   * writer's field-level decision is visible from the outside: `webhooks.ts`
   * records `url_host` and deliberately keeps the full URL and the plaintext
   * secret out of the append-only log. So the expanded row must show the host
   * (the detail an incident reviewer needs) and must *not* show the path (which
   * was never written) — which is also the assertion that the screen is
   * displaying the stored record rather than reconstructing anything.
   */
  test('expands a row to reveal what the entry recorded, and what it deliberately did not', async ({
    agentPage,
    request,
  }) => {
    const token = await ownerAccessToken(request);
    const auth = { authorization: `Bearer ${token}` };
    const host = `detail-${Date.now().toString().slice(-8)}.example`;

    const created = await request.post(`${API_BASE}/webhooks`, {
      headers: auth,
      data: { url: `https://${host}/secret-receiver-path`, action: 'chat_started' },
    });
    expect(created.ok(), `webhook create failed: ${created.status()} ${await created.text()}`).toBe(
      true,
    );
    const { id } = (await created.json()) as { id: string };

    await agentPage.goto('/app/settings/audit-log');
    await expect(agentPage.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
    // Server-side filter, so the row is the newest `webhook.created` however
    // much else this shared tenant has logged today.
    await agentPage.getByLabel('Filter by action').selectOption('webhook.created');

    const table = agentPage.getByRole('table', { name: 'Audit log' });
    await expect(table.getByText('webhook.created').first()).toBeVisible();

    const toggle = agentPage
      .getByRole('button', { name: /^Detail for webhook\.created at / })
      .first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Recorded, and now legible: the metadata keys as labelled pairs.
    await expect(agentPage.getByText('url_host', { exact: true })).toBeVisible();
    await expect(agentPage.getByText(host, { exact: true })).toBeVisible();
    await expect(agentPage.getByText('chat_started', { exact: true }).first()).toBeVisible();
    // Never recorded, so never shown — the write-time decision, proved from the
    // outside rather than asserted on the writer.
    await expect(agentPage.getByText('secret-receiver-path')).toHaveCount(0);

    // The expansion is a link: the id is in the URL, so an admin can paste it
    // into an incident ticket and it reopens on exactly this entry.
    await expect(agentPage).toHaveURL(/[?&]entry=[0-9a-f-]{36}/);
    await agentPage.screenshot({ path: 'kanit/92.12-audit-entry-detail.png', fullPage: true });

    await request.delete(`${API_BASE}/webhooks/${id}`, { headers: auth });
  });
});

test.describe('composer shortcuts', () => {
  test('a reply saved in Settings reaches a customer through #', async ({
    browser,
    agentPage,
    organizationId,
  }) => {
    const shortcut = `promo${Date.now().toString().slice(-6)}`;
    const replyText = `Free shipping this week — ${Date.now().toString().slice(-6)}`;

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

      const question = `Do you ship free? ${Date.now().toString().slice(-6)}`;
      await openWidget(visitor, organizationId);
      await visitorSends(visitor, question);

      const list = agentPage.getByRole('region', { name: 'Conversations' });
      await expect(list).toContainText(question, { timeout: 20_000 });
      await list.getByRole('button').first().click();

      // 3. The agent types the shortcut. No reload anywhere — the composer's
      //    cache was invalidated when Settings saved.
      const composer = agentPage.getByPlaceholder('Type your reply');
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

    const composer = agentPage.getByPlaceholder('Type your reply');
    await composer.fill('see example.com/page#anchor');
    await expect(agentPage.getByRole('listbox', { name: 'Saved replies' })).toHaveCount(0);

    await composer.fill('#hel');
    await expect(agentPage.getByRole('listbox', { name: 'Saved replies' })).toBeVisible();
  });
});
