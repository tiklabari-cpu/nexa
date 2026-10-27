/**
 * The website source's detail drawer (tm 312.4 · AI-17).
 *
 * Driven on its own with a scripted API: the drawer's whole behaviour is what it
 * asks (`GET /knowledge-jobs/{id}` on a 3 s beat while the job is under way,
 * `GET …/pages`) and what it sends (`POST …/crawl`, `POST …/cancel`, the PATCH
 * that leaves a page out), so the assertions are on those calls and on the words
 * the admin reads — not on markup.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import { resetLocale, setLocale } from '../../test/i18n.js';
import type { KnowledgeJob, KnowledgePage, KnowledgeSource } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { KnowledgeSourceDrawer } = await import('./KnowledgeSourceDrawer.js');

function source(patch: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    id: 'src-1',
    ai_agent_id: 'agent-1',
    name: 'Help centre',
    type: 'website',
    status: 'crawling',
    source_url: 'https://help.example.com/',
    chunk_count: 0,
    updated_at: '2026-10-27T10:00:00.000Z',
    added_by_name: 'Ada',
    refresh_after_days: null,
    next_refresh_at: null,
    last_refresh_error: null,
    crawl_scope: 'all',
    page_limit: 50,
    include_paths: [],
    exclude_paths: [],
    last_crawled_at: null,
    page_count: 0,
    job_id: 'job-1',
    ...patch,
  };
}

function job(patch: Partial<KnowledgeJob> = {}): KnowledgeJob {
  return {
    id: 'job-1',
    source_id: 'src-1',
    kind: 'crawl',
    status: 'running',
    pages: { discovered: 10, done: 4, ok: 3, unchanged: 0, skipped: 1, failed: 0, removed: 0 },
    error: null,
    created_at: '2026-10-27T10:00:00.000Z',
    ...patch,
  };
}

function page(patch: Partial<KnowledgePage> = {}): KnowledgePage {
  return {
    id: 'page-1',
    url: 'https://help.example.com/iade',
    title: 'Returns',
    status: 'ok',
    http_status: 200,
    error: null,
    depth: 1,
    chunk_count: 2,
    fetched_at: '2026-10-27T10:01:00.000Z',
    ...patch,
  };
}

interface World {
  job: KnowledgeJob;
  pages: KnowledgePage[];
}

function serve(world: World): void {
  api.get.mockImplementation((path: string) => {
    if (path === `/knowledge-jobs/${world.job.id}`) return Promise.resolve(world.job);
    if (path === '/knowledge-sources/src-1/pages') return Promise.resolve({ items: world.pages });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function open(props: Partial<Parameters<typeof KnowledgeSourceDrawer>[0]> = {}) {
  const onChanged = vi.fn();
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <KnowledgeSourceDrawer
        source={source()}
        canEdit
        onClose={onClose}
        onChanged={onChanged}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onChanged, onClose, queryClient, ...view };
}

beforeEach(() => {
  resetLocale();
  for (const fn of Object.values(api)) fn.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the crawl’s progress', () => {
  it('shows the running job and every page the crawl has found so far', async () => {
    serve({
      job: job(),
      pages: [
        page(),
        page({
          id: 'p2',
          url: 'https://help.example.com/gizli',
          status: 'robots_disallowed',
          chunk_count: 0,
          title: null,
        }),
      ],
    });
    open();

    expect(await screen.findByText('Crawling…')).toBeTruthy();
    expect(screen.getByText(/4 of 10 pages · 3 indexed/)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Pages crawled' })).toBeTruthy();

    const table = await screen.findByRole('table', { name: 'Pages found by the crawl' });
    expect(within(table).getByText('Returns')).toBeTruthy();
    expect(within(table).getByText('Indexed')).toBeTruthy();
    expect(within(table).getByText('Blocked by robots.txt')).toBeTruthy();
  });

  it('asks for the job again every 3 seconds while it is under way, and stops once it ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const world: World = { job: job(), pages: [page()] };
    serve(world);
    const { onChanged } = open();

    await screen.findByText('Crawling…');
    const jobReads = () =>
      api.get.mock.calls.filter(([path]) => path === '/knowledge-jobs/job-1').length;
    expect(jobReads()).toBe(1);

    await act(() => vi.advanceTimersByTimeAsync(3_100));
    expect(jobReads()).toBe(2);

    // The job ends: the drawer reads it once more, says so, tells the list to look again…
    world.job = job({ status: 'done', pages: { ...world.job.pages, done: 10, ok: 9 } });
    await act(() => vi.advanceTimersByTimeAsync(3_100));
    expect(await screen.findByText('Crawl finished')).toBeTruthy();
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

    // …and stops asking.
    const after = jobReads();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(jobReads()).toBe(after);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('says when the day’s AI allowance paused the crawl, and when it goes on', async () => {
    serve({
      job: job({ status: 'waiting_budget', available_at: '2026-10-28T00:00:00.000Z' }),
      pages: [],
    });
    open();

    expect(await screen.findByText('Paused: today’s AI allowance is used up')).toBeTruthy();
    expect(screen.getByText(/It continues after/)).toBeTruthy();
  });

  it('words a failed job’s reason, in Turkish when the panel is', async () => {
    setLocale('tr');
    serve({ job: job({ status: 'failed', error: 'workspace_page_limit' }), pages: [] });
    open();

    expect(await screen.findByText('Tarama başarısız oldu')).toBeTruthy();
    expect(screen.getByText('Çalışma alanının taranmış sayfa sınırına ulaşıldı.')).toBeTruthy();
  });
});

describe('what became of each page', () => {
  it('words the failure, and chips the pages that need JavaScript or are blocked', async () => {
    serve({
      job: job({ status: 'done' }),
      pages: [
        page(),
        page({
          id: 'p2',
          url: 'https://help.example.com/a',
          status: 'error',
          error: 'ssrf_refused',
          chunk_count: 0,
        }),
        page({ id: 'p3', url: 'https://help.example.com/b', status: 'needs_js', chunk_count: 0 }),
        page({
          id: 'p4',
          url: 'https://help.example.com/c',
          status: 'blocked',
          error: 'bot_wall',
          chunk_count: 0,
        }),
        page({
          id: 'p5',
          url: 'https://help.example.com/d',
          status: 'error',
          error: 'http_503',
          chunk_count: 0,
        }),
      ],
    });
    open();

    const table = await screen.findByRole('table', { name: 'Pages found by the crawl' });
    expect(
      within(table).getByText('The address is private or internal, so it was not fetched.'),
    ).toBeTruthy();
    expect(within(table).getByText('The site answered with HTTP 503.')).toBeTruthy();
    expect(within(table).getByText(/drawn by JavaScript/)).toBeTruthy();

    const chips = screen.getByRole('list', { name: 'Pages that need a look' });
    expect(within(chips).getByRole('button', { name: /Failed · 2/ })).toBeTruthy();
    expect(within(chips).getByRole('button', { name: /Needs JavaScript · 1/ })).toBeTruthy();
    expect(within(chips).getByRole('button', { name: /Blocked by the site · 1/ })).toBeTruthy();
  });

  it('narrows the table to the status a chip or the filter names', async () => {
    const user = userEvent.setup();
    serve({
      job: job({ status: 'done' }),
      pages: [
        page(),
        page({
          id: 'p3',
          url: 'https://help.example.com/b',
          title: 'Spa',
          status: 'needs_js',
          chunk_count: 0,
        }),
      ],
    });
    open();

    await screen.findByText('Returns');
    await user.click(screen.getByRole('button', { name: /Needs JavaScript · 1/ }));
    expect(screen.queryByText('Returns')).toBeNull();
    expect(screen.getByText('Spa')).toBeTruthy();

    await user.selectOptions(screen.getByLabelText('Show'), 'ok');
    expect(screen.getByText('Returns')).toBeTruthy();
    expect(screen.queryByText('Spa')).toBeNull();
  });

  it('shows an unknown reason code as it is rather than hiding it', async () => {
    serve({
      job: job({ status: 'done' }),
      pages: [page({ status: 'error', error: 'from_the_future', chunk_count: 0 })],
    });
    open();

    expect(await screen.findByText('Reason: from_the_future')).toBeTruthy();
  });
});

describe('the buttons', () => {
  it('queues a crawl and follows the job it answers with', async () => {
    const user = userEvent.setup();
    const world: World = { job: job({ id: 'job-1', status: 'done' }), pages: [page()] };
    serve(world);
    api.post.mockImplementation(async () => {
      world.job = job({ id: 'job-2', status: 'queued' });
      return world.job;
    });
    const { onChanged } = open({ source: source({ job_id: null, status: 'ready' }) });

    await user.click(await screen.findByRole('button', { name: 'Crawl again' }));

    expect(api.post).toHaveBeenCalledWith('/knowledge-sources/src-1/crawl', {});
    expect(await screen.findByText('Waiting for its turn…')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/knowledge-jobs/job-2');
    expect(onChanged).toHaveBeenCalled();
    // Not twice at once: the button is off while a job is under way.
    expect(screen.getByRole('button', { name: 'Crawl again' }).hasAttribute('disabled')).toBe(true);
  });

  it('follows the crawl already under way when the server says there is one', async () => {
    const user = userEvent.setup();
    serve({ job: job({ id: 'job-9', status: 'running' }), pages: [] });
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'knowledge_job_in_progress',
        status: 409,
        message: 'busy',
        requestId: 'r',
        details: { job_id: 'job-9' },
      }),
    );
    open({ source: source({ job_id: null, status: 'ready' }) });

    await user.click(await screen.findByRole('button', { name: 'Crawl again' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/knowledge-jobs/job-9'));
  });

  it('stops a crawl under way, and offers the button only while there is one', async () => {
    const user = userEvent.setup();
    const world: World = { job: job(), pages: [] };
    serve(world);
    api.post.mockImplementation(async () => {
      world.job = job({ status: 'cancelled' });
      return world.job;
    });
    open();

    await user.click(await screen.findByRole('button', { name: 'Stop crawl' }));

    expect(api.post).toHaveBeenCalledWith('/knowledge-jobs/job-1/cancel', {});
    expect(await screen.findByText('Crawl stopped')).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop crawl' })).toBeNull());
  });

  it('leaves a page out by patching the source’s exclude list, keeping what was there', async () => {
    const user = userEvent.setup();
    serve({ job: job({ status: 'done' }), pages: [page()] });
    api.patch.mockResolvedValue(source());
    const { onChanged } = open({ source: source({ exclude_paths: ['/eski'], job_id: null }) });

    await user.click(
      await screen.findByRole('button', { name: 'Leave out /iade from the next crawl' }),
    );

    expect(api.patch).toHaveBeenCalledWith('/knowledge-sources/src-1', {
      exclude_paths: ['/eski', '/iade'],
    });
    expect(await screen.findByText(/Left out/)).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it('does not offer to leave out a page the source already skips, or the site root', async () => {
    serve({
      job: job({ status: 'done' }),
      pages: [page(), page({ id: 'root', url: 'https://help.example.com/', title: 'Home' })],
    });
    open({ source: source({ exclude_paths: ['/iade'], job_id: null }) });

    await screen.findByText('Home');
    expect(screen.queryByRole('button', { name: /Leave out/ })).toBeNull();
  });

  it('is a read-only view without the write scope', async () => {
    serve({ job: job(), pages: [page()] });
    open({ canEdit: false });

    await screen.findByText('Returns');
    expect(screen.queryByRole('button', { name: 'Crawl again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop crawl' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Leave out/ })).toBeNull();
  });
});
