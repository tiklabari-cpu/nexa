/**
 * When a knowledge source is next refreshed (FR-MOD-06.3.3, tm 198.4). A
 * `website` source's refresh is its crawl — queued by "reindex", "Crawl
 * again" or the freshness sweep and worked through by the knowledge job
 * runner (tm 312.3, `crawler/job-runner.ts`), which stamps the next attempt
 * when the crawl ends.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * When a `website` source should next be attempted, given its freshness
 * window. `null` — the window is unset — means "never automatically", the
 * behaviour every source had before this field existed.
 */
export function computeNextRefreshAt(refreshAfterDays: number | null, from: Date): Date | null {
  if (refreshAfterDays === null) return null;
  return new Date(from.getTime() + refreshAfterDays * MS_PER_DAY);
}
