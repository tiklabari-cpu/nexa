/**
 * Campaigns page (FR-MOD-03.3). The two acceptance criteria this pins at the UI:
 * the status sub-tabs narrow the list (03.3.1), and each card shows the campaign's
 * Displayed / Chats / Conversion with a working on/off toggle (03.3.3) — with the
 * write controls hidden from a read-only agent.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Campaign, CampaignStatus } from '@siyahtus/types';
import { ApiClientError } from '../../lib/api-client.js';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api, auth } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  auth: { scopes: [] as string[] },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { scopes: string[] } }) => unknown) =>
      selector({ agent: { scopes: auth.scopes } }),
  };
});

const { CampaignsPage } = await import('./CampaignsPage.js');

function campaign(status: CampaignStatus, name: string, over: Partial<Campaign> = {}): Campaign {
  return {
    id: `c-${name}`,
    name,
    status,
    conditions: { url_contains: '/pricing' },
    content: { message: 'Hi' },
    starts_at: null,
    ends_at: null,
    recurring: false,
    created_at: '2026-07-26T12:00:00.000Z',
    performance: { displayed: 0, chats: 0, conversion: 0, suppressed: 0 },
    ...over,
  };
}

const LIST = {
  items: [
    campaign('ongoing', 'Running', {
      performance: { displayed: 200, chats: 30, conversion: 12, suppressed: 0 },
    }),
    campaign('scheduled', 'Later'),
    campaign('inactive', 'Off'),
  ],
  total: 3,
};

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <CampaignsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.get.mockResolvedValue(LIST);
  auth.scopes = ['customers:rw'];
});

describe('CampaignsPage', () => {
  it('filters the list by the status sub-tabs (FR-MOD-03.3.1)', async () => {
    renderPage();
    // All three visible on the default "All" tab.
    expect(await screen.findByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Later')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Ongoing/ }));

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.queryByText('Later')).not.toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
  });

  it("shows each campaign's Displayed / Chats / Conversion (FR-MOD-03.3.3)", async () => {
    renderPage();
    const card = (await screen.findByText('Running')).closest('div.rounded-lg') as HTMLElement;
    const stats = within(card);
    expect(stats.getByText('Displayed').parentElement).toHaveTextContent('200');
    expect(stats.getByText('Chats').parentElement).toHaveTextContent('30');
    // Conversion shows the count and its rate (12 / 200 = 6%).
    expect(stats.getByText('Conversion').parentElement).toHaveTextContent('12');
    expect(stats.getByText('Conversion').parentElement).toHaveTextContent('6%');
  });

  it('says how many matched players a risk flag kept it from, only when some were (EN-01 · tm 350)', async () => {
    api.get.mockResolvedValue({
      items: [
        campaign('ongoing', 'Bonus', {
          performance: { displayed: 5, chats: 0, conversion: 0, suppressed: 3 },
        }),
        campaign('ongoing', 'Clean'),
      ],
      total: 2,
    });
    renderPage();
    const bonus = (await screen.findByText('Bonus')).closest('div.rounded-lg') as HTMLElement;
    expect(within(bonus).getByTestId('campaign-suppressed')).toHaveTextContent(
      'Not shown due to risk: 3',
    );
    const clean = screen.getByText('Clean').closest('div.rounded-lg') as HTMLElement;
    expect(within(clean).queryByTestId('campaign-suppressed')).not.toBeInTheDocument();
  });

  it('toggles a campaign off (FR-MOD-03.3.3)', async () => {
    api.patch.mockResolvedValue(campaign('inactive', 'Running'));
    renderPage();
    const card = (await screen.findByText('Running')).closest('div.rounded-lg') as HTMLElement;

    await userEvent.click(within(card).getByRole('button', { name: 'Turn off' }));
    expect(api.patch).toHaveBeenCalledWith('/campaigns/c-Running', { active: false });
  });

  // Tm 259.9: a refused toggle used to change nothing and say nothing.
  it('a refused toggle shows why, and the card keeps its state', async () => {
    api.patch.mockRejectedValue(
      new ApiClientError({ type: 'internal', status: 500, message: 'x', requestId: 'r' }),
    );
    renderPage();
    const card = (await screen.findByText('Running')).closest('div.rounded-lg') as HTMLElement;

    await userEvent.click(within(card).getByRole('button', { name: 'Turn off' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "“Running” couldn't be turned off. Something went wrong on our side — try again.",
    );
    // Still on: the card is read from the server, which never said otherwise.
    expect(within(card).getByRole('button', { name: 'Turn off' })).toBeEnabled();
  });

  it('a refused turn-on says "turned on", and a retry that works clears it', async () => {
    api.patch.mockRejectedValueOnce(
      new ApiClientError({ type: 'network', status: 0, message: 'x', requestId: '' }),
    );
    api.patch.mockResolvedValueOnce({ ...campaign('ongoing', 'Off'), matched: 0 });
    renderPage();
    const card = (await screen.findByText('Off')).closest('div.rounded-lg') as HTMLElement;

    await userEvent.click(within(card).getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "“Off” couldn't be turned on. Could not reach the server",
    );

    await userEvent.click(within(card).getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  // `matched` — not `performance.displayed` — is what the "reached" notice
  // reads (tm 244): delivery is asynchronous, so `displayed` is always 0 in
  // the write response no matter how many visitors were just targeted.
  it('shows a reached-visitors banner when turning a campaign on matches visitors', async () => {
    api.patch.mockResolvedValue({
      ...campaign('ongoing', 'Off'),
      matched: 5,
    });
    renderPage();
    const card = (await screen.findByText('Off')).closest('div.rounded-lg') as HTMLElement;

    await userEvent.click(within(card).getByRole('button', { name: 'Turn on' }));
    expect(api.patch).toHaveBeenCalledWith('/campaigns/c-Off', { active: true });
    expect(await screen.findByText('“Off” reached 5 on-site visitors.')).toBeInTheDocument();
  });

  it('hides the write controls from a read-only agent', async () => {
    auth.scopes = ['customers:ro'];
    renderPage();
    await screen.findByText('Running');
    expect(screen.queryByRole('button', { name: 'New campaign' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  // Same fix, the other call site (tm 244): CampaignBuilder's create path
  // reads `matched` too, not `performance.displayed`.
  it('shows a reached-visitors banner when a newly-created campaign matches visitors', async () => {
    api.post.mockResolvedValue({
      ...campaign('ongoing', 'Pricing nudge'),
      matched: 3,
    });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'New campaign' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Pricing nudge');
    await userEvent.type(screen.getByLabelText('Rule 1 value'), '/pricing');
    await userEvent.type(screen.getByLabelText('Message'), 'Questions about pricing?');
    await userEvent.click(screen.getByRole('button', { name: 'Create campaign' }));

    expect(api.post).toHaveBeenCalledWith('/campaigns', expect.anything());
    expect(
      await screen.findByText('“Pricing nudge” reached 3 on-site visitors.'),
    ).toBeInTheDocument();
  });
});

describe('CampaignBuilder rules (EN-03 · tm 352.2)', () => {
  it('builds a trigger of several rules joined by "any", and saves exactly what was built (FR-MOD-03.3.2)', async () => {
    api.post.mockResolvedValue({ ...campaign('ongoing', 'Exit offer'), matched: 0 });
    renderPage();

    await userEvent.click(await screen.findByRole('button', { name: 'New campaign' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Exit offer');
    // Nothing to join yet: the match choice appears with the second rule.
    expect(screen.queryByLabelText('Reach visitors when')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Rule 1 value'), '/deposit');

    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 2 field'), 'time_on_page');
    await userEvent.type(screen.getByLabelText('Rule 2 value'), '30');

    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 3 field'), 'exit_intent');

    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    await userEvent.selectOptions(screen.getByLabelText('Rule 4 field'), 'custom_var');
    await userEvent.type(screen.getByLabelText('Rule 4 variable name'), 'plan');
    await userEvent.type(screen.getByLabelText('Rule 4 value'), 'premium');

    await userEvent.selectOptions(screen.getByLabelText('Reach visitors when'), 'any');
    await userEvent.type(screen.getByLabelText('Message'), 'Wait, ten percent off.');
    await userEvent.click(screen.getByRole('button', { name: 'Create campaign' }));

    expect(api.post).toHaveBeenCalledWith(
      '/campaigns',
      expect.objectContaining({
        conditions: {
          match: 'any',
          rules: [
            { field: 'current_url', op: 'contains', value: '/deposit' },
            { field: 'time_on_page', op: 'gte', value: 30 },
            { field: 'exit_intent', op: 'equals', value: true },
            { field: 'custom_var', op: 'contains', value: 'premium', key: 'plan' },
          ],
        },
      }),
    );
  });

  it('keeps Create off while a rule is unfinished or malformed, and says what is wrong', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'New campaign' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Late');
    await userEvent.type(screen.getByLabelText('Message'), 'Hi');
    const create = screen.getByRole('button', { name: 'Create campaign' });
    expect(create).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText('Rule 1 field'), 'time_on_page');
    await userEvent.type(screen.getByLabelText('Rule 1 value'), '99999');
    await userEvent.tab();
    expect(await screen.findByText('Whole seconds, from 1 to 3600.')).toBeInTheDocument();
    expect(create).toBeDisabled();

    await userEvent.clear(screen.getByLabelText('Rule 1 value'));
    await userEvent.type(screen.getByLabelText('Rule 1 value'), '45');
    expect(create).toBeEnabled();
  });

  it('opens a campaign saved in the first shape as one URL rule, and a many-rule one as rows', async () => {
    api.get.mockResolvedValue({
      items: [
        campaign('ongoing', 'Old'),
        campaign('ongoing', 'Many', {
          conditions: {
            match: 'all',
            rules: [
              { field: 'country', op: 'equals', value: 'TR' },
              { field: 'visitor_type', op: 'equals', value: 'returning' },
            ],
          },
        }),
      ],
      total: 2,
    });
    renderPage();

    const editButtons = await screen.findAllByRole('button', { name: 'Edit' });
    await userEvent.click(editButtons[0]!);
    expect(screen.getByLabelText('Rule 1 value')).toHaveValue('/pricing');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await userEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[1]!);
    expect(screen.getByLabelText('Rule 1 field')).toHaveValue('country');
    expect(screen.getByLabelText('Rule 1 value')).toHaveValue('TR');
    expect(screen.getByLabelText('Rule 2 value')).toHaveValue('returning');
    expect(screen.getByLabelText('Reach visitors when')).toHaveValue('all');

    await userEvent.click(screen.getByRole('button', { name: 'Remove rule 2' }));
    expect(screen.queryByLabelText('Rule 2 value')).not.toBeInTheDocument();
    // One rule left: no remove button to leave an empty trigger.
    expect(screen.queryByRole('button', { name: 'Remove rule 1' })).not.toBeInTheDocument();
  });

  it('stops at ten rules', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'New campaign' }));
    for (let i = 1; i < 10; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    }
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();
    expect(screen.getByText('At most 10 rules.')).toBeInTheDocument();
  });

  it('describes a many-rule campaign on its card', async () => {
    api.get.mockResolvedValue({
      items: [
        campaign('ongoing', 'Many', {
          conditions: {
            match: 'any',
            rules: [
              { field: 'country', op: 'equals', value: 'TR' },
              { field: 'exit_intent', op: 'equals', value: true },
            ],
          },
        }),
      ],
      total: 1,
    });
    renderPage();
    expect(await screen.findByText('When any of these holds:')).toBeInTheDocument();
    expect(
      screen.getByText('Country is TR · The visitor is about to leave the page'),
    ).toBeInTheDocument();
  });
});

describe('CampaignBuilder card (EN-02 · tm 353)', () => {
  async function openCard(): Promise<void> {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'New campaign' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Deposit help');
    await userEvent.type(screen.getByLabelText('Rule 1 value'), '/deposit');
    await userEvent.click(screen.getByLabelText('Card'));
  }

  it('builds a title, an image and three buttons, previews it, and saves exactly that (FR-MOD-03.3.2)', async () => {
    api.post.mockResolvedValue({ ...campaign('ongoing', 'Deposit help'), matched: 0 });
    await openCard();
    await userEvent.type(screen.getByLabelText('Card title (optional)'), 'Deposit trouble?');
    await userEvent.type(screen.getByLabelText('Card text'), 'We can help.');
    await userEvent.type(
      screen.getByLabelText('Image address (optional)'),
      'https://cdn.test/a.png',
    );
    await userEvent.type(screen.getByLabelText('Image description'), 'Coins');
    await userEvent.type(screen.getByLabelText('Button 1 label'), 'Get help');

    await userEvent.click(screen.getByRole('button', { name: 'Add a button' }));
    await userEvent.type(screen.getByLabelText('Button 2 label'), 'Rules');
    await userEvent.selectOptions(screen.getByLabelText('Button 2 does'), 'open_url');
    await userEvent.type(screen.getByLabelText('Button 2 link'), 'https://casino.test/rules');

    await userEvent.click(screen.getByRole('button', { name: 'Add a button' }));
    await userEvent.type(screen.getByLabelText('Button 3 label'), 'Copy code');
    await userEvent.selectOptions(screen.getByLabelText('Button 3 does'), 'copy_coupon');
    await userEvent.type(screen.getByLabelText('Button 3 coupon code'), 'WELCOME50');

    const preview = screen.getByRole('region', { name: 'Preview' });
    expect(within(preview).getByText('Deposit trouble?')).toBeInTheDocument();
    expect(within(preview).getByRole('img', { name: 'Coins' })).toBeInTheDocument();
    expect(within(preview).getByText('Copies WELCOME50')).toBeInTheDocument();
    await userEvent.click(within(preview).getByRole('button', { name: 'Mobile' }));
    expect(within(preview).getByRole('button', { name: 'Mobile' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
    expect(api.post).toHaveBeenCalledWith(
      '/campaigns',
      expect.objectContaining({
        content: {
          type: 'card',
          card: {
            title: 'Deposit trouble?',
            body: 'We can help.',
            image: { url: 'https://cdn.test/a.png', alt: 'Coins' },
            buttons: [
              { label: 'Get help', style: 'primary', action: { type: 'send_message' } },
              {
                label: 'Rules',
                style: 'default',
                action: { type: 'open_url', url: 'https://casino.test/rules' },
              },
              {
                label: 'Copy code',
                style: 'default',
                action: { type: 'copy_coupon', code: 'WELCOME50' },
              },
            ],
          },
        },
      }),
    );
  });

  it('keeps Create off for a javascript: link or a long label, counting rather than cutting', async () => {
    await openCard();
    await userEvent.type(screen.getByLabelText('Card text'), 'Hi');
    await userEvent.type(screen.getByLabelText('Button 1 label'), 'Go');
    const create = screen.getByRole('button', { name: 'Create campaign' });
    expect(create).toBeEnabled();

    await userEvent.selectOptions(screen.getByLabelText('Button 1 does'), 'open_url');
    await userEvent.type(screen.getByLabelText('Button 1 link'), 'javascript:alert(1)');
    await userEvent.tab();
    expect(await screen.findByText('Use an https:// address.')).toBeInTheDocument();
    expect(create).toBeDisabled();

    // Switching the action starts it empty: the bad link is not carried into a coupon.
    await userEvent.selectOptions(screen.getByLabelText('Button 1 does'), 'copy_coupon');
    expect(screen.getByLabelText('Button 1 coupon code')).toHaveValue('');

    await userEvent.selectOptions(screen.getByLabelText('Button 1 does'), 'send_message');
    await userEvent.type(screen.getByLabelText('Button 1 label'), ' it is really long');
    expect(screen.getByLabelText('Button 1 label')).toHaveValue('Go it is really long');
    expect(screen.getByText('20/20')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Button 1 label'), '!');
    expect(screen.getByText('21/20')).toBeInTheDocument();
    expect(create).toBeDisabled();
  });

  it('opens a saved card campaign on the card, and a text one on its message', async () => {
    api.get.mockResolvedValue({
      items: [
        campaign('ongoing', 'Carded', {
          content: {
            type: 'card',
            card: {
              body: 'Saved body',
              buttons: [{ label: 'Help', style: 'default', action: { type: 'send_message' } }],
            },
            fallback_text: 'Saved body\n1. Help',
          },
        }),
      ],
      total: 1,
    });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Card')).toBeChecked();
    expect(screen.getByLabelText('Card text')).toHaveValue('Saved body');
    expect(screen.getByLabelText('Button 1 label')).toHaveValue('Help');
  });
});

describe('CampaignsPage localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the page in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <CampaignsPage />
        </QueryClientProvider>
      </MemoryRouter>,
      'tr',
    );

    expect(await screen.findByText('Running')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kampanyalar', level: 1 })).toBeInTheDocument();
    // The campaign cards sit directly under the h1 — a skipped level reads as a gap
    // to a screen reader's heading list (tm 259.20 · O15).
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    expect(document.title).toBe('Kampanyalar · SiyahTuş');
    expect(screen.getByRole('button', { name: 'Yeni kampanya' })).toBeInTheDocument();
  });

  it('shows 0% for a campaign nothing has been displayed on yet (UX audit D6)', async () => {
    api.get.mockResolvedValue({ items: [campaign('ongoing', 'Fresh')], total: 1 });
    renderPage();

    expect((await screen.findByText('Conversion')).parentElement).toHaveTextContent(/0%/);
  });

  it('writes the conversion rate with the percent sign in front (O17)', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <CampaignsPage />
        </QueryClientProvider>
      </MemoryRouter>,
      'tr',
    );

    // 12 conversions of 200 displayed.
    expect(await screen.findByText('%6')).toBeInTheDocument();
    expect(screen.queryByText('6%')).not.toBeInTheDocument();
  });
});
