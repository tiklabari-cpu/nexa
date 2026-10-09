/**
 * `DeploymentGate` (tm 259.4): nothing under it renders before
 * `GET /deployment` has answered, a read that keeps failing stops on "cannot
 * reach the server" instead of on the ordinary deployment's screens, and an
 * answer once in is kept — a failed background refetch does not bring the
 * loading page back.
 *
 * The child is a probe that records every answer `useDeployment` gave it: the
 * point is not only that it renders eventually, but that it never once
 * rendered with the fallback's "pilot mode off".
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { DeploymentConfig } from '@siyahtus/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEPLOYMENT_QUERY_KEY, useDeployment } from '../lib/deployment.js';
import { resetLocale, setLocale } from '../test/i18n.js';
import { DeploymentGate } from './DeploymentGate.js';

const PILOT: DeploymentConfig = {
  pilot_mode: true,
  contact_email: 'pilot-desk@siyahtus.test',
  signup_enabled: true,
  email_verification_required: true,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const failure = (): Response => json({ error: { type: 'internal', message: 'down' } }, 500);

let seen: DeploymentConfig[] = [];

function Probe(): React.ReactElement {
  const deployment = useDeployment();
  seen.push(deployment);
  return <p>The app, pilot {String(deployment.pilot_mode)}</p>;
}

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <DeploymentGate>
        <Probe />
      </DeploymentGate>
    </QueryClientProvider>,
  );
  return { queryClient, ...view };
}

afterEach(() => {
  cleanup();
  seen = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetLocale();
});

describe('DeploymentGate', () => {
  it('shows only the loading page while the answer is on its way', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderGate();

    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    // The tab names the wait too (tm 261 · tm 259.20 O15): a row of tabs on a
    // slow start should not all read the bare product name.
    expect(document.title).toBe('Loading… · SiyahTuş');
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByText(/The app/)).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it('renders the app once the answer is in, and the app only ever sees that answer', async () => {
    const fetch = vi.fn(async () => json(PILOT));
    vi.stubGlobal('fetch', fetch);
    renderGate();

    expect(await screen.findByText('The app, pilot true')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((answer) => answer.pilot_mode)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('stops on "cannot reach the server" after three failed attempts, and "Try again" recovers', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => failure());
    vi.stubGlobal('fetch', fetch);
    renderGate();

    // Still loading through the retries: one failure is not an outage.
    await act(() => vi.advanceTimersByTimeAsync(2_999));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetch).toHaveBeenCalledTimes(3);
    // React Query hands the result to the screen on a timer of its own.
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(screen.getByRole('heading', { name: 'Cannot reach the server' })).toBeInTheDocument();
    expect(document.title).toBe('Cannot reach the server · SiyahTuş');
    expect(
      screen.getByText(
        'The app could not load its settings from the server. Check your connection and try again.',
      ),
    ).toBeInTheDocument();
    // Fail-closed: the app was never drawn on a guess.
    expect(screen.queryByText(/The app,/)).toBeNull();
    expect(seen).toHaveLength(0);

    // Nothing more is sent on its own.
    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(fetch).toHaveBeenCalledTimes(3);

    fetch.mockImplementation(async () => json(PILOT));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(screen.getByText('The app, pilot true')).toBeInTheDocument();
    expect(seen.every((answer) => answer.pilot_mode)).toBe(true);
  });

  it('keeps the app on a failed background refetch rather than going back to loading', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => json(PILOT));
    vi.stubGlobal('fetch', fetch);
    const { queryClient } = renderGate();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(screen.getByText('The app, pilot true')).toBeInTheDocument();

    fetch.mockImplementation(async () => failure());
    await act(async () => {
      void queryClient.refetchQueries({ queryKey: DEPLOYMENT_QUERY_KEY });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('The app, pilot true')).toBeInTheDocument();

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(queryClient.getQueryState(DEPLOYMENT_QUERY_KEY)?.status).toBe('error');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Cannot reach the server' })).toBeNull();
    expect(screen.getByText('The app, pilot true')).toBeInTheDocument();
  });

  it('says it in Turkish too (NFR-I18N2)', async () => {
    vi.useFakeTimers();
    setLocale('tr');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => failure()),
    );
    renderGate();
    expect(screen.getByRole('status')).toHaveTextContent('Yükleniyor…');

    await act(() => vi.advanceTimersByTimeAsync(3_010));
    expect(screen.getByRole('heading', { name: 'Sunucuya ulaşılamıyor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeniden dene' })).toBeInTheDocument();
  });
});
