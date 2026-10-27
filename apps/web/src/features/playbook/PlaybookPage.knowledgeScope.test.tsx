/**
 * The Playbook's single knowledge list (tm 309.3 · AI-14 · owner decision K11).
 *
 * The store is one list for what the AI agent answers players from and what
 * Copilot drafts agents' replies from. Asserted here, through `PlaybookPage`
 * because the controls only exist inside it and only with the write scope:
 *
 * - the list asks for the whole store (`audience=all`) and each row says who
 *   uses the source, for which brands, until when, who owns it and whether a
 *   review is late — in words, not in the server's codes;
 * - the controls above the list narrow it by audience, brand, owner and
 *   "review needed" without hiding what the tabs count;
 * - a person marks a late source reviewed from the row menu — a bodiless POST;
 * - the edit dialog sends only the scope fields that changed, and a Knowledge
 *   Base article's source offers only its upkeep fields (the server refuses the
 *   rest);
 * - a new source's scope reaches the create request, and a source with no
 *   audience is not submittable.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type { KnowledgeSource } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { PlaybookPage } = await import('./PlaybookPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

const BRANDS = [
  { id: 'brand-a', name: 'Acme Casino' },
  { id: 'brand-b', name: 'Acme Sports' },
];
const MEMBERS = [
  { id: 'user-1', name: 'Dana Okonkwo' },
  { id: 'user-2', name: 'Ada Lovelace' },
];

function source(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: 'src-1',
    ai_agent_id: 'agent-1',
    name: 'Return policy',
    type: 'faq',
    status: 'ready',
    source_url: null,
    chunk_count: 3,
    updated_at: '2026-01-15T10:00:00.000Z',
    added_by_name: 'Ada Lovelace',
    refresh_after_days: null,
    next_refresh_at: null,
    last_refresh_error: null,
    audiences: ['ai_agent', 'copilot'],
    ai_agent_ids: [],
    brand_ids: [],
    valid_until: null,
    kb_article_id: null,
    language: null,
    owner_id: null,
    owner_name: null,
    reviewed_at: '2099-01-01T00:00:00.000Z',
    review_interval_days: 90,
    review_due_at: '2099-04-01T00:00:00.000Z',
    ...overrides,
  };
}

/** One source of every kind the list tells apart. */
const STORE: KnowledgeSource[] = [
  source({ id: 'src-both', name: 'Return policy', owner_id: 'user-1', owner_name: 'Dana Okonkwo' }),
  source({
    id: 'src-agents',
    name: 'Escalation notes',
    audiences: ['copilot'],
    brand_ids: ['brand-a'],
  }),
  source({
    id: 'src-late',
    name: 'Bonus terms',
    audiences: ['ai_agent'],
    reviewed_at: '2025-01-01T00:00:00.000Z',
    review_due_at: '2025-04-01T00:00:00.000Z',
    valid_until: '2025-06-01T00:00:00.000Z',
  }),
  source({ id: 'src-kb', name: 'Delivery times', type: 'article', kb_article_id: 'kb-1' }),
];

beforeEach(() => {
  // General is the landing tab (tm 390.2); these tests are about the Skills/Knowledge tabs.
  window.history.replaceState(null, '', '/app/playbook?view=skills');
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: ['agents-bot--all:rw'],
      routing_status: 'accepting_chats',
    },
  });
});

async function openKnowledge(
  user: ReturnType<typeof userEvent.setup>,
  items: KnowledgeSource[] = STORE,
): Promise<void> {
  api.get.mockImplementation((path: string) => {
    if (path === '/skills') return Promise.resolve({ items: [] });
    if (path === '/ai-agents') {
      return Promise.resolve({
        items: [{ id: 'agent-1', kind: 'ai_agent', name: 'Ada', active: true }],
      });
    }
    if (path.startsWith('/knowledge-sources')) return Promise.resolve({ items });
    if (path === '/brands') return Promise.resolve({ items: BRANDS });
    if (path === '/agents') return Promise.resolve({ items: MEMBERS });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlaybookPage />
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole('tab', { name: 'Knowledge' }));
  await screen.findByText(items[0]?.name ?? '');
}

/** The `<li>` of a row, by the source's name. */
function row(name: string): HTMLElement {
  const item = screen.getByText(name).closest('li');
  if (!item) throw new Error(`no row for ${name}`);
  return item;
}

/** Opens a row's “…” menu and clicks one of its items (each row mounts its own menu). */
async function pickFromMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  item: string,
): Promise<void> {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  await user.click(within(row(name)).getByRole('button', { name: item }));
}

