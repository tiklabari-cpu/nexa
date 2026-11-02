/**
 * The wizard's website step shows the install code (WG-13 · tm 349): the
 * server's own snippet, copy and mail-to-developer, a live "waiting / connected"
 * line fed by polling the site, and the installation guide link.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingWizard } from './OnboardingWizard.js';
import { useAuth } from '../../lib/auth-store.js';

const SNIPPET = [
  '<!-- SiyahTuş widget -->',
  '<script>',
  '  window.__siyahtus = { organizationId: "org-1", widgetOrigin: "https://w.test" };',
  '</script>',
  '<script async src="https://w.test/loader.js"></script>',
  '<noscript><a href="https://w.test/chat.html?organization_id=org-1" lang="en">Chat with us</a></noscript>',
].join('\n');

function okJson(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

interface Stub {
  fetchMock: ReturnType<typeof vi.fn>;
  /** Flip what `GET /websites/site-1` answers. */
  setStatus: (status: 'pending' | 'connected') => void;
}

function stubFetch(deployment: Record<string, unknown> = {}): Stub {
  let status: 'pending' | 'connected' = 'pending';
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    if (u.includes('/onboarding/state')) {
      return okJson({
        completed: false,
        completed_at: null,
        demo_seeded: false,
        demo_seeded_at: null,
        survey_answer: null,
        survey_answered_at: null,
      });
    }
    if (u.includes('/deployment')) return okJson(deployment);
    if (u.endsWith('/websites') && method === 'POST') {
      return okJson(
        { id: 'site-1', domain: 'shop.example', status: 'pending', snippet: SNIPPET },
        201,
      );
    }
    if (u.includes('/websites/site-1')) {
      return okJson({ id: 'site-1', domain: 'shop.example', status, snippet: SNIPPET });
    }
    if (u.includes('/settings/trusted-domains')) return okJson({}, 201);
    return okJson({});
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    setStatus: (next) => {
      status = next;
    },
  };
}

function renderWizard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/onboarding']}>
        <Routes>
          <Route path="/app/onboarding" element={<OnboardingWizard />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'robin@example.test',
      name: 'Robin Owner',
      role: 'owner',
      organization_id: 'org-1',
      license_id: '1000001',
      scopes: [],
      routing_status: 'accepting_chats',
      onboarding_completed: false,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OnboardingWizard website step (FR-MOD-00.4 · FR-MOD-08.5.2)', () => {
  it('shows the server install code, with the noscript line, once the site is added', async () => {
    stubFetch();
    renderWizard();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText('Website domain'), 'shop.example');
    await userEvent.click(screen.getByRole('button', { name: 'Add website' }));

    const code = await screen.findByTestId('website-snippet');
    expect(code).toHaveTextContent('window.__siyahtus');
    expect(code).toHaveTextContent(
      '<noscript><a href="https://w.test/chat.html?organization_id=org-1"',
    );
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
    // "Send to a developer" is a mailto: carrying the very same code.
    const mail = screen.getByRole('link', { name: 'Invite developer' });
    expect(mail.getAttribute('href')).toMatch(/^mailto:\?subject=/);
    expect(decodeURIComponent(mail.getAttribute('href') ?? '')).toContain(
      'organizationId: "org-1"',
    );
    // The wizard is a first install: the developer-only examples stay in Settings.
    expect(screen.queryByTestId('website-snippet-track-sale')).toBeNull();
  });

  it('copies the code to the clipboard and says so', async () => {
    stubFetch();
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderWizard();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.type(screen.getByLabelText('Website domain'), 'shop.example');
    await user.click(screen.getByRole('button', { name: 'Add website' }));

    await user.click(await screen.findByRole('button', { name: 'Copy code' }));
    expect(writeText).toHaveBeenCalledWith(SNIPPET);
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('waits on the widget, then turns to connected by itself when the site flips', async () => {
    const stub = stubFetch();
    renderWizard();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(screen.getByLabelText('Website domain'), 'shop.example');
    await userEvent.click(screen.getByRole('button', { name: 'Add website' }));

    const status = await screen.findByTestId('onboarding-connect-status');
    expect(status).toHaveTextContent('Waiting for the widget to load on shop.example');

    // The server writes `connected` on the widget's first handshake; the step
    // polls the site (every 5 s) and picks it up without a reload.
    stub.setStatus('connected');
    await waitFor(
      () =>
        expect(screen.getByTestId('onboarding-connect-status')).toHaveTextContent(
          'Connected — the widget is live on shop.example.',
        ),
      { timeout: 9_000 },
    );
    expect(
      stub.fetchMock.mock.calls.some(([url]) => String(url).includes('/websites/site-1')),
    ).toBe(true);
  }, 20_000);

  it('links to the installation guide before and after a site is added', async () => {
    stubFetch();
    renderWizard();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('link', { name: 'Installation guide' })).toHaveAttribute(
      'href',
      '/help/install-guide.html',
    );
    await userEvent.type(screen.getByLabelText('Website domain'), 'shop.example');
    await userEvent.click(screen.getByRole('button', { name: 'Add website' }));
    await screen.findByTestId('website-snippet');
    expect(screen.getByRole('link', { name: 'Installation guide' })).toBeInTheDocument();
  });

  it('uses the deployment own guide address when it names one', async () => {
    stubFetch({ install_guide_url: 'https://help.example.com/install' });
    renderWizard();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Installation guide' })).toHaveAttribute(
        'href',
        'https://help.example.com/install',
      ),
    );
  });
});
