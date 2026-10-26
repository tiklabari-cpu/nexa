/**
 * Where "enter as the customer" lands, and where it ends (tm 389.15 ·
 * FR-ADMIN-21).
 *
 * The code is single-use and lives in the fragment: it is traded exactly once
 * (StrictMode mounts every effect twice), taken out of the address bar before
 * anything else happens, and a spent or late code says what to do rather than
 * "authentication failed".
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no title carries one as a
 * requirement tag (CONVENTIONS §7.3).
 */
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handoffCodeOf, ImpersonatePage, ImpersonationEndedPage } from './ImpersonatePage.js';
import { ApiClientError } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const original = useAuth.getState();

async function renderAt(hash: string): Promise<void> {
  window.history.replaceState(null, '', `/auth/impersonate${hash}`);
  await act(async () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/auth/impersonate']}>
          <ImpersonatePage />
        </MemoryRouter>
      </StrictMode>,
    );
  });
}

afterEach(() => {
  useAuth.setState({ startImpersonation: original.startImpersonation });
  window.history.replaceState(null, '', '/');
});

describe('ImpersonatePage', () => {
  it('reads the code from the fragment', () => {
    expect(handoffCodeOf('#code=abc-123_x')).toBe('abc-123_x');
    expect(handoffCodeOf('#code=')).toBeNull();
    expect(handoffCodeOf('')).toBeNull();
  });

  it('trades the code once, and takes it out of the address bar first', async () => {
    const startImpersonation = vi.fn(async () => undefined);
    useAuth.setState({ startImpersonation });

    await renderAt('#code=one-time-code');

    await waitFor(() => expect(startImpersonation).toHaveBeenCalledWith('one-time-code'));
    expect(startImpersonation).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/auth/impersonate');
    expect(screen.getByRole('status')).toHaveTextContent(/Opening the support session/);
  });

  it('says a link with no code is one, and trades nothing', async () => {
    const startImpersonation = vi.fn(async () => undefined);
    useAuth.setState({ startImpersonation });

    await renderAt('');

    expect(await screen.findByRole('alert')).toHaveTextContent(/no session code/);
    expect(startImpersonation).not.toHaveBeenCalled();
  });

  it('says a spent or late code is used up — not "authentication failed"', async () => {
    useAuth.setState({
      startImpersonation: vi.fn(async () => {
        throw new ApiClientError({
          type: 'authentication',
          status: 401,
          message: 'This link is no longer valid.',
          requestId: 'req_imp1',
        });
      }),
    });

    await renderAt('#code=spent');

    expect(await screen.findByRole('alert')).toHaveTextContent(/already been used or has expired/);
    expect(screen.getByText(/each link works once, for one minute/)).toBeInTheDocument();
  });
});

describe('ImpersonationEndedPage', () => {
  afterEach(() => resetLocale());

  it('says how the session ended, and that the tab can go', () => {
    render(<ImpersonationEndedPage reason="ended" />);
    expect(screen.getByRole('heading', { name: 'Support session over' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/You ended the session/);
    expect(screen.getByText('You can close this tab.')).toBeInTheDocument();
  });

  it('tells a run-out session from an unreachable server, in Turkish too', () => {
    const { unmount } = render(<ImpersonationEndedPage reason="expired" />);
    expect(screen.getByRole('status')).toHaveTextContent(/time ran out/);
    unmount();
    renderWithLocale(<ImpersonationEndedPage reason="unreachable" />, 'tr');
    expect(screen.getByRole('status')).toHaveTextContent('Sunucuya ulaşılamadı');
  });
});
