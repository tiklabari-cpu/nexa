/**
 * Settings deletions ask first (tm 259.7, UX audit Y3).
 *
 * Eleven buttons used to DELETE on a single click — removing a website stopped
 * the widget on that site with nothing in between. Each now opens the shared
 * confirmation dialog: no request leaves until "Delete"/"Remove" is pressed in
 * it, Cancel sends nothing, and the confirmed click sends exactly one request.
 * One table, so a twelfth site cannot be added without a row here.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ApiClientError } from '../../lib/api-client.js';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api, useBrand: () => ({ id: 'brand-1' }) };
});

const {
  Tags,
  CannedResponses,
  RoutingRules,
  TicketRules,
  TicketEmailTemplates,
  ChatFormsSettings,
  CustomFieldsSettings,
  TrustedDomains,
  Skills,
} = await import('./SettingsPage.js');
const { Brands } = await import('./Brands.js');
const { WebsiteWidgets } = await import('./WebsiteWidgets.js');

const NOW = '2026-10-08T00:00:00.000Z';

interface Site {
  name: string;
  element: ReactElement;
  /** Path → body the screen's reads get. */
  reads: Record<string, unknown>;
  /** The row's own button, by accessible name. */
  trigger: string;
  /** What the dialog is titled. */
  title: string;
  /** The danger button's label in the dialog. */
  confirm: 'Delete' | 'Remove';
  deletePath: string;
  /** What a refused delete says in the dialog; absent where the row reads its own error. */
  refused?: string;
}

