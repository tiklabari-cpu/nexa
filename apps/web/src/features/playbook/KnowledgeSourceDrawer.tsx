/**
 * A website source's detail drawer (tm 312.4 · AI-17): where its crawl is, what
 * became of every page it found, and the three things an admin does about it —
 * crawl again, stop the crawl under way, leave a page out.
 *
 * **Progress is the job's, polled.** A crawl runs in the background (tm 312.3),
 * so the drawer asks `GET /knowledge-jobs/{id}` every 3 seconds while the job is
 * `queued`, `running` or `waiting_budget` and stops asking once it ends; the page
 * table is read on the same beat so a page appears in it as it is indexed. When
 * the job ends the list behind the drawer is read once more, so the row's badge
 * and chunk count catch up without a reload.
 *
 * **A page's failure is worded here, not by the server.** The page row carries a
 * snake_case code; `crawlErrorMessage` turns it into a Turkish or English
 * sentence, and a code this build does not know is shown as the code, never
 * hidden. `needs_js` and `blocked` get a chip of their own at the top: they are
 * the two a person can do something about (AI-17-S3), and a long table would
 * bury them.
 *
 * The drawer is a read-only view without the write scope: the buttons are not
 * drawn rather than drawn and refused.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { KNOWLEDGE_PAGE_STATUSES, isKnowledgeJobActive } from '@siyahtus/types';
import { Modal } from '../../components/ui/index.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  PAGE_STATUS_VIEW,
  PROBLEM_PAGE_STATUSES,
  crawlErrorMessage,
  pathToExclude,
} from './knowledge-crawl.js';
import type { KnowledgeJob, KnowledgePage, KnowledgeSource } from './types.js';

/** How often an unfinished job and the pages it has found are read again. */
const JOB_POLL_MS = 3_000;

const BUTTON = 'rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-50';

