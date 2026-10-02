/**
 * The invite modal's seat notice in the public pilot (tm 257.2 · ADR
 * docs/adr/pilot-public-readiness.md K-d): the seat count and the ceiling stay
 * — the server still enforces the ceiling — and the money goes: no price, no
 * "nothing is billed yet" (nothing ever is), no sales to talk to. Each case is
 * paired with the same render on an ordinary deployment; the flag-off copy
 * `InviteTeammates.test.tsx` pins is left to it, unchanged.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DeploymentConfig } from '@siyahtus/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteTeammates } from './InviteTeammates.js';
import { useAuth } from '../../lib/auth-store.js';

interface SeatFixture {
  headcount: number;
  purchased: number | null;
  unit_price_cents: number | null;
  ceiling: number;
}

const PILOT: DeploymentConfig = { pilot_mode: true, contact_email: null, signup_enabled: true };
const ORDINARY: DeploymentConfig = { pilot_mode: false, contact_email: null, signup_enabled: true };

const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

function stubInvitations(seats: SeatFixture, outstanding = 0): void {
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

async function openInvite(config: DeploymentConfig): Promise<QueryClient> {
  deployment.current = config;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <InviteTeammates />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole('button', { name: 'Invite teammates' }));
  return queryClient;
}

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('InviteTeammates seat notice in the public pilot (tm 257.2)', () => {
  it('quotes no contracted plan either', async () => {
    stubInvitations({ headcount: 3, purchased: 5, unit_price_cents: null, ceiling: 200 });
    await openInvite(PILOT);
    expect(await screen.findByText('3 of 5 seats in use.')).toBeVisible();
    expect(screen.queryByText(/contracted plan/)).toBeNull();
  });

  it('quotes no price', async () => {
    stubInvitations({ headcount: 3, purchased: 5, unit_price_cents: 9900, ceiling: 200 });
    await openInvite(PILOT);
    expect(await screen.findByText('3 of 5 seats in use.')).toBeVisible();
    expect(screen.queryByText(/per user per month/)).toBeNull();

    // The projection is a seat count, not a charge — it stays.
    await userEvent.type(
      screen.getByLabelText('Email addresses'),
      'robin@example.com, sam@example.com, kim@example.com',
    );
    expect(
      screen.getByText('Inviting 3 people takes this workspace to 6 seats once they accept.'),
    ).toBeVisible();
  });

  it('says nothing about billing on a trial workspace — and draws no empty box', async () => {
    stubInvitations({ headcount: 3, purchased: null, unit_price_cents: 9900, ceiling: 200 });
    const queryClient = await openInvite(PILOT);
    // Absence means something only once the seat summary has arrived.
    await waitFor(() => expect(queryClient.getQueryState(['invitations'])?.status).toBe('success'));
    expect(screen.queryByText(/Nothing is billed yet/)).toBeNull();
    expect(screen.queryByText(/takes a seat/)).toBeNull();
    expect(screen.queryByText(/seats in use/)).toBeNull();

    // With something to say, the notice is back — the seat count alone.
    await userEvent.type(screen.getByLabelText('Email addresses'), 'robin@example.com');
    expect(
      screen.getByText('Inviting 1 person takes this workspace to 4 seats once they accept.'),
    ).toBeVisible();
    expect(screen.queryByText(/Nothing is billed yet/)).toBeNull();
  });

  it('warns before the ceiling refusal without sending anyone to sales', async () => {
    stubInvitations({ headcount: 198, purchased: 200, unit_price_cents: 9900, ceiling: 200 }, 2);
    await openInvite(PILOT);
    await screen.findByText('198 of 200 seats in use.');
    await userEvent.type(screen.getByLabelText('Email addresses'), 'one-too-many@example.com');
    expect(
      screen.getByText(
        'That would pass the 200-seat ceiling and be refused. Revoke invitations you no longer want.',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/talk to sales/)).toBeNull();
  });

  describe('on an ordinary deployment', () => {
    it('quotes the price', async () => {
      stubInvitations({ headcount: 3, purchased: 5, unit_price_cents: 9900, ceiling: 200 });
      await openInvite(ORDINARY);
      expect(
        await screen.findByText(
          'Each teammate who accepts takes a seat, at $99.00 per user per month.',
        ),
      ).toBeVisible();
    });

    it('says nothing is billed on a trial', async () => {
      stubInvitations({ headcount: 3, purchased: null, unit_price_cents: 9900, ceiling: 200 });
      await openInvite(ORDINARY);
      expect(
        await screen.findByText('Nothing is billed yet — this workspace is on a trial.'),
      ).toBeVisible();
    });

    it('points past the ceiling to sales', async () => {
      stubInvitations({ headcount: 198, purchased: 200, unit_price_cents: 9900, ceiling: 200 }, 2);
      await openInvite(ORDINARY);
      await screen.findByText('198 of 200 seats in use.');
      await userEvent.type(screen.getByLabelText('Email addresses'), 'one-too-many@example.com');
      expect(screen.getByText(/or talk to sales\.$/)).toBeVisible();
    });
  });
});
