/**
 * Webhook subscriptions + manifest reference (09.4-f): these tests prove the
 * screen is a pure contract consumer — the event dropdown comes from the
 * manifest response (never a hard-coded copy), a server 400 lands under the
 * URL field, and the signing secret is shown exactly once and never listed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_CATALOG } from '@nexa/types';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { WebhookSubscriptions, IntegrationManifestReference, AUTOMATION_APPS_LIMIT } =
  await import('./WebhookSubscriptions.js');

function renderComponent(ui: 'webhooks' | 'manifest', canEdit = true): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      {ui === 'webhooks' ? (
        <WebhookSubscriptions canEdit={canEdit} />
      ) : (
        <IntegrationManifestReference />
      )}
    </QueryClientProvider>,
  );
}

// A manifest with one trigger no real `WEBHOOK_ACTION` uses — its presence in
// the dropdown is what proves the options come from this response, not a
// static list copied into the component.
const manifest = {
  triggers: [
    {
      action: 'chat_started',
      label: 'Chat started',
      description: 'Fires when a new chat begins.',
      sample_payload: { action: 'chat_started', data: {} },
    },
    {
      action: 'manifest_only_trigger',
      label: 'Manifest-only trigger',
      description: 'A trigger that exists only in this test’s mocked manifest.',
      sample_payload: { action: 'manifest_only_trigger', data: {} },
    },
  ],
  actions: [
    {
      id: 'send_message',
      method: 'POST',
      path: '/chats/{chatId}/events',
      label: 'Send a message',
      required_scopes: ['chats--all:rw', 'chats--access:rw'],
    },
  ],
  subscribe: { method: 'POST', path: '/webhooks' },
  unsubscribe: { method: 'DELETE', path: '/webhooks/{webhookId}' },
};

const registeredWebhook = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  url: 'https://hooks.example.com/receiver',
  action: 'chat_started',
  type: 'license' as const,
  enabled: true,
  created_at: '2026-08-01T00:00:00.000Z',
  app_id: null as string | null,
};

/**
 * A connected automation card (FR-MOD-09.4). Only cards that come back with
 * live `automation` figures may own a subscription, so this is exactly the
 * shape the form filters on.
 */
const connectedZapier = {
  id: 'zapier',
  name: 'Zapier',
  installed: true,
  installation: { automation: { triggers: 1, last_run_at: null } },
};

