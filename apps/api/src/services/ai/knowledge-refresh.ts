/**
 * The one crawl path a knowledge source's refresh goes through, whichever of
 * the two callers decided it was time: an admin clicking "reindex" (FR-MOD-06.3.3,
 * tm 198.3) or the freshness sweep deciding a `website` source was past its
 * window (FR-MOD-06.3.3, tm 198.4). Two implementations of "crawl a stored
 * URL" would be two SSRF gates to keep in sync — see
 * `POST /knowledge-sources/:sourceId/reindex` for why the row is never
 * trusted just because it exists.
 */
import { ApiError } from '../../lib/api-error.js';
import { assertPublicHttpUrl } from '../../lib/ssrf.js';
import { crawl } from './web-crawler.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RefreshableSource {
  type: string;
  sourceUrl: string | null;
  content: string | null;
}

/**
 * A `website` source is re-crawled from its stored URL, re-run through the
 * SSRF guard every time (NFR-S7) — "it was validated when it was added" is
 * exactly the assumption a stored row must not get the benefit of. Every
 * other type has nothing to fetch, so the text it already holds is returned
 * for the caller to re-chunk.
 */
export async function fetchRefreshedText(source: RefreshableSource): Promise<string> {
  if (source.type !== 'website') return source.content ?? '';
  if (!source.sourceUrl) throw ApiError.validation('This website source has no URL to crawl.');
  const url = assertPublicHttpUrl(source.sourceUrl);
  return (await crawl(url)).text;
}

/**
 * When a `website` source should next be attempted, given its freshness
 * window. `null` — the window is unset — means "never automatically", the
 * behaviour every source had before this field existed.
 */
export function computeNextRefreshAt(refreshAfterDays: number | null, from: Date): Date | null {
  if (refreshAfterDays === null) return null;
  return new Date(from.getTime() + refreshAfterDays * MS_PER_DAY);
}
