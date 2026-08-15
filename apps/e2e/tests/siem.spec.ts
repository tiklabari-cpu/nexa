/**
 * The audit trail's way out of the running deployment (NFR-C6 · C6-g).
 *
 * Everything below this file proves the SIEM export against a server the test
 * started itself, usually from rows the test planted: `siem-export.test.ts`
 * drives the pull endpoint, `audit-chain.test.ts` the hashes, `siem-sink.test.ts`
 * the delivery job, and `SiemExport.test.tsx` the screen against a mocked API.
 * Those suites are the detailed ones and stay the detailed ones.
 *
 * What none of them can show is the loop closing on the *deployment*: an
 * administrator ticks a box in a browser, and the record of that act comes back
 * out of the feed, in order, joined to the chain, from processes started the way
 * a developer starts them. Three things have to be true at once for that, and
 * each is a separate failure if it is not:
 *
 *   1. the screen writes through to the real setting (C6-f → C6-b);
 *   2. the act is audited and chained by the route that performed it (C6-a2 →
 *      C6-c) — not by a helper the test called;
 *   3. the feed hands it back, linked to the entry before it, and says the page
 *      verified (C6-b → C6-c).
 *
 * The horizon is why this file is slower than it looks. The export deliberately
 * refuses to read right up to the present — an entry is exportable a few seconds
 * after it happens, so that no in-flight transaction can commit behind the
 * cursor and be lost. Waiting that out is not a workaround; it is the property
 * being observed, and a suite that mocked the clock would not have seen it.
 *
 * NOT covered here, and deliberately: the `siem_export` entitlement refusal.
 * That gate is built in `11.5-b` (tm 84), which has not run yet — see this
 * slice's handoff note.
 */
import { expect, test } from './fixtures.js';
import { ACME_OWNER, API_BASE, NORTHWIND_OWNER, ownerAccessTokenFor } from './fixtures.js';
import type { APIRequestContext } from '@playwright/test';

/** One line of the NDJSON feed, as a consumer receives it. */
interface ExportRecord {
  id: string;
  license_id: string;
  action: string;
  actor_type: string;
  created_at: string;
  metadata: Record<string, unknown>;
  chain_seq: number | null;
  prev_hash: string | null;
  hash: string | null;
}

interface ExportPage {
  records: ExportRecord[];
  cursor: string;
  hasMore: boolean;
  chainOk: boolean;
}

