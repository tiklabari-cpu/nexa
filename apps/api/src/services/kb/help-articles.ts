/**
 * What the widget's "Help" tab reads (WG-12 · tm 348): the workspace's
 * published knowledge base articles, searched and opened with the visitor's
 * customer token.
 *
 * The route talks to a {@link HelpArticleSource}, not to `kb_articles`: the
 * analysis (05, WG-12 "Riskler") expects the search's source to move once the
 * single knowledge store (AI-14, tm 309 · K11) grows a reader-facing audience
 * — today its `audiences` are only `ai_agent` and `copilot`, which never reach
 * a player, and the reader-facing half of the store is exactly the published
 * KB article. Swapping the source is then one object, not a route rewrite.
 *
 * Two rules are the boundary and both live in the database read, not in a
 * filter after it: only published articles (`status = 'published'` with a
 * stamped `published_at`, `publishedArticleWhere` and `kb_search_published`),
 * and only the token's workspace (RLS for the article read, the function's
 * tenant guard for the search). A draft and another workspace's article are
 * the same "nothing" as an article that never existed.
 */
import type { WidgetUiLocale } from '@siyahtus/types';
import { publishedArticleWhere } from '../../lib/kb-public-read.js';
import { renderPlainExcerpt } from '../../lib/kb-render.js';
import type { TenantClient } from '../../lib/tenant.js';
import { defaultBrandId } from '../websites/prechat.js';

/** One result line: enough to show the article in a list, never its body. */
export interface HelpSearchHit {
  slug: string;
  title: string;
  excerpt: string;
}

/** One article as the Help tab shows it. */
export interface HelpArticleView {
  slug: string;
  title: string;
  /** The KB's markdown subset, drawn by the widget without HTML. */
  body: string;
  updatedAt: Date;
}

export interface HelpSearchInput {
  licenseId: bigint;
  query: string;
  limit: number;
  /** The widget's language. No article carries one yet, so it narrows nothing today. */
  locale?: WidgetUiLocale;
}

/** Where the Help tab's articles come from. */
export interface HelpArticleSource {
  search(tx: TenantClient, input: HelpSearchInput): Promise<HelpSearchHit[]>;
  article(tx: TenantClient, slug: string): Promise<HelpArticleView | null>;
}

interface SearchRow {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  body_start: string;
}

/** A result's excerpt: the article's own, else the start of its body, as plain text. */
function excerptOf(row: SearchRow): string {
  const own = row.excerpt?.trim();
  return renderPlainExcerpt(own ? own : row.body_start);
}

/** The published KB articles of the transaction's workspace. */
export const publishedKbArticles: HelpArticleSource = {
  async search(tx, input) {
    // `kb_search_published` (20261201090000) is SECURITY DEFINER so its match
    // reaches the GIN index; it refuses any licence but the transaction's own.
    const rows = await tx.$queryRaw<SearchRow[]>`
      SELECT id::text AS id, slug, title, excerpt, body_start
      FROM kb_search_published(${input.licenseId}::bigint, ${input.query}::text, ${input.limit}::integer)`;
    return rows.map((row) => ({ slug: row.slug, title: row.title, excerpt: excerptOf(row) }));
  },

  async article(tx, slug) {
    const row = await tx.kbArticle.findFirst({
      where: { slug, ...publishedArticleWhere() },
      select: { slug: true, title: true, body: true, updatedAt: true },
    });
    return row;
  },
};

/**
 * Whether the visitor's widget shows the Help tab: its brand's switch, else the
 * licence default brand's. No row, or a brand never saved, reads as off.
 */
export async function readCustomerHelpEnabled(
  tx: TenantClient,
  brandId: string | undefined,
): Promise<boolean> {
  const resolved = brandId ?? (await defaultBrandId(tx));
  if (!resolved) return false;
  const row = await tx.widgetSettings.findFirst({
    where: { brandId: resolved },
    select: { helpEnabled: true },
  });
  return row?.helpEnabled === true;
}
