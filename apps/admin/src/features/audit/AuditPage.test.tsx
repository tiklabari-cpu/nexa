/**
 * The Audit page against a fake platform API (tm 391 · FR-ADMIN-05/06). The chain itself — the
 * hashes, the seal, the findings — has its own suite (`platform-audit.test.ts`); here: what the
 * list shows and sends for each filter, how a clean and a broken verification read, and what an
 * export page tells the operator about itself.
 */
import type { PlatformRole } from '@siyahtus/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NAV_ITEMS } from '../../lib/navigation.js';
import { OTHER_ID } from '../../test/fake-admins.js';
import type { FakePlatform } from '../../test/fake-platform.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSession();
});

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

// The page address, taken from the menu table: a literal page path would read as an API call to
// the endpoint-ui audit.
const AUDIT_PATH = NAV_ITEMS.find((item) => item.id === 'audit')!.path;

const user = () => userEvent.setup();

async function open(role: PlatformRole = 'superadmin', heading = 'Audit'): Promise<FakePlatform> {
  const fake = installFakePlatform({ role });
  renderApp(AUDIT_PATH);
  await user().type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user().type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user().click(screen.getByRole('button', { name: 'Continue' }));
  await user().type(await screen.findByLabelText('Authenticator code'), '123456');
  await user().click(screen.getByRole('button', { name: 'Verify' }));
  await screen.findByRole('heading', { name: heading });
  return fake;
}

const entriesTable = () => screen.findByRole('table', { name: 'Entries' });

/** The query string of the last `GET /audit` — the recorded path carries none, so ask the mock. */
function lastQuery(fake: FakePlatform): URLSearchParams {
  const calls = fake.fetch.mock.calls
    .map(([input]) => String(input))
    .filter((url) => /\/platform\/v1\/audit(\?|$)/.test(url));
  return new URL(calls[calls.length - 1]!, 'http://localhost').searchParams;
}

describe('Audit — the entries', () => {
  it('lists the trail newest first, with the operator’s address and the reason', async () => {
    await open();
    const table = await entriesTable();
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(6);
    expect(within(rows[1]!).getByText('5')).toBeVisible();
    expect(within(rows[1]!).getByText('admin.role_changed')).toBeVisible();
    expect(within(rows[1]!).getByText('ops@example.com')).toBeVisible();
    expect(within(rows[1]!).getByText('Because the runbook says so')).toBeVisible();
    // A sign-in nobody could be matched to has no operator.
    expect(within(rows[4]!).getByText('Nobody matched')).toBeVisible();
    expect(within(rows[4]!).getByText('admin.sign_in_failed')).toBeVisible();
  });

  it('sends each filter, and says so when nothing matches', async () => {
    const fake = await open();
    await entriesTable();
    await user().selectOptions(screen.getByLabelText('Operator'), OTHER_ID);
    await user().selectOptions(screen.getByLabelText('Action'), 'workspace.suspended');
    await user().type(screen.getByLabelText('Workspace number'), '42');
    await user().type(screen.getByLabelText('From'), '2026-10-26');
    await user().type(screen.getByLabelText('To'), '2026-10-26');

    await vi.waitFor(() => {
      const query = lastQuery(fake);
      expect(query.get('admin_id')).toBe(OTHER_ID);
      expect(query.get('action')).toBe('workspace.suspended');
      expect(query.get('license_id')).toBe('42');
      expect(query.get('from')).toBe('2026-10-26T00:00:00.000Z');
      expect(query.get('to')).toBe('2026-10-26T23:59:59.999Z');
    });
    const table = await entriesTable();
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getByText('workspace.suspended')).toBeVisible();

    await user().selectOptions(screen.getByLabelText('Action'), 'admin.disabled');
    expect(await screen.findByText('No entry matches these filters.')).toBeVisible();
    await user().click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await entriesTable()).toBeVisible();
  });

  it('does not send a workspace number that is not digits, and says why', async () => {
    const fake = await open();
    await entriesTable();
    await user().type(screen.getByLabelText('Workspace number'), '4x2');
    expect(await screen.findByText('The workspace number is digits only.')).toBeVisible();
    expect(lastQuery(fake).get('license_id')).toBeNull();
  });

  it('does not send a start date after the end date', async () => {
    const fake = await open();
    await entriesTable();
    await user().type(screen.getByLabelText('From'), '2026-10-27');
    await user().type(screen.getByLabelText('To'), '2026-10-26');
    expect(await screen.findByText('The start date is after the end date.')).toBeVisible();
    const query = lastQuery(fake);
    expect(query.get('from')).toBeNull();
    expect(query.get('to')).toBeNull();
  });

  it('pages by keyset', async () => {
    const fake = await open();
    fake.adminsState.listPageSize = 2;
    // The first page was already fetched with the old size: ask again through a filter round trip.
    await user().selectOptions(screen.getByLabelText('Action'), 'admin.bootstrapped');
    await user().click(screen.getByRole('button', { name: 'Clear filters' }));
    await vi.waitFor(async () =>
      expect(within(await entriesTable()).getAllByRole('row')).toHaveLength(3),
    );
    await user().click(screen.getByRole('button', { name: 'Load more' }));
    await vi.waitFor(async () =>
      expect(within(await entriesTable()).getAllByRole('row')).toHaveLength(5),
    );
    // The first page ended at position 4; the next one starts below it.
    expect(lastQuery(fake).get('cursor')).toBe('4');
  });

  it('shows a role without audit access nothing of the trail', async () => {
    await open('billing', 'You do not have access to this page');
    expect(screen.queryByRole('table', { name: 'Entries' })).toBeNull();
  });
});