function mockList(
  items: (typeof registeredWebhook)[],
  automationApps: (typeof connectedZapier)[] = [],
): void {
  api.get.mockImplementation((path: string) => {
    if (path === '/webhooks') return Promise.resolve({ items });
    if (path === '/integrations/manifest') return Promise.resolve(manifest);
    if (path.startsWith('/settings/apps')) return Promise.resolve({ items: automationApps });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

async function fillSubscribeForm(url: string, action = 'chat_started'): Promise<void> {
  await userEvent.type(await screen.findByLabelText('URL'), url);
  await userEvent.selectOptions(screen.getByLabelText('Event'), action);
}

describe('WebhookSubscriptions', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.delete.mockReset();
  });

  it('renders a meaningful empty state when there are no webhooks', async () => {
    mockList([]);
    renderComponent('webhooks');

    expect(await screen.findByText('No webhook subscriptions yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Subscribe a URL to be notified the moment a chat starts/),
    ).toBeInTheDocument();
  });

  it('derives the event options from the integration manifest, not a static list', async () => {
    mockList([]);
    renderComponent('webhooks');

    // Present only because the mocked manifest response carries it — the
    // component has no other source for this label.
    expect(
      await screen.findByRole('option', { name: 'Manifest-only trigger' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Chat started' })).toBeInTheDocument();
  });

  it('subscribes a webhook, shows the secret once, then never lists it', async () => {
    let items: (typeof registeredWebhook)[] = [];
    api.get.mockImplementation((path: string) => {
      if (path === '/webhooks') return Promise.resolve({ items });
      if (path === '/integrations/manifest') return Promise.resolve(manifest);
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    api.post.mockImplementation(() => {
      items = [registeredWebhook];
      return Promise.resolve({ ...registeredWebhook, secret: 'whsec_mock-secret-value' });
    });
    renderComponent('webhooks');

    await fillSubscribeForm(registeredWebhook.url);
    await userEvent.click(screen.getByRole('button', { name: 'Subscribe' }));

    const secretDialog = await screen.findByRole('dialog', { name: 'Webhook subscribed' });
    expect(within(secretDialog).getByText('whsec_mock-secret-value')).toBeInTheDocument();
    expect(within(secretDialog).getByText(/will not be shown again/)).toBeInTheDocument();

    await userEvent.click(within(secretDialog).getByRole('button', { name: 'Done' }));

    // Discarded from state entirely, not merely hidden behind the closed panel.
    expect(screen.queryByText('whsec_mock-secret-value')).not.toBeInTheDocument();
    // The list — read from the server, which never returns a secret — never had it.
    await waitFor(() =>
      expect(screen.getByTestId(`webhook-${registeredWebhook.id}`)).toBeInTheDocument(),
    );
    expect(screen.getByTestId(`webhook-${registeredWebhook.id}`)).not.toHaveTextContent(
      'whsec_mock-secret-value',
    );
  });

  it('reflects a server 400 (private/loopback URL) as a field-under error on URL', async () => {
    mockList([]);
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'That address points at a private or internal host and cannot be fetched.',
        requestId: 'req_test',
      }),
    );
    renderComponent('webhooks');

    await fillSubscribeForm('http://127.0.0.1/receiver');
    await userEvent.click(screen.getByRole('button', { name: 'Subscribe' }));

    await waitFor(() =>
      expect(
        screen.getByText(
          'That address points at a private or internal host and cannot be fetched.',
        ),
      ).toBeInTheDocument(),
    );
    // The URL input carries the error — this is a field-under error, not a banner.
    expect(screen.getByLabelText(/URL/)).toHaveAttribute('aria-invalid', 'true');
  });

  it('deletes a webhook after confirmation', async () => {
    mockList([registeredWebhook]);
    api.delete.mockResolvedValue(undefined);
    renderComponent('webhooks');

    await userEvent.click(
      await screen.findByRole('button', { name: `Delete webhook for ${registeredWebhook.url}` }),
    );
    const confirmDialog = screen.getByRole('dialog', {
      name: `Delete webhook for ${registeredWebhook.url}?`,
    });
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete webhook' }));

    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith(`/webhooks/${registeredWebhook.id}`),
    );
  });

  it('hides Subscribe and Delete when canEdit is false', async () => {
    mockList([registeredWebhook]);
    renderComponent('webhooks', false);

    await screen.findByTestId(`webhook-${registeredWebhook.id}`);
    expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `Delete webhook for ${registeredWebhook.url}` }),
    ).not.toBeInTheDocument();
  });
});

describe('IntegrationManifestReference', () => {
  beforeEach(() => {
    api.get.mockReset();
  });

  it('renders the trigger + action catalogue read from the manifest endpoint', async () => {
    api.get.mockImplementation((path: string) => {
      if (path === '/integrations/manifest') return Promise.resolve(manifest);
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    renderComponent('manifest');

    expect(await screen.findByText('Chat started')).toBeInTheDocument();
    expect(screen.getByText('Fires when a new chat begins.')).toBeInTheDocument();
    expect(screen.getByText('Send a message')).toBeInTheDocument();
    expect(screen.getByText('/chats/{chatId}/events')).toBeInTheDocument();
    expect(screen.getByText('/webhooks')).toBeInTheDocument();
    expect(screen.getByText('/webhooks/{webhookId}')).toBeInTheDocument();
  });
});

describe('WebhookSubscriptions localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the webhooks tab in Turkish when that is the active locale', async () => {
    mockList([]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <WebhookSubscriptions canEdit />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByText('Henüz webhook aboneliği yok')).toBeInTheDocument();
    expect(screen.getByText('Olay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abone ol' })).toBeInTheDocument();
  });
});

