/**
 * The workspace list, its detail tabs and the support lookup against a fake platform API
 * (tm 389.9 · FR-ADMIN-08/10). The server's filters, keyset and isolation have their own suite
 * (`platform-workspaces.test.ts`); here: what the SPA asks for and how it shows the answer.
 */
import type { PlatformRole } from '@siyahtus/types';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_ID, type FakePlatform } from '../../test/fake-platform.js';
import { installFakePlatform, renderApp, resetSession } from '../../test/render-app.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSession();
});

beforeEach(() => {
  globalThis.sessionStorage.clear();
});

async function open(path: string, role: PlatformRole = 'superadmin'): Promise<FakePlatform> {
  const fake = installFakePlatform({ role });
  const user = userEvent.setup();
  renderApp(path);
  await user.type(await screen.findByLabelText('Email'), 'ops@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery staple');
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.type(await screen.findByLabelText('Authenticator code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Verify' }));
  return fake;
}

describe('the workspace list', () => {
  it('lists the first page, then the next one on "Load more"', async () => {
    const fake = await open('/workspaces');
    const table = await screen.findByRole('table', { name: 'Workspaces' });
    expect(within(table).getByRole('link', { name: 'Acme Gaming' })).toHaveAttribute(
      'href',
      `/workspaces/${WORKSPACE_ID}`,
    );
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(fake.calls('/workspaces')[0]!.path).toBe('/workspaces');

    await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await within(table).findByRole('link', { name: 'Zeta Bets' })).toBeVisible();
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('sends the filters it shows, and the search text only on submit', async () => {
    const fake = await open('/workspaces');
    await screen.findByRole('table', { name: 'Workspaces' });
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Status'), 'suspended');
    await user.selectOptions(screen.getByLabelText('Plan'), 'enterprise');
    await user.selectOptions(screen.getByLabelText('Order'), 'name_asc');
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'nothing');
    const asked = () =>
      fake.fetch.mock.calls.map(
        (call) => new URL(call[0] as string, 'http://localhost').searchParams.get('q') ?? '',
      );
    // Typing alone asks for nothing.
    expect(asked()).not.toContain('nothing');
    await user.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('No workspace matches these filters.')).toBeVisible();
    const last = fake.fetch.mock.calls.at(-1)![0] as string;
    const query = new URL(last, 'http://localhost').searchParams;
    expect(Object.fromEntries(query)).toMatchObject({
      q: 'nothing',
      status: 'suspended',
      plan: 'enterprise',
      sort: 'name_asc',
      limit: '25',
    });
  });
});

describe('the workspace detail', () => {
  it('opens on the overview — organization, Kurucu, counts and history — and moves between tabs by address', async () => {
    await open(`/workspaces/${WORKSPACE_ID}`);
    expect(await screen.findByRole('heading', { name: 'Acme Gaming', level: 1 })).toBeVisible();
    expect(screen.getByText('ayse@acme.example')).toBeVisible();
    expect(screen.getByText('845')).toBeVisible();
    expect(screen.getByText('Trial extended')).toBeVisible();
    expect(screen.getByText('Asked for more time')).toBeVisible();

    const tabs = screen.getByRole('navigation', { name: 'Workspace sections' });
    await userEvent.click(within(tabs).getByRole('link', { name: 'Members' }));
    const members = await screen.findByRole('table', { name: 'Members' });
    expect(within(members).getByText('Team Lead')).toBeVisible();
    expect(within(tabs).getByRole('link', { name: 'Members' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('hides the Audit tab from a role that cannot read audit trails', async () => {
    await open(`/workspaces/${WORKSPACE_ID}`, 'billing');
    const tabs = await screen.findByRole('navigation', { name: 'Workspace sections' });
    expect(within(tabs).queryByRole('link', { name: 'Audit' })).not.toBeInTheDocument();
  });

  it('shows the workspace’s own audit trail to a role that reads audit trails', async () => {
    await open(`/workspaces/${WORKSPACE_ID}/audit`, 'readonly');
    expect(await screen.findByText('billing.subscription_updated')).toBeVisible();
  });

  it('says an unknown workspace does not exist', async () => {
    await open('/workspaces/999');
    expect(await screen.findByText('No such workspace')).toBeVisible();
  });

  it('adds a note through the reason dialog', async () => {
    const fake = await open(`/workspaces/${WORKSPACE_ID}/notes`, 'support');
    const user = userEvent.setup();
    expect(await screen.findByText('No notes yet.')).toBeVisible();
    await user.type(screen.getByLabelText('New note'), 'Prefers email.');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a note' });
    await user.type(within(dialog).getByLabelText(/Reason/), 'Customer asked us to');
    await user.click(within(dialog).getByRole('button', { name: 'Add note' }));

    expect(await screen.findByText('Prefers email.')).toBeVisible();
    const sent = fake.requests.find((r) => r.method === 'POST' && r.path.endsWith('/notes'));
    expect(sent?.body).toEqual({ body: 'Prefers email.', reason: 'Customer asked us to' });
  });

  it('gives readonly the notes but no form', async () => {
    await open(`/workspaces/${WORKSPACE_ID}/notes`, 'readonly');
    expect(await screen.findByText('No notes yet.')).toBeVisible();
    expect(screen.queryByLabelText('New note')).not.toBeInTheDocument();
  });

  it('downloads an invoice as CSV through the session', async () => {
    const fake = await open(`/workspaces/${WORKSPACE_ID}/invoices`);
    const button = await screen.findByRole('button', {
      name: 'Download the September 2026 invoice as CSV',
    });
    URL.createObjectURL = () => 'blob:invoice';
    URL.revokeObjectURL = () => {};
    const saved = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await userEvent.click(button);
    const download = fake.requests.find((r) => r.path.endsWith('/download'));
    expect(download?.path).toBe(`/workspaces/${WORKSPACE_ID}/invoices/202609/download`);
    expect(download?.headers.get('Authorization')).toMatch(/^Bearer /);
    expect(saved).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('the support lookup', () => {
  it('names the workspace a Thread ID belongs to and links to it', async () => {
    await open('/support', 'support');
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('searchbox', { name: 'Find the workspace for an identifier' }),
      'TJ1H8CFKRV',
    );
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    const results = await screen.findByRole('table', { name: 'Matching workspaces' });
    expect(within(results).getByText('Thread ID')).toBeVisible();
    expect(within(results).getByRole('link', { name: 'Acme Gaming' })).toHaveAttribute(
      'href',
      `/workspaces/${WORKSPACE_ID}`,
    );
  });

  it('says nothing matched, whatever was typed', async () => {
    await open('/support', 'support');
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('searchbox', { name: 'Find the workspace for an identifier' }),
      'who knows',
    );
    await user.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText(/Nothing matches that/)).toBeVisible();
  });
});
