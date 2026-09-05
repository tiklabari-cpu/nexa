/**
 * The composer's `#` picker, once saved replies have team scope (FR-MOD-08.7.2).
 *
 * The narrowing is the server's job — `GET /settings/canned-responses` returns
 * the workspace-wide replies plus the caller's teams', and nothing else leaves
 * the API. What has to stay true on this side is that the picker is a *view of
 * that response*: it offers what arrived, it does not re-filter, and above all
 * it does not go looking for the library anywhere else. A second, unfiltered
 * source would put another team's text in an agent's composer while every
 * server-side test stayed green, so the request the picker makes is asserted as
 * well as what it renders.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';

/** What a Sales agent's session gets back: the public reply plus their team's. */
const VISIBLE_TO_SALES = [
  { id: 'c1', shortcut: 'hello', text: 'Hi there!' },
  { id: 'c2', shortcut: 'discount', text: 'I can offer 10% this week.' },
];

function setup(items = VISIBLE_TO_SALES): { textarea: HTMLTextAreaElement; urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      urls.push(typeof input === 'string' ? input : String(input));
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ items }),
      };
    }),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Composer chatId="CHAT1" disabled={false} />
    </QueryClientProvider>,
  );
  return { textarea: screen.getByLabelText('Reply to the customer') as HTMLTextAreaElement, urls };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Composer — the `#` picker over team-scoped replies (FR-MOD-08.7.2)', () => {
  it('reads the library from the endpoint that applies the team scope', async () => {
    const { urls } = setup();

    await waitFor(() => expect(urls.length).toBeGreaterThan(0));
    // Not a bare `/settings/canned-responses` on some other host, and not a
    // per-team list the client stitches together: the one narrowed endpoint.
    expect(urls.some((url) => url.includes('/settings/canned-responses?scope=chat'))).toBe(true);
  });

  it("offers a team's reply to a member of that team", async () => {
    const { textarea } = setup();

    await userEvent.type(textarea, '#dis');

    const option = await screen.findByRole('option', { name: /discount/ });
    expect(option).toBeInTheDocument();
  });

  it('offers nothing for a reply the server withheld', async () => {
    // The Billing team's `#refundpolicy` is simply not in the response — the
    // filter ran before it reached the browser. The picker must have no other
    // way to reach it.
    const { textarea } = setup();

    await userEvent.type(textarea, '#refundpolicy');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('inserts the text of the reply that was picked', async () => {
    const { textarea } = setup();

    await userEvent.type(textarea, '#dis');
    await userEvent.click(await screen.findByRole('option', { name: /discount/ }));

    await waitFor(() => expect(textarea.value).toBe('I can offer 10% this week. '));
  });

  it('shows nothing at all when the caller is in no team and there are no public replies', async () => {
    const { textarea } = setup([]);

    await userEvent.type(textarea, '#');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