describe('Audit — verifying the chain', () => {
  it('says how much was checked when the chain is intact', async () => {
    const fake = await open();
    await user().click(screen.getByRole('button', { name: 'Verify the chain' }));
    expect(
      await screen.findByText('The chain is intact: 5 entries checked, positions 1 to 5.'),
    ).toBeVisible();
    expect(fake.calls('/audit/verify')).toHaveLength(1);
  });

  it('lists every finding with its position when the chain is broken', async () => {
    const fake = await open();
    fake.adminsState.verification = 'broken';
    await user().click(screen.getByRole('button', { name: 'Verify the chain' }));
    expect(await screen.findByText('The chain does not verify: 2 findings.')).toBeVisible();
    const table = screen.getByRole('table', { name: 'Findings' });
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByText('Hash mismatch')).toBeVisible();
    expect(within(rows[1]!).getByText('3')).toBeVisible();
    expect(within(rows[2]!).getByText('Chain head mismatch')).toBeVisible();
    expect(within(rows[2]!).getByText('—')).toBeVisible();
  });
});

describe('Audit — exporting', () => {
  it('downloads a page and shows its seal, its range and the cursor to resume from', async () => {
    const fake = await open();
    await user().click(screen.getByRole('button', { name: 'Export from the start' }));
    const facts = await screen.findByLabelText('The exported page');
    expect(within(facts).getByText('Entries in this page').nextElementSibling).toHaveTextContent(
      '3',
    );
    expect(within(facts).getByText('Resume cursor').nextElementSibling).toHaveTextContent('3');
    expect(within(facts).getByText('1 – 3')).toBeVisible();
    expect(within(facts).getByText('Yes — export the next page to continue')).toBeVisible();
    expect(within(facts).getByText('sig-1-3')).toBeVisible();
    expect(within(facts).getByText('Intact')).toBeVisible();
    const first = fake.fetch.mock.calls.map(([input]) => String(input));
    expect(first.some((url) => url.endsWith('/platform/v1/audit/export'))).toBe(true);
  });

  it('resumes from the cursor and stops offering more on the last page', async () => {
    const fake = await open();
    await user().click(screen.getByRole('button', { name: 'Export from the start' }));
    await screen.findByLabelText('The exported page');
    await user().click(screen.getByRole('button', { name: 'Export the next page' }));
    await vi.waitFor(() =>
      expect(within(screen.getByLabelText('The exported page')).getByText('4 – 5')).toBeVisible(),
    );
    expect(
      fake.fetch.mock.calls.some(([input]) =>
        String(input).endsWith('/platform/v1/audit/export?cursor=3'),
      ),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: 'Export the next page' })).toBeNull();
    expect(screen.getByText('No — this was the last page')).toBeVisible();
  });
});
