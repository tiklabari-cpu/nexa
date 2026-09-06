/**
 * Goals page (FR-MOD-13.3). Pins the acceptance criteria at the UI: the status
 * sub-tabs narrow the list, creating requires a name and a trigger ("hedef
 * tanımı" — a goal definition), and the write controls are hidden from a
 * read-only agent.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Goal } from '@nexa/types';
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

const { GoalsPage } = await import('./GoalsPage.js');

function goal(active: boolean, name: string, over: Partial<Goal> = {}): Goal {
  return {
    id: `g-${name}`,
    name,
    definition: { url_contains: '/thank-you' },
    active,
    created_at: '2026-07-26T12:00:00.000Z',
    ...over,
  };
}

const LIST = {
  items: [goal(true, 'Signed up'), goal(false, 'Upgraded')],
  total: 2,
};

const FUNNEL = {
  range: { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T00:00:00.000Z' },
  funnel: { visitors: 100, chats: 40, conversions: 10, conversion_rate: 0.25 },
  by_goal: [{ goal_id: 'g-Signed up', name: 'Signed up', conversions: 10 }],
};

/**
 * The page now issues two reads — its own `/goals` list and the funnel's
 * `/reports/goals` — so the mock has to answer by path. A single
 * `mockResolvedValue` would hand the funnel a goal list and crash on `by_goal`.
 */
function mockGets(list: unknown = LIST, funnel: unknown = FUNNEL): void {
  api.get.mockImplementation((path: string) =>
    Promise.resolve(path === '/reports/goals' ? funnel : list),
  );
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <GoalsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  mockGets();
  auth.scopes = ['customers:rw'];
});

