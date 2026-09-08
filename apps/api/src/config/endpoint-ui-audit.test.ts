/**
 * Pins `scripts/audit/endpoint-ui.cjs` — the report that answers "which
 * contract operation has no client" (tm 215, PLAN §F.1/7).
 *
 * Why here, in a package that has nothing to do with it: the script is a
 * repo-root tool, no workspace package owns it, and the root has no test
 * runner. This directory is already where repo-level artefacts get pinned for
 * exactly that reason — `req-coverage-audit.test.ts` checks the sibling
 * scanner, `migrate-on-start.test.ts` checks a Helm chart, `env.parity` checks
 * `.env.example` against `turbo.json`. Placement also has to satisfy
 * CONVENTIONS §1.3: the gate runs in shards (`test:unit` is `--dir src`,
 * `test:integration` is `--dir test/integration`), so a file outside both would
 * be skipped by every split run.
 *
 * What is worth pinning is not that the script runs. It is that it still asks
 * the RIGHT question. The defect tm 215 fixed was a confident, wrong number:
 * the audit counted paths, so `POST /chats/{chatId}/supervise` having a caller
 * made the whole path covered and the `DELETE` that ends supervision — with no
 * caller in any client — never appeared. tm 213 found that by reading the code.
 * A scanner that answers a coarser question than the one being asked will do
 * the same thing again on the next endpoint, so the first test below is the
 * method blindness itself, reproduced against a synthetic corpus and required
 * to be visible.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// src/config → apps/api → apps → repo root (same resolution as load-env-file.ts)
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/audit/endpoint-ui.cjs');

interface Operation {
  op: string;
  path: string;
  method: string;
  at?: string;
  reason?: string;
  owner?: string;
}
interface Analysis {
  paths: string[];
  operations: Operation[];
  called: Operation[];
  uncalled: Operation[];
  uncalledPaths: string[];
  explained: { headless: Operation[]; indirect: Operation[]; tracked: Operation[] };
  dead: Operation[];
  errors: string[];
}
interface Entry {
  op: string;
  reason: string;
  owner?: string;
  site?: { file: string; contains: string };
}
interface Source {
  file: string;
  lines: string[];
}
interface Module {
  analyse: (input?: {
    spec?: unknown;
    sources?: Source[];
    headless?: Entry[];
    indirect?: Entry[];
    tracked?: Entry[];
  }) => Analysis;
  verbsForPath: (path: string, sources: Source[]) => Map<string, string>;
  HEADLESS: Entry[];
  INDIRECT: Entry[];
  TRACKED: Entry[];
}

// CommonJS, and it reads paths relative to the repo root, so it is required
// rather than imported and the cwd is pinned around the call.
const load = (): Module => createRequire(import.meta.url)(SCRIPT) as Module;
const withRepoRoot = <T>(run: () => T): T => {
  const previous = process.cwd();
  process.chdir(REPO_ROOT);
  try {
    return run();
  } finally {
    process.chdir(previous);
  }
};

/** A one-file corpus, in the shape `analyse` takes. */
const corpus = (file: string, text: string): Source[] => [{ file, lines: text.split('\n') }];