/**
 * The Zapier/Make leg (FR-MOD-09.4). A subscription may name the automation
 * card it belongs to, and the option only exists for a card this workspace has
 * actually connected — the server refuses any other, so offering one here would
 * produce a 400 the person cannot act on.
 */
describe('WebhookSubscriptions — automation card (FR-MOD-09.4)', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.delete.mockReset();
  });

  it('offers no automation field when no automation card is connected', async () => {
    mockList([]);
    renderComponent('webhooks');

    await screen.findByLabelText('URL');
    expect(screen.queryByLabelText('Automation app')).not.toBeInTheDocument();
  });

  it('sends the chosen card with the subscription', async () => {
    mockList([], [connectedZapier]);
    api.post.mockResolvedValue({
      ...registeredWebhook,
      app_id: 'zapier',
      secret: 'whsec_mock-secret-value',
    });
    renderComponent('webhooks');

    await fillSubscribeForm(registeredWebhook.url);
    await userEvent.selectOptions(await screen.findByLabelText('Automation app'), 'zapier');
    await userEvent.click(screen.getByRole('button', { name: 'Subscribe' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/webhooks', {
        url: registeredWebhook.url,
        action: 'chat_started',
        app_id: 'zapier',
      }),
    );
  });

  it('leaves app_id out entirely when the card is left unselected', async () => {
    mockList([], [connectedZapier]);
    api.post.mockResolvedValue({ ...registeredWebhook, secret: 'whsec_mock-secret-value' });
    renderComponent('webhooks');

    await fillSubscribeForm(registeredWebhook.url);
    await userEvent.click(screen.getByRole('button', { name: 'Subscribe' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/webhooks', {
        url: registeredWebhook.url,
        action: 'chat_started',
      }),
    );
  });

  // The two `app_id` refusals are the server's, and they belong under the field
  // they are about — not under URL, which is where every other 400 lands.
  it('pins the server’s app_id refusal under the automation field', async () => {
    mockList([], [connectedZapier]);
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'app_id: connect Zapier in the app marketplace first.',
        requestId: 'req_test',
      }),
    );
    renderComponent('webhooks');

    await fillSubscribeForm(registeredWebhook.url);
    await userEvent.selectOptions(await screen.findByLabelText('Automation app'), 'zapier');
    await userEvent.click(screen.getByRole('button', { name: 'Subscribe' }));

    await waitFor(() =>
      expect(
        screen.getByText('app_id: connect Zapier in the app marketplace first.'),
      ).toBeInTheDocument(),
    );
    // Regex, not an exact match: the rendered `FieldError` sits inside the same
    // `<label>`, so its text joins the field's accessible name.
    expect(screen.getByLabelText(/Automation app/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('URL')).not.toHaveAttribute('aria-invalid');
  });

  it('names the owning card on the subscription row', async () => {
    mockList([{ ...registeredWebhook, app_id: 'zapier' }], [connectedZapier]);
    renderComponent('webhooks');

    const row = await screen.findByTestId(`webhook-${registeredWebhook.id}`);
    // The card's display name, not its catalogue id.
    await waitFor(() => expect(within(row).getByText('via Zapier')).toBeInTheDocument());
  });

  /**
   * The other half of this screen's `paging-exempt` (tm 215, NFR-P5).
   *
   * The automation-app request pins a `limit` and sends no cursor, which
   * `audit:unpaged-lists` reports unless the source says why. The reason given
   * there is that the list being capped is a compile-time constant rather than
   * tenant data — so the claim that has to stay true is this one, and a bare
   * comment cannot hold it. Adding a 101st `productivity` card turns this red
   * instead of silently truncating the dropdown.
   */
  it('asks for the whole productivity section in one page (NFR-P5)', () => {
    const productivity = APP_CATALOG.filter((entry) => entry.category === 'productivity');
    expect(productivity.length).toBeGreaterThan(0);
    expect(productivity.length).toBeLessThanOrEqual(AUTOMATION_APPS_LIMIT);
  });
});
