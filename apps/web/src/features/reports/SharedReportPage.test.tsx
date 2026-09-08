/**
 * The page a share link opens (FR-MOD-07.3.1).
 *
 * Three properties, and two of them are refusals:
 *
 *   - the token is read from the **fragment** and handed to the API as a query
 *     parameter — the pair of hops that keeps it out of the web host's log and
 *     out of the API's alike;
 *   - every failure reads the same. The API answers one indistinguishable 404
 *     for unknown/expired/revoked (NFR-S5), and this page must not undo that by
 *     guessing which happened;
 *   - and the positive: the group's table renders as the table it is.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiClientModule from '../../lib/api-client.js';
import { ApiClientError } from '../../lib/api-client.js';
import { resetLocale } from '../../test/i18n.js';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('../../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    ApiClient: class {
      get = get;
    },
  };
});

const { SharedReportPage, tokenFromHash } = await import('./SharedReportPage.js');

const TOKEN = 'ZmFrZS1zaGFyZS10b2tlbi12YWx1ZQ';

const REPORT = {
  group: 'overview',
  label: 'Overview',
  from: '2026-06-26T00:00:00.000Z',
  to: '2026-07-26T00:00:00.000Z',
  generated_at: '2026-07-26T09:00:00.000Z',
  expires_at: '2026-08-02T09:00:00.000Z',
  headers: ['metric', 'value'],
  rows: [
    ['chats', 12],
    ['tickets', 3],
  ],
};

function renderPage(hash: string): void {
  window.location.hash = hash;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SharedReportPage />
    </QueryClientProvider>,
  );
}

describe('shared report page (FR-MOD-07.3.1)', () => {
  beforeEach(() => {
    resetLocale();
    get.mockResolvedValue(REPORT);
  });

  afterEach(() => {
    window.location.hash = '';
    vi.clearAllMocks();
  });

  it('reads the token from the fragment and sends it as a query parameter', async () => {
    renderPage(`#token=${TOKEN}`);

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(`/reports/shared?token=${TOKEN}`);
  });

  it('accepts a link whose `token=` prefix was stripped in transit', () => {
    // Chat clients mangle URLs. A truncated prefix should still open the report
    // rather than reading as "no token at all".
    expect(tokenFromHash(`#${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`#token=${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash('#other=1')).toBeNull();
  });

  it('renders the group table it was given', async () => {
    renderPage(`#token=${TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'metric' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'chats' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '12' })).toBeInTheDocument();
  });

  it('says the same thing for every dead link', async () => {
    get.mockRejectedValue(
      new ApiClientError({ type: 'not_found', status: 404, message: 'Not found.', requestId: 'r' }),
    );
    renderPage(`#token=${TOKEN}`);

    // Never the server's message: the API deliberately answers the same 404 for
    // unknown, expired and revoked, and repeating a per-case message here would
    // be the leak the uniformity exists to prevent.
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is no longer available.');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('never asks the API when the URL carries no token', async () => {
    renderPage('');

    expect(await screen.findByRole('alert')).toHaveTextContent('This link is incomplete.');
    expect(get).not.toHaveBeenCalled();
  });
});