/** One page of the feed, with the headers that carry the position and the verdict. */
async function exportPage(
  request: APIRequestContext,
  token: string,
  cursor?: string,
): Promise<ExportPage> {
  const query = cursor ? `?limit=5000&page_id=${encodeURIComponent(cursor)}` : '?limit=5000';
  const response = await request.get(`${API_BASE}/audit-log/export${query}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status(), `export failed: ${response.status()} ${await response.text()}`).toBe(
    200,
  );

  const body = await response.text();
  const headers = response.headers();
  return {
    // Every line is a record — that is the format's rule, and splitting on it
    // the way a real consumer does is the only way to notice if it stops being
    // true.
    records: body
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ExportRecord),
    cursor: headers['x-nexa-export-cursor'] ?? '',
    hasMore: headers['x-nexa-export-has-more'] === 'true',
    chainOk: headers['x-nexa-export-chain-ok'] === 'true',
  };
}

/**
 * Walk the feed to its end, the way a SIEM that has just been switched on does.
 *
 * Returns the position to resume from and the last chained record seen, which is
 * the anchor the entries written after this point have to link back to.
 */
async function drainExport(
  request: APIRequestContext,
  token: string,
): Promise<{ cursor: string; tail: ExportRecord | null; pages: number }> {
  let cursor = '';
  let tail: ExportRecord | null = null;
  let pages = 0;

  for (;;) {
    const page = await exportPage(request, token, cursor || undefined);
    pages += 1;
    // The whole trail this deployment has accumulated verifies as it goes past.
    // A false here would mean the suite's own activity had already damaged the
    // chain, which is worth knowing before anything else is asserted.
    expect(page.chainOk, `page ${pages} of the trail did not verify`).toBe(true);

    const chained = page.records.filter((r) => r.chain_seq !== null);
    if (chained.length > 0) tail = chained[chained.length - 1] as ExportRecord;
    cursor = page.cursor;
    if (!page.hasMore) return { cursor, tail, pages };
    // Guard rather than trust: a cursor that stopped moving would spin here.
    expect(pages, 'the feed never reported catching up').toBeLessThan(50);
  }
}

test.describe('the trail leaves the building (NFR-C6 · C6-g)', () => {
  // The horizon holds a fresh entry back for a few seconds by design, and this
  // test waits it out twice over rather than racing it.
  test.slow();

  test('an admin turns the export on, and the act of doing so comes back out of the feed, chained', async ({
    agentPage,
    request,
  }) => {
    const token = await ownerAccessTokenFor(request, ACME_OWNER);

    // Where the feed has got to before anything happens. Taken through the API
    // rather than the screen because a consumer's position is the consumer's,
    // and this is the consumer.
    const start = await drainExport(request, token);

    // --- The screen (C6-f) ---------------------------------------------------
    await agentPage.goto('/app/settings');
    const card = agentPage.getByRole('region', { name: 'SIEM export' });
    await expect(card.getByRole('heading', { name: 'SIEM export' })).toBeVisible();

    // Never delivered, nothing shipped — the honest empty state, and the one
    // that makes the "Delivered" figure below mean something when it changes.
    await expect(card.getByText('Never').first()).toBeVisible();

    // No gap warning on a healthy workspace. This is the false-positive half:
    // a banner that is always up says nothing when it matters.
    await expect(card.getByRole('alert')).toHaveCount(0);

    const enable = card.getByRole('checkbox', { name: /Enable export/ });
    await expect(enable).not.toBeChecked();

    // The change saves on the tick — this screen has no Save button — so the
    // write is the thing to wait for before claiming anything about it.
    //
    // `click`, not `check`: the input is controlled by the server's answer and
    // holds no optimistic value, so between the click and the response it renders
    // back as unchecked. `check` asserts the box flipped straight away and would
    // fail against a screen that is behaving exactly as C6-f designed it.
    const saved = agentPage.waitForResponse(
      (response) =>
        response.url().includes('/settings/siem') &&
        response.request().method() === 'PATCH' &&
        response.ok(),
    );
    await enable.click();
    await saved;
    await expect(enable).toBeChecked();

    // Reloading proves it reached the server rather than the page's own state.
    await agentPage.reload();
    const reloaded = agentPage.getByRole('region', { name: 'SIEM export' });
    await expect(reloaded.getByRole('checkbox', { name: /Enable export/ })).toBeChecked();
    // By role rather than by label: the checkbox's own description ends "…the
    // destination below", so a label lookup matches both controls.
    await expect(reloaded.getByRole('combobox')).toHaveValue('file');

    await agentPage.screenshot({ path: 'kanit/C6-siem-export.png', fullPage: true });

    // --- The feed (C6-b · C6-c) ---------------------------------------------
    // The tick above is a security-sensitive act: it decides where this
    // workspace's audit trail is shipped. So it is audited, and the audit entry
    // has to arrive here — once the horizon releases it.
    await expect
      .poll(
        async () => {
          const polled = await exportPage(request, token, start.cursor || undefined);
          return polled.records.some((r) => r.action === 'settings.security_updated');
        },
        {
          message: 'the settings change never reached the SIEM feed',
          timeout: 40_000,
          intervals: [1_000, 2_000, 2_000, 3_000],
        },
      )
      .toBe(true);

    // Re-read rather than capture inside the poll: the cursor has not moved, so
    // this is the same page, and a closure smuggling state out of a poll is a
    // place where a stale value hides.
    const page = await exportPage(request, token, start.cursor || undefined);
    const entry = page.records.find((r) => r.action === 'settings.security_updated');
    expect(entry, 'the audited act is missing from the page it arrived on').toBeDefined();

    // The record is evidence about the act: performed by a person, in this
    // workspace, carrying its own position and hash.
    expect(entry!.actor_type).toBe('agent');
    expect(entry!.chain_seq).not.toBeNull();
    expect(entry!.hash).toBeTruthy();
    // Nothing credential-shaped rides along. `sanitizeAuditMetadata` is the
    // mechanism; that it held on a real request is the claim.
    expect(JSON.stringify(entry!.metadata)).not.toMatch(/token|secret|password/i);

    // The page says it verified, and the links inside it agree — each record
    // names the hash of the one before it, with no position skipped. That is
    // checkable by any consumer without the key, which is the point of carrying
    // the chain inline.
    expect(page.chainOk).toBe(true);
    const chained = page.records.filter((r) => r.chain_seq !== null);
    for (let i = 1; i < chained.length; i++) {
      expect(chained[i]!.chain_seq).toBe(chained[i - 1]!.chain_seq! + 1);
      expect(chained[i]!.prev_hash).toBe(chained[i - 1]!.hash);
    }
    // And the join to what came before this page: the first new record points at
    // the record the feed had already delivered. Without this the run above
    // would prove the new entries are consistent with each other while the
    // history in front of them could have gone.
    if (start.tail && chained.length > 0) {
      expect(chained[0]!.chain_seq).toBe(start.tail.chain_seq! + 1);
      expect(chained[0]!.prev_hash).toBe(start.tail.hash);
    }

    // --- Back on the screen --------------------------------------------------
    // Still no gap: the deployment checked, and found none. `null` would mean it
    // could not answer, and this workspace has a chain by now.
    const status = await request.get(`${API_BASE}/settings/siem/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(status.status()).toBe(200);
    expect(await status.json()).toMatchObject({
      enabled: true,
      target: 'file',
      chain_gap_detected: false,
    });
  });

  test('the access review report names who can open this workspace, and exports as CSV', async ({
    request,
  }) => {
    // C6-e's report is the other evidence a SOC 2 reviewer asks for (CC6.1), and
    // it has no screen by design — so the deployment-level proof is the endpoint
    // answering about a workspace people have genuinely been signing into all
    // suite long.
    const token = await ownerAccessTokenFor(request, ACME_OWNER);
    const auth = { authorization: `Bearer ${token}` };

    const report = await request.get(`${API_BASE}/reports/access-review`, { headers: auth });
    expect(report.status()).toBe(200);
    const body = (await report.json()) as {
      members: Array<{
        email: string;
        role: string;
        status: string;
        last_login_at: string | null;
      }>;
      credentials: Array<{ id: string; type: string; scopes: string[] }>;
      audit_trail_starts_at: string | null;
    };

    const owner = body.members.find((m) => m.email === ACME_OWNER.email);
    expect(owner, 'the owner is missing from the access review').toBeDefined();
    expect(owner!.role).toBe('owner');
    // Read from the audit trail, not from a column nothing writes: this account
    // has signed in repeatedly during this run, so a null here would mean the
    // report tells an auditor nobody has ever logged in.
    expect(owner!.last_login_at).not.toBeNull();

    // The bearer credentials that can open the door today — including the one
    // this test is holding.
    expect(body.credentials.length).toBeGreaterThan(0);
    // No secret material in any format. An inventory that leaks the tokens it
    // inventories is worse than no inventory.
    expect(JSON.stringify(body)).not.toMatch(/"(token|digest|token_hash|secret)"\s*:/);

    const csv = await request.get(`${API_BASE}/reports/access-review?format=csv&section=members`, {
      headers: auth,
    });
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    const text = await csv.text();
    expect(text.split('\n')[0]).toContain('email');
    expect(text).toContain(ACME_OWNER.email);
  });

  test('each workspace is answered about its own trail and nobody else’s', async ({ request }) => {
    // RLS, at the deployment. Both tenants are real, both have been active, and
    // the feed is the surface where a boundary failure would hand one
    // workspace's complete security history to another.
    // Signing in is itself audited, so minting these two tokens gives each
    // workspace at least one entry of its own — which this test needs to be
    // able to say whose entries it is looking at.
    const [acme, northwind] = await Promise.all([
      ownerAccessTokenFor(request, ACME_OWNER),
      ownerAccessTokenFor(request, NORTHWIND_OWNER),
    ]);

    // The horizon holds those sign-ins back for a few seconds. Waiting for them
    // rather than assuming earlier specs left something behind: run this file on
    // its own against a fresh seed and both feeds are legitimately empty.
    await expect
      .poll(
        async () => {
          const [a, n] = await Promise.all([
            exportPage(request, acme),
            exportPage(request, northwind),
          ]);
          return a.records.length > 0 && n.records.length > 0;
        },
        {
          message: 'neither workspace ever had an exportable entry',
          timeout: 40_000,
          intervals: [1_000, 2_000, 2_000, 3_000],
        },
      )
      .toBe(true);

    const acmePage = await exportPage(request, acme);
    const northwindPage = await exportPage(request, northwind);

    const acmeLicences = new Set(acmePage.records.map((r) => r.license_id));
    const northwindLicences = new Set(northwindPage.records.map((r) => r.license_id));
    expect(acmeLicences.size).toBe(1);
    expect(northwindLicences.size).toBe(1);
    expect([...acmeLicences][0]).not.toBe([...northwindLicences][0]);

    // The access review draws the same boundary from a different table.
    const review = await request.get(`${API_BASE}/reports/access-review`, {
      headers: { authorization: `Bearer ${northwind}` },
    });
    expect(review.status()).toBe(200);
    const members = ((await review.json()) as { members: Array<{ email: string }> }).members;
    expect(members.length).toBeGreaterThan(0);
    expect(members.map((m) => m.email)).not.toContain(ACME_OWNER.email);
  });
});
