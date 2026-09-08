/**
 * Share (FR-MOD-07.3.1) — the control that mints, shows and withdraws a link.
 *
 * The property that carries the requirement is "shown once". The server keeps
 * only a digest, so a token that is still on screen after the modal closes is
 * not a cosmetic slip — it is the one copy of a live credential sitting in a DOM
 * nobody will look at again. So the test that matters most is the negative:
 * re-opening Share shows the row and never the token.
 *
 * Alongside it, the two things a link is for — the URL is copyable, and it can
 * be withdrawn from the same place it was minted — plus the fragment form,
 * which is what keeps the credential out of the web host's log and out of
 * `Referer`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { ShareControl, shareUrl, SHARED_REPORT_PATH } = await import('./ShareControl.js');

const TOKEN = 'ZmFrZS1zaGFyZS10b2tlbi12YWx1ZQ';
const RANGE = { from: '2026-06-26T00:00:00.000Z', to: '2026-07-26T00:00:00.000Z' };

const LINK = {
  id: 'a4a3f0d2-3f9e-4c1e-9a3b-2f1d0c9b8a77',
  group: 'overview',
  from: RANGE.from,
  to: RANGE.to,
  token_last_four: TOKEN.slice(-4),
  created_at: '2026-07-26T09:00:00.000Z',
  expires_at: '2026-08-02T09:00:00.000Z',
  revoked_at: null,
  expired: false,
};

function renderControl(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ShareControl group="overview" range={RANGE} />
    </QueryClientProvider>,
  );
}

describe('report share control (FR-MOD-07.3.1)', () => {
  beforeEach(() => {
    resetLocale();
    api.get.mockResolvedValue({ items: [] });
    api.post.mockResolvedValue({ ...LINK, token: TOKEN });
    api.delete.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows the link once, and never again', async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole('button', { name: 'Share this report' }));
    // The list has to have loaded before the row assertion below means
    // anything; the empty first render would satisfy "no token" trivially.
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/reports/share-links'));

    api.get.mockResolvedValue({ items: [LINK] });
    await user.click(screen.getByRole('button', { name: 'Create link' }));

    const shown = await screen.findByTestId('report-share-url');
    expect(shown).toHaveTextContent(TOKEN);

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('report-share-url')).not.toBeInTheDocument();

    // Re-opening shows the row — identified by its last four — and nowhere in
    // the document is the token itself. This is the assertion the whole
    // "stored as a digest" arrangement exists to make true.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: `Revoke the link ending ${LINK.token_last_four}` }),
      ),
    );
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('offers the link as a fragment URL, so the token is never sent to a server', () => {
    const url = shareUrl('https://panel.nexa.test', TOKEN);

    expect(url).toBe(`https://panel.nexa.test${SHARED_REPORT_PATH}#token=${TOKEN}`);
    // The distinction is the whole point: a query string reaches the web host's
    // access log and the `Referer` of anything the page loads; a fragment does
    // not leave the browser.
    expect(url.split('#')[0]).not.toContain(TOKEN);
  });

  it('copies the link to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // `vi.stubGlobal` rather than redefining the property: `userEvent.setup()`
    // installs its own clipboard stub, and swapping the whole `navigator` is
    // how the repo's other copy tests (`McpConnection`) stay in front of it.
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    renderControl();

    await userEvent.click(screen.getByRole('button', { name: 'Share this report' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create link' }));
    await screen.findByTestId('report-share-url');
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith(shareUrl(window.location.origin, TOKEN));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('mints for the tab and window on screen, with the chosen lifetime', async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole('button', { name: 'Share this report' }));
    await user.selectOptions(screen.getByLabelText('Expires'), '30');
    await user.click(screen.getByRole('button', { name: 'Create link' }));

    // A share is the view in front of the agent, not a second set of choices.
    expect(api.post).toHaveBeenCalledWith('/reports/share-links', {
      group: 'overview',
      from: RANGE.from,
      to: RANGE.to,
      expires_in_days: 30,
    });
  });

  it('revokes a link from the same place it was minted', async () => {
    api.get.mockResolvedValue({ items: [LINK] });
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole('button', { name: 'Share this report' }));
    await user.click(
      await screen.findByRole('button', {
        name: `Revoke the link ending ${LINK.token_last_four}`,
      }),
    );

    expect(api.delete).toHaveBeenCalledWith(`/reports/share-links/${LINK.id}`);
  });

  it('marks a lapsed link instead of hiding it', async () => {
    api.get.mockResolvedValue({ items: [{ ...LINK, expired: true }] });
    renderControl();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Share this report' }));

    // "Why did my link stop working?" has to be answerable from the screen.
    expect(await screen.findByText(/^Expired /)).toBeInTheDocument();
  });

  it("surfaces the server's own refusal rather than failing silently", async () => {
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'authorization',
        status: 403,
        message: 'This token cannot share the overview report.',
        requestId: 'req_1',
      }),
    );
    const user = userEvent.setup();
    renderControl();

    await user.click(screen.getByRole('button', { name: 'Share this report' }));
    await user.click(screen.getByRole('button', { name: 'Create link' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('report-share-url')).not.toBeInTheDocument();
  });
});
