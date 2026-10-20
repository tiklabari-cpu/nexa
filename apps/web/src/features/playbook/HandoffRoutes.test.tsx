/**
 * The hand-over routes card (tm 307.3 · AI-12): the list with its team,
 * expertise and priority, the deleted-team marker, turning a route on and off,
 * the form (a new route; an edit that cannot change what the route matches),
 * the server's refusals in words, and the read-only view.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { HandoffRoute } from './handoff-routes.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { HandoffRoutes } = await import('./HandoffRoutes.js');

function route(id: string, over: Partial<HandoffRoute> = {}): HandoffRoute {
  return {
    id,
    brand_id: null,
    match_type: 'topic',
    match_key: 'finance',
    group_id: 4,
    required_expertise_id: null,
    default_priority: 'normal',
    active: true,
    ...over,
  };
}

const TEAMS = [
  { id: 4, name: 'Finance desk' },
  { id: 5, name: 'Safer play' },
];
const EXPERTISE = [{ id: 9, name: 'Responsible gaming training' }];
const BRANDS = [
  { id: 'b-1', name: 'Alpha' },
  { id: 'b-2', name: 'Beta' },
];

let routes: HandoffRoute[];

function renderCard(canEdit = true, locale?: 'tr'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (
    <QueryClientProvider client={queryClient}>
      <HandoffRoutes canEdit={canEdit} />
    </QueryClientProvider>
  );
  if (locale) renderWithLocale(ui, locale);
  else render(ui);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  routes = [
    route('r1'),
    route('r2', {
      match_type: 'reason',
      match_key: 'guardrail_self_harm',
      group_id: 5,
      required_expertise_id: 9,
      default_priority: 'urgent',
    }),
    route('r3', { match_key: 'bonus', group_id: 99, brand_id: 'b-2', active: false }),
  ];
  api.get.mockImplementation((path: string) => {
    if (path === '/groups') return Promise.resolve({ items: TEAMS });
    if (path === '/settings/expertise') return Promise.resolve({ items: EXPERTISE });
    if (path === '/brands') return Promise.resolve({ items: BRANDS });
    return Promise.resolve({ items: routes });
  });
  api.post.mockResolvedValue(route('new'));
  api.patch.mockResolvedValue(route('r1'));
  api.delete.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetLocale();
});

function refusal(reason: string): ApiClientError {
  return new ApiClientError({
    type: 'validation',
    status: 400,
    message: 'refused',
    requestId: 'req-1',
    details: { reason },
  });
}

async function row(id: string): Promise<HTMLElement> {
  return screen.findByTestId(`handoff-route-${id}`);
}

describe('HandoffRoutes — the list', () => {
  it('says for each route what it matches, which team it sends to, with what priority and skill', async () => {
    renderCard();

    const topic = await row('r1');
    expect(topic).toHaveTextContent('Topic: Finance');
    await waitFor(() => expect(topic).toHaveTextContent('All brands → Finance desk · normal'));

    const reason = await row('r2');
    expect(reason).toHaveTextContent('Reason: Self-harm signals');
    await waitFor(() =>
      expect(reason).toHaveTextContent('Safer play · urgent · needs Responsible gaming training'),
    );
  });

  it('shows the brand by name and a deleted team as gone', async () => {
    renderCard();
    const deleted = await row('r3');
    await waitFor(() => expect(deleted).toHaveTextContent('Beta → A team that no longer exists'));
    expect(within(deleted).getByRole('checkbox')).not.toBeChecked();
  });

  it('warns that a route whose required skill was deleted is met by nobody', async () => {
    routes = [route('r1', { required_expertise_id: 77 })];
    renderCard();
    const target = await row('r1');
    await waitFor(() =>
      expect(target).toHaveTextContent('needs a skill that no longer exists — nobody takes it'),
    );
  });

  it('explains an empty list instead of drawing nothing', async () => {
    routes = [];
    renderCard();
    expect(await screen.findByText('No routes yet')).toBeInTheDocument();
  });

  it('reports a failed load with a way to retry', async () => {
    api.get.mockImplementation((path: string) =>
      path === '/handoff-routes'
        ? Promise.reject(new Error('down'))
        : Promise.resolve({ items: [] }),
    );
    renderCard();
    expect(await screen.findByText('The routes couldn’t be loaded')).toBeInTheDocument();
  });
});

describe('HandoffRoutes — turning a route on and off, deleting', () => {
  it('turns a route on with the one field it changes', async () => {
    const user = userEvent.setup();
    renderCard();
    const deleted = await row('r3');
    await user.click(within(deleted).getByRole('checkbox'));
    expect(api.patch).toHaveBeenCalledWith('/handoff-routes/r3', { active: true });
  });

  it('deletes only once confirmed', async () => {
    const user = userEvent.setup();
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    renderCard();
    const target = await row('r1');
    const button = within(target).getByRole('button', { name: /Delete the route Topic: Finance/ });

    await user.click(button);
    expect(api.delete).not.toHaveBeenCalled();
    await user.click(button);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(api.delete).toHaveBeenCalledWith('/handoff-routes/r1');
  });

  it('says that a failed toggle failed', async () => {
    const user = userEvent.setup();
    api.patch.mockRejectedValue(new Error('nope'));
    renderCard();
    await user.click(within(await row('r1')).getByRole('checkbox'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('HandoffRoutes — the form', () => {
  it('adds a topic route with ids as numbers, naming the team, the skill and the priority', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole('button', { name: 'New route' }));

    const form = screen.getByRole('form', { name: 'New route' });
    await user.selectOptions(within(form).getByLabelText('Key'), 'Responsible gambling');
    await waitFor(() => within(form).getByRole('option', { name: 'Beta' }));
    await user.selectOptions(within(form).getByLabelText('Brand'), 'Alpha');
    await waitFor(() => within(form).getByRole('option', { name: 'Safer play' }));
    await user.selectOptions(within(form).getByLabelText('Team'), 'Safer play');
    await waitFor(() => within(form).getByRole('option', { name: 'Responsible gaming training' }));
    await user.selectOptions(
      within(form).getByLabelText('Required skill'),
      'Responsible gaming training',
    );
    await user.selectOptions(within(form).getByLabelText('Starts with priority'), 'urgent');
    await user.click(within(form).getByRole('button', { name: 'Save route' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/handoff-routes', {
        match_type: 'topic',
        match_key: 'responsible_gambling',
        brand_id: 'b-1',
        group_id: 5,
        required_expertise_id: 9,
        default_priority: 'urgent',
        active: true,
      }),
    );
  });

  it('offers a reason route the hand-over reasons, not the queue roles', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole('button', { name: 'New route' }));
    const form = screen.getByRole('form', { name: 'New route' });

    await user.selectOptions(within(form).getByLabelText('Matches'), 'Reason');
    const key = within(form).getByLabelText('Key');
    expect(within(key).getByRole('option', { name: 'The same problem again today' })).toBeVisible();
    expect(within(key).queryByRole('option', { name: 'Finance' })).toBeNull();
    // The first reason is picked, so the form is never on a key the type refuses.
    expect(key).toHaveValue('guardrail_self_harm');
  });

  it('refuses a save with no team, in words, without calling the server', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole('button', { name: 'New route' }));
    await user.click(screen.getByRole('button', { name: 'Save route' }));

    expect(await screen.findByText('Choose the team the route sends to.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('words the server’s refusal that the key already has a route', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue(refusal('handoff_route_taken'));
    renderCard();
    await user.click(await screen.findByRole('button', { name: 'New route' }));
    const form = screen.getByRole('form', { name: 'New route' });
    await waitFor(() => within(form).getByRole('option', { name: 'Finance desk' }));
    await user.selectOptions(within(form).getByLabelText('Team'), 'Finance desk');
    await user.click(within(form).getByRole('button', { name: 'Save route' }));

    expect(
      await screen.findByText('There is a route for that key and brand already — edit it.'),
    ).toBeInTheDocument();
  });

  it('edits only the team, the skill and the priority — what the route matches is fixed — and sends what changed', async () => {
    const user = userEvent.setup();
    renderCard();
    const target = await row('r1');
    await user.click(within(target).getByRole('button', { name: /Edit the route Topic: Finance/ }));

    const form = screen.getByRole('form', { name: 'Edit route' });
    expect(within(form).getByLabelText('Matches')).toBeDisabled();
    expect(within(form).getByLabelText('Key')).toBeDisabled();
    await waitFor(() => within(form).getByRole('option', { name: 'Safer play' }));
    await user.selectOptions(within(form).getByLabelText('Team'), 'Safer play');
    await user.click(within(form).getByRole('button', { name: 'Save route' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/handoff-routes/r1', { group_id: 5 }),
    );
  });

  it('keeps a deleted team on an edit visible instead of re-pointing the route', async () => {
    const user = userEvent.setup();
    renderCard();
    const target = await row('r3');
    await user.click(within(target).getByRole('button', { name: /Edit the route/ }));

    const form = screen.getByRole('form', { name: 'Edit route' });
    await waitFor(() => expect(within(form).getByLabelText('Team')).toHaveValue('99'));
    await user.selectOptions(within(form).getByLabelText('Starts with priority'), 'high');
    await user.click(within(form).getByRole('button', { name: 'Save route' }));
    // Only the priority changed: the missing team is not part of the body.
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/handoff-routes/r3', { default_priority: 'high' }),
    );
  });

  it('cancels without a request', async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole('button', { name: 'New route' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('HandoffRoutes — without edit access', () => {
  it('lists the routes read-only: no new, edit or delete, a disabled switch, and says so', async () => {
    renderCard(false);
    const target = await row('r1');
    expect(screen.queryByRole('button', { name: 'New route' })).toBeNull();
    expect(within(target).queryByRole('button')).toBeNull();
    expect(within(target).getByRole('checkbox')).toBeDisabled();
    expect(
      screen.getByText('Only people with AI agent access can change these settings.'),
    ).toBeInTheDocument();
  });
});

describe('HandoffRoutes — in Turkish', () => {
  it('words the list and the key labels in Turkish', async () => {
    renderCard(true, 'tr');
    const topic = await row('r1');
    expect(topic).toHaveTextContent('Konu: Finans');
    await waitFor(() => expect(topic).toHaveTextContent('Tüm markalar → Finance desk · normal'));
    expect(await row('r2')).toHaveTextContent('Neden:');
    expect(screen.getByRole('button', { name: 'Yeni rota' })).toBeInTheDocument();
  });
});
