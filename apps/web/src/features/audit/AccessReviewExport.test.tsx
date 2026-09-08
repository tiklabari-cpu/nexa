/**
 * Settings → Audit log: the access review download (tm 215 · NFR-C6 · CC6.1).
 *
 * `GET /reports/access-review` was complete and had no client at all, so what
 * these pin is the connection itself and the two things about it that are not
 * arbitrary: the request asks for the CSV of the section the button names, and
 * the file keeps the name the server gave it — the filename carries the section
 * and the day the snapshot was taken (`accessReviewFilename`), which is part of
 * the evidence rather than decoration.
 *
 * The role gate mirrors the endpoint's `minimumRole: 'admin'`, the same
 * courtesy hide `Compliance.tsx` uses. The route stays the real boundary; this
 * only keeps the console from showing a door that leads to a 403.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({ api: { getFile: vi.fn() } }));

let currentRole = 'admin';

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { role: string } }) => unknown) =>
      selector({ agent: { role: currentRole } }),
  };
});

const { AccessReviewExport } = await import('./AccessReviewExport.js');

/** The anchor the component builds and clicks, captured instead of followed. */
let clicked: HTMLAnchorElement | null = null;

/**
 * jsdom has neither object-URL plumbing nor real navigation — the same stub
 * `ReportsPage.test.tsx` and `BillingPage.test.tsx` install for their own
 * downloads, plus a capture of the anchor so the assigned filename can be read.
 */
function stubDownload(): void {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:review'),
    revokeObjectURL: vi.fn(),
  });
  // The anchor is appended to the body, clicked and removed, so it is in the
  // document for exactly the length of this call — read out of the DOM rather
  // than off `this`, which the lint rule rightly refuses to have aliased.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
    clicked = document.body.querySelector('a[download]');
  });
}

beforeEach(() => {
  currentRole = 'admin';
  clicked = null;
  api.getFile.mockReset();
  stubDownload();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetLocale();
});

describe('AccessReviewExport — access review evidence surface (NFR-C6)', () => {
  it('downloads the members CSV under the name the server assigned', async () => {
    api.getFile.mockResolvedValue({
      blob: new Blob(['email,role\n']),
      filename: 'nexa-access-review-members-2026-09-08.csv',
    });
    render(<AccessReviewExport />);

    await userEvent.click(screen.getByRole('button', { name: 'Download members (CSV)' }));

    await waitFor(() =>
      expect(api.getFile).toHaveBeenCalledWith('/reports/access-review?format=csv&section=members'),
    );
    // The date in that name is when the snapshot was taken; a client-invented
    // filename would drop it and the CSV would stop being dated evidence.
    await waitFor(() =>
      expect(clicked?.download).toBe('nexa-access-review-members-2026-09-08.csv'),
    );
  });

  it('asks for the credentials section from the other button', async () => {
    api.getFile.mockResolvedValue({ blob: new Blob(['id,kind\n']), filename: null });
    render(<AccessReviewExport />);

    await userEvent.click(screen.getByRole('button', { name: 'Download credentials (CSV)' }));

    await waitFor(() =>
      expect(api.getFile).toHaveBeenCalledWith(
        '/reports/access-review?format=csv&section=credentials',
      ),
    );
    // Only if the server sent no `content-disposition` at all.
    await waitFor(() => expect(clicked?.download).toBe('nexa-access-review-credentials.csv'));
  });

  it('shows the server’s own refusal rather than a generic failure', async () => {
    api.getFile.mockRejectedValue(
      new ApiClientError({
        type: 'authorization',
        status: 403,
        message: 'Insufficient scope.',
        requestId: 'req-1',
      }),
    );
    render(<AccessReviewExport />);

    await userEvent.click(screen.getByRole('button', { name: 'Download members (CSV)' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('hides entirely below admin, mirroring the route’s minimumRole', () => {
    currentRole = 'agent';
    const { container } = render(<AccessReviewExport />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says out loud that the report does not judge what it lists', async () => {
    renderWithLocale(<AccessReviewExport />, 'en');

    expect(
      await screen.findByText(/The report states facts and does not judge them/),
    ).toBeInTheDocument();
  });
});