describe('the single knowledge list — what each row says (AI-14 · tm 309.3)', () => {
  it('asks for the whole store, not the AI agent’s slice of it', async () => {
    await openKnowledge(userEvent.setup());
    expect(api.get).toHaveBeenCalledWith('/knowledge-sources?audience=all');
  });

  it('names who uses each source, in words', async () => {
    await openKnowledge(userEvent.setup());

    expect(within(row('Return policy')).getByText('AI agent + Copilot')).toBeInTheDocument();
    expect(within(row('Escalation notes')).getByText('Agents only')).toBeInTheDocument();
    expect(within(row('Bonus terms')).getByText('AI agent')).toBeInTheDocument();
  });

  it('shows the brands a source is limited to, by name', async () => {
    await openKnowledge(userEvent.setup());

    expect(await within(row('Escalation notes')).findByText('Acme Casino')).toBeInTheDocument();
    expect(within(row('Return policy')).queryByText('Acme Casino')).not.toBeInTheDocument();
  });

  it('warns on a source past its review, and says one has ended — a fresh one has neither', async () => {
    await openKnowledge(userEvent.setup());

    const late = within(row('Bonus terms'));
    expect(late.getByText('Review needed')).toBeInTheDocument();
    expect(late.getByText(/^Ended /)).toBeInTheDocument();
    const fresh = within(row('Return policy'));
    expect(fresh.queryByText('Review needed')).not.toBeInTheDocument();
    expect(fresh.queryByText(/^Ended /)).not.toBeInTheDocument();
  });

  it('shows the owner, or that there is none, and marks a Knowledge Base article’s source', async () => {
    await openKnowledge(userEvent.setup());

    expect(within(row('Return policy')).getByText(/Owner: Dana Okonkwo/)).toBeInTheDocument();
    expect(within(row('Escalation notes')).getByText(/No owner/)).toBeInTheDocument();
    expect(within(row('Delivery times')).getByText('Knowledge Base article')).toBeInTheDocument();
  });
});

describe('the controls over the list (AI-14 · tm 309.3)', () => {
  it('narrows by audience, and the tabs keep counting the whole store', async () => {
    const user = userEvent.setup();
    await openKnowledge(user);

    await user.selectOptions(screen.getByLabelText('Audience'), 'agents_only');

    expect(screen.getByText('Escalation notes')).toBeInTheDocument();
    expect(screen.queryByText('Return policy')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^All 4$/ })).toBeInTheDocument();
  });

  it('narrows to a brand’s sources plus the every-brand ones, or to the every-brand ones only', async () => {
    const user = userEvent.setup();
    await openKnowledge(user);

    await user.selectOptions(await screen.findByLabelText('Brand'), 'brand-b');
    expect(screen.queryByText('Escalation notes')).not.toBeInTheDocument();
    expect(screen.getByText('Return policy')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Brand'), 'brand-a');
    expect(screen.getByText('Escalation notes')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Brand'), 'every');
    expect(screen.queryByText('Escalation notes')).not.toBeInTheDocument();
  });

  it('narrows by owner, including the unowned', async () => {
    const user = userEvent.setup();
    await openKnowledge(user);

    await user.selectOptions(await screen.findByLabelText('Owner'), 'user-1');
    expect(screen.getByText('Return policy')).toBeInTheDocument();
    expect(screen.queryByText('Bonus terms')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Owner'), 'none');
    expect(screen.queryByText('Return policy')).not.toBeInTheDocument();
    expect(screen.getByText('Bonus terms')).toBeInTheDocument();
  });

  it('lists only the sources due a review, with the count on the control', async () => {
    const user = userEvent.setup();
    await openKnowledge(user);

    await user.click(screen.getByRole('checkbox', { name: 'Review needed (1)' }));

    expect(screen.getByText('Bonus terms')).toBeInTheDocument();
    expect(screen.queryByText('Return policy')).not.toBeInTheDocument();
  });

  it('says when no source matches, rather than showing the empty store', async () => {
    const user = userEvent.setup();
    await openKnowledge(user);

    await user.selectOptions(screen.getByLabelText('Audience'), 'ai_agent');
    await user.selectOptions(await screen.findByLabelText('Owner'), 'user-1');

    expect(screen.getByText('No source matches these filters.')).toBeInTheDocument();
    expect(screen.queryByText('Nothing indexed')).not.toBeInTheDocument();
  });
});

describe('reviewing and editing a source (AI-14-S3 · tm 309.3)', () => {
  it('marks a source reviewed from its menu — a POST with no fields', async () => {
    api.post.mockResolvedValue(source());
    const user = userEvent.setup();
    await openKnowledge(user);

    await pickFromMenu(user, 'Bonus terms', 'Mark as reviewed');

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/knowledge-sources/src-late/review', {}),
    );
  });

  it('sends only the scope that changed when a source is edited', async () => {
    api.patch.mockResolvedValue(source());
    const user = userEvent.setup();
    await openKnowledge(user);

    await pickFromMenu(user, 'Return policy', 'Edit');
    const dialog = within(await screen.findByRole('dialog'));

    // For agents only: Copilot alone, so the AI agent box comes off.
    await user.click(dialog.getByRole('checkbox', { name: 'AI agent' }));
    expect(dialog.getByText(/never reaches a player/)).toBeInTheDocument();
    await user.click(await dialog.findByRole('checkbox', { name: 'Acme Sports' }));
    await user.selectOptions(dialog.getByLabelText('Owner'), 'user-2');
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/knowledge-sources/src-both', {
        audiences: ['copilot'],
        brand_ids: ['brand-b'],
        owner_id: 'user-2',
      }),
    );
  });

  it('closes without a request when nothing changed', async () => {
    const user = userEvent.setup();
    await openKnowledge(user);

    await pickFromMenu(user, 'Return policy', 'Edit');
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save changes' }),
    );

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('refuses a source with no audience, and a review interval outside 1–365', async () => {
    const user = userEvent.setup();
    await openKnowledge(user);

    await pickFromMenu(user, 'Return policy', 'Edit');
    const dialog = within(await screen.findByRole('dialog'));
    const save = dialog.getByRole('button', { name: 'Save changes' });

    await user.click(dialog.getByRole('checkbox', { name: 'AI agent' }));
    await user.click(dialog.getByRole('checkbox', { name: 'Copilot' }));
    expect(dialog.getByText('Pick at least one: the AI agent or Copilot.')).toBeInTheDocument();
    expect(save).toBeDisabled();

    await user.click(dialog.getByRole('checkbox', { name: 'Copilot' }));
    expect(save).toBeEnabled();
    await user.clear(dialog.getByLabelText('Review every (days)'));
    await user.type(dialog.getByLabelText('Review every (days)'), '400');
    expect(save).toBeDisabled();
  });

  it('offers a Knowledge Base article’s source only its upkeep — its text and reach are the article’s', async () => {
    api.patch.mockResolvedValue(source());
    const user = userEvent.setup();
    await openKnowledge(user);

    await pickFromMenu(user, 'Delivery times', 'Edit');
    const dialog = within(await screen.findByRole('dialog'));

    expect(dialog.getByText(/is a Knowledge Base article/)).toBeInTheDocument();
    expect(dialog.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(dialog.queryByLabelText('Content')).not.toBeInTheDocument();
    expect(dialog.queryByRole('checkbox', { name: 'AI agent' })).not.toBeInTheDocument();
    expect(dialog.queryByLabelText('Valid until')).not.toBeInTheDocument();

    await user.selectOptions(dialog.getByLabelText('Owner'), 'user-2');
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/knowledge-sources/src-kb', { owner_id: 'user-2' }),
    );
  });
});

