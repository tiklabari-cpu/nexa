/**
 * Pins `scripts/audit/url-pii.mjs` (GV-05 · tm 386) — the CI step that keeps a
 * person's e-mail, name, username or phone, and whatever was typed into a
 * search box, out of every address the apps build. Placed beside
 * `log-keys-audit.test.ts` for the reason that file gives: the script is a
 * repo-root tool and this directory is where repo-level artefacts get pinned.
 *
 * Pinned: the three shapes an address is built in are each caught; a comment,
 * a non-personal key and a marked API request are not; a marker with no reason
 * is a finding of its own; the scan roots are globbed (so `apps/admin` is in
 * without anyone listing it) and the repository is clean today.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/audit/url-pii.mjs');

interface Finding {
  file: string;
  line: number;
  key: string;
  kind: 'search-param' | 'builder-object' | 'literal';
  reason?: string;
}
interface Audit {
  PII_KEYS: string[];
  findUrlPii: (source: string, file?: string) => Finding[];
  scanRoots: () => string[];
  auditRepository: () => { roots: string[]; scanned: number; findings: Finding[] };
}

let audit: Audit;
beforeAll(async () => {
  audit = (await import(pathToFileURL(SCRIPT).href)) as Audit;
});

const shape = (findings: Finding[]) => findings.map((f) => `${f.line}:${f.key}:${f.kind}`);

describe('scripts/audit/url-pii.mjs (GV-05)', () => {
  it('goes red on a search box, an e-mail or a name written into an address', () => {
    const source = [
      'const next = new URLSearchParams(searchParams);',
      "next.set('q', text);",
      "searchParams.append('email', customer.email);",
      'setSearchParams({ search: term, page: 2 });',
      'const p = new URLSearchParams({ username: login });',
      'navigate(`/app/customers?email=${encodeURIComponent(email)}`);',
      '<a href="/profile?name=Jane">x</a>;',
      "location.assign('/x?segment=all&phone=' + phone);",
    ].join('\n');

    expect(shape(audit.findUrlPii(source, 'x.tsx'))).toEqual([
      '2:q:search-param',
      '3:email:search-param',
      '4:search:builder-object',
      '5:username:builder-object',
      '6:email:literal',
      '7:name:literal',
      '8:phone:literal',
    ]);
  });

  it('leaves ids, non-personal filters, comments and a marked API request alone', () => {
    const source = [
      "params.set('chat', chatId);",
      "params.set('segment', 'leads');",
      'setSearchParams({ c: threadId, status: "open" });',
      'navigate(`/app/inbox?chat=${chat.id}`);',
      "// navigate('/x?email=a')",
      '/* params.set("q", x) */',
      'const filters = new Map(); filters.set(name, value);',
      '// url-pii-ok: API request, not the address bar',
      "if (q) params.set('q', q);",
      'api.get(`/search?query=${query}`); // url-pii-ok: API request; the log masks it',
    ].join('\n');

    expect(audit.findUrlPii(source)).toEqual([]);
  });

  it('counts a marker that gives no reason as a finding', () => {
    const found = audit.findUrlPii("// url-pii-ok:\nparams.set('email', e);", 'y.ts');
    expect(found).toEqual([
      {
        file: 'y.ts',
        line: 2,
        key: 'email',
        kind: 'search-param',
        reason: 'url-pii-ok marker without a reason',
      },
    ]);
  });

  it('knows the keys the rule names', () => {
    expect(audit.PII_KEYS).toEqual(['email', 'name', 'username', 'phone', 'query', 'q', 'search']);
  });

  it('globs every app and package, the platform panel included, and finds nothing today', () => {
    const roots = audit.scanRoots();
    for (const app of ['apps/web/src', 'apps/admin/src', 'apps/widget/src', 'apps/api/src']) {
      expect(roots).toContain(app);
    }
    const { scanned, findings } = audit.auditRepository();
    expect(scanned).toBeGreaterThan(500);
    expect(findings).toEqual([]);
  });
});
