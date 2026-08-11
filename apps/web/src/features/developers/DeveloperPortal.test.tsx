/**
 * Developer portal (09.4-e): list + register + secret-once panel + delete, all
 * against `/partner/apps` (09.4-c/-d)'s already-built contract. Every rule this
 * screen appears to enforce (redirect URI shape, scope ceiling) is actually the
 * server's — these tests only prove the screen shows what the server said.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { FOOTER, isNavVisible } from '../../components/navigation.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

let currentScopes: string[] = ['access_rules:rw'];

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { scopes: string[] } }) => unknown) =>
      selector({ agent: { scopes: currentScopes } }),
  };
});

const { DeveloperPortalPage } = await import('./DeveloperPortal.js');

function renderPortal(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DeveloperPortalPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const registeredApp = {
  client_id: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
  display_name: 'Acme Zap Connector',
  client_type: 'confidential' as const,
  redirect_uris: ['https://example.com/cb'],
  scopes: ['chats--all:ro'],
  created_at: '2026-08-01T00:00:00.000Z',
};

/** Fills the register form with a valid name, URI and one scope. */
async function fillValidForm(): Promise<void> {
  const dialog = screen.getByRole('dialog', { name: 'Register app' });
  await userEvent.type(within(dialog).getByLabelText('App name'), 'Acme Zap Connector');
  await userEvent.type(
    within(dialog).getByLabelText('Redirect URIs'),
    'https://example.com/oauth/callback',
  );
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'chats--all:ro' }));
}