export function KnowledgeSourceDrawer({
  source,
  canEdit,
  onClose,
  onChanged,
}: {
  source: KnowledgeSource;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  // The job being followed. It starts as the source's own, moves to a job this
  // drawer queued, and stays on a job after it ends so the outcome can be read.
  const [jobId, setJobId] = useState<string | null>(source.job_id ?? null);
  useEffect(() => {
    if (source.job_id) setJobId(source.job_id);
  }, [source.job_id]);

  const job = useQuery({
    queryKey: ['playbook', 'knowledge-job', jobId],
    queryFn: () => api.get<KnowledgeJob>(`/knowledge-jobs/${jobId}`),
    enabled: jobId !== null,
    refetchInterval: (query) =>
      query.state.data && !isKnowledgeJobActive(query.state.data.status) ? false : JOB_POLL_MS,
  });
  const underWay = job.data ? isKnowledgeJobActive(job.data.status) : false;

  // The list behind the drawer is read once when the job ends, not on every poll.
  const settled = useRef<string | null>(null);
  useEffect(() => {
    if (!job.data || isKnowledgeJobActive(job.data.status)) return;
    const mark = `${job.data.id}:${job.data.status}`;
    if (settled.current === mark) return;
    settled.current = mark;
    onChanged();
  }, [job.data, onChanged]);

  const pages = useQuery({
    queryKey: ['playbook', 'knowledge-pages', source.id],
    queryFn: () => api.get<{ items: KnowledgePage[] }>(`/knowledge-sources/${source.id}/pages`),
    refetchInterval: underWay ? JOB_POLL_MS : false,
  });

  const crawlAgain = useMutation({
    mutationFn: () => api.post<KnowledgeJob>(`/knowledge-sources/${source.id}/crawl`, {}),
    onSuccess: (queued) => {
      setJobId(queued.id);
      onChanged();
    },
    onError: (error) => {
      // A crawl is already under way: follow that one rather than only refusing.
      const running = error instanceof ApiClientError ? error.details?.['job_id'] : undefined;
      if (typeof running === 'string') setJobId(running);
    },
  });

  const cancel = useMutation({
    mutationFn: (id: string) => api.post<KnowledgeJob>(`/knowledge-jobs/${id}/cancel`, {}),
    onSuccess: () => {
      void job.refetch();
      void pages.refetch();
      onChanged();
    },
  });

  const exclude = useMutation({
    mutationFn: (path: string) =>
      api.patch<KnowledgeSource>(`/knowledge-sources/${source.id}`, {
        exclude_paths: [...(source.exclude_paths ?? []), path],
      }),
    onSuccess: onChanged,
  });

  const [filter, setFilter] = useState<'all' | (typeof KNOWLEDGE_PAGE_STATUSES)[number]>('all');
  const allPages = pages.data?.items ?? [];
  const shown = filter === 'all' ? allPages : allPages.filter((page) => page.status === filter);
  const problemCounts = PROBLEM_PAGE_STATUSES.map(
    (status) => [status, allPages.filter((page) => page.status === status).length] as const,
  ).filter(([, count]) => count > 0);
  const excluded = new Set(source.exclude_paths ?? []);

  return (
    <Modal
      onClose={onClose}
      dock="right"
      className="w-full max-w-3xl"
      title={t('playbook.knowledge.crawl.drawerTitle', { name: source.name })}
      description={source.source_url ?? undefined}
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          <Fact
            label={t('playbook.knowledge.crawl.scope')}
            value={
              source.crawl_scope
                ? t(`playbook.knowledge.crawl.scope.${source.crawl_scope}`)
                : t('playbook.knowledge.crawl.scope.single')
            }
          />
          <Fact
            label={t('playbook.knowledge.crawl.pageLimit')}
            value={
              source.page_limit !== null && source.page_limit !== undefined
                ? source.page_limit
                : '—'
            }
          />
          <Fact label={t('playbook.knowledge.crawl.pagesKept')} value={source.page_count ?? 0} />
          <Fact
            label={t('playbook.knowledge.crawl.lastCrawled')}
            value={
              source.last_crawled_at
                ? (formatDate(source.last_crawled_at) ?? '—')
                : t('playbook.knowledge.crawl.never')
            }
          />
        </dl>

        {(source.include_paths?.length ?? 0) > 0 && (
          <p className="text-2xs text-content-tertiary">
            {t('playbook.knowledge.crawl.includeSummary', {
              paths: (source.include_paths ?? []).join(', '),
            })}
          </p>
        )}
        {(source.exclude_paths?.length ?? 0) > 0 && (
          <p className="text-2xs text-content-tertiary">
            {t('playbook.knowledge.crawl.excludeSummary', {
              paths: (source.exclude_paths ?? []).join(', '),
            })}
          </p>
        )}

        <JobProgress job={job.data} failed={job.isError} />

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={BUTTON}
              disabled={underWay || crawlAgain.isPending}
              onClick={() => crawlAgain.mutate()}
            >
              {t('playbook.knowledge.crawl.crawlAgain')}
            </button>
            {underWay && jobId && (
              <button
                type="button"
                className={`${BUTTON} text-danger`}
                disabled={cancel.isPending}
                onClick={() => cancel.mutate(jobId)}
              >
                {t('playbook.knowledge.crawl.cancel')}
              </button>
            )}
            {[crawlAgain, cancel, exclude].map(
              (mutation, index) =>
                mutation.isError && (
                  <span key={index} role="alert" className="text-2xs text-danger">
                    {t(errorMessageKey(mutation.error))}
                  </span>
                ),
            )}
            {exclude.isSuccess && (
              <span role="status" className="text-2xs text-content-tertiary">
                {t('playbook.knowledge.crawl.excludedNote')}
              </span>
            )}
          </div>
        )}

        {problemCounts.length > 0 && (
          <ul
            aria-label={t('playbook.knowledge.crawl.problemsLabel')}
            className="flex flex-wrap gap-2"
          >
            {problemCounts.map(([status, count]) => (
              <li key={status}>
                <button
                  type="button"
                  aria-pressed={filter === status}
                  onClick={() => setFilter(filter === status ? 'all' : status)}
                  className="rounded-full border border-border px-2.5 py-0.5 text-2xs text-content"
                >
                  {t(PAGE_STATUS_VIEW[status].key)} · {count}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2">
          <label
            htmlFor="knowledge-pages-filter"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('playbook.knowledge.crawl.filter')}
          </label>
          <select
            id="knowledge-pages-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as typeof filter)}
            className="rounded-md border border-border bg-inset px-2 py-1 text-sm text-content outline-none"
          >
            <option value="all">{t('playbook.knowledge.crawl.filterAll')}</option>
            {KNOWLEDGE_PAGE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(PAGE_STATUS_VIEW[status].key)}
              </option>
            ))}
          </select>
        </div>

        {pages.isError ? (
          <p role="alert" className="text-sm text-danger">
            {t(errorMessageKey(pages.error))}
          </p>
        ) : pages.isPending ? (
          <p className="text-sm text-content-secondary">{t('playbook.knowledge.loading')}</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-content-secondary">
            {allPages.length === 0
              ? t('playbook.knowledge.crawl.noPages')
              : t('playbook.knowledge.crawl.noPagesFiltered')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t('playbook.knowledge.crawl.tableLabel')}</caption>
              <thead>
                <tr className="border-b border-border text-2xs uppercase tracking-wide text-content-tertiary">
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t('playbook.knowledge.crawl.colPage')}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t('playbook.knowledge.crawl.colStatus')}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t('playbook.knowledge.crawl.colChunks')}
                  </th>
                  <th scope="col" className="py-1.5 pr-3 font-medium">
                    {t('playbook.knowledge.crawl.colFetched')}
                  </th>
                  {canEdit && <th scope="col" className="py-1.5 font-medium" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {shown.map((page) => {
                  const view = PAGE_STATUS_VIEW[page.status];
                  const path = pathToExclude(page.url);
                  const reason = page.error ? crawlErrorMessage(page.error) : null;
                  return (
                    <tr key={page.id} className="align-top">
                      <td className="max-w-xs py-1.5 pr-3">
                        <p className="truncate font-medium" title={page.title ?? undefined}>
                          {page.title || page.url}
                        </p>
                        <p className="truncate text-2xs text-content-tertiary" title={page.url}>
                          {page.url}
                        </p>
                      </td>
                      <td className="py-1.5 pr-3">
                        <StatusDot tone={view.tone} label={t(view.key)} />
                        {reason && (
                          <p className="text-2xs text-content-tertiary">
                            {t(reason.key, reason.values)}
                          </p>
                        )}
                        {view.hintKey && (
                          <p className="text-2xs text-content-tertiary">{t(view.hintKey)}</p>
                        )}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">{page.chunk_count}</td>
                      <td className="py-1.5 pr-3 text-2xs text-content-tertiary">
                        {page.fetched_at ? (formatDate(page.fetched_at) ?? '—') : '—'}
                      </td>
                      {canEdit && (
                        <td className="py-1.5 text-right">
                          {path !== null && !excluded.has(path) && page.status !== 'removed' && (
                            <button
                              type="button"
                              className="text-2xs text-content-secondary underline disabled:opacity-50"
                              disabled={exclude.isPending}
                              aria-label={t('playbook.knowledge.crawl.excludeAria', {
                                path,
                              })}
                              onClick={() => exclude.mutate(path)}
                            >
                              {t('playbook.knowledge.crawl.excludePage')}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end">
          <button type="button" className={BUTTON} onClick={onClose}>
            {t('playbook.knowledge.crawl.close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string | number }): ReactElement {
  return (
    <div className="flex flex-col">
      <dt className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

/** The job's line: a bar while it works, a sentence once it has stopped. */
function JobProgress({
  job,
  failed,
}: {
  job: KnowledgeJob | undefined;
  failed: boolean;
}): ReactElement | null {
  const t = useTranslate();
  if (!job) {
    return failed ? (
      <p role="alert" className="text-sm text-danger">
        {t('playbook.knowledge.crawl.job.unreadable')}
      </p>
    ) : null;
  }
  const { pages } = job;
  const active = isKnowledgeJobActive(job.status);
  const reason = job.error ? crawlErrorMessage(job.error) : null;
  return (
    <section
      aria-label={t('playbook.knowledge.crawl.job.label')}
      className="flex flex-col gap-1 rounded-md border border-border p-3"
    >
      <p role="status" className="text-sm font-medium">
        {t(`playbook.knowledge.crawl.job.${job.status}`)}
      </p>
      {active && (
        <progress
          className="w-full"
          max={Math.max(pages.discovered, 1)}
          value={Math.min(pages.done, Math.max(pages.discovered, 1))}
          aria-label={t('playbook.knowledge.crawl.job.progressLabel')}
        />
      )}
      <p className="text-2xs text-content-tertiary">
        {t('playbook.knowledge.crawl.job.counts', {
          done: pages.done,
          discovered: pages.discovered,
          ok: pages.ok,
          unchanged: pages.unchanged,
          skipped: pages.skipped,
          failed: pages.failed,
          removed: pages.removed,
        })}
      </p>
      {job.status === 'waiting_budget' && job.available_at && (
        <p className="text-2xs text-content-tertiary">
          {t('playbook.knowledge.crawl.job.resumesAt', {
            date: formatDateTime(job.available_at) ?? '',
          })}
        </p>
      )}
      {reason && job.status !== 'cancelled' && (
        <p className="text-2xs text-danger">{t(reason.key, reason.values)}</p>
      )}
    </section>
  );
}