const SITES: Site[] = [
  {
    name: 'a website',
    element: <WebsiteWidgets canEdit />,
    reads: {
      '/websites': {
        items: [
          {
            id: 'site-1',
            domain: 'shop.example.com',
            setup: 'manual',
            status: 'connected',
            connected_at: NOW,
            created_at: NOW,
            snippet: '<script></script>',
          },
        ],
      },
      '/brands': { items: [{ id: 'brand-1', name: 'Acme' }] },
    },
    trigger: 'Remove shop.example.com',
    title: 'Remove shop.example.com?',
    confirm: 'Remove',
    deletePath: '/websites/site-1',
    refused: "“shop.example.com” couldn't be removed.",
  },
  {
    name: 'a tag',
    element: <Tags canEdit />,
    reads: {
      '/settings/tags': {
        items: [
          {
            id: 'tag-1',
            name: 'vip',
            group_ids: [],
            author_id: null,
            usage_count: 0,
            created_at: NOW,
          },
        ],
      },
      '/groups': { items: [] },
    },
    trigger: 'Delete tag vip',
    title: 'Delete tag “vip”?',
    confirm: 'Delete',
    deletePath: '/settings/tags/tag-1',
    refused: "“vip” couldn't be deleted.",
  },
  {
    name: 'a canned response',
    element: <CannedResponses canEdit />,
    reads: {
      '/settings/canned-responses?scope=chat': {
        items: [
          {
            id: 'canned-1',
            shortcut: 'shipping',
            text: 'Three to five working days.',
            scope: 'chat',
            group_id: null,
            visibility: 'all',
          },
        ],
      },
      '/groups': { items: [] },
    },
    trigger: 'Delete #shipping',
    title: 'Delete #shipping?',
    confirm: 'Delete',
    deletePath: '/settings/canned-responses/canned-1',
    refused: "“shipping” couldn't be deleted.",
  },
  {
    name: 'a routing rule',
    element: <RoutingRules canEdit />,
    reads: {
      '/settings/routing-rules': {
        items: [
          {
            id: 'rule-1',
            name: 'Checkout page',
            kind: 'url',
            conditions: {},
            target_group_id: null,
            target_group_name: null,
            priority: 1,
            is_fallback: false,
            enabled: true,
          },
        ],
      },
      '/settings/expertise': { items: [] },
      '/groups': { items: [] },
    },
    trigger: 'Delete rule Checkout page',
    title: 'Delete rule Checkout page?',
    confirm: 'Delete',
    deletePath: '/settings/routing-rules/rule-1',
    refused: "“Checkout page” couldn't be deleted.",
  },
  {
    name: 'a ticket rule',
    element: <TicketRules canEdit />,
    reads: {
      '/settings/ticket-rules': {
        items: [
          {
            id: 'tr-1',
            name: 'Urgent mail',
            conditions: { source: 'email' },
            actions: { priority: 3 },
            enabled: true,
            position: 1,
          },
        ],
      },
    },
    trigger: 'Delete rule Urgent mail',
    title: 'Delete rule Urgent mail?',
    confirm: 'Delete',
    deletePath: '/settings/ticket-rules/tr-1',
    refused: "“Urgent mail” couldn't be deleted.",
  },
  {
    name: 'a ticket e-mail template',
    element: <TicketEmailTemplates canEdit />,
    reads: {
      '/settings/ticket-email-templates': {
        items: [
          {
            id: 'tpl-1',
            name: 'Received',
            subject: 'We got it',
            body: 'Thanks.',
            enabled: true,
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      },
    },
    trigger: 'Delete template Received',
    title: 'Delete template Received?',
    confirm: 'Delete',
    deletePath: '/settings/ticket-email-templates/tpl-1',
    refused: "“Received” couldn't be deleted.",
  },
  {
    name: 'a chat form field',
    element: <ChatFormsSettings canEdit />,
    reads: {
      '/settings/custom-fields': {
        items: [
          {
            id: 'cf-form',
            entity: 'contact',
            label: 'Order number',
            type: 'text',
            required: false,
            form_placement: 'pre_chat',
            show_in_table: false,
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      },
    },
    trigger: 'Delete field Order number',
    title: 'Delete field Order number?',
    confirm: 'Delete',
    deletePath: '/settings/custom-fields/cf-form',
    refused: "“Order number” couldn't be deleted.",
  },
  {
    name: 'a custom field',
    element: <CustomFieldsSettings canEdit />,
    reads: {
      '/settings/custom-fields': {
        items: [
          {
            id: 'cf-crm',
            entity: 'contact',
            label: 'Plan tier',
            type: 'text',
            required: false,
            form_placement: null,
            show_in_table: false,
            created_at: NOW,
            updated_at: NOW,
          },
        ],
      },
    },
    trigger: 'Delete field Plan tier',
    title: 'Delete field Plan tier?',
    confirm: 'Delete',
    deletePath: '/settings/custom-fields/cf-crm',
  },
  {
    name: 'a brand',
    element: <Brands canEdit />,
    reads: {
      '/brands': {
        items: [
          {
            id: 'brand-1',
            name: 'Default',
            slug: 'default',
            logo_url: null,
            is_default: true,
            created_at: NOW,
          },
          {
            id: 'brand-2',
            name: 'Acme EU',
            slug: 'acme-eu',
            logo_url: null,
            is_default: false,
            created_at: NOW,
          },
        ],
      },
    },
    trigger: 'Remove Acme EU',
    title: 'Remove Acme EU?',
    confirm: 'Remove',
    deletePath: '/brands/brand-2',
  },
  {
    name: 'a trusted domain',
    element: <TrustedDomains canEdit />,
    reads: {
      '/settings/trusted-domains': {
        items: [
          {
            id: 'td-1',
            domain: 'example.com',
            include_subdomains: false,
            created_at: NOW,
          },
        ],
      },
    },
    trigger: 'Remove',
    title: 'Remove example.com?',
    confirm: 'Remove',
    deletePath: '/settings/trusted-domains/td-1',
    refused: "“example.com” couldn't be removed.",
  },
  {
    name: 'a skill',
    element: <Skills canEdit />,
    reads: { '/settings/expertise': { items: [{ id: 7, name: 'Billing', slug: 'billing' }] } },
    trigger: 'Delete skill Billing',
    title: 'Delete skill Billing?',
    confirm: 'Delete',
    deletePath: '/settings/expertise/7',
    refused: "“Billing” couldn't be deleted.",
  },
];

function renderSite(site: Site): void {
  api.get.mockImplementation((path: string) =>
    path in site.reads ? Promise.resolve(site.reads[path]) : Promise.reject(new Error(path)),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{site.element}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  api.delete.mockResolvedValue(undefined);
});

describe('settings deletions ask first (tm 259.7)', () => {
  it.each(SITES)('$name: no request until the dialog is confirmed', async (site) => {
    const user = userEvent.setup();
    renderSite(site);

    await user.click(await screen.findByRole('button', { name: site.trigger }));

    const dialog = screen.getByRole('dialog', { name: site.title });
    expect(api.delete).not.toHaveBeenCalled();
    // The safe choice has the focus.
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();

    await user.click(within(dialog).getByRole('button', { name: site.confirm }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledTimes(1));
    expect(api.delete).toHaveBeenCalledWith(site.deletePath);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it.each(SITES)('$name: Cancel and Escape send nothing', async (site) => {
    const user = userEvent.setup();
    renderSite(site);

    await user.click(await screen.findByRole('button', { name: site.trigger }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: site.trigger }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    expect(api.delete).not.toHaveBeenCalled();
  });
});

describe('removing a website', () => {
  it('says the widget stops on that site, and the button is disabled while the request runs', async () => {
    let finish: () => void = () => {};
    api.delete.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const user = userEvent.setup();
    renderSite(SITES[0]!);

    const trigger = await screen.findByRole('button', { name: 'Remove shop.example.com' });
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('The chat widget stops working on this site');

    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(trigger).toBeDisabled());
    expect(within(dialog).getByRole('button', { name: 'Working…' })).toBeDisabled();

    finish();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.delete).toHaveBeenCalledTimes(1);
  });
});

describe('a refused deletion is said out loud (tm 259.9, UX audit Y3/O10)', () => {
  const REFUSING = SITES.filter((site) => site.refused);

  function refuse(): void {
    api.delete.mockRejectedValue(
      new ApiClientError({
        type: 'internal',
        status: 500,
        message: 'boom',
        requestId: 'req-1',
      }),
    );
  }

  it('covers every site that does not already read its own error', () => {
    // Brands and custom fields show `remove.error` beside the row since before
    // 259.9; the other nine were silent and are the ones this block pins.
    expect(REFUSING.map((site) => site.name)).toHaveLength(9);
    expect(SITES.filter((site) => !site.refused).map((site) => site.name)).toEqual([
      'a custom field',
      'a brand',
    ]);
  });

  it.each(REFUSING)('$name: a 500 keeps the dialog open with the reason', async (site) => {
    refuse();
    const user = userEvent.setup();
    renderSite(site);

    await user.click(await screen.findByRole('button', { name: site.trigger }));
    const dialog = screen.getByRole('dialog', { name: site.title });
    await user.click(within(dialog).getByRole('button', { name: site.confirm }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      `${site.refused} Something went wrong on our side — try again.`,
    );
    // Still there, and live again: the person can retry or give up.
    expect(screen.getByRole('dialog', { name: site.title })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: site.confirm })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it.each(REFUSING)(
    '$name: a retry that works closes the dialog and clears the alert',
    async (site) => {
      refuse();
      const user = userEvent.setup();
      renderSite(site);

      await user.click(await screen.findByRole('button', { name: site.trigger }));
      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: site.confirm }));
      await within(dialog).findByRole('alert');

      api.delete.mockResolvedValue(undefined);
      await user.click(within(dialog).getByRole('button', { name: site.confirm }));

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(api.delete).toHaveBeenCalledTimes(2);
    },
  );

  it('Cancel after a refusal closes it, and reopening starts without the old alert', async () => {
    refuse();
    const user = userEvent.setup();
    const site = SITES[1]!;
    renderSite(site);

    await user.click(await screen.findByRole('button', { name: site.trigger }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: site.confirm }),
    );
    await within(screen.getByRole('dialog')).findByRole('alert');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: site.trigger }));
    expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a network failure reads as a network failure, not as a server one', async () => {
    api.delete.mockRejectedValue(
      new ApiClientError({ type: 'network', status: 0, message: 'offline', requestId: '' }),
    );
    const user = userEvent.setup();
    const site = SITES[1]!;
    renderSite(site);

    await user.click(await screen.findByRole('button', { name: site.trigger }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: site.confirm }),
    );

    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'Could not reach the server — check your connection.',
    );
  });
});
