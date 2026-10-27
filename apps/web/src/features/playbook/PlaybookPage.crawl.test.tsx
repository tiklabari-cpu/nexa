/**
 * Adding a website source and opening its crawl (tm 312.4 · AI-17), through the
 * Knowledge tab.
 *
 * Three promises: a website cannot be added until the admin says they may crawl
 * it; the crawl settings reach the create body exactly as chosen (and a single
 * page sends no limit it never asked for); and only a website row has a
 * Details drawer to open.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { resetLocale } from '../../test/i18n.js';
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

function source(patch: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: 'src-1',
    ai_agent_id: 'agent-1',
    name: 'Help centre',
    type: 'website',
    status: 'ready',
    source_url: 'https://help.example.com/',
    chunk_count: 4,
    updated_at: '2026-10-27T10:00:00.000Z',
    added_by_name: 'Ada',
    refresh_after_days: null,
    next_refresh_at: null,
    last_refresh_error: null,
    crawl_scope: 'single',
    page_limit: 200,
    include_paths: [],
    exclude_paths: [],
    last_crawled_at: '2026-10-27T10:05:00.000Z',
    page_count: 1,
    job_id: null,
    ...patch,
  };
}

beforeEach(() => {
  // General is the landing tab (tm 390.2); these tests are about the Knowledge tab.
  window.history.replaceState(null, '', '/app/playbook?view=skills');
  resetLocale();
  for (const fn of Object.values(api)) fn.mockReset();
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
  items: KnowledgeSource[] = [],
): Promise<void> {
  api.get.mockImplementation((path: string) => {
    if (path === '/skills') return Promise.resolve({ items: [] });
    if (path === '/ai-agents') {
      return Promise.resolve({
        items: [{ id: 'agent-1', kind: 'ai_agent', name: 'Ada', active: true }],
      });
    }
    if (path.startsWith('/knowledge-sources/src-1/pages')) return Promise.resolve({ items: [] });
    if (path.startsWith('/knowledge-sources')) return Promise.resolve({ items });
    if (path === '/brands' || path === '/agents') return Promise.resolve({ items: [] });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlaybookPage />
    </QueryClientProvider>,
  );
  await user.click(await screen.findByRole('tab', { name: 'Knowledge' }));
}

async function fillWebsite(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.selectOptions(await screen.findByLabelText('Type', { exact: true }), 'website');
  await user.type(screen.getByLabelText('Title'), 'Help centre');
  await user.type(screen.getByLabelText(/Website URL/), 'https://help.example.com/');
}

describe('adding a website source', () => {
  it('stays closed until the admin says they may crawl the site', async () => {
    const user = userEvent.setup();
    await openKnowledge(user);
    await fillWebsite(user);

    const add = screen.getByRole('button', { name: 'Add source' });
    expect(add.hasAttribute('disabled')).toBe(true);

    await user.click(screen.getByLabelText('I am authorised to crawl this site.'));
    expect(add.hasAttribute('disabled')).toBe(false);

    await user.click(screen.getByLabelText('I am authorised to crawl this site.'));
    expect(add.hasAttribute('disabled')).toBe(true);
  });

  it('sends the chosen scope, limit and paths, then schedules the refresh on the new source', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(source({ id: 'src-new', status: 'crawling', job_id: 'job-1' }));
    api.patch.mockResolvedValue(source({ id: 'src-new', refresh_after_days: 30 }));
    await openKnowledge(user);
    await fillWebsite(user);

    await user.selectOptions(screen.getByLabelText('Crawl scope'), 'all');
    await user.clear(screen.getByLabelText('Page limit'));
    await user.type(screen.getByLabelText('Page limit'), '40');
    await user.type(screen.getByLabelText('Only these paths'), '/yardim');
    await user.type(screen.getByLabelText('Skip these paths'), '/yardim/eski');
    await user.type(screen.getByLabelText('Refresh every (days)'), '30');
    await user.click(screen.getByLabelText('I am authorised to crawl this site.'));
    await user.click(screen.getByRole('button', { name: 'Add source' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith(
      '/knowledge-sources',
      expect.objectContaining({
        name: 'Help centre',
        type: 'website',
        source_url: 'https://help.example.com/',
        crawl_scope: 'all',
        page_limit: 40,
        include_paths: ['/yardim'],
        exclude_paths: ['/yardim/eski'],
      }),
    );
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/knowledge-sources/src-new', {
        refresh_after_days: 30,
      }),
    );
  });

  it('sends only the scope for one page, and no refresh call when none was asked for', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(source({ id: 'src-new', status: 'crawling', job_id: 'job-1' }));
    await openKnowledge(user);
    await fillWebsite(user);
    await user.click(screen.getByLabelText('I am authorised to crawl this site.'));
    await user.click(screen.getByRole('button', { name: 'Add source' }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = api.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(body['crawl_scope']).toBe('single');
    expect(body).not.toHaveProperty('page_limit');
    expect(body).not.toHaveProperty('include_paths');
    expect(body).not.toHaveProperty('exclude_paths');
    expect(api.patch).not.toHaveBeenCalled();
    // The form is ready for the next one: the tick has to be given again.
    await waitFor(() =>
      expect(
        (screen.getByLabelText('I am authorised to crawl this site.') as HTMLInputElement).checked,
      ).toBe(false),
    );
  });

  it('keeps the source and says so when only the refresh schedule was refused', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(source({ id: 'src-new', status: 'crawling', job_id: 'job-1' }));
    api.patch.mockRejectedValue(new Error('boom'));
    await openKnowledge(user);
    await fillWebsite(user);
    await user.type(screen.getByLabelText('Refresh every (days)'), '30');
    await user.click(screen.getByLabelText('I am authorised to crawl this site.'));
    await user.click(screen.getByRole('button', { name: 'Add source' }));

    expect(await screen.findByText(/The source was added, but the refresh schedule/)).toBeTruthy();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it('refuses a limit or an interval the endpoint would refuse, in place', async () => {
    const user = userEvent.setup();
    await openKnowledge(user);
    await fillWebsite(user);
    await user.selectOptions(screen.getByLabelText('Crawl scope'), 'sitemap');
    await user.clear(screen.getByLabelText('Page limit'));
    await user.type(screen.getByLabelText('Page limit'), '500');
    await user.type(screen.getByLabelText('Refresh every (days)'), '2');
    await user.click(screen.getByLabelText('I am authorised to crawl this site.'));

    expect(screen.getByText('Enter a whole number from 1 to 200.')).toBeTruthy();
    expect(screen.getByText('Enter a whole number from 5 to 365, or leave it empty.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add source' }).hasAttribute('disabled')).toBe(true);
  });

  it('does not draw the crawl settings for the other types', async () => {
    const user = userEvent.setup();
    await openKnowledge(user);

    expect(await screen.findByLabelText('Type', { exact: true })).toBeTruthy();
    expect(screen.queryByLabelText('Crawl scope')).toBeNull();
    expect(screen.queryByLabelText('I am authorised to crawl this site.')).toBeNull();
  });
});

describe('a website row’s details', () => {
  it('opens the drawer for a website, and offers none for a text source', async () => {
    const user = userEvent.setup();
    await openKnowledge(user, [
      source(),
      source({ id: 'src-2', name: 'Return policy', type: 'faq', source_url: null }),
    ]);

    expect(await screen.findByText('Return policy')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Crawl details for Return policy' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Crawl details for Help centre' }));

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Crawl of Help centre')).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Crawl again' })).toBeTruthy();
  });

  it('is there for a viewer without the write scope too, as a read-only view', async () => {
    useAuth.setState({
      agent: {
        account_id: 'a-2',
        email: 'v@acme.localhost',
        name: 'Viewer',
        role: 'agent',
        organization_id: 'o-1',
        license_id: '1000003',
        scopes: [],
        routing_status: 'accepting_chats',
      },
    });
    const user = userEvent.setup();
    await openKnowledge(user, [source()]);

    await user.click(await screen.findByRole('button', { name: 'Crawl details for Help centre' }));

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).queryByRole('button', { name: 'Crawl again' })).toBeNull();
  });
});
