/**
 * What the panel knows about a website source's crawl (tm 312.4 · AI-17): the
 * add form's crawl settings, the words for a page's status and for the reason
 * a page or a job failed, and the one URL-to-path rule "exclude this page"
 * needs. Pure — the screens in `KnowledgeCrawlFields.tsx` and
 * `KnowledgeSourceDrawer.tsx` only draw what is decided here.
 */
import {
  CRAWL_SCOPES,
  DEFAULT_CRAWL_SCOPE,
  KNOWLEDGE_PAGE_LIMIT,
  normalizeCrawlPaths,
  type CrawlScope,
  type KnowledgePageStatus,
} from '@siyahtus/types';
import type { StatusTone } from '../../components/StatusDot.js';

/** The days a website may be re-crawled by itself, as the add form asks for them (AI-17-S1). */
export const CRAWL_REFRESH_DAYS = { min: 5, max: 365 } as const;

/** How the add form holds a website's crawl settings; every field is the text the admin typed. */
export interface CrawlFormValue {
  scope: CrawlScope;
  pageLimit: string;
  /** One path prefix per line. */
  includePaths: string;
  excludePaths: string;
  /** Days between automatic re-crawls; `''` — never. */
  refreshDays: string;
  /** "I am allowed to crawl this site" — AI-17's legal gate. */
  authorized: boolean;
}

export function defaultCrawlValue(): CrawlFormValue {
  return {
    scope: DEFAULT_CRAWL_SCOPE,
    pageLimit: String(KNOWLEDGE_PAGE_LIMIT.default),
    includePaths: '',
    excludePaths: '',
    refreshDays: '',
    authorized: false,
  };
}

/** The lines of a textarea as path prefixes: trimmed, blanks dropped. */
export function pathLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

export type CrawlFieldError = 'pageLimit' | 'includePaths' | 'excludePaths' | 'refreshDays';

/** Which crawl settings the endpoint would refuse — the same rules, so the form never blocks a valid body. */
export function crawlErrors(value: CrawlFormValue): CrawlFieldError[] {
  const errors: CrawlFieldError[] = [];
  // A single page has no limit or paths to ask for — the form hides them, so
  // whatever they still hold is not sent and cannot be wrong.
  if (value.scope !== 'single') {
    const limit = Number(value.pageLimit);
    if (
      !Number.isInteger(limit) ||
      limit < KNOWLEDGE_PAGE_LIMIT.min ||
      limit > KNOWLEDGE_PAGE_LIMIT.max
    ) {
      errors.push('pageLimit');
    }
    if (normalizeCrawlPaths(pathLines(value.includePaths)) === null) errors.push('includePaths');
    if (normalizeCrawlPaths(pathLines(value.excludePaths)) === null) errors.push('excludePaths');
  }
  if (value.refreshDays.trim() !== '') {
    const days = Number(value.refreshDays);
    if (!Number.isInteger(days) || days < CRAWL_REFRESH_DAYS.min || days > CRAWL_REFRESH_DAYS.max) {
      errors.push('refreshDays');
    }
  }
  return errors;
}

/** A website can be added once its settings hold and the admin has said they may crawl it. */
export function crawlIsValid(value: CrawlFormValue): boolean {
  return value.authorized && crawlErrors(value).length === 0;
}

/**
 * The create body's crawl half. `single` sends the scope alone (a single page
 * has no "below it"), and the lists are sent only when they say something, so a
 * form left alone posts the body a website always had plus the scope.
 */
export function crawlCreateBody(value: CrawlFormValue): Record<string, unknown> {
  const body: Record<string, unknown> = { crawl_scope: value.scope };
  if (value.scope === 'single') return body;
  body['page_limit'] = Number(value.pageLimit);
  const include = normalizeCrawlPaths(pathLines(value.includePaths)) ?? [];
  const exclude = normalizeCrawlPaths(pathLines(value.excludePaths)) ?? [];
  if (include.length > 0) body['include_paths'] = include;
  if (exclude.length > 0) body['exclude_paths'] = exclude;
  return body;
}

/** The number of days to schedule after the source is created, or null — never. */
export function crawlRefreshDays(value: CrawlFormValue): number | null {
  return value.refreshDays.trim() === '' ? null : Number(value.refreshDays);
}

export function isCrawlScopeValue(value: string): value is CrawlScope {
  return (CRAWL_SCOPES as readonly string[]).includes(value);
}

/** How a page's status reads on the table: a tone for the glyph, and the catalogue key for the word. */
export const PAGE_STATUS_VIEW: Record<
  KnowledgePageStatus,
  { tone: StatusTone; key: string; hintKey?: string }
> = {
  ok: { tone: 'success', key: 'playbook.knowledge.crawl.page.ok' },
  unchanged: { tone: 'success', key: 'playbook.knowledge.crawl.page.unchanged' },
  skipped_scope: { tone: 'neutral', key: 'playbook.knowledge.crawl.page.skipped_scope' },
  robots_disallowed: { tone: 'neutral', key: 'playbook.knowledge.crawl.page.robots_disallowed' },
  blocked: {
    tone: 'danger',
    key: 'playbook.knowledge.crawl.page.blocked',
    hintKey: 'playbook.knowledge.crawl.page.blockedHint',
  },
  needs_js: {
    tone: 'warning',
    key: 'playbook.knowledge.crawl.page.needs_js',
    hintKey: 'playbook.knowledge.crawl.page.needsJsHint',
  },
  error: { tone: 'danger', key: 'playbook.knowledge.crawl.page.error' },
  removed: { tone: 'neutral', key: 'playbook.knowledge.crawl.page.removed' },
};

/** The pages whose status is a problem the admin may want to look at. */
export const PROBLEM_PAGE_STATUSES: readonly KnowledgePageStatus[] = [
  'error',
  'blocked',
  'needs_js',
];

/** Reason codes the crawler writes (`knowledge_pages.error`, `knowledge_jobs.error`) that the catalogue words. */
const CRAWL_ERROR_CODES: ReadonlySet<string> = new Set([
  'ssrf_refused',
  'dns_failed',
  'timeout',
  'too_large',
  'compression_ratio',
  'unsupported_encoding',
  'network',
  'tls',
  'redirect_limit',
  'redirect_invalid',
  'redirect_out_of_scope',
  'not_html',
  'cancelled',
  'bot_wall',
  'empty_page',
  'gone',
  'out_of_scope',
  'robots_unreachable',
  'job_bytes_limit',
  'workspace_page_limit',
  'residency_refused',
  'invalid_url',
  'not_website',
  'unsupported_kind',
  'internal',
]);

/**
 * The catalogue key and values for a failure code. A code the build does not
 * know is shown as the code itself rather than hidden — the server may be
 * ahead of the panel.
 */
export function crawlErrorMessage(code: string): { key: string; values?: Record<string, string> } {
  if (CRAWL_ERROR_CODES.has(code)) return { key: `playbook.knowledge.crawl.error.${code}` };
  const http = /^http_(\d{3})$/.exec(code);
  if (http) return { key: 'playbook.knowledge.crawl.error.http', values: { status: http[1]! } };
  return { key: 'playbook.knowledge.crawl.error.unknown', values: { code } };
}

/**
 * The path prefix that leaves exactly this page out of the next crawl, or null
 * when the URL has none (not a URL, or the site's root — excluding `/` would
 * exclude the whole source).
 */
export function pathToExclude(pageUrl: string): string | null {
  let path: string;
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    return null;
  }
  if (path === '' || path === '/') return null;
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return normalizeCrawlPaths([trimmed]) === null ? null : trimmed;
}
