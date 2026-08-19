/**
 * Pilot form under the shared primitive (FR-EK-A.1): an invalid address shows a
 * field-under error and keeps Submit disabled; a valid one enables it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InviteTeammates } from './InviteTeammates.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

function renderInvite() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <InviteTeammates />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
});

async function openModal() {
  await userEvent.click(screen.getByRole('button', { name: 'Invite teammates' }));
}

describe('InviteTeammates validation', () => {
  it('disables Submit until an address is entered', async () => {
    renderInvite();
    await openModal();
    expect(screen.getByRole('button', { name: /^Invite/ })).toBeDisabled();
  });

  it('shows a field-under error for a bad address and keeps Submit disabled', async () => {
    renderInvite();
    await openModal();

    const field = screen.getByLabelText('Email addresses');
    await userEvent.type(field, 'not-an-email');
    // Disabled the moment it is invalid, before the field is even blurred.
    expect(screen.getByRole('button', { name: /^Invite/ })).toBeDisabled();

    await userEvent.tab(); // blur reveals the message
    expect(screen.getByRole('alert')).toHaveTextContent('Not a valid address: not-an-email');
  });

  it('enables Submit once every address is valid', async () => {
    renderInvite();
    await openModal();

    await userEvent.type(screen.getByLabelText('Email addresses'), 'robin@example.com');
    expect(screen.getByRole('button', { name: /^Invite/ })).toBeEnabled();
    expect(screen.queryByText(/Not a valid address/)).not.toBeInTheDocument();
  });
});

describe('InviteTeammates localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the invite modal in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <InviteTeammates />
      </QueryClientProvider>,
      'tr',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Ekip arkadaşı davet et' }));
    expect(screen.getByRole('dialog', { name: 'Ekip arkadaşı davet et' })).toBeInTheDocument();
    expect(screen.getByLabelText('E-posta adresleri')).toBeInTheDocument();
  });
});
