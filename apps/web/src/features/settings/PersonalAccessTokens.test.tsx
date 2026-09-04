/**
 * Settings → Personal access tokens (FR-MOD-08.8.2 · M-UI-b).
 *
 * The endpoints existed and `apps/web` never called them, so these pin the
 * client half — and specifically the four properties a credential surface owes,
 * each of which is a way this screen could be wrong while still looking right:
 *
 *  - the scope picker offers the session's *literal* scopes, because the server
 *    compares literally (an expanded list would offer certain rejections);
 *  - the created token is rendered once, with a warning, and closing the panel
 *    discards it rather than hiding it;
 *  - a server refusal is shown, not swallowed — under the field when the server
 *    names one;
 *  - revoking asks first, then calls DELETE and refreshes the list.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

const SESSION_SCOPES = ['accounts--my:rw', 'chats--access:rw', 'reports_read'];

let currentScopes: string[] = SESSION_SCOPES;

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { scopes: string[] } }) => unknown) =>
      selector({ agent: { scopes: currentScopes } }),
  };
});

const { PersonalAccessTokens } = await import('./PersonalAccessTokens.js');

const EXISTING = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Nightly reporting job',
  scopes: ['reports_read'],
  created_at: '2026-08-01T09:00:00.000Z',
  last_used_at: null,
  expires_at: null,
};

function signInWith(scopes: string[] = SESSION_SCOPES): void {
  currentScopes = scopes;
}

function renderScreen(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PersonalAccessTokens />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.get.mockResolvedValue({ items: [EXISTING] });
  signInWith();
});

describe('PersonalAccessTokens — the scope picker', () => {
  it('offers exactly the scopes the session holds, and no others', async () => {
    renderScreen();
    await screen.findByText('Nightly reporting job');

    const picker = screen.getByRole('group', { name: 'Scopes' });
    for (const scope of SESSION_SCOPES) {
      expect(within(picker).getByLabelText(scope, { exact: true })).toBeInTheDocument();
    }
    // `accounts--my:rw` implies `accounts--my:ro` at the route gate, but the
    // create endpoint compares against the literal list — offering the implied
    // one would be offering a refusal.
    expect(within(picker).queryByLabelText('accounts--my:ro', { exact: true })).toBeNull();
    expect(within(picker).queryByLabelText('chats--all:rw', { exact: true })).toBeNull();
    expect(within(picker).getAllByRole('checkbox')).toHaveLength(SESSION_SCOPES.length);
  });

  it('keeps Create disabled until a name and at least one scope are given', async () => {
    renderScreen();
    await screen.findByText('Nightly reporting job');

    const create = screen.getByRole('button', { name: 'Create token' });
    expect(create).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'deploy bot' } });
    // A name alone is not enough: a token with no scopes is unbounded at the
    // server's default rather than restricted.
    expect(create).toBeDisabled();

    fireEvent.click(screen.getByLabelText('reports_read', { exact: true }));
    expect(create).toBeEnabled();
  });
});

describe('PersonalAccessTokens — creating one', () => {
  it('sends the name, the checked scopes and the chosen expiry', async () => {
    renderScreen();
    await screen.findByText('Nightly reporting job');
    api.post.mockResolvedValue({ ...EXISTING, id: 'new', name: 'deploy bot', token: 'pat_secret' });

    fireEvent.change(screen.getByLabelText('Token name'), { target: { value: '  deploy bot  ' } });
    fireEvent.click(screen.getByLabelText('reports_read', { exact: true }));
    fireEvent.change(screen.getByLabelText('Expires after'), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/personal-access-tokens', {
        name: 'deploy bot',
        scopes: ['reports_read'],
        expires_in_days: 90,
      }),
    );
  });

  it('omits expires_in_days entirely when the lifetime is left at Never', async () => {
    renderScreen();
    await screen.findByText('Nightly reporting job');
    api.post.mockResolvedValue({ ...EXISTING, id: 'new', name: 'forever', token: 'pat_secret' });

    fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'forever' } });
    fireEvent.click(screen.getByLabelText('chats--access:rw', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/personal-access-tokens', {
        name: 'forever',
        scopes: ['chats--access:rw'],
      }),
    );
  });

  it('shows the token once, with the warning, and forgets it when the panel closes', async () => {
    renderScreen();
    await screen.findByText('Nightly reporting job');
    api.post.mockResolvedValue({
      ...EXISTING,
      id: 'new',
      name: 'deploy bot',
      token: 'pat_live_abc123',
    });

    fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'deploy bot' } });
    fireEvent.click(screen.getByLabelText('reports_read', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('pat-token')).toHaveTextContent('pat_live_abc123');
    expect(
      within(dialog).getByText(/will not be shown again/i, { selector: '[role="alert"]' }),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // Not merely hidden: no copy of the plaintext survives anywhere on screen.
    expect(screen.queryByText('pat_live_abc123')).toBeNull();
    expect(screen.queryByTestId('pat-token')).toBeNull();
  });

  it('clears the form after a successful create, so the next token starts empty', async () => {
    renderScreen();
    await screen.findByText('Nightly reporting job');
    api.post.mockResolvedValue({ ...EXISTING, id: 'new', name: 'deploy bot', token: 'pat_secret' });

    fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'deploy bot' } });
    const scope = screen.getByLabelText('reports_read', { exact: true });
    fireEvent.click(scope);
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await screen.findByRole('dialog');
    expect(screen.getByLabelText('Token name')).toHaveValue('');
    expect(scope).not.toBeChecked();
  });
});

describe('PersonalAccessTokens — refusals are shown, not swallowed', () => {
  it('puts a validation refusal under the field the server names', async () => {
    renderScreen();
    await screen.findByText('Nightly reporting job');
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'name: String must contain at most 120 character(s)',
        requestId: 'req_1',
        details: { fields: [{ field: 'name', message: 'Too long.' }] },
      }),
    );

    fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'too long' } });
    fireEvent.click(screen.getByLabelText('reports_read', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    const message = await screen.findByText(/must contain at most 120/i);
    expect(screen.getByLabelText('Token name')).toHaveAttribute(
      'aria-describedby',
      'new-pat-name-error',
    );
    expect(message).toHaveAttribute('id', 'new-pat-name-error');
  });

  it('shows the escalation refusal verbatim — it names the scope that was denied', async () => {
    renderScreen();
    await screen.findByText('Nightly reporting job');
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'authorization',
        status: 403,
        message: 'Cannot grant scopes the current session does not hold: reports_read',
        requestId: 'req_2',
      }),
    );

    fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'stale session' } });
    fireEvent.click(screen.getByLabelText('reports_read', { exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Create token' }));

    expect(await screen.findByText(/does not hold: reports_read/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('PersonalAccessTokens — revoking', () => {
  it('asks before revoking, then deletes and refreshes the list', async () => {
    renderScreen();
    await screen.findByText('Nightly reporting job');
    api.delete.mockResolvedValue(undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Revoke token Nightly reporting job' }));
    const dialog = await screen.findByRole('dialog');

    // Still nothing deleted — the confirmation is the gate, not the button.
    expect(api.delete).not.toHaveBeenCalled();

    api.get.mockResolvedValue({ items: [] });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke token' }));

    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith(`/auth/personal-access-tokens/${EXISTING.id}`),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await screen.findByText('No tokens yet');
  });

  it('keeps the token when the confirmation is cancelled', async () => {
    renderScreen();
    await screen.findByText('Nightly reporting job');

    fireEvent.click(screen.getByRole('button', { name: 'Revoke token Nightly reporting job' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.delete).not.toHaveBeenCalled();
    expect(screen.getByText('Nightly reporting job')).toBeInTheDocument();
  });
});

describe('PersonalAccessTokens — sessions that may not write', () => {
  it('renders the list read-only when the session cannot mint one', async () => {
    signInWith(['accounts--my:ro']);
    renderScreen();
    await screen.findByText('Nightly reporting job');

    expect(screen.queryByRole('button', { name: 'Create token' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Scopes' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Revoke token / })).toBeNull();
  });

  it('never requests the list when the session holds neither account scope', () => {
    signInWith(['chats--access:rw']);
    renderScreen();

    expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByText(/not allowed to read personal access tokens/i)).toBeInTheDocument();
  });
});