describe('adding a source with a scope (AI-14 · tm 309.3)', () => {
  async function fillBasics(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.type(await screen.findByLabelText('Title'), 'Agent escalation notes');
    await user.type(screen.getByLabelText('Content'), 'Escalate chargebacks to the payments team.');
  }

  it('sends the same body as ever while the scope is left alone', async () => {
    api.post.mockResolvedValue(source());
    const user = userEvent.setup();
    await openKnowledge(user);
    await fillBasics(user);
    await user.click(screen.getByRole('button', { name: 'Add source' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/knowledge-sources', {
      ai_agent_id: 'agent-1',
      name: 'Agent escalation notes',
      type: 'article',
      content: 'Escalate chargebacks to the payments team.',
    });
  });

  it('carries the chosen audiences, brands and owner to the create request', async () => {
    api.post.mockResolvedValue(source());
    const user = userEvent.setup();
    await openKnowledge(user);
    await fillBasics(user);

    await user.click(screen.getByRole('button', { name: 'Who uses it and who keeps it' }));
    await user.click(screen.getByRole('checkbox', { name: 'AI agent' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Acme Casino' }));
    await user.selectOptions(screen.getAllByLabelText('Owner')[0] as HTMLElement, 'user-1');
    await user.click(screen.getByRole('button', { name: 'Add source' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/knowledge-sources', {
        ai_agent_id: 'agent-1',
        name: 'Agent escalation notes',
        type: 'article',
        content: 'Escalate chargebacks to the payments team.',
        audiences: ['copilot'],
        brand_ids: ['brand-a'],
        owner_id: 'user-1',
      }),
    );
  });

  it('does not submit a source nobody is meant to use', async () => {
    const user = userEvent.setup();
    await openKnowledge(user);
    await fillBasics(user);

    await user.click(screen.getByRole('button', { name: 'Who uses it and who keeps it' }));
    await user.click(screen.getByRole('checkbox', { name: 'AI agent' }));
    await user.click(screen.getByRole('checkbox', { name: 'Copilot' }));

    expect(screen.getByRole('button', { name: 'Add source' })).toBeDisabled();
  });
});

describe('a website being crawled (AI-17 · tm 312.3)', () => {
  it('says a crawl is under way, or kept only part of the site, instead of counting chunks', async () => {
    await openKnowledge(userEvent.setup(), [
      source({
        id: 'src-crawling',
        name: 'Help centre',
        type: 'website',
        status: 'crawling',
        chunk_count: 0,
      }),
      source({
        id: 'src-partial',
        name: 'Bonus pages',
        type: 'website',
        status: 'partial',
        chunk_count: 4,
      }),
      source({ id: 'src-ready', name: 'Return policy' }),
    ]);

    expect(within(row('Help centre')).getByText('Crawling…')).toBeInTheDocument();
    expect(within(row('Help centre')).queryByText('Empty')).not.toBeInTheDocument();
    expect(within(row('Bonus pages')).getByText('Partly crawled')).toBeInTheDocument();
    expect(within(row('Return policy')).getByText('Indexed')).toBeInTheDocument();
  });
});
