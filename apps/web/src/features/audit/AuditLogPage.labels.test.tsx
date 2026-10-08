/**
 * O8 (tm 259.16): the trail speaks in people's words. Raw codes, UUIDs and
 * `kind:id` targets are data the CSV export keeps; the screen shows what they
 * mean, and keeps the raw value one line down where it can be copied.
 *
 * Roster reads (`GET /agents`) get their own mock so the trail's `api.get`
 * stays the trail's alone.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api, roster } = vi.hoisted(() => ({ api: { get: vi.fn() }, roster: { get: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => ({
      get: (path: string) => (path.startsWith('/agents') ? roster.get(path) : api.get(path)),
    }),
    useAuth: (selector: (state: { agent: { scopes: string[]; role: string } }) => unknown) =>
      selector({ agent: { scopes: ['audit_log--all:ro'], role: 'owner' } }),
  };
});

const { AuditLogPage } = await import('./AuditLogPage.js');

const ACTOR_ID = 'a1111111-1111-1111-1111-111111111111';
const ACCOUNT_ID = 'b2222222-2222-2222-2222-222222222222';
const SAM = { id: ACTOR_ID, name: 'Sam Rivera', email: 'sam@acme.example' };
const LEE = { id: ACCOUNT_ID, name: 'Lee Chen', email: 'lee@acme.example' };

const BASE = {
  id: 'entry-1',
  action: 'member.role_changed',
  actor_id: ACTOR_ID,
  actor_type: 'agent' as const,
  target: `account:${ACCOUNT_ID}`,
  metadata: { from: 'agent', to: 'admin' },
  ip: '203.0.113.5',
  created_at: '2026-08-01T10:00:00.000Z',
};

function entry(over: Record<string, unknown>): Record<string, unknown> {
  return { ...BASE, ...over };
}

function renderPage(locale: 'en' | 'tr' = 'en'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithLocale(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AuditLogPage />
      </QueryClientProvider>
    </MemoryRouter>,
    locale,
  );
}

beforeEach(() => {
  api.get.mockReset();
  roster.get.mockReset();
  roster.get.mockResolvedValue({ items: [] });
});

afterEach(() => {
  resetLocale();
});

describe('AuditLogPage humanised rows (tm 259.16)', () => {
  it('shows a readable action label instead of the code', async () => {
    api.get.mockResolvedValue({
      items: [
        entry({ id: 'e1', action: 'auth.login' }),
        entry({ id: 'e2', action: 'settings.security_updated' }),
      ],
    });
    renderPage();

    const rows = within(await screen.findByRole('table'));
    expect(rows.getByText('Signed in')).toBeInTheDocument();
    expect(rows.getByText('Security settings updated')).toBeInTheDocument();
    expect(rows.queryByText('auth.login')).not.toBeInTheDocument();
    expect(rows.queryByText('settings.security_updated')).not.toBeInTheDocument();
  });

  it('shows an action code it has no label for exactly as written', async () => {
    api.get.mockResolvedValue({ items: [entry({ action: 'future.thing_happened' })] });
    renderPage();

    const rows = within(await screen.findByRole('table'));
    expect(rows.getByText('future.thing_happened')).toBeInTheDocument();
  });

  it('names the agent and shows the e-mail under the name', async () => {
    api.get.mockResolvedValue({ items: [entry({})] });
    roster.get.mockResolvedValue({ items: [SAM, LEE] });
    renderPage();

    const rows = within(await screen.findByRole('table'));
    expect(await rows.findByText('Sam Rivera')).toBeInTheDocument();
    expect(rows.getByText('sam@acme.example')).toBeInTheDocument();
    expect(rows.queryByText(ACTOR_ID)).not.toBeInTheDocument();
    expect(roster.get).toHaveBeenCalledWith('/agents?status=all');
  });

  it('falls back to a shortened id when the roster does not hold the agent', async () => {
    api.get.mockResolvedValue({ items: [entry({})] });
    renderPage();

    const rows = within(await screen.findByRole('table'));
    expect(rows.getByText('Agent')).toBeInTheDocument();
    expect(rows.getByText('a1111111…')).toHaveAttribute('title', ACTOR_ID);
    expect(rows.queryByText(ACTOR_ID)).not.toBeInTheDocument();
  });

  it('still shows the shortened id when the roster cannot be read', async () => {
    api.get.mockResolvedValue({ items: [entry({})] });
    roster.get.mockRejectedValue(new Error('403'));
    renderPage();

    const rows = within(await screen.findByRole('table'));
    expect(rows.getByText('a1111111…')).toBeInTheDocument();
  });

  it('labels bot and system actors without an id line', async () => {
    api.get.mockResolvedValue({
      items: [
        entry({ id: 'e1', actor_type: 'system', actor_id: null }),
        entry({ id: 'e2', actor_type: 'bot', actor_id: null }),
      ],
    });
    renderPage();

    const rows = within(await screen.findByRole('table'));
    expect(rows.getByText('System')).toBeInTheDocument();
    expect(rows.getByText('Bot')).toBeInTheDocument();
  });

  it('describes a workspace target in words and keeps the raw value beneath it', async () => {
    api.get.mockResolvedValue({ items: [entry({ target: 'license:1000006' })] });
    renderPage();

    const rows = within(await screen.findByRole('table'));
    expect(rows.getByText('Workspace')).toBeInTheDocument();
    expect(rows.getByText('license:1000006')).toBeInTheDocument();
  });

  it('describes an app target as "App: <client id>"', async () => {
    api.get.mockResolvedValue({ items: [entry({ target: 'client:siyahtus-agent-app-acme' })] });
    renderPage();

    const rows = within(await screen.findByRole('table'));
    expect(rows.getByText('App: siyahtus-agent-app-acme')).toBeInTheDocument();
    expect(rows.getByText('client:siyahtus-agent-app-acme')).toBeInTheDocument();
  });

  it('names an account target after the teammate', async () => {
    api.get.mockResolvedValue({ items: [entry({})] });
    roster.get.mockResolvedValue({ items: [SAM, LEE] });
    renderPage();

    const rows = within(await screen.findByRole('table'));
    expect(await rows.findByText('Account: Lee Chen')).toBeInTheDocument();
    expect(rows.getByText(`account:${ACCOUNT_ID}`)).toBeInTheDocument();
  });

  it('shows a target it does not know exactly as written', async () => {
    api.get.mockResolvedValue({
      items: [
        entry({ id: 'e1', target: 'first_response' }),
        entry({ id: 'e2', target: 'novelty:42' }),
      ],
    });
    renderPage();

    const rows = within(await screen.findByRole('table'));
    expect(rows.getByText('first_response')).toBeInTheDocument();
    expect(rows.getByText('novelty:42')).toBeInTheDocument();
  });

  it('labels the filter options too, but keeps the code as the value', async () => {
    api.get.mockResolvedValue({ items: [entry({})] });
    renderPage();
    await screen.findByRole('table');

    const option = within(screen.getByLabelText('Filter by action')).getByRole('option', {
      name: 'Signed in',
    }) as HTMLOptionElement;
    expect(option.value).toBe('auth.login');
  });

  it('keeps the raw code reachable in the expanded detail', async () => {
    api.get.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/audit-log/entry-1' ? { ...BASE, chain_seq: 3 } : { items: [entry({})] },
      ),
    );
    renderPage();
    await screen.findByRole('table');

    await userEvent.click(screen.getByRole('button', { name: /Detail for/ }));

    expect(await screen.findByText('Action code')).toBeInTheDocument();
    expect(await screen.findByText('member.role_changed')).toBeInTheDocument();
  });

  it('paints the labels in Turkish', async () => {
    api.get.mockResolvedValue({
      items: [entry({ action: 'auth.login', target: 'license:1000006' })],
    });
    roster.get.mockResolvedValue({ items: [SAM] });
    renderPage('tr');

    const rows = within(await screen.findByRole('table'));
    expect(rows.getByText('Oturum açıldı')).toBeInTheDocument();
    expect(rows.getByText('Çalışma alanı')).toBeInTheDocument();
    expect(await rows.findByText('Sam Rivera')).toBeInTheDocument();
    expect(rows.queryByText('auth.login')).not.toBeInTheDocument();
  });
});
