/**
 * Pilot form under the shared primitive (FR-EK-A.1): an invalid address shows a
 * field-under error and keeps Submit disabled; a valid one enables it.
 *
 * Plus what the modal says an invitation will *cost* (FR-MOD-04.4). The seat
 * summary rides on `GET /invitations`, which the modal only asks for while it is
 * open, so every test here stubs that response — an unstubbed one would leave
 * the notice absent and the assertions below quietly meaningless.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteTeammates } from './InviteTeammates.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

interface SeatFixture {
  headcount: number;
  purchased: number | null;
  unit_price_cents: number | null;
  ceiling: number;
}

const SEATS: SeatFixture = {
  headcount: 3,
  purchased: 5,
  unit_price_cents: 9900,
  ceiling: 200,
};

function stubInvitations(seats: SeatFixture = SEATS, outstanding = 0): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!url.includes('/invitations')) throw new Error(`unexpected fetch: ${url}`);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({
          items: Array.from({ length: outstanding }, (_, i) => ({
            id: `invite-${i}`,
            email: `pending-${i}@example.test`,
            role: 'agent',
            invited_by_name: 'Owner',
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          })),
          seats,
        }),
      } as unknown as Response;
    }),
  );
}

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
  stubInvitations();
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe('InviteTeammates custom trigger (FR-MOD-01.1.5)', () => {
  it('renders the caller-supplied trigger instead of the default pill, and still opens the same modal', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <InviteTeammates trigger={(open) => <button onClick={open}>Custom trigger</button>} />
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Invite teammates' })).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Custom trigger' });

    await userEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Invite teammates' })).toBeVisible();
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

describe('InviteTeammates seat cost (FR-MOD-04.4)', () => {
  it('says what a seat costs, and what these invitations would take the workspace to', async () => {
    renderInvite();
    await openModal();

    expect(await screen.findByText('3 of 5 seats in use.')).toBeVisible();
    // Nothing typed yet: the rule, not a projection.
    expect(
      screen.getByText('Each teammate who accepts takes a seat, at $99.00 per user per month.'),
    ).toBeVisible();

    await userEvent.type(
      screen.getByLabelText('Email addresses'),
      'robin@example.com, sam@example.com, kim@example.com',
    );
    // 3 members + 3 invitations = 6, above the 5 already bought.
    expect(
      screen.getByText('Inviting 3 people takes this workspace to 6 seats once they accept.'),
    ).toBeVisible();
  });

  it('says so when the invitations fit inside the seats already bought', async () => {
    renderInvite();
    await openModal();

    await userEvent.type(screen.getByLabelText('Email addresses'), 'robin@example.com');
    expect(screen.getByText('Inviting 1 person stays within the 5 seats bought.')).toBeVisible();
  });

  it('promises no charge while the workspace is on a trial', async () => {
    stubInvitations({ ...SEATS, purchased: null });
    renderInvite();
    await openModal();

    expect(
      await screen.findByText('Nothing is billed yet — this workspace is on a trial.'),
    ).toBeVisible();
  });

  it('quotes no price on a contracted plan rather than inventing one', async () => {
    stubInvitations({ ...SEATS, unit_price_cents: null });
    renderInvite();
    await openModal();

    expect(
      await screen.findByText('Each teammate who accepts takes a seat on your contracted plan.'),
    ).toBeVisible();
    expect(screen.queryByText(/per user per month/)).toBeNull();
  });

  it('warns before the ceiling refusal instead of letting it be a surprise', async () => {
    // Members plus everyone still holding an invitation is already the ceiling,
    // which is exactly what the server counts.
    stubInvitations({ headcount: 198, purchased: 200, unit_price_cents: 9900, ceiling: 200 }, 2);
    renderInvite();
    await openModal();

    expect(await screen.findByText('198 of 200 seats in use.')).toBeVisible();
    expect(screen.queryByText(/would pass the 200-seat ceiling/)).toBeNull();

    await userEvent.type(screen.getByLabelText('Email addresses'), 'one-too-many@example.com');
    expect(
      screen.getByText(
        'That would pass the 200-seat ceiling and be refused. Revoke invitations you no longer want, or talk to sales.',
      ),
    ).toBeVisible();
  });
});
