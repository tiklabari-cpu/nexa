/**
 * Pins `scripts/audit/unpaged-lists.cjs` — the NFR-P5 sentry for list requests
 * that pin a `limit` and carry no way to ask for the next page (tm 401).
 *
 * Placement is the same as `endpoint-ui-audit.test.ts`: the script is a
 * repo-root tool, no workspace package owns it, and this directory is where the
 * gate's unit shard picks such artefacts up.
 *
 * What is worth pinning is the vocabulary. The audit used to know only
 * `page_id` / `before_event_id` / `after_event_id`, so a list that pages
 * correctly by `cursor` (webhook deliveries) was reported as a ceiling — a false
 * positive that sat in the output next to real ones, which is how a gate learns
 * to be ignored. The cursor cases below are that regression; the rest keep the
 * sentry honest in the other direction (a local variable named `cursor`, or the
 * word in a comment, must NOT count as paging).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// src/config → apps/api → apps → repo root (same resolution as the sibling audits)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/audit/unpaged-lists.cjs');

interface Scan {
  paged: string[];
  exempt: string[];
  unpaged: string[];
}
interface Module {
  scan: (sources: { file: string; text: string }[]) => Scan;
}

const { scan } = createRequire(import.meta.url)(SCRIPT) as Module;

const one = (text: string): Scan => scan([{ file: 'apps/web/src/x.tsx', text }]);

describe('unpaged-lists audit recognises every paging vocabulary (tm 401)', () => {
  it('takes `params.set("cursor", …)` as paging — the webhook deliveries shape', () => {
    const result = one(
      [
        'queryFn: ({ pageParam }) => {',
        '  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });',
        "  if (pageParam) params.set('cursor', pageParam);",
        '  return api.get(`/webhooks/${id}/deliveries?${params.toString()}`);',
        '},',
        'getNextPageParam: (last) => last.next_cursor,',
      ].join('\n'),
    );
    expect(result.paged).toHaveLength(1);
    expect(result.unpaged).toEqual([]);
  });

  it.each([
    ['a `cursor=` in the URL', 'api.get(`/things?limit=50&cursor=${c}`);'],
    ['a `cursor:` object key', 'api.get(path, { limit: 50, cursor: c });'],
    ['`next_cursor` read from the response', 'const q = `?limit=50`; const n = page.next_cursor;'],
    ['an `offset` parameter', 'api.get(`/ai/suggestions?limit=50&offset=${loaded}`);'],
    ['`page_id`, as before', 'api.get(`/chats?limit=50&page_id=${id}`);'],
  ])('takes %s as paging', (_name, text) => {
    expect(one(text).paged).toHaveLength(1);
    expect(one(text).unpaged).toEqual([]);
  });

  it('still reports a pinned limit with nothing that pages', () => {
    const result = one('api.get(`/ai/test-runs?ai_agent_id=${id}&limit=20`);');
    expect(result.unpaged).toHaveLength(1);
    expect(result.paged).toEqual([]);
  });

  it('does not take a local variable named `cursor` for a wire parameter', () => {
    const result = one(['const cursor = next ?? null;', 'api.get(`/things?limit=50`);'].join('\n'));
    expect(result.unpaged).toHaveLength(1);
  });

  it('does not take a comment that mentions the cursor for paging', () => {
    const result = one(
      ['// walks the next_cursor chain elsewhere', 'api.get(`/things?limit=50`);'].join('\n'),
    );
    expect(result.unpaged).toHaveLength(1);
  });

  it('honours `paging-exempt:` with a reason, and only with a reason', () => {
    const withReason = one(
      ['// paging-exempt: a six-row type-ahead', 'api.get(`/customers?limit=6`);'].join('\n'),
    );
    expect(withReason.exempt).toHaveLength(1);
    expect(withReason.exempt[0]).toContain('a six-row type-ahead');
    expect(withReason.unpaged).toEqual([]);

    const bare = one(['// paging-exempt:', 'api.get(`/customers?limit=6`);'].join('\n'));
    expect(bare.exempt).toEqual([]);
    expect(bare.unpaged).toHaveLength(1);
  });
});

describe('unpaged-lists audit on the repository (tm 401)', () => {
  it('exits 0 on the committed console sources', () => {
    // execFileSync throws on a non-zero exit, with the report on stdout.
    const output = execFileSync(process.execPath, [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
    expect(output).toContain('UNPAGED: 0');
  });
});
