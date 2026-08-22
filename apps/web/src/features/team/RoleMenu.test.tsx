/**
 * Changing a teammate's role (NFR-S12).
 *
 * The rule lives on the server, so what is worth testing here is the mirror:
 * the control is absent exactly where the server would refuse (your own row,
 * the owner, anyone ranked above you), the picker offers only roles this caller
 * could actually be granted — never Owner, never above their own rank — and a
 * refusal that comes back anyway is shown rather than swallowed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

const { RoleMenu } = await import('./RoleMenu.js');

const SAM = { id: 'agent-1', name: 'Sam Rivera', role: 'admin' as const };

function renderMenu(ui: ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

/** The picker's options, in the order they are offered. */
function optionLabels(): string[] {
  return screen.getAllByRole('option').map((option) => option.textContent ?? '');
}

function openMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Change role for Sam Rivera' }));
}

beforeEach(() => {
  api.put.mockReset();
  api.put.mockResolvedValue({ ...SAM, role: 'agent' });
});

describe('RoleMenu — where the control appears', () => {
  it('is absent on your own row', () => {
    renderMenu(<RoleMenu agent={SAM} actorRole="owner" isSelf />);

    expect(screen.queryByRole('button', { name: /Change role/ })).not.toBeInTheDocument();
  });

  it('is absent for the owner, who cannot be moved to another role here', () => {
    renderMenu(<RoleMenu agent={{ ...SAM, role: 'owner' }} actorRole="owner" isSelf={false} />);

    expect(screen.queryByRole('button', { name: /Change role/ })).not.toBeInTheDocument();
  });

  it('is absent for a teammate ranked above the caller', () => {
    renderMenu(<RoleMenu agent={{ ...SAM, role: 'viceowner' }} actorRole="admin" isSelf={false} />);

    expect(screen.queryByRole('button', { name: /Change role/ })).not.toBeInTheDocument();
  });

  it('is absent for an agent-role caller, who may not administer teammates at all', () => {
    renderMenu(<RoleMenu agent={SAM} actorRole="agent" isSelf={false} />);

    expect(screen.queryByRole('button', { name: /Change role/ })).not.toBeInTheDocument();
  });
});

describe('RoleMenu — the picker', () => {
  it('offers an admin only the roles they could be granted themselves', () => {
    renderMenu(<RoleMenu agent={SAM} actorRole="admin" isSelf={false} />);
    openMenu();

    // Never Owner (that is an ownership transfer), never Vice owner (above an
    // admin's own rank) — both would come back as a 403.
    expect(optionLabels()).toEqual(['Admin', 'Agent']);
  });

  it('offers an owner every role below ownership, and never ownership itself', () => {
    renderMenu(<RoleMenu agent={SAM} actorRole="owner" isSelf={false} />);
    openMenu();

    expect(optionLabels()).toEqual(['Vice owner', 'Admin', 'Agent']);
  });

  it('opens on the role the teammate already holds, with saving disabled until it changes', () => {
    renderMenu(<RoleMenu agent={SAM} actorRole="owner" isSelf={false} />);
    openMenu();

    expect(screen.getByLabelText('Role')).toHaveValue('admin');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'agent' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});

describe('RoleMenu — saving', () => {
  it('sends the chosen role to the endpoint and closes', async () => {
    renderMenu(<RoleMenu agent={SAM} actorRole="owner" isSelf={false} />);
    openMenu();

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'agent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/agents/agent-1/role', { role: 'agent' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the server’s refusal instead of swallowing it, and keeps the dialog open', async () => {
    api.put.mockRejectedValue(
      new ApiClientError({
        type: 'authorization',
        status: 403,
        message: 'You cannot grant a role above your own.',
        requestId: 'req-1',
      }),
    );
    renderMenu(<RoleMenu agent={SAM} actorRole="owner" isSelf={false} />);
    openMenu();

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'agent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A role can only be assigned at or below your own rank',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('answers any other failure through the shared ADR-06 catalogue', async () => {
    api.put.mockRejectedValue(
      new ApiClientError({
        type: 'internal',
        status: 500,
        message: 'boom',
        requestId: 'req-2',
      }),
    );
    renderMenu(<RoleMenu agent={SAM} actorRole="owner" isSelf={false} />);
    openMenu();

    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'agent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent('boom');
    expect(alert.textContent).toBeTruthy();
  });
});

describe('RoleMenu localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the dialog in Turkish when that is the active locale', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <RoleMenu agent={SAM} actorRole="owner" isSelf={false} />
      </QueryClientProvider>,
      'tr',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sam Rivera için rolü değiştir' }));

    expect(screen.getByRole('dialog', { name: 'Rolü değiştir — Sam Rivera' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeInTheDocument();
  });
});
