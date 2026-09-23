/**
 * The embedding seam has one door (tm 255.7).
 *
 * `embed()` from `@nexa/ai-mock` is the lexical stub's algorithm. Before the
 * seam it was also how the knowledge service embedded; now a vector that is
 * written to the index or compared with one has to come through the configured
 * `EmbeddingProvider`, which knows the space it writes. A second direct caller
 * in production code would be exactly the regression this rules out: a vector
 * that is the stub's while the deployment's questions are a model's, stored or
 * searched without a space to go with it — the failure that looks like a
 * knowledge base that stopped answering.
 *
 * Two callers are allowed, and each is a decision rather than an oversight:
 *
 * - `mock-embedding-provider.ts` is the stub, behind the seam.
 * - `report-csv.ts` clusters the topic report with the lexical embedding on
 *   purpose (PLAN §D182): nothing it computes is stored or compared with the
 *   index, and a remote provider would send up to two windows of customer
 *   messages to a third party on every report view.
 *
 * Read as text, the way `schema-consumers-audit.test.ts` reads the schema: an
 * import is a fact about a file, and `git grep` would not see a file that is
 * new in the working tree.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const ALLOWED = new Set([
  'services/ai/provider/mock-embedding-provider.ts',
  'services/reports/report-csv.ts',
]);

function productionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

/** The names a file imports from `@nexa/ai-mock`, as written before any `as`. */
function aiMockImports(source: string): { named: string[]; namespace: boolean } {
  const named: string[] = [];
  for (const match of source.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@nexa\/ai-mock'/g,
  )) {
    for (const specifier of match[1]!.split(',')) {
      const name = specifier
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]!
        .trim();
      if (name) named.push(name);
    }
  }
  const namespace = /import\s+\*\s+as\s+\w+\s+from\s*'@nexa\/ai-mock'/.test(source);
  return { named, namespace };
}

describe('embeddings reach the index only through the provider seam (FR-MOD-06.3.2)', () => {
  const files = productionSources(SRC).map((path) => ({
    path: relative(SRC, path).split(sep).join('/'),
    imports: aiMockImports(readFileSync(path, 'utf8')),
  }));

  it('reads a non-trivial source tree (guards a broken walk passing vacuously)', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files.some((file) => file.imports.named.includes('chunk'))).toBe(true);
  });

  it('lets only the stub and the topic report call the lexical embed() directly', () => {
    const callers = files
      .filter((file) => file.imports.named.includes('embed'))
      .map((file) => file.path)
      .sort();
    expect(callers).toEqual([...ALLOWED].sort());
  });

  it('leaves no namespace import that could reach embed() unseen', () => {
    expect(files.filter((file) => file.imports.namespace).map((file) => file.path)).toEqual([]);
  });
});
