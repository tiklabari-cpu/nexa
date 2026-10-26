/**
 * The red band of a support session (tm 389.15 · FR-ADMIN-21): shown only
 * while an operator is signed in as the member, with the mode, the member and
 * a countdown; "End session" ends it on the server; the countdown reaching
 * zero forgets it here.
 */
import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countdown, ImpersonationBanner } from './ImpersonationBanner.js';
import { useAuth, type CurrentAgent } from '../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../test/i18n.js';

const original = useAuth.getState();
const NOW = Date.parse('2026-11-02T09:00:00Z');

function agent(impersonation?: CurrentAgent['impersonation']): CurrentAgent {
  return {
    account_id: 'acc-1',
    email: 'agent@example.test',
    name: 'Agent',
    role: 'agent',
    organization_id: 'org-1',
    license_id: '1',
    scopes: [],
    routing_status: 'offline',
    ...(impersonation ? { impersonation } : {}),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  useAuth.setState({
    agent: original.agent,
    signOut: original.signOut,
    expireImpersonation: original.expireImpersonation,
  });
  resetLocale();
});

describe('ImpersonationBanner', () => {
  it('formats the countdown', () => {
    expect(countdown(29 * 60_000 + 41_000)).toBe('29:41');
    expect(countdown(5_000)).toBe('0:05');
    expect(countdown(3_600_000 + 61_000)).toBe('1:01:01');
    expect(countdown(-1)).toBe('0:00');
  });

  it('is not there for a member’s own session', () => {
    useAuth.setState({ agent: agent() });
    render(<ImpersonationBanner />);
    expect(screen.queryByTestId('impersonation-banner')).toBeNull();
  });

  it('names the member, the mode and the time left, and counts down', () => {
    useAuth.setState({
      agent: agent({
        session_id: 's-1',
        mode: 'read_only',
        ends_at: new Date(NOW + 30 * 60_000).toISOString(),
      }),
    });
    render(
      <StrictMode>
        <ImpersonationBanner />
      </StrictMode>,
    );
    const band = screen.getByRole('region', { name: 'Support session' });
    expect(band).toHaveTextContent('Signed in as agent@example.test — read-only');
    expect(band).toHaveTextContent('Ends in 30:00');
    act(() => {
      vi.advanceTimersByTime(19_000);
    });
    // One tick a second, not two — StrictMode's second mount replaced the first interval.
    expect(band).toHaveTextContent('Ends in 29:41');
  });

  it('ends the session on the server from its button', () => {
    const signOut = vi.fn(async () => undefined);
    useAuth.setState({
      signOut,
      agent: agent({
        session_id: 's-1',
        mode: 'full',
        ends_at: new Date(NOW + 60_000).toISOString(),
      }),
    });
    render(<ImpersonationBanner />);
    expect(screen.getByTestId('impersonation-banner')).toHaveTextContent(/full access/);
    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Ending…' })).toBeDisabled();
  });

  it('forgets the session when the countdown runs out', () => {
    const expireImpersonation = vi.fn();
    useAuth.setState({
      expireImpersonation,
      agent: agent({
        session_id: 's-1',
        mode: 'read_only',
        ends_at: new Date(NOW + 2_000).toISOString(),
      }),
    });
    render(<ImpersonationBanner />);
    expect(expireImpersonation).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(expireImpersonation).toHaveBeenCalled();
  });

  it('speaks Turkish', () => {
    useAuth.setState({
      agent: agent({
        session_id: 's-1',
        mode: 'read_only',
        ends_at: new Date(NOW + 60_000).toISOString(),
      }),
    });
    renderWithLocale(<ImpersonationBanner />, 'tr');
    expect(screen.getByRole('region', { name: 'Destek oturumu' })).toHaveTextContent('salt okunur');
    expect(screen.getByRole('button', { name: 'Oturumu bitir' })).toBeInTheDocument();
  });
});
