/**
 * The attach button hides when the licence has file sharing switched off
 * (FR-MOD-08.9.4). Before this, `Composer.tsx` never read the setting at
 * all — the button was always on screen, and an agent only learned sharing
 * was off after picking a file and getting `POST /uploads`'s 403 back.
 *
 * `GET /uploads-policy` is the one bit of `security_settings` every agent
 * role can read (`GET /settings/security` itself is admin-only); these tests
 * pin the button to its answer rather than to the fuller, unreachable one.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

function stubFetch(fileSharingEnabled: boolean): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/uploads-policy')) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ file_sharing_enabled: fileSharingEnabled }),
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ items: [] }),
      };
    }),
  );
}

function setup(fileSharingEnabled: boolean): void {
  stubFetch(fileSharingEnabled);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Composer chatId="CHAT1" disabled={false} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Composer — attach button (FR-MOD-08.9.4)', () => {
  it('shows the attach button while the licence allows file sharing', async () => {
    setup(true);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Attach a file' })).toBeInTheDocument(),
    );
  });

  it('hides the attach button once the licence switches file sharing off', async () => {
    setup(false);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Attach a file' })).not.toBeInTheDocument(),
    );
  });

  it('shows the button before the policy query has resolved — fails open, same default the endpoint itself falls back to', () => {
    setup(true);
    // Synchronous assertion: the query has not resolved yet, and the button
    // must already be on screen rather than flashing in after the fetch.
    expect(screen.getByRole('button', { name: 'Attach a file' })).toBeInTheDocument();
  });
});