describe('endpoint audit sees methods, not just paths (tm 215)', () => {
  /**
   * The regression that opened this task, reproduced exactly: a path whose
   * `POST` has a caller and whose `DELETE` does not. Under the path-level
   * measure this operation was invisible; here it has to be reported.
   */
  it('reports DELETE /chats/{chatId}/supervise while only its POST is called', () => {
    const spec = {
      paths: {
        '/chats/{chatId}/supervise': { post: {}, delete: {} },
      },
    };
    const sources = corpus(
      'apps/web/src/features/traffic/TrafficPage.tsx',
      [
        'const supervise = useMutation({',
        '  mutationFn: (chatId: string) => api.post(`/chats/${chatId}/supervise`, {}),',
        '});',
      ].join('\n'),
    );

    const analysis = load().analyse({ spec, sources, headless: [], indirect: [], tracked: [] });

    expect(analysis.called.map((operation) => operation.op)).toEqual([
      'POST /chats/{chatId}/supervise',
    ]);
    expect(analysis.dead.map((operation) => operation.op)).toEqual([
      'DELETE /chats/{chatId}/supervise',
    ]);
    // And the old measure is shown to be blind to it, in the same run: at path
    // level nothing is missing at all.
    expect(analysis.uncalledPaths).toEqual([]);
  });

  it('counts the DELETE as called once a client sends it', () => {
    const spec = { paths: { '/chats/{chatId}/supervise': { post: {}, delete: {} } } };
    const sources = corpus(
      'apps/web/src/features/traffic/TrafficPage.tsx',
      [
        'const supervise = useMutation({',
        '  mutationFn: (chatId: string) => api.post(`/chats/${chatId}/supervise`, {}),',
        '});',
        'const release = useMutation({',
        '  mutationFn: (chatId: string) => api.delete(`/chats/${chatId}/supervise`),',
        '});',
      ].join('\n'),
    );

    const analysis = load().analyse({ spec, sources, headless: [], indirect: [], tracked: [] });

    expect(analysis.dead).toEqual([]);
    expect(analysis.called).toHaveLength(2);
  });

  /**
   * A collection endpoint must not answer for the item under it. This is the
   * KB categories finding in miniature: `POST /kb-categories` was called, and
   * the path matcher's tolerance was what let it stand in for the item path.
   */
  it('does not let a collection call answer for the item beneath it', () => {
    const spec = {
      paths: { '/kb-categories': { post: {} }, '/kb-categories/{categoryId}': { patch: {} } },
    };
    const sources = corpus(
      'apps/web/src/features/playbook/KbArticleEditor.tsx',
      "const created = await api.post<KbCategory>('/kb-categories', { name });",
    );

    const analysis = load().analyse({ spec, sources, headless: [], indirect: [], tracked: [] });

    expect(analysis.dead.map((operation) => operation.op)).toEqual([
      'PATCH /kb-categories/{categoryId}',
    ]);
  });

  it('reads the mobile client’s literal placeholders as well as template literals', () => {
    const spec = { paths: { '/chats/{chatId}/events': { get: {}, post: {} } } };
    const sources = corpus(
      'apps/mobile/src/features/inbox/api.ts',
      [
        "      return client.request('get', '/chats/{chatId}/events', {",
        '        params: { chatId },',
        '      });',
      ].join('\n'),
    );

    const analysis = load().analyse({ spec, sources, headless: [], indirect: [], tracked: [] });

    expect(analysis.called.map((operation) => operation.op)).toEqual([
      'GET /chats/{chatId}/events',
    ]);
    expect(analysis.dead.map((operation) => operation.op)).toEqual(['POST /chats/{chatId}/events']);
  });

  /**
   * A URL built away from its call site — every `usePagedQuery` `buildUrl`, and
   * `useInbox`'s `chatListUrl` — has no verb beside it. Reading those as GET is
   * what keeps the report from calling half the console dead; the cost is that
   * a bare URL cannot vouch for anything else, which is the other half of this.
   */
  it('reads a URL with no verb near it as a GET, and only a GET', () => {
    const spec = { paths: { '/chats': { get: {}, post: {} } } };
    const sources = corpus(
      'apps/web/src/features/inbox/useInbox.ts',
      [
        'function chatListUrl(view: InboxView, pageId: string | undefined): string {',
        '  return `/chats?view=${view}&limit=${CHAT_PAGE_SIZE}`;',
        '}',
      ].join('\n'),
    );

    const analysis = load().analyse({ spec, sources, headless: [], indirect: [], tracked: [] });

    expect(analysis.called.map((operation) => operation.op)).toEqual(['GET /chats']);
    expect(analysis.dead.map((operation) => operation.op)).toEqual(['POST /chats']);
  });

  it('ignores a path that only a comment mentions', () => {
    const spec = { paths: { '/reports/access-review': { get: {} } } };
    const sources = corpus(
      'apps/web/src/features/audit/AuditLogPage.tsx',
      ['/**', ' * See `GET /reports/access-review` for the CC6.1 evidence.', ' */'].join('\n'),
    );

    const analysis = load().analyse({ spec, sources, headless: [], indirect: [], tracked: [] });

    expect(analysis.dead.map((operation) => operation.op)).toEqual(['GET /reports/access-review']);
  });
});