describe('GoalsPage', () => {
  it('filters the list by the status sub-tabs', async () => {
    renderPage();
    expect(await screen.findByText('Signed up')).toBeInTheDocument();
    expect(screen.getByText('Upgraded')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Active/ }));

    expect(screen.getByText('Signed up')).toBeInTheDocument();
    expect(screen.queryByText('Upgraded')).not.toBeInTheDocument();
  });

  it('toggles a goal off', async () => {
    api.patch.mockResolvedValue(goal(false, 'Signed up'));
    renderPage();
    const card = (await screen.findByText('Signed up')).closest('div.rounded-lg') as HTMLElement;

    await userEvent.click(within(card).getByRole('button', { name: 'Turn off' }));
    expect(api.patch).toHaveBeenCalledWith('/goals/g-Signed up', { active: false });
  });

  it('hides the write controls from a read-only agent', async () => {
    auth.scopes = ['customers:ro'];
    renderPage();
    await screen.findByText('Signed up');
    expect(screen.queryByRole('button', { name: 'New goal' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument();
  });

  /**
   * 204.1 gave a goal three more predicates than `url_contains`; the list has
   * to describe whichever one a definition actually carries, and never throw
   * on a shape it does not recognise (FR-MOD-13.3).
   */
  it('describes each goal by the predicate its definition actually sets (FR-MOD-13.3)', async () => {
    mockGets({
      items: [
        goal(true, 'Signed up', { definition: { url_contains: '/thank-you' } }),
        goal(true, 'Bought something', { definition: { sale_completed: true } }),
        goal(true, 'Became a lead', { definition: { lead_captured: true } }),
        goal(true, 'Got helped', { definition: { chat_resolved: true } }),
        goal(true, 'Hand-edited row', { definition: {} }),
      ],
      total: 5,
    });
    renderPage();

    expect(await screen.findByText('Page contains /thank-you')).toBeInTheDocument();
    expect(screen.getByText('Sale completed')).toBeInTheDocument();
    expect(screen.getByText('Lead captured')).toBeInTheDocument();
    expect(screen.getByText('Chat resolved')).toBeInTheDocument();
    expect(screen.getByText('No trigger defined')).toBeInTheDocument();
  });

  it('shows a meaningful empty state, not a blank rectangle', async () => {
    mockGets({ items: [], total: 0 }, { ...FUNNEL, by_goal: [] });
    renderPage();
    expect(await screen.findByText('No goals yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Create a goal to track when a visitor reaches a page that counts as a conversion.',
      ),
    ).toBeInTheDocument();
  });

  /**
   * 13.3-h built the funnel but wired it to nothing, so the screen that owns
   * the goals never showed what they produced. This pins the mount: the
   * definitions and their result are read together or the slice is only half
   * delivered (13.3-i).
   */
  it('shows the goal funnel above the list', async () => {
    renderPage();

    const funnel = await screen.findByRole('region', { name: 'Goal funnel' });
    expect(await within(funnel).findByText('Visitors')).toBeInTheDocument();
    expect(within(funnel).getByText('Chats')).toBeInTheDocument();
    expect(within(funnel).getByText('Conversions')).toBeInTheDocument();
    expect(within(funnel).getByTestId('goal-funnel-conversions')).toHaveTextContent('10');
    expect(api.get).toHaveBeenCalledWith('/reports/goals');
  });

  describe('Create goal', () => {
    it('keeps Submit disabled and shows a field-under error until a name and trigger are given', async () => {
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'New goal' }));

      const submit = screen.getByRole('button', { name: 'Create goal' });
      expect(submit).toBeDisabled();

      // Touching and leaving the name field blank surfaces its field-under error.
      const nameInput = screen.getByLabelText('Name');
      await userEvent.click(nameInput);
      await userEvent.tab();
      expect(await screen.findByText('Give the goal a name.')).toBeInTheDocument();
      expect(submit).toBeDisabled();

      await userEvent.type(nameInput, 'Signed up');
      const triggerInput = screen.getByLabelText(/Trigger/);
      await userEvent.click(triggerInput);
      await userEvent.tab();
      expect(await screen.findByText(/A goal needs a trigger/)).toBeInTheDocument();
      expect(submit).toBeDisabled();

      await userEvent.type(triggerInput, '/thank-you');
      expect(submit).not.toBeDisabled();
    });

    it('creates a goal with the given name and trigger', async () => {
      api.post.mockResolvedValue(goal(true, 'Signed up'));
      renderPage();
      await userEvent.click(await screen.findByRole('button', { name: 'New goal' }));

      await userEvent.type(screen.getByLabelText('Name'), 'Signed up');
      await userEvent.type(screen.getByLabelText(/Trigger/), '/thank-you');
      await userEvent.click(screen.getByRole('button', { name: 'Create goal' }));

      expect(api.post).toHaveBeenCalledWith('/goals', {
        name: 'Signed up',
        definition: { url_contains: '/thank-you' },
      });
    });

    /**
     * 204.1 taught the matcher three funnel predicates besides the page URL;
     * this is the form actually offering them. Picking one of the three flags
     * hides the URL field entirely — there is nothing left to type in, the
     * choice itself is the whole definition — and the same server threshold
     * ("a goal needs something to match on") stays satisfied without it.
     */
    describe('choosing a funnel trigger type (FR-MOD-13.3)', () => {
      it.each([
        ['Sale completed', { sale_completed: true }],
        ['Lead captured', { lead_captured: true }],
        ['Chat resolved', { chat_resolved: true }],
      ] as const)(
        'creates a goal triggered by "%s" with no URL field',
        async (label, definition) => {
          api.post.mockResolvedValue(goal(true, 'Converted'));
          renderPage();
          await userEvent.click(await screen.findByRole('button', { name: 'New goal' }));

          await userEvent.type(screen.getByLabelText('Name'), 'Converted');
          await userEvent.click(screen.getByRole('radio', { name: label }));
          expect(screen.queryByLabelText(/Trigger/)).not.toBeInTheDocument();

          const submit = screen.getByRole('button', { name: 'Create goal' });
          expect(submit).not.toBeDisabled();
          await userEvent.click(submit);

          expect(api.post).toHaveBeenCalledWith('/goals', { name: 'Converted', definition });
        },
      );

      it('switching back to "Page reached" brings the URL field and its requirement back', async () => {
        renderPage();
        await userEvent.click(await screen.findByRole('button', { name: 'New goal' }));

        await userEvent.click(screen.getByRole('radio', { name: 'Sale completed' }));
        expect(screen.queryByLabelText(/Trigger/)).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('radio', { name: 'Page reached' }));
        const triggerInput = screen.getByLabelText(/Trigger/);
        expect(triggerInput).toBeInTheDocument();

        await userEvent.type(screen.getByLabelText('Name'), 'Signed up');
        const submit = screen.getByRole('button', { name: 'Create goal' });
        expect(submit).toBeDisabled();

        await userEvent.type(triggerInput, '/thank-you');
        expect(submit).not.toBeDisabled();
      });
    });
  });
});

describe('GoalsPage localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the page in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <GoalsPage />
        </QueryClientProvider>
      </MemoryRouter>,
      'tr',
    );

    expect(await screen.findByText('Signed up')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Müşteriler', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeni hedef' })).toBeInTheDocument();
  });
});