describe('DeveloperPortal', () => {
  beforeEach(() => {
    currentScopes = ['access_rules:rw'];
    api.get.mockReset();
    api.post.mockReset();
    api.delete.mockReset();
  });

  it('renders a meaningful empty state when there are no partner apps', async () => {
    api.get.mockResolvedValue({ items: [] });
    renderPortal();

    expect(await screen.findByText('No partner apps yet')).toBeInTheDocument();
    expect(screen.getByText(/Register an OAuth client to let a script/)).toBeInTheDocument();
  });

  it('disables Register until a name is entered, with a field-under error', async () => {
    api.get.mockResolvedValue({ items: [] });
    renderPortal();

    await userEvent.click(await screen.findByRole('button', { name: 'Register app' }));
    const dialog = screen.getByRole('dialog', { name: 'Register app' });
    const submit = within(dialog).getByRole('button', { name: 'Register' });
    expect(submit).toBeDisabled();

    // Captured once: once the error renders it joins the label's own text (as
    // FieldError is nested inside it, like every other field on this form), so
    // a second `getByLabelText('App name')` after that point would stop matching.
    const nameField = within(dialog).getByLabelText('App name');

    // Touch and leave the name field empty — the field-under error surfaces on blur.
    await userEvent.click(nameField);
    await userEvent.tab();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a name for this app.');
    expect(submit).toBeDisabled();

    await userEvent.type(nameField, 'Acme Zap Connector');
    expect(within(dialog).queryByText('Enter a name for this app.')).not.toBeInTheDocument();
  });

  it('shows the secret once, then discards it from state and never lists it', async () => {
    // Stateful, like the real endpoint: the list reflects the app once it has
    // been registered, so the "never in the list" assertion below is proving
    // something (a static empty mock would make it vacuously true).
    let items: (typeof registeredApp)[] = [];
    api.get.mockImplementation(() => Promise.resolve({ items }));
    api.post.mockImplementation(() => {
      items = [registeredApp];
      return Promise.resolve({ ...registeredApp, client_secret: 'nxcs_mock-secret-value' });
    });
    renderPortal();

    await userEvent.click(await screen.findByRole('button', { name: 'Register app' }));
    await fillValidForm();
    const dialog = screen.getByRole('dialog', { name: 'Register app' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register' }));

    const secretDialog = await screen.findByRole('dialog', {
      name: 'Acme Zap Connector registered',
    });
    expect(within(secretDialog).getByText('nxcs_mock-secret-value')).toBeInTheDocument();
    expect(within(secretDialog).getByText(/will not be shown again/)).toBeInTheDocument();
    // The register modal itself is gone — only the secret panel remains.
    expect(screen.queryByRole('dialog', { name: 'Register app' })).not.toBeInTheDocument();

    await userEvent.click(within(secretDialog).getByRole('button', { name: 'Done' }));

    // Closing discards the secret from state: it is gone from the DOM entirely,
    // not just the (now-unmounted) panel that used to show it.
    expect(screen.queryByText('nxcs_mock-secret-value')).not.toBeInTheDocument();
    // The list (read from the server, which never returns a secret) never had it.
    expect(screen.queryByTestId(`partner-app-${registeredApp.client_id}`)).not.toHaveTextContent(
      'nxcs_mock-secret-value',
    );
  });

  it('reflects a server 400 (bad redirect_uri) as a visible error, not a silent failure', async () => {
    api.get.mockResolvedValue({ items: [] });
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'redirect_uri "javascript:alert(1)" is not acceptable: only https is allowed',
        requestId: 'req_test',
      }),
    );
    renderPortal();

    await userEvent.click(await screen.findByRole('button', { name: 'Register app' }));
    await fillValidForm();
    const dialog = screen.getByRole('dialog', { name: 'Register app' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register' }));

    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'redirect_uri "javascript:alert(1)" is not acceptable: only https is allowed',
      ),
    );
    // The dialog stays open on failure — nothing was silently thrown away.
    expect(screen.getByRole('dialog', { name: 'Register app' })).toBeInTheDocument();
  });

  it('deletes an app after confirmation', async () => {
    api.get.mockResolvedValue({ items: [registeredApp] });
    api.delete.mockResolvedValue(undefined);
    renderPortal();

    await userEvent.click(
      await screen.findByRole('button', { name: `Delete ${registeredApp.display_name}` }),
    );
    const confirmDialog = screen.getByRole('dialog', {
      name: `Delete ${registeredApp.display_name}?`,
    });
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete app' }));

    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith(`/partner/apps/${registeredApp.client_id}`),
    );
  });

  describe('tabs', () => {
    /** Path-aware, unlike the apps-only tests above: switching tabs means the
     *  Webhooks and Manifest panels issue their own `/webhooks` and
     *  `/integrations/manifest` requests, which need shapes of their own. */
    function mockTabbedResponses(): void {
      api.get.mockImplementation((path: string) => {
        if (path === '/integrations/manifest') {
          return Promise.resolve({
            triggers: [
              {
                action: 'chat_started',
                label: 'Chat started',
                description: 'Fires when a new chat begins.',
                sample_payload: {},
              },
            ],
            actions: [],
            subscribe: { method: 'POST', path: '/webhooks' },
            unsubscribe: { method: 'DELETE', path: '/webhooks/{webhookId}' },
          });
        }
        return Promise.resolve({ items: [] });
      });
    }

    it('switches between Apps, Webhooks and Manifest', async () => {
      mockTabbedResponses();
      renderPortal();

      expect(await screen.findByText('No partner apps yet')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('tab', { name: 'Webhooks' }));
      expect(await screen.findByText('No webhook subscriptions yet')).toBeInTheDocument();
      // The Apps-tab header action does not follow onto another tab.
      expect(screen.queryByRole('button', { name: 'Register app' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('tab', { name: 'Manifest' }));
      expect(await screen.findByText('Chat started')).toBeInTheDocument();
    });
  });

  describe('rotate secret', () => {
    const confidentialApp = { ...registeredApp, client_type: 'confidential' as const };
    const publicApp = {
      ...registeredApp,
      client_id: 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3',
      display_name: 'Acme Public Client',
      client_type: 'public' as const,
    };

    it('offers Rotate secret only for a confidential app', async () => {
      api.get.mockResolvedValue({ items: [confidentialApp, publicApp] });
      renderPortal();

      await screen.findByTestId(`partner-app-${confidentialApp.client_id}`);
      expect(
        screen.getByRole('button', { name: `Rotate secret for ${confidentialApp.display_name}` }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: `Rotate secret for ${publicApp.display_name}` }),
      ).not.toBeInTheDocument();
    });

    it('rotates a secret, shows it once, then discards it', async () => {
      api.get.mockResolvedValue({ items: [confidentialApp] });
      api.post.mockResolvedValue({
        ...confidentialApp,
        client_secret: 'nxcs_rotated-secret-value',
      });
      renderPortal();

      await userEvent.click(
        await screen.findByRole('button', {
          name: `Rotate secret for ${confidentialApp.display_name}`,
        }),
      );
      const confirmDialog = screen.getByRole('dialog', {
        name: `Rotate secret for ${confidentialApp.display_name}?`,
      });
      await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Rotate secret' }));

      expect(api.post).toHaveBeenCalledWith(
        `/partner/apps/${confidentialApp.client_id}/rotate-secret`,
      );
      const secretDialog = await screen.findByRole('dialog', {
        name: `${confidentialApp.display_name} secret rotated`,
      });
      expect(within(secretDialog).getByText('nxcs_rotated-secret-value')).toBeInTheDocument();

      await userEvent.click(within(secretDialog).getByRole('button', { name: 'Done' }));
      expect(screen.queryByText('nxcs_rotated-secret-value')).not.toBeInTheDocument();
    });
  });

  describe('access_rules:rw gate', () => {
    it('hides the portal for a caller without access_rules:rw', () => {
      currentScopes = [];
      renderPortal();

      expect(screen.getByText('Developer portal not available')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Register app' })).not.toBeInTheDocument();
      expect(api.get).not.toHaveBeenCalled();
    });

    it('hides the Developers nav entry for a caller without access_rules:rw', () => {
      const dest = FOOTER.find((item) => item.to === '/app/developers');
      expect(dest).toBeDefined();
      expect(isNavVisible(dest!, [])).toBe(false);
      expect(isNavVisible(dest!, ['access_rules:rw'])).toBe(true);
    });
  });
});