describe('the three lists have to stay honest (tm 215)', () => {
  it('errors on a list entry whose operation now has a caller', () => {
    const spec = { paths: { '/health/live': { get: {} } } };
    const sources = corpus('apps/web/src/lib/probe.ts', "api.get('/health/live');");

    const analysis = load().analyse({
      spec,
      sources,
      headless: [{ op: 'GET /health/live', reason: 'the liveness probe.' }],
      indirect: [],
      tracked: [],
    });

    expect(analysis.errors).toEqual([
      'headless: GET /health/live IS called now — the surface arrived, drop the entry',
    ]);
  });

  it('errors on an entry with no reason, and on one the contract dropped', () => {
    const spec = { paths: { '/health/live': { get: {} } } };
    const analysis = load().analyse({
      spec,
      sources: [],
      headless: [
        { op: 'GET /health/live', reason: '  ' },
        { op: 'GET /health/gone', reason: 'a path nobody serves any more.' },
      ],
      indirect: [],
      tracked: [],
    });

    expect(analysis.errors).toContain('headless: GET /health/live has no reason');
    expect(analysis.errors).toContain(
      'headless: GET /health/gone is not an operation in the contract',
    );
  });

  it('errors on a tracked debt with no owning task', () => {
    const spec = { paths: { '/kb-settings': { put: {} } } };
    const analysis = load().analyse({
      spec,
      sources: [],
      headless: [],
      indirect: [],
      tracked: [{ op: 'PUT /kb-settings', reason: 'no screen turns the public KB on.' }],
    });

    expect(analysis.errors).toContain('tracked: PUT /kb-settings names no owning task');
  });

  /**
   * The `INDIRECT` list is the one that could quietly become a lie: it claims a
   * call exists that the scanner cannot see. So the claim is checked against
   * the file, not taken on trust — delete the call and the entry goes red.
   */
  it('errors when an indirect entry points at a call that is gone or sends another verb', () => {
    const spec = { paths: { '/reports/breakdown': { get: {} } } };
    const entry = {
      op: 'GET /reports/breakdown',
      reason: 'one call site for every report tab.',
      site: {
        file: 'apps/web/src/features/reports/ReportsPage.tsx',
        contains: '`/reports/${kind}?',
      },
    };

    const gone = load().analyse({
      spec,
      sources: corpus('apps/web/src/features/reports/ReportsPage.tsx', 'const tabs = [];'),
      headless: [],
      indirect: [entry],
      tracked: [],
    });
    expect(gone.errors).toEqual([
      'indirect: GET /reports/breakdown — `' +
        entry.site.contains +
        '` is no longer in apps/web/src/features/reports/ReportsPage.tsx',
    ]);

    const wrongVerb = load().analyse({
      spec,
      sources: corpus(
        'apps/web/src/features/reports/ReportsPage.tsx',
        'api.post<T>(`/reports/${kind}?${reportQuery(range)}`);',
      ),
      headless: [],
      indirect: [entry],
      tracked: [],
    });
    expect(wrongVerb.errors).toEqual([
      'indirect: GET /reports/breakdown — the call at ' +
        'apps/web/src/features/reports/ReportsPage.tsx:1 sends post, not get',
    ]);
  });
});

describe('the repo as it stands', () => {
  it('has no unexplained dead end and no stale list entry', () => {
    const analysis = withRepoRoot(() => load().analyse());

    // The measurable close of tm 215: every uncalled operation is accounted
    // for, in writing, in one of the three lists.
    expect(analysis.dead).toEqual([]);
    expect(analysis.errors).toEqual([]);
    expect(analysis.operations.length).toBeGreaterThan(analysis.paths.length);
    expect(analysis.called.length + analysis.uncalled.length).toBe(analysis.operations.length);
  });

  it('gives every list entry a reason, and every tracked debt an owner', () => {
    const audit = load();

    for (const entry of [...audit.HEADLESS, ...audit.INDIRECT, ...audit.TRACKED]) {
      expect(entry.reason.trim().length, entry.op).toBeGreaterThan(0);
    }
    for (const entry of audit.INDIRECT) {
      expect(entry.site?.file, entry.op).toBeTruthy();
      expect(entry.site?.contains, entry.op).toBeTruthy();
    }
    for (const entry of audit.TRACKED) {
      // A gap with a name and an owner is recorded; one with neither is hidden
      // (the §D145 discipline, and why `TRACKED` is a separate list at all).
      expect(entry.owner, entry.op).toMatch(/^tm \d+/);
    }
  });

  it('still calls the two supervise operations, the surface tm 213 completed', () => {
    const analysis = withRepoRoot(() => load().analyse());
    const ops = analysis.called.map((operation) => operation.op);

    expect(ops).toContain('POST /chats/{chatId}/supervise');
    expect(ops).toContain('DELETE /chats/{chatId}/supervise');
  });
});
